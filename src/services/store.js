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
      lastAck: null,
      shuttingDown: false,
      shuttingDownAt: 0,
      lastShutdownAt: 0
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
        this._checkShutdownTimeout();
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

  _sanitizeHostname(name) {
    if (!name || typeof name !== 'string') return 'PC';
    return name
      .replace(/\uFFFD/g, 'ú')
      .replace(/CDKEYSPER[Úú]?/i, 'CDKeysPerú');
  }

  _checkShutdownTimeout() {
    if (this.pc.shuttingDown) {
      const elapsed = Date.now() - (this.pc.shuttingDownAt || 0);
      // Tras 25 segundos (Windows ejecuta shutdown /s /f /t 5), el apagado concluyó
      if (elapsed > 25000) {
        this.pc.shuttingDown = false;
        this.pc.shuttingDownAt = 0;
        if (!this.pc.lastShutdownAt) {
          this.pc.lastShutdownAt = Date.now();
        }
        this._savePc();
      }
    }
  }

  completeShutdown() {
    this.pc.shuttingDown = false;
    this.pc.shuttingDownAt = 0;
    this.pc.lastShutdownAt = Date.now();
    this._savePc();
  }

  updatePcHeartbeat(data = {}) {
    this.pc.lastHeartbeat = Date.now();
    this.pc.shuttingDown = false;
    this.pc.shuttingDownAt = 0;
    this.pc.lastShutdownAt = 0;
    if (data.hostname) this.pc.hostname = this._sanitizeHostname(data.hostname);
    if (data.platform) this.pc.platform = data.platform;
    if (typeof data.uptimeSeconds === 'number') this.pc.uptimeSeconds = data.uptimeSeconds;
    if (data.localIp) this.pc.localIp = data.localIp;

    this._savePc();
  }

  isPcOnline(thresholdSeconds = config.pcAgent.offlineThresholdSeconds) {
    this._checkShutdownTimeout();
    if (this.pc.shuttingDown) return false;
    if (this.pc.lastShutdownAt && this.pc.lastShutdownAt >= this.pc.lastHeartbeat) {
      return false;
    }
    if (!this.pc.lastHeartbeat) return false;
    const diffSeconds = (Date.now() - this.pc.lastHeartbeat) / 1000;
    return diffSeconds <= thresholdSeconds;
  }

  getPcStatus() {
    this._checkShutdownTimeout();
    return {
      online: this.isPcOnline(),
      shuttingDown: Boolean(this.pc.shuttingDown),
      hostname: this._sanitizeHostname(this.pc.hostname),
      platform: this.pc.platform,
      uptimeSeconds: this.pc.uptimeSeconds,
      localIp: this.pc.localIp,
      lastHeartbeat: this.pc.lastHeartbeat,
      lastShutdownAt: this.pc.lastShutdownAt || 0,
      pendingCommand: this.pc.pendingCommand,
      commandIssuedAt: this.pc.commandIssuedAt
    };
  }

  queuePcCommand(command) {
    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.pc.pendingCommand = command;
    this.pc.commandId = commandId;
    this.pc.commandIssuedAt = Date.now();
    if (command === 'shutdown') {
      this.pc.shuttingDown = true;
      this.pc.shuttingDownAt = Date.now();
    }
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
      if (result.status === 'shutdown_initiated' || result.status === 'executing') {
        this.pc.shuttingDown = true;
        this.pc.shuttingDownAt = Date.now();
        this.pc.lastShutdownAt = Date.now();
      }
      this._savePc();
      return true;
    }
    return false;
  }
}

module.exports = new Store();
