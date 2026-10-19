const config = require('../config');
const store = require('./store');
const woocommerce = require('./woocommerce');
const telegram = require('../bot/telegram');
const formatters = require('../bot/formatters');

class OrderMonitor {
  constructor() {
    this.pollInterval = config.woocommerce.pollIntervalSeconds * 1000;
    this.timer = null;
    this.isPolling = false;
    this.isInitialized = false;

    // Enlazar sync manual desde Telegram
    telegram.onManualSyncRequested = () => this.checkOrders();
  }

  /**
   * Inicializa el monitor y sincroniza el estado inicial de pedidos
   */
  async start() {
    console.log('[OrderMonitor] Iniciando monitor de pedidos (Solo Lectura)...');

    // 1. Inicializar estado previo si está vacío (indexando solo pedidos antiguos > 4h)
    await this._syncInitialState();

    // 2. Ejecutar de inmediato una primera verificación sin esperar al timer
    this.checkOrders().catch(err => {
      console.error('[OrderMonitor] Error en primera verificación de pedidos:', err.message);
    });

    // 3. Iniciar ciclo de sondeo periódico
    this.timer = setInterval(() => {
      this.checkOrders().catch(err => {
        console.error('[OrderMonitor] Error no capturado en ciclo de sondeo:', err.message);
      });
    }, this.pollInterval);

    console.log(`[OrderMonitor] Sondeo activo cada ${config.woocommerce.pollIntervalSeconds}s.`);
  }

  /**
   * Sincroniza el lote inicial.
   * IMPORTANTE: Indexa silenciosamente solo pedidos con más de 4 horas de antigüedad.
   * Los pedidos recientes (< 4 horas) se dejan para ser notificados en el primer ciclo.
   */
  async _syncInitialState() {
    const existingCount = store.getOrderCount();

    if (existingCount > 0) {
      console.log(`[OrderMonitor] Estado existente encontrado con ${existingCount} pedidos registrados.`);
      this.isInitialized = true;
      return;
    }

    try {
      console.log('[OrderMonitor] Primer arranque: obteniendo pedidos recientes para inicializar base de datos local...');
      const orders = await woocommerce.getRecentOrders({ per_page: 50 });

      const fourHoursMs = 4 * 60 * 60 * 1000;
      const now = Date.now();

      // Filtrar históricos (pedidos con más de 4 horas)
      const historicalOrders = orders.filter(o => {
        const orderTime = o.date_created_gmt ? new Date(o.date_created_gmt + 'Z').getTime() : new Date(o.date_created).getTime();
        return (now - orderTime) > fourHoursMs;
      });

      const added = store.initializeBatch(historicalOrders);
      console.log(`[OrderMonitor] ${added} pedidos históricos (>4h) indexados como estado inicial.`);
      console.log(`[OrderMonitor] ${orders.length - added} pedidos recientes detectados (<4h), listos para alertar en Telegram.`);
      this.isInitialized = true;
    } catch (err) {
      console.error('[OrderMonitor] Error en inicialización de estado:', err.message);
      // Continuar para permitir reintento en el siguiente ciclo
      this.isInitialized = true;
    }
  }

  /**
   * Ejecuta una revisión completa de pedidos recientes (por fecha y por modificación)
   */
  async checkOrders() {
    if (this.isPolling) {
      return { newOrders: 0, statusUpdates: 0 };
    }

    this.isPolling = true;
    let newOrdersCount = 0;
    let statusUpdatesCount = 0;

    try {
      // 1. Obtener pedidos recientes por fecha de creación
      const recentByDate = await woocommerce.getRecentOrders({
        per_page: config.woocommerce.pollBatchSize || 20,
        orderby: 'date',
        order: 'desc'
      });

      // 2. Obtener pedidos recientes por fecha de modificación (para detectar cambios en pedidos antiguos)
      const recentByModified = await woocommerce.getRecentOrders({
        per_page: config.woocommerce.pollBatchSize || 20,
        orderby: 'modified',
        order: 'desc'
      });

      // Unir sin duplicados
      const map = new Map();
      [...recentByDate, ...recentByModified].forEach(o => {
        if (o && o.id) map.set(o.id, o);
      });
      const uniqueOrders = Array.from(map.values());

      // Ordenar cronológicamente (ID ascendente) para que en Telegram los mensajes
      // aparezcan en orden y el más reciente quede al final del chat.
      uniqueOrders.sort((a, b) => Number(a.id) - Number(b.id));

      for (const order of uniqueOrders) {
        const result = await this.processOrder(order);
        if (result === 'NEW') {
          newOrdersCount++;
          // Pequeña pausa de 400ms para evitar rate-limiting de Telegram y preservar orden
          await new Promise(r => setTimeout(r, 400));
        }
        if (result === 'UPDATED') {
          statusUpdatesCount++;
          await new Promise(r => setTimeout(r, 400));
        }
      }
    } catch (err) {
      console.error('[OrderMonitor] Error en checkOrders:', err.message);
    } finally {
      this.isPolling = false;
    }

    return { newOrders: newOrdersCount, statusUpdates: statusUpdatesCount };
  }

  /**
   * Procesa un pedido individual: detecta si es nuevo o si cambió su estado
   */
  async processOrder(order) {
    if (!order || !order.id) return 'IGNORED';

    const orderId = String(order.id);
    const tracked = store.getOrder(orderId);

    // CASO 1: Pedido totalmente nuevo
    if (!tracked) {
      const orderTime = order.date_created_gmt ? new Date(order.date_created_gmt + 'Z').getTime() : new Date(order.date_created).getTime();
      const ageHours = (Date.now() - orderTime) / (1000 * 3600);

      // Si por alguna razón es un pedido antiguo (> 6 horas) que no estaba en el estado, registrarlo sin alertar
      if (ageHours > 6) {
        console.log(`[OrderMonitor] 📦 Pedido histórico detectado #${order.id} (${order.status}, ${ageHours.toFixed(1)}h atrás). Registrado sin alerta.`);
        store.recordOrder(order);
        return 'HISTORICAL';
      }

      console.log(`[OrderMonitor] 🛒 ¡Nuevo pedido detectado! #${order.id} (${order.status})`);
      store.recordOrder(order);
      await telegram.sendOrUpdateOrderNotification(order, null);
      return 'NEW';
    }

    // CASO 2: El pedido ya existía, pero su estado cambió (se actualiza el mismo mensaje en tiempo real)
    if (tracked.status !== order.status) {
      console.log(`[OrderMonitor] 🔄 Cambio de estado en pedido #${order.id}: ${tracked.status} -> ${order.status}`);
      const oldStatus = tracked.status;
      store.recordOrder(order);
      await telegram.sendOrUpdateOrderNotification(order, oldStatus);
      return 'UPDATED';
    }

    return 'UNCHANGED';
  }

  /**
   * Método público para procesar eventos provenientes de Webhooks de WooCommerce
   */
  async handleWebhookOrder(order) {
    console.log(`[OrderMonitor] Evento Webhook recibido para pedido #${order?.id}`);
    return await this.processOrder(order);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[OrderMonitor] Sondeo de pedidos detenido.');
    }
  }
}

module.exports = new OrderMonitor();
