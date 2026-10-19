const { Telegraf } = require('telegraf');
const config = require('../config');
const store = require('../services/store');
const telegram = require('../bot/telegram');
const formatters = require('../bot/formatters');
const keyboards = require('../bot/keyboards');

async function testTelegramRealtimeUpdate() {
  console.log('🤖 Probando actualización en tiempo real de notificaciones en Telegram...');

  if (!config.telegram.token) {
    console.error('❌ TELEGRAM_BOT_TOKEN no configurado en .env');
    process.exit(1);
  }

  const chatIds = config.telegram.adminChatIds;
  if (chatIds.length === 0) {
    console.warn('⚠️ No hay ADMIN_CHAT_ID configurado en .env para enviar la prueba.');
    process.exit(0);
  }

  const mockOrderId = 99999;

  // Paso 1: Pedido inicialmente en Pendiente
  const initialOrder = {
    id: mockOrderId,
    status: 'pending',
    currency: 'PEN',
    currency_symbol: 'S/',
    total: '124.00',
    date_created: new Date().toISOString(),
    billing: {
      first_name: 'Axel',
      last_name: 'Gomez (Prueba)',
      email: 'cliente@ejemplo.com',
      phone: '907463313'
    },
    payment_method_title: 'Yape / Plin',
    customer_note: 'Prueba de actualización en tiempo real del mismo mensaje',
    line_items: [
      { name: 'Licencia Windows 11 Pro Retail (1 PC)', quantity: 1, total: '45.00' },
      { name: 'Cuenta Microsoft Office 2024 Pro Plus', quantity: 1, total: '79.00' }
    ]
  };

  console.log('\n--- PASO 1: Enviando notificación inicial (⏳ PEDIDO PENDIENTE DE PAGO) ---');
  store.recordOrder(initialOrder);
  await telegram.sendOrUpdateOrderNotification(initialOrder, null);
  console.log('✅ Mensaje inicial enviado. Revisa tu Telegram.');

  console.log('\n⏳ Esperando 4 segundos para simular que el cliente pagó y el pedido pasa a completado...');
  await new Promise(resolve => setTimeout(resolve, 4000));

  // Paso 2: El cliente pagó, estado pasa a 'completed'
  const updatedOrder = {
    ...initialOrder,
    status: 'completed',
    date_modified: new Date().toISOString()
  };

  console.log('\n--- PASO 2: Actualizando EL MISMO MENSAJE (✅ PEDIDO COMPLETADO) ---');
  store.recordOrder(updatedOrder);
  await telegram.sendOrUpdateOrderNotification(updatedOrder, 'pending');

  console.log('\n🎉 ¡Prueba finalizada! Observa en tu Telegram: el mensaje NO se duplicó, sino que se actualizó en tiempo real.');
}

testTelegramRealtimeUpdate();
