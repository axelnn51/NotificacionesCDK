const express = require('express');
const webhookRoutes = require('./routes/webhook');
const pcApiRoutes = require('./routes/pcApi');
const store = require('../services/store');
const woocommerce = require('../services/woocommerce');

const orderMonitor = require('../services/orderMonitor');

const app = express();

// Middlewares globales
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Rutas principales
app.use('/webhook', webhookRoutes);
app.use('/api/pc', pcApiRoutes);

// Endpoint manual de sincronización para pruebas o webhooks externos
app.all('/api/sync', async (req, res) => {
  const config = require('../config');
  if (!config.woocommerce.enabled) {
    return res.json({ ok: true, message: 'Modo Control Remoto puro activo. Notificaciones de WooCommerce delegadas a YapeBot.' });
  }
  try {
    const result = await orderMonitor.checkOrders();
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para forzar reintento de pedidos no notificados
app.all('/api/sync/missed', async (req, res) => {
  const config = require('../config');
  if (!config.woocommerce.enabled) {
    return res.json({ ok: true, message: 'Modo Control Remoto puro activo. Notificaciones de WooCommerce delegadas a YapeBot.' });
  }
  try {
    const telegram = require('../bot/telegram');
    const recent = await woocommerce.getRecentOrders({ per_page: 30, status: 'any' });
    let resent = 0;
    for (const order of recent) {
      if (!store.hasOrderBeenNotified(order.id)) {
        store.recordOrder(order);
        const delivered = await telegram.sendOrUpdateOrderNotification(order, null);
        if (delivered) resent++;
        await new Promise(r => setTimeout(r, 400));
      }
    }
    return res.json({ ok: true, resentCount: resent });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Diagnóstico detallado del sistema
app.get('/api/diag', (req, res) => {
  const telegram = require('../bot/telegram');
  const config = require('../config');
  const pcStatus = store.getPcStatus();

  return res.json({
    ok: true,
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      timezone: config.timezone
    },
    telegram: {
      configured: Boolean(config.telegram.token),
      isReady: telegram.isReady,
      adminChatIdsCount: config.telegram.adminChatIds.length,
      adminChatIdsMasked: config.telegram.adminChatIds.map(id => id.replace(/\d(?=\d{3})/g, '*'))
    },
    woocommerce: {
      isConfigured: woocommerce.isConfigured,
      url: config.woocommerce.url,
      pollIntervalSeconds: config.woocommerce.pollIntervalSeconds,
      pollBatchSize: config.woocommerce.pollBatchSize
    },
    pc: pcStatus,
    store: {
      trackedOrdersCount: store.getOrderCount(),
      unnotifiedOrdersCount: store.getUnnotifiedOrders(48).length
    }
  });
});

// Health check para Docker / Portainer
app.get('/health', (req, res) => {
  const telegram = require('../bot/telegram');
  const config = require('../config');
  const pcStatus = store.getPcStatus();

  return res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    trackedOrders: store.getOrderCount(),
    woocommerceConfigured: woocommerce.isConfigured,
    telegramConfigured: Boolean(config.telegram.token),
    telegramReady: telegram.isReady,
    adminChatIdsCount: config.telegram.adminChatIds.length,
    pcOnline: pcStatus.online,
    pcHostname: pcStatus.hostname
  });
});

// Manejador 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores
app.use((err, req, res, next) => {
  console.error('[Server] Error no controlado:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
