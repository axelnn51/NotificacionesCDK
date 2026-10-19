const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const config = require('../config');

class WooCommerceService {
  constructor() {
    this.api = null;
    this.isConfigured = false;
    this._init();
  }

  _init() {
    const { url, consumerKey, consumerSecret, version } = config.woocommerce;

    if (!consumerKey || !consumerSecret) {
      console.warn('[WooCommerce] WC_CONSUMER_KEY o WC_CONSUMER_SECRET no están configurados.');
      return;
    }

    try {
      this.api = new WooCommerceRestApi({
        url: url,
        consumerKey: consumerKey,
        consumerSecret: consumerSecret,
        version: version,
        queryStringAuth: true // Importante para entornos con HTTP/HTTPS reverse proxy o Cloudflare
      });
      this.isConfigured = true;
      console.log(`[WooCommerce] Cliente inicializado para: ${url} (Modo: SOLO LECTURA)`);
    } catch (err) {
      console.error('[WooCommerce] Error al inicializar cliente:', err.message);
    }
  }

  /**
   * Obtiene pedidos recientes ordenados por fecha o modificación.
   * SOLO LECTURA - No altera ningún estado en WooCommerce.
   */
  async getRecentOrders(params = {}) {
    if (!this.isConfigured) {
      throw new Error('WooCommerce API no configurada correctamente.');
    }

    const defaultParams = {
      per_page: config.woocommerce.pollBatchSize || 20,
      page: 1,
      orderby: 'date',
      order: 'desc'
    };

    const queryParams = { ...defaultParams, ...params };

    try {
      const response = await this.api.get('orders', queryParams);
      return response.data || [];
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message;
      console.error(`[WooCommerce] Error consultando pedidos (${errMsg})`);
      throw err;
    }
  }

  /**
   * Obtiene los detalles de un único pedido por ID.
   * SOLO LECTURA.
   */
  async getOrder(orderId) {
    if (!this.isConfigured) {
      throw new Error('WooCommerce API no configurada correctamente.');
    }

    try {
      const response = await this.api.get(`orders/${orderId}`);
      return response.data;
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message;
      console.error(`[WooCommerce] Error obteniendo pedido #${orderId} (${errMsg})`);
      throw err;
    }
  }

  /**
   * Verifica la conexión a la tienda y los permisos de la API.
   */
  async testConnection() {
    if (!this.isConfigured) {
      return { ok: false, error: 'Credenciales incompletas en variables de entorno' };
    }

    try {
      const response = await this.api.get('orders', { per_page: 1 });
      return {
        ok: true,
        ordersCountTested: Array.isArray(response.data) ? response.data.length : 0,
        url: config.woocommerce.url
      };
    } catch (err) {
      return {
        ok: false,
        error: err.response?.data?.message || err.message
      };
    }
  }
}

module.exports = new WooCommerceService();
