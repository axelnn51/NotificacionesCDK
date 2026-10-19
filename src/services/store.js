const fs = require('fs');
const path = require('path');
const config = require('../config');

class Store {
  constructor() {
    this.dataDir = config.dataDir;
    this.ordersFilePath = path.join(this.dataDir, 'orders_state.json');
    this.pcFilePath = path.join(this.dataDir, 'pc_state.json');

    this.orders = {}; // { [orderId]: { id, number, status, total, currency, customer, date_modified, notifiedAt } }
    this.pc = {
      lastHeartbeat: 0,
      hostname: 'Desconocido',
      platform: 'win32',
      uptimeSeconds: 0,
      localIp: 'N/A',
      pendingCommand: null,
      commandId: null,
      commandIssuedAt: 0,
      lastAck: null
    };

    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (err) {
      console.error('[Store] Error creando directorio de datos:', err.message);
    }
  }

  _load() {
    // Cargar órdenes
    try {
      if (fs.existsSync(this.ordersFilePath)) {
        const raw = fs.readFileSync(this.ordersFilePath, 'utf8');
        this.orders = JSON.parse(raw);
        console.log(`[Store] ${Object.keys(this.orders).length} pedidos cargados del almacenamiento local.`);
      }
    } catch (err) {
      console.error('[Store] Error leyendo orders_state.json, inicializando vacío:', err.message);
      this.orders = {};
    }

    // Cargar estado de la PC
    try {
      if (fs.existsSync(this.pcFilePath)) {
        const raw = fs.readFileSync(this.pcFilePath, 'utf8');
        this.pc = { ...this.pc, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('[Store] Error leyendo pc_state.json:', err.message);
    }
  }

  _saveOrders() {
    try {
      this._ensureDir();
      const tmpPath = `${this.ordersFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.orders, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.ordersFilePath);
    } catch (err) {
      console.error('[Store] Error guardando orders_state.json:', err.message);
    }
  }

  _savePc() {
    try {
      this._ensureDir();
      const tmpPath = `${this.pcFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.pc, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.pcFilePath);
    } catch (err) {
      console.error('[Store] Error guardando pc_state.json:', err.message);
    }
  }

  // --- MÉTODOS PARA PEDIDOS ---

  isOrderTracked(orderId) {
    return Boolean(this.orders[String(orderId)]);
  }

  getOrder(orderId) {
    return this.orders[String(orderId)] || null;
  }

  getOrderCount() {
    return Object.keys(this.orders).length;
  }

  recordOrder(order, notifiedAt = Date.now()) {
    const id = String(order.id);
    const existing = this.orders[id] || {};

    this.orders[id] = {
      id: order.id,
      number: order.number || order.id,
      status: order.status,
      total: order.total,
      currency: order.currency_symbol || order.currency || 'PEN',
      customer: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'Cliente',
      date_created: order.date_created,
      date_modified: order.date_modified,
      notifiedAt: notifiedAt || existing.notifiedAt || Date.now(),
      // Preservar los IDs de mensajes de Telegram enviados a cada chat
      telegramMessages: existing.telegramMessages || {}
    };

    this._saveOrders();
  }

  setOrderTelegramMessage(orderId, chatId, messageId) {
    const id = String(orderId);
    if (!this.orders[id]) {
      this.orders[id] = { id: orderId, telegramMessages: {} };
    }
    if (!this.orders[id].telegramMessages) {
      this.orders[id].telegramMessages = {};
    }
    this.orders[id].telegramMessages[String(chatId)] = messageId;
    this._saveOrders();
  }

  getOrderTelegramMessage(orderId, chatId) {
    const id = String(orderId);
    return this.orders[id]?.telegramMessages?.[String(chatId)] || null;
  }

  getOrderTelegramMessages(orderId) {
    const id = String(orderId);
    return this.orders[id]?.telegramMessages || {};
  }

  // Registra un lote de órdenes iniciales sin notificar
  initializeBatch(orders) {
    let count = 0;
    for (const order of orders) {
      const id = String(order.id);
      if (!this.orders[id]) {
        this.orders[id] = {
          id: order.id,
          number: order.number || order.id,
          status: order.status,
          total: order.total,
          currency: order.currency_symbol || order.currency || 'PEN',
          customer: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'Cliente',
          date_created: order.date_created,
          date_modified: order.date_modified,
          notifiedAt: Date.now(),
          telegramMessages: {}
        };
        count++;
      }
    }
    if (count > 0) {
      this._saveOrders();
    }
    return count;
  }

  // --- MÉTODOS PARA AGENTE PC ---

  updatePcHeartbeat(data = {}) {
    this.pc.lastHeartbeat = Date.now();
    if (data.hostname) this.pc.hostname = data.hostname;
    if (data.platform) this.pc.platform = data.platform;
    if (typeof data.uptimeSeconds === 'number') this.pc.uptimeSeconds = data.uptimeSeconds;
    if (data.localIp) this.pc.localIp = data.localIp;

    this._savePc();
  }

  isPcOnline(thresholdSeconds = config.pcAgent.offlineThresholdSeconds) {
    if (!this.pc.lastHeartbeat) return false;
    const diffSeconds = (Date.now() - this.pc.lastHeartbeat) / 1000;
    return diffSeconds <= thresholdSeconds;
  }

  getPcStatus() {
    return {
      online: this.isPcOnline(),
      hostname: this.pc.hostname,
      platform: this.pc.platform,
      uptimeSeconds: this.pc.uptimeSeconds,
      localIp: this.pc.localIp,
      lastHeartbeat: this.pc.lastHeartbeat,
      pendingCommand: this.pc.pendingCommand,
      commandIssuedAt: this.pc.commandIssuedAt
    };
  }

  queuePcCommand(command) {
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.pc.pendingCommand = command;
    this.pc.commandId = commandId;
    this.pc.commandIssuedAt = Date.now();
    this._savePc();
    return { commandId, command };
  }

  getPcPendingCommand() {
    return {
      command: this.pc.pendingCommand,
      commandId: this.pc.commandId
    };
  }

  ackPcCommand(commandId, result = {}) {
    if (this.pc.commandId === commandId) {
      this.pc.pendingCommand = null;
      this.pc.commandId = null;
      this.pc.lastAck = {
        commandId,
        time: Date.now(),
        result
      };
      this._savePc();
      return true;
    }
    return false;
  }
}

module.exports = new Store();
