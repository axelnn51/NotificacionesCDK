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
   * Obtiene la marca de tiempo precisa de un pedido considerando GMT o zona horaria de Perú
   */
  _getOrderTimestamp(order) {
    if (!order) return Date.now();
    const dateStr = order.date_created_gmt || order.date_created;
    if (!dateStr) return Date.now();
    if (typeof dateStr !== 'string') return new Date(dateStr).getTime();

    if (dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
      return new Date(dateStr).getTime();
    }
    if (order.date_created_gmt) {
      return new Date(`${dateStr}Z`).getTime();
    }
    // Hora local de Perú (America/Lima UTC-5)
    return new Date(`${dateStr}-05:00`).getTime();
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
      const orders = await woocommerce.getRecentOrders({ per_page: 50, status: 'any' });

      const fourHoursMs = 4 * 60 * 60 * 1000;
      const now = Date.now();

      // Filtrar históricos (pedidos con más de 4 horas)
      const historicalOrders = orders.filter(o => {
        const orderTime = this._getOrderTimestamp(o);
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
      // 1. Obtener pedidos recientes por fecha de creación (con status: 'any')
      const recentByDate = await woocommerce.getRecentOrders({
        per_page: config.woocommerce.pollBatchSize || 20,
        orderby: 'date',
        order: 'desc',
        status: 'any'
      });

      // 2. Obtener pedidos recientes por fecha de modificación (para detectar cambios en pedidos antiguos)
      const recentByModified = await woocommerce.getRecentOrders({
        per_page: config.woocommerce.pollBatchSize || 20,
        orderby: 'modified',
        order: 'desc',
        status: 'any'
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
   * Procesa un pedido individual: detecta si es nuevo, si no fue notificado, o si cambió de estado
   */
  async processOrder(order) {
    if (!order || !order.id) return 'IGNORED';

    const orderId = String(order.id);
    const tracked = store.getOrder(orderId);
    const hasBeenNotified = store.hasOrderBeenNotified(orderId);

    const orderTime = this._getOrderTimestamp(order);
    const ageHours = (Date.now() - orderTime) / (1000 * 3600);

    // CASO A: Pedido no registrado y con más de 24h de antigüedad (histórico puro)
    if (!tracked && ageHours > 24) {
      console.log(`[OrderMonitor] 📦 Pedido histórico detectado #${order.id} (${order.status}, ${ageHours.toFixed(1)}h atrás). Registrado sin alerta.`);
      store.recordOrder(order);
      return 'HISTORICAL';
    }

    // CASO B: Pedido nuevo O pedido registrado que jamás se notificó con éxito a Telegram
    if (!tracked || !hasBeenNotified) {
      console.log(`[OrderMonitor] 🛒 ¡Notificando pedido #${order.id} (${order.status}, age: ${ageHours.toFixed(1)}h)!`);
      store.recordOrder(order);
      const delivered = await telegram.sendOrUpdateOrderNotification(order, null);
      if (delivered) {
        return 'NEW';
      }
      console.warn(`[OrderMonitor] ⚠️ No se pudo entregar notificación de pedido #${order.id}. Se reintentará en el próximo ciclo.`);
      return 'RETRY_PENDING';
    }

    // CASO C: El pedido ya fue notificado previamente, pero su estado cambió en WooCommerce
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
