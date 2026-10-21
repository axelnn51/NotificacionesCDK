const config = require('./config');
const app = require('./server/app');
const telegram = require('./bot/telegram');
const woocommerce = require('./services/woocommerce');
const orderMonitor = require('./services/orderMonitor');

async function main() {
  console.log('====================================================');
  console.log('🚀 INICIANDO AXELREMOTE BOT - CONTROL REMOTO & ANTIGRAVITY');
  console.log('====================================================');
  console.log(`🌍 Entorno: ${config.env}`);
  console.log(`🕒 Zona horaria: ${config.timezone}`);
  console.log(`🔌 Puerto HTTP: ${config.port}`);

  // 1. Probar conexión con WooCommerce (solo si está habilitado)
  if (config.woocommerce.enabled) {
    try {
      const wcTest = await woocommerce.testConnection();
      if (wcTest.ok) {
        console.log(`✅ WooCommerce API conectada correctamente (${wcTest.ordersCountTested} pedidos verificados).`);
      } else {
        console.warn(`⚠️ WooCommerce API no respondió favorablemente: ${wcTest.error}`);
      }
    } catch (err) {
      console.warn(`⚠️ Advertencia de conexión inicial a WooCommerce: ${err.message}`);
    }
  } else {
    console.log('ℹ️ Modo Control Remoto Puro activo (Monitoreo de WooCommerce delegado a YapeBot).');
  }

  // 2. Iniciar servidor HTTP Express (para Webhooks y API de PC)
  const server = app.listen(config.port, () => {
    console.log(`🌐 Servidor HTTP escuchando en http://0.0.0.0:${config.port}`);
    console.log(`   • PC API:  POST http://0.0.0.0:${config.port}/api/pc/heartbeat`);
    console.log(`   • Poll:    GET  http://0.0.0.0:${config.port}/api/pc/poll`);
    console.log(`   • Shots:   POST http://0.0.0.0:${config.port}/api/pc/screenshot`);
    console.log(`   • Health:  GET  http://0.0.0.0:${config.port}/health`);
  });

  // 3. Iniciar Bot de Telegram
  if (config.telegram.token) {
    try {
      await telegram.launch();
    } catch (err) {
      console.error('[Main] Error iniciando bot de Telegram:', err.message);
    }
  } else {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN no configurado. El bot de Telegram no arrancará.');
  }

  // 4. Iniciar Monitor de Pedidos (solo si está habilitado)
  if (config.woocommerce.enabled && woocommerce.isConfigured) {
    await orderMonitor.start();
  }

  console.log('====================================================');
  console.log('✅ SISTEMA TOTALMENTE OPERATIVO');
  console.log('====================================================');

  // Manejo de apagado graceful
  const shutdown = async (signal) => {
    console.log(`\n[Main] Señal ${signal} recibida. Cerrando servicios...`);
    orderMonitor.stop();
    telegram.stop(signal);
    server.close(() => {
      console.log('[Main] Servidor HTTP detenido.');
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[Main] Error fatal en arranque:', err);
  process.exit(1);
});
