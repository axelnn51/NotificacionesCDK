const express = require('express');
const crypto = require('crypto');
const config = require('../../config');
const orderMonitor = require('../../services/orderMonitor');

const router = express.Router();

/**
 * Validador de firma HMAC para Webhooks de WooCommerce
 */
function verifyWebhookSignature(req, res, buf) {
  const secret = config.woocommerce.webhookSecret;
  if (!secret) return true; // Si no hay secreto configurado, omitir validación

  const signature = req.headers['x-wc-webhook-signature'];
  if (!signature) return false;

  const hash = crypto.createHmac('sha256', secret).update(buf).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
}

// Ruta para recibir webhooks de WooCommerce
router.post('/woocommerce', async (req, res) => {
  try {
    const topic = req.headers['x-wc-webhook-topic'] || 'unknown';
    const order = req.body;

    console.log(`[Webhook] Notificación entrante - Tópico: ${topic}, Pedido: #${order?.id}`);

    // Si es un ping de prueba de WooCommerce
    if (topic === 'webhook.ping' || !order || !order.id) {
      return res.status(200).json({ ok: true, message: 'Ping recibido correctamente' });
    }

    // Procesar pedido a través del monitor
    await orderMonitor.handleWebhookOrder(order);

    return res.status(200).json({ ok: true, orderId: order.id });
  } catch (err) {
    console.error('[Webhook] Error procesando notificación:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
