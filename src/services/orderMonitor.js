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

    // Inicializar estado previo si está vacío
    await this._syncInitialState();

    // Iniciar ciclo de sondeo periódico
    this.timer = setInterval(() => {
      this.checkOrders().catch(err => {
        console.error('[OrderMonitor] Error no capturado en ciclo de sondeo:', err.message);
      });
    }, this.pollInterval);

    console.log(`[OrderMonitor] Sondeo activo cada ${config.woocommerce.pollIntervalSeconds}s.`);
  }

  /**
   * Sincroniza el lote inicial para evitar notificar pedidos antiguos en el primer arranque
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
      const orders = await woocommerce.getRecentOrders({ per_page: 30 });
      const added = store.initializeBatch(orders);
      console.log(`[OrderMonitor] ${added} pedidos históricos indexados como estado inicial. ¡Listo para nuevas alertas!`);
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

      for (const order of uniqueOrders) {
        const result = await this.processOrder(order);
        if (result === 'NEW') newOrdersCount++;
        if (result === 'UPDATED') statusUpdatesCount++;
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
