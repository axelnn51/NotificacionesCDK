const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

const config = {
  // Entorno
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT, 10) || 3005,
  timezone: process.env.TZ || 'America/Lima',

  // Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    // Permite múltiples Chat IDs separados por coma: "123456,789012"
    adminChatIds: (process.env.ADMIN_CHAT_ID || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0)
  },

  // WooCommerce (Solo Lectura)
  woocommerce: {
    url: (process.env.WC_URL || 'https://cdkeysperu.com').replace(/\/$/, ''),
    consumerKey: process.env.WC_CONSUMER_KEY || '',
    consumerSecret: process.env.WC_CONSUMER_SECRET || '',
    version: 'wc/v3',
    pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS, 10) || 30,
    pollBatchSize: parseInt(process.env.POLL_BATCH_SIZE, 10) || 20,
    webhookSecret: process.env.WC_WEBHOOK_SECRET || ''
  },

  // Agente PC (Monitoreo y Apagado)
  pcAgent: {
    token: process.env.PC_AGENT_TOKEN || 'cdkeys-pc-default-secret-token',
    offlineThresholdSeconds: parseInt(process.env.PC_OFFLINE_THRESHOLD_SECONDS, 10) || 20
  },

  // Directorio de persistencia
  dataDir: path.resolve(process.env.DATA_DIR || './data')
};

module.exports = config;
