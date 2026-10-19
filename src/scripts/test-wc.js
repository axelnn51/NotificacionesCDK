const woocommerce = require('../services/woocommerce');
const formatters = require('../bot/formatters');

async function testWc() {
  console.log('🔍 Probando conexión a WooCommerce (Modo Solo Lectura)...');
  try {
    const status = await woocommerce.testConnection();
    console.log('Resultado de testConnection:', status);

    const orders = await woocommerce.getRecentOrders({ per_page: 1 });
    if (orders.length > 0) {
      console.log('\n✅ Pedido más reciente obtenido con éxito:');
      console.log(`ID: #${orders[0].id} | Estado: ${orders[0].status} | Total: ${orders[0].total}`);
      console.log('\n--- Vista previa del mensaje formateado para Telegram ---');
      console.log(formatters.formatNewOrder(orders[0]));
    } else {
      console.log('No se encontraron pedidos en la tienda.');
    }
  } catch (err) {
    console.error('❌ Error probando WooCommerce:', err.message);
  }
}

testWc();
