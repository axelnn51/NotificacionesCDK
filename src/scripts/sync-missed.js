const woocommerce = require('../services/woocommerce');
const store = require('../services/store');
const telegram = require('../bot/telegram');

async function syncMissed() {
  console.log('🔍 [Sync-Missed] Comprobando pedidos de WooCommerce de las últimas 48 horas...');

  try {
    const orders = await woocommerce.getRecentOrders({ per_page: 30, status: 'any' });
    console.log(`📦 Se obtuvieron ${orders.length} pedidos recientes de WooCommerce.`);

    let missingCount = 0;
    let deliveredCount = 0;

    for (const order of orders) {
      const orderId = String(order.id);
      const isNotified = store.hasOrderBeenNotified(orderId);

      if (!isNotified) {
        missingCount++;
        console.log(`\n⚠️ Pedido #${order.id} (${order.status}) no tenía registro de notificación en Telegram.`);
        console.log(`👤 Cliente: ${order.billing?.first_name || ''} ${order.billing?.last_name || ''} | Total: ${order.currency_symbol || 'S/'} ${order.total}`);

        store.recordOrder(order);
        const delivered = await telegram.sendOrUpdateOrderNotification(order, null);
        if (delivered) {
          deliveredCount++;
          console.log(`✅ ¡Pedido #${order.id} notificado con éxito a Telegram!`);
        } else {
          console.error(`❌ Falló el envío de la notificación para pedido #${order.id}`);
        }

        // Pausa de 600ms entre envíos para respetar límites de Telegram
        await new Promise(r => setTimeout(r, 600));
      }
    }

    console.log('\n====================================================');
    if (missingCount === 0) {
      console.log('✅ ¡Todos los pedidos recientes ya fueron notificados en Telegram! Nada pendiente.');
    } else {
      console.log(`🎉 Proceso finalizado: ${deliveredCount}/${missingCount} pedidos pendientes notificados a Telegram.`);
    }
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Error en sync-missed:', err.message);
  }
}

syncMissed();
