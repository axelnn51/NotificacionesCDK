const express = require('express');
const webhookRoutes = require('./routes/webhook');
const pcApiRoutes = require('./routes/pcApi');
const store = require('../services/store');
const woocommerce = require('../services/woocommerce');

const app = express();

// Middlewares globales
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rutas principales
app.use('/webhook', webhookRoutes);
app.use('/api/pc', pcApiRoutes);

// Health check para Docker / Portainer
app.get('/health', (req, res) => {
  const pcStatus = store.getPcStatus();
  return res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    trackedOrders: store.getOrderCount(),
    woocommerceConfigured: woocommerce.isConfigured,
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
