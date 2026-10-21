const config = require('../config');

// Mapeo amigable y directo de estados de WooCommerce
const STATUS_CONFIG = {
  pending: {
    emoji: '⏳',
    title: 'PEDIDO PENDIENTE DE PAGO',
    shortLabel: 'Pendiente'
  },
  processing: {
    emoji: '⚙️',
    title: 'PEDIDO CONFIRMADO / EN PROCESO',
    shortLabel: 'Confirmado'
  },
  'on-hold': {
    emoji: '⏸️',
    title: 'PEDIDO EN ESPERA',
    shortLabel: 'En Espera'
  },
  completed: {
    emoji: '✅',
    title: 'PEDIDO COMPLETADO',
    shortLabel: 'Completado'
  },
  cancelled: {
    emoji: '❌',
    title: 'PEDIDO CANCELADO',
    shortLabel: 'Cancelado'
  },
  refunded: {
    emoji: '↩️',
    title: 'PEDIDO REEMBOLSADO',
    shortLabel: 'Reembolsado'
  },
  failed: {
    emoji: '⚠️',
    title: 'PEDIDO FALLIDO',
    shortLabel: 'Fallido'
  },
  'checkout-draft': {
    emoji: '📝',
    title: 'BORRADOR DE COMPRA',
    shortLabel: 'Borrador'
  }
};

/**
 * Escapa caracteres especiales para HTML de Telegram
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Obtiene la configuración de un estado
 */
function getStatusInfo(statusKey) {
  const cleanKey = String(statusKey || '').replace(/^wc-/, '').toLowerCase();
  if (STATUS_CONFIG[cleanKey]) {
    return STATUS_CONFIG[cleanKey];
  }
  const cleanName = cleanKey.toUpperCase().replace(/-/g, ' ');
  return {
    emoji: '📦',
    title: `PEDIDO ${cleanName}`,
    shortLabel: cleanName
  };
}

/**
 * Formatea fecha en zona horaria de Perú (America/Lima)
 */
function formatDatePeru(dateString) {
  try {
    if (!dateString) return 'N/A';
    let date;
    if (dateString instanceof Date) {
      date = dateString;
    } else if (typeof dateString === 'string') {
      if (dateString.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateString)) {
        date = new Date(dateString);
      } else {
        // WooCommerce entrega date_created en hora local de Lima sin sufijo de timezone
        date = new Date(`${dateString}-05:00`);
      }
    } else {
      date = new Date(dateString);
    }

    return date.toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return dateString || 'N/A';
  }
}

/**
 * Formatea el tiempo transcurrido en formato legible (ej: "hace 5 min", "hace 2 horas")
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'No disponible';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'hace un instante';
  if (diffSec < 60) return `hace ${diffSec} seg`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays} días`;
}

/**
 * Formatea los segundos de uptime a días, horas y minutos
 */
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0 min';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Genera la notificación de pedido.
 * El encabezado indica directamente el estado:
 * Ej: ⏳ PEDIDO PENDIENTE DE PAGO #14720 o ✅ PEDIDO COMPLETADO #14720
 * Si hubo un cambio de estado previo, se añade una insignia de actualización.
 */
function formatOrderNotification(order, previousStatus = null) {
  const statusInfo = getStatusInfo(order.status);
  const currency = order.currency_symbol || order.currency || 'S/';
  const customerName = `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'No especificado';
  const email = order.billing?.email || 'N/A';
  const phone = order.billing?.phone || '';
  const paymentMethod = order.payment_method_title || order.payment_method || 'Por definir';
  const adminUrl = `${config.woocommerce.url}/wp-admin/post.php?post=${order.id}&action=edit`;

  // Teléfono formateado con enlace de WhatsApp
  let phoneHtml = 'No registrado';
  if (phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const waNumber = cleanPhone.startsWith('51') ? cleanPhone : `51${cleanPhone}`;
    phoneHtml = `<code>${escapeHtml(phone)}</code> (<a href="https://wa.me/${waNumber}">WhatsApp</a>)`;
  }

  // Lista de productos adquiridos
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  let itemsText = '';
  if (items.length > 0) {
    itemsText = items
      .slice(0, 6)
      .map(item => `  • <b>${item.quantity}x</b> ${escapeHtml(item.name)} — <i>${currency} ${escapeHtml(item.total)}</i>`)
      .join('\n');

    if (items.length > 6) {
      itemsText += `\n  <i>...y ${items.length - 6} producto(s) más.</i>`;
    }
  } else {
    itemsText = '  • <i>Sin productos detallados</i>';
  }

  // Nota del cliente si existe
  let customerNote = '';
  if (order.customer_note && order.customer_note.trim().length > 0) {
    customerNote = `\n💬 <b>Nota del cliente:</b> <i>"${escapeHtml(order.customer_note.trim())}"</i>\n`;
  }

  // Bloque de actualización si el estado fue modificado
  let updateBlock = '';
  if (previousStatus && previousStatus !== order.status) {
    const prevInfo = getStatusInfo(previousStatus);
    const updatedTime = formatDatePeru(order.date_modified || new Date());
    updateBlock = (
      `🔄 <b>ACTUALIZADO:</b> ${updatedTime}\n` +
      `   <i>(Estado anterior: ${prevInfo.emoji} ${escapeHtml(prevInfo.shortLabel)})</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n`
    );
  }

  return (
    `${statusInfo.emoji} <b>${escapeHtml(statusInfo.title)} #${escapeHtml(order.id)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    updateBlock +
    `👤 <b>Cliente:</b> ${escapeHtml(customerName)}\n` +
    `📧 <b>Email:</b> <code>${escapeHtml(email)}</code>\n` +
    `📱 <b>Teléfono:</b> ${phoneHtml}\n` +
    customerNote +
    `\n📦 <b>Productos (${items.length}):</b>\n` +
    `${itemsText}\n\n` +
    `💳 <b>Método:</b> ${escapeHtml(paymentMethod)}\n` +
    `💰 <b>Total:</b> <b>${escapeHtml(currency)} ${escapeHtml(order.total)}</b>\n` +
    `🕒 <b>Fecha:</b> ${formatDatePeru(order.date_created)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${adminUrl}">Ver pedido en WordPress Admin</a>`
  );
}

// Mantener retrocompatibilidad
const formatNewOrder = (order) => formatOrderNotification(order, null);
const formatStatusChange = (order, oldStatus) => formatOrderNotification(order, oldStatus);

function cleanHostname(name) {
  if (!name || typeof name !== 'string') return 'DESKTOP';
  return name
    .replace(/\uFFFD/g, 'ú')
    .replace(/CDKEYSPER[Úú]?/i, 'CDKeysPerú');
}

/**
 * Formatea el estado de la PC para Telegram
 */
function formatPcStatus(pcState) {
  const isOnline = Boolean(pcState.online);
  const isShuttingDown = Boolean(pcState.shuttingDown);
  const hostname = cleanHostname(pcState.hostname);
  const localIp = pcState.localIp || 'N/A';
  const timeAgo = formatTimeAgo(pcState.lastHeartbeat);

  if (isShuttingDown) {
    return (
      `💻 <b>ESTADO DE MI EQUIPO (PC)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟠 <b>ESTADO:</b> <b>APAGÁNDOSE...</b>\n\n` +
      `🏷️ <b>Nombre:</b> <code>${escapeHtml(hostname)}</code>\n` +
      `⏳ <b>Detalle:</b> Orden de apagado ejecutada en Windows.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>El equipo está cerrando Windows y se desconectará en breve (unos segundos)...</i>`
    );
  }

  if (isOnline) {
    return (
      `💻 <b>ESTADO DE MI EQUIPO (PC)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 <b>ESTADO:</b> <b>ENCENDIDO (Online)</b>\n\n` +
      `🏷️ <b>Nombre:</b> <code>${escapeHtml(hostname)}</code>\n` +
      `🌐 <b>IP Local:</b> <code>${escapeHtml(localIp)}</code>\n` +
      `📡 <b>Último contacto:</b> ${timeAgo}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Puedes actualizar el estado o enviar la orden de apagado directo.</i>`
    );
  }

  let shutdownInfo = '';
  if (pcState.lastShutdownAt && Date.now() - pcState.lastShutdownAt < 86400000 * 2) {
    shutdownInfo = `💤 <b>Último apagado:</b> ${formatTimeAgo(pcState.lastShutdownAt)}\n`;
  }

  return (
    `💻 <b>ESTADO DE MI EQUIPO (PC)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔴 <b>ESTADO:</b> <b>APAGADO / DESCONECTADO</b>\n\n` +
    `🏷️ <b>Nombre:</b> <code>${escapeHtml(hostname)}</code>\n` +
    `📡 <b>Última señal recibida:</b> ${timeAgo}\n` +
    shutdownInfo +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>El equipo se encuentra apagado o sin conexión a internet.</i>`
  );
}

/**
 * Formatea el listado de los últimos pedidos para el comando /pedidos
 */
function formatRecentOrdersList(orders) {
  if (!orders || orders.length === 0) {
    return '📭 <i>No se encontraron pedidos recientes en la tienda.</i>';
  }

  let text = `📋 <b>ÚLTIMOS ${orders.length} PEDIDOS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;

  orders.forEach((o, index) => {
    const statusInfo = getStatusInfo(o.status);
    const currency = o.currency_symbol || o.currency || 'S/';
    const customer = `${o.billing?.first_name || ''} ${o.billing?.last_name || ''}`.trim() || 'Cliente';
    const date = formatDatePeru(o.date_created);

    text += (
      `<b>${index + 1}. Pedido #${escapeHtml(o.id)}</b> — <b>${escapeHtml(currency)} ${escapeHtml(o.total)}</b>\n` +
      `   Estado: ${statusInfo.emoji} ${escapeHtml(statusInfo.shortLabel || statusInfo.title)}\n` +
      `   Cliente: ${escapeHtml(customer)}\n` +
      `   Fecha: ${date}\n\n`
    );
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━\n<i>Para ver el detalle completo, abre el enlace en WordPress Admin.</i>`;
  return text;
}

module.exports = {
  escapeHtml,
  getStatusInfo,
  formatDatePeru,
  formatTimeAgo,
  formatUptime,
  formatOrderNotification,
  formatNewOrder,
  formatStatusChange,
  formatPcStatus,
  formatRecentOrdersList
};
