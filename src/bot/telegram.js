const { Telegraf } = require('telegraf');
const config = require('../config');
const store = require('../services/store');
const woocommerce = require('../services/woocommerce');
const formatters = require('./formatters');
const keyboards = require('./keyboards');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.isReady = false;
    this.onManualSyncRequested = null; // Callback asignable por OrderMonitor
    this._init();
  }

  _init() {
    const token = config.telegram.token;
    if (!token) {
      console.warn('[Telegram] TELEGRAM_BOT_TOKEN no configurado en variables de entorno.');
      return;
    }

    try {
      this.bot = new Telegraf(token);
      this._setupMiddleware();
      this._setupHandlers();
      this.isReady = true;
      console.log('[Telegram] Bot configurado y listo para iniciar.');
    } catch (err) {
      console.error('[Telegram] Error al inicializar Telegraf:', err.message);
    }
  }

  _isAuthorized(ctx) {
    const allowed = config.telegram.adminChatIds;
    // Si no se configuró ningún adminChatId, se permite por defecto en modo configuración
    if (!allowed || allowed.length === 0) return true;

    const userId = String(ctx.from?.id || '');
    const chatId = String(ctx.chat?.id || '');
    return allowed.includes(userId) || allowed.includes(chatId);
  }

  _setupMiddleware() {
    // Middleware de autorización y logging
    this.bot.use(async (ctx, next) => {
      if (!this._isAuthorized(ctx)) {
        const userId = ctx.from?.id || 'Desconocido';
        console.warn(`[Telegram] Intento de acceso no autorizado del usuario ID: ${userId}`);
        return ctx.reply(
          `⛔ <b>Acceso No Autorizado</b>\n\n` +
          `Tu Chat ID es: <code>${userId}</code>\n` +
          `Para autorizar este usuario o grupo, agrégalo a <b>ADMIN_CHAT_ID</b> en tu archivo de configuración o en Portainer.`,
          { parse_mode: 'HTML' }
        );
      }
      return next();
    });
  }

  _setupHandlers() {
    // Comando /start
    this.bot.command('start', async (ctx) => {
      const welcome = (
        `👋 <b>¡Bienvenido al Bot de Pedidos de CDKeysPerú!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔔 <b>Notificaciones Activas:</b> Te notificaré automáticamente cada vez que ingrese un nuevo pedido o cambie de estado (Pendiente, Completado, Cancelado, etc.).\n\n` +
        `💻 <b>Control de PC:</b> Puedes consultar si tu equipo está encendido/apagado y apagarlo directamente desde este chat.\n\n` +
        `<i>Usa los botones inferiores para navegar rápidamente.</i>`
      );

      await ctx.reply(welcome, {
        parse_mode: 'HTML',
        ...keyboards.getMainMenu()
      });
    });

    // Comando /ayuda o botón 'ℹ️ Ayuda'
    const sendHelp = async (ctx) => {
      const helpText = (
        `📖 <b>CENTRO DE AYUDA Y COMANDOS</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `• /pedidos — Muestra los últimos 5 pedidos registrados en la tienda.\n` +
        `• /pc o /estado — Muestra si tu equipo está Online/Offline y el botón de apagado.\n` +
        `• /apagar — Envía la orden directa para apagar tu equipo.\n` +
        `• /ayuda — Muestra este menú informativo.\n\n` +
        `🛡️ <b>Seguridad:</b> Este bot opera en modo <b>SOLO LECTURA</b> sobre WooCommerce. Jamás modificará ni eliminará datos de tus clientes o productos.\n` +
        `⚡ <b>Actualizaciones:</b> El bot consulta automáticamente pedidos nuevos cada ${config.woocommerce.pollIntervalSeconds}s.`
      );
      await ctx.reply(helpText, { parse_mode: 'HTML', ...keyboards.getMainMenu() });
    };

    this.bot.command('ayuda', sendHelp);
    this.bot.hears('ℹ️ Ayuda', sendHelp);

    // Comando /pedidos o botón '🛍️ Últimos Pedidos'
    const sendRecentOrders = async (ctx) => {
      try {
        await ctx.reply('🔍 <i>Consultando últimos pedidos en cdkeysperu.com...</i>', { parse_mode: 'HTML' });
        const orders = await woocommerce.getRecentOrders({ per_page: 5 });
        const listText = formatters.formatRecentOrdersList(orders);
        await ctx.reply(listText, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (err) {
        await ctx.reply(`⚠️ Error consultando pedidos en WooCommerce: ${err.message}`);
      }
    };

    this.bot.command('pedidos', sendRecentOrders);
    this.bot.hears('🛍️ Últimos Pedidos', sendRecentOrders);

    // Comando /pc, /estado o botón '💻 Estado de mi PC'
    const sendPcStatus = async (ctx) => {
      const pcStatus = store.getPcStatus();
      const statusText = formatters.formatPcStatus(pcStatus);
      await ctx.reply(statusText, {
        parse_mode: 'HTML',
        ...keyboards.getPcKeyboard(pcStatus.online)
      });
    };

    this.bot.command('pc', sendPcStatus);
    this.bot.command('estado', sendPcStatus);
    this.bot.hears('💻 Estado de mi PC', sendPcStatus);

    // Comando /sync, /sincronizar o botón '🔄 Sincronizar Ahora'
    const handleSync = async (ctx) => {
      await ctx.reply('🔄 <i>Comprobando pedidos nuevos en la tienda...</i>', { parse_mode: 'HTML' });
      if (typeof this.onManualSyncRequested === 'function') {
        try {
          const result = await this.onManualSyncRequested();
          await ctx.reply(`✅ <i>Sincronización completada. ${result.newOrders} nuevos, ${result.statusUpdates} actualizaciones.</i>`, { parse_mode: 'HTML' });
        } catch (err) {
          await ctx.reply(`⚠️ Error en sincronización: ${err.message}`);
        }
      } else {
        await ctx.reply('ℹ️ El monitor en segundo plano está activo y operativo.');
      }
    };

    this.bot.command('sync', handleSync);
    this.bot.command('sincronizar', handleSync);
    this.bot.hears('🔄 Sincronizar Ahora', handleSync);

    // Comando /apagar directo
    this.bot.command('apagar', async (ctx) => {
      const pcStatus = store.getPcStatus();
      const confirmText = (
        `⚠️ <b>CONFIRMACIÓN DE APAGADO REMOTO</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `¿Confirmas que deseas apagar tu equipo (<code>${formatters.escapeHtml(pcStatus.hostname)}</code>)?\n\n` +
        `<i>La PC se apagará en los próximos 15 segundos al recibir la orden.</i>`
      );
      await ctx.reply(confirmText, {
        parse_mode: 'HTML',
        ...keyboards.getShutdownConfirmKeyboard()
      });
    });

    // --- ACCIONES INLINE ---

    // Refrescar estado de PC
    this.bot.action('pc_refresh', async (ctx) => {
      try {
        await ctx.answerCbQuery('Estado actualizado');
        const pcStatus = store.getPcStatus();
        const text = formatters.formatPcStatus(pcStatus);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...keyboards.getPcKeyboard(pcStatus.online)
        });
      } catch (err) {
        // Ignorar si el contenido no cambió
      }
    });

    // Solicitar confirmación de apagado
    this.bot.action('pc_prompt_shutdown', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const pcStatus = store.getPcStatus();
        const confirmText = (
          `⚠️ <b>CONFIRMACIÓN DE APAGADO REMOTO</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `¿Confirmas que deseas apagar tu equipo (<code>${formatters.escapeHtml(pcStatus.hostname)}</code>)?\n\n` +
          `<i>La PC recibirá la orden y se apagará de inmediato.</i>`
        );
        await ctx.editMessageText(confirmText, {
          parse_mode: 'HTML',
          ...keyboards.getShutdownConfirmKeyboard()
        });
      } catch (err) {
        console.error('[Telegram] Error en prompt shutdown:', err.message);
      }
    });

    // Confirmar apagado
    this.bot.action('pc_confirm_shutdown', async (ctx) => {
      try {
        await ctx.answerCbQuery('Orden de apagado enviada');
        const { commandId } = store.queuePcCommand('shutdown');
        console.log(`[PC] Orden de apagado registrada (ID: ${commandId})`);

        const executedText = (
          `🔌 <b>ORDEN DE APAGADO ENVIADA</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ La orden de apagado ha sido encolada para el equipo.\n` +
          `⏱️ En cuanto el agente de tu PC sincronice (en menos de 5 segundos), Windows ejecutará el apagado automático.\n\n` +
          `<i>ID de comando: <code>${commandId}</code></i>`
        );

        await ctx.editMessageText(executedText, {
          parse_mode: 'HTML',
          ...keyboards.getPcKeyboard(false)
        });
      } catch (err) {
        console.error('[Telegram] Error en confirm shutdown:', err.message);
      }
    });

    // Cancelar apagado
    this.bot.action('pc_cancel_shutdown', async (ctx) => {
      try {
        await ctx.answerCbQuery('Apagado cancelado');
        const pcStatus = store.getPcStatus();
        const text = formatters.formatPcStatus(pcStatus);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...keyboards.getPcKeyboard(pcStatus.online)
        });
      } catch (err) {
        // Ignorar error si no hubo cambios
      }
    });
  }

  /**
   * Envía una notificación nueva o actualiza en tiempo real el mensaje existente en Telegram
   * evitando notificaciones duplicadas para un mismo pedido.
   */
  async sendOrUpdateOrderNotification(order, previousStatus = null) {
    if (!this.isReady || !this.bot) {
      console.warn('[Telegram] No se puede enviar notificación, bot no inicializado.');
      return;
    }

    const recipients = config.telegram.adminChatIds;
    if (!recipients || recipients.length === 0) {
      console.warn('[Telegram] No hay ADMIN_CHAT_ID configurado para recibir alertas.');
      return;
    }

    const htmlMessage = formatters.formatOrderNotification(order, previousStatus);
    const options = {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    for (const chatId of recipients) {
      const existingMessageId = store.getOrderTelegramMessage(order.id, chatId);

      if (existingMessageId) {
        // Intentar actualizar el mensaje existente en tiempo real
        try {
          await this.bot.telegram.editMessageText(chatId, existingMessageId, null, htmlMessage, options);
          console.log(`[Telegram] ✅ Mensaje de pedido #${order.id} actualizado en tiempo real en chat ${chatId}`);
          continue;
        } catch (err) {
          const errMsg = err.message || '';
          if (errMsg.includes('message is not modified')) {
            // El contenido no cambió, no se hace nada
            continue;
          }
          console.warn(`[Telegram] No se pudo editar mensaje existente #${existingMessageId} (${errMsg}), enviando nuevo...`);
        }
      }

      // Si no existe mensaje previo o falló la edición, enviar uno nuevo
      try {
        const sent = await this.bot.telegram.sendMessage(chatId, htmlMessage, options);
        store.setOrderTelegramMessage(order.id, chatId, sent.message_id);
        console.log(`[Telegram] 🔔 Mensaje nuevo enviado para pedido #${order.id} (Msg ID: ${sent.message_id}) en chat ${chatId}`);
      } catch (err) {
        console.error(`[Telegram] Error enviando mensaje a Chat ID ${chatId}:`, err.message);
      }
    }
  }

  /**
   * Envía un mensaje a todos los administradores configurados
   */
  async broadcast(htmlMessage, extra = {}) {
    if (!this.isReady || !this.bot) {
      console.warn('[Telegram] No se puede enviar broadcast, bot no inicializado.');
      return;
    }

    const recipients = config.telegram.adminChatIds;
    if (!recipients || recipients.length === 0) {
      console.warn('[Telegram] No hay ADMIN_CHAT_ID configurado para recibir alertas.');
      return;
    }

    const options = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    };

    for (const chatId of recipients) {
      try {
        await this.bot.telegram.sendMessage(chatId, htmlMessage, options);
      } catch (err) {
        console.error(`[Telegram] Error enviando mensaje a Chat ID ${chatId}:`, err.message);
      }
    }
  }

  /**
   * Inicia el bot en modo polling (no bloqueante)
   */
  async launch() {
    if (!this.isReady || !this.bot) return;

    try {
      // 1. Probar conectividad y autenticación con Telegram
      const me = await this.bot.telegram.getMe();
      console.log(`[Telegram] ✅ Bot autenticado con éxito: @${me.username} (${me.first_name})`);

      // 2. Iniciar sondeo (polling) en segundo plano sin bloquear el arranque de los demás servicios
      this.bot.launch().catch(err => {
        console.error('[Telegram] Error en ciclo de sondeo:', err.message);
        if (err.message && err.message.includes('409: Conflict')) {
          console.error('⚠️ ALERTA: Conflicto 409: Hay otra instancia usando este mismo token de Telegram.');
        }
      });
      console.log('[Telegram] Sondeo de mensajes activo en segundo plano.');
    } catch (err) {
      console.error('[Telegram] Error al conectar con Telegram:', err.message);
      if (err.message && err.message.includes('409: Conflict')) {
        console.error('⚠️ ALERTA: Conflicto 409 con Telegram API (otra instancia activa usando este token).');
      }
    }
  }

  stop(signal) {
    if (this.bot) {
      try {
        this.bot.stop(signal);
        console.log(`[Telegram] Bot detenido (${signal || 'desconocido'})`);
      } catch (err) {
        // Ignore
      }
    }
  }
}

module.exports = new TelegramBotService();
