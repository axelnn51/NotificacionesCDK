const config = require('./config');
const app = require('./server/app');
const telegram = require('./bot/telegram');
const woocommerce = require('./services/woocommerce');
const orderMonitor = require('./services/orderMonitor');

async function main() {
  console.log('====================================================');
  console.log('🚀 INICIANDO BOT DE PEDIDOS CDKEYSPERU (PORTAINER READY)');
  console.log('====================================================');
  console.log(`🌍 Entorno: ${config.env}`);
  console.log(`🕒 Zona horaria: ${config.timezone}`);
  console.log(`🔌 Puerto HTTP: ${config.port}`);
  console.log(`🛒 Tienda WooCommerce: ${config.woocommerce.url} (SOLO LECTURA)`);

  // 1. Probar conexión con WooCommerce
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

  // 2. Iniciar servidor HTTP Express (para Webhooks y API de PC)
  const server = app.listen(config.port, () => {
    console.log(`🌐 Servidor HTTP escuchando en http://0.0.0.0:${config.port}`);
    console.log(`   • Webhook: POST http://0.0.0.0:${config.port}/webhook/woocommerce`);
    console.log(`   • PC API:  POST http://0.0.0.0:${config.port}/api/pc/heartbeat`);
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

  // 4. Iniciar Monitor de Pedidos
  if (woocommerce.isConfigured) {
    await orderMonitor.start();
  } else {
    console.warn('⚠️ Credenciales de WooCommerce incompletas. El monitor de pedidos no se ejecutó.');
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
