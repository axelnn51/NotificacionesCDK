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
        `🚀 <b>¡Bienvenido a AxelRemoteBot!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Consola de Control Remoto de tu PC y <b>Antigravity IDE</b>.\n\n` +
        `📸 <b>Ver Pantalla:</b> Pulsa el botón o envía /screenshot para ver tu monitor en vivo.\n` +
        `💬 <b>/prompt &lt;orden&gt;:</b> Inyecta una solicitud a Antigravity y presiona Enter.\n` +
        `🛑 <b>/esc:</b> Envía tecla Escape para frenar a Antigravity.\n` +
        `✅ <b>/enter:</b> Envía Enter para aceptar o continuar.\n` +
        `💻 <b>/pc:</b> Consulta estado, CPU, RAM y ventana activa.\n` +
        `⚡ <b>/cmd &lt;comando&gt;:</b> Ejecuta un comando en PowerShell.\n` +
        `🔌 <b>/apagar:</b> Apaga tu equipo Windows a distancia.\n\n` +
        `<i>Usa los botones inferiores para operar cómodamente desde el móvil.</i>`
      );

      await ctx.reply(welcome, {
        parse_mode: 'HTML',
        ...keyboards.getMainMenu()
      });
    });

    // Comando /ayuda o botón 'ℹ️ Ayuda'
    const sendHelp = async (ctx) => {
      const helpText = (
        `📖 <b>COMANDOS DE CONTROL REMOTO</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📸 <b>/screenshot</b> o <b>/pantalla</b>\n` +
        `   <i>Toma una captura de tus pantallas y la envía como foto.</i>\n\n` +
        `💬 <b>/prompt &lt;tu instrucción&gt;</b>\n` +
        `   <i>Trae al frente Antigravity, escribe el texto y le da Enter.</i>\n\n` +
        `🛑 <b>/esc</b> o <b>/stop</b>\n` +
        `   <i>Presiona Escape para pausar Antigravity.</i>\n\n` +
        `✅ <b>/enter</b>\n` +
        `   <i>Presiona Enter en Antigravity.</i>\n\n` +
        `💻 <b>/pc</b> o <b>/stats</b>\n` +
        `   <i>Muestra CPU %, RAM, Uptime y si la PC está Online.</i>\n\n` +
        `⚡ <b>/cmd &lt;comando&gt;</b>\n` +
        `   <i>Ejecuta comandos en Windows (ej: /cmd ipconfig).</i>\n\n` +
        `🔌 <b>/apagar</b>\n` +
        `   <i>Protocolo de apagado limpio de tu equipo.</i>`
      );
      await ctx.reply(helpText, { parse_mode: 'HTML', ...keyboards.getMainMenu() });
    };

    this.bot.command('ayuda', sendHelp);
    this.bot.command('help', sendHelp);
    this.bot.hears('ℹ️ Ayuda', sendHelp);

    // Captura de pantalla
    const handleScreenshot = async (ctx) => {
      const pcStatus = store.getPcStatus();
      if (!pcStatus.online) {
        return ctx.reply('🔴 <b>Tu PC está apagada o sin conexión.</b>\nNo se puede tomar captura de pantalla.', { parse_mode: 'HTML' });
      }
      store.queuePcCommand('screenshot');
      await ctx.reply('📸 <i>Solicitando captura de pantalla a tu PC... En unos segundos la recibirás.</i>', { parse_mode: 'HTML' });
    };

    this.bot.command('screenshot', handleScreenshot);
    this.bot.command('pantalla', handleScreenshot);
    this.bot.hears('📸 Ver Pantalla', handleScreenshot);

    // Inyección de prompts a Antigravity
    this.bot.command('prompt', async (ctx) => {
      const text = ctx.message.text.replace(/^\/prompt\s*/i, '').trim();
      if (!text) {
        return ctx.reply('⚠️ <i>Debes escribir el prompt. Ej:</i> <code>/prompt refactoriza el index.js</code>', { parse_mode: 'HTML' });
      }
      const pcStatus = store.getPcStatus();
      if (!pcStatus.online) {
        return ctx.reply('🔴 <b>Tu PC está apagada o sin conexión.</b>', { parse_mode: 'HTML' });
      }
      store.queuePcCommand('prompt', { text });
      await ctx.reply(`💬 <i>Inyectando prompt en Antigravity IDE...</i>\n\n📝 <b>Orden:</b> <code>${formatters.escapeHtml(text)}</code>`, { parse_mode: 'HTML' });
    });

    // Control de teclas en Antigravity
    const handleEsc = async (ctx) => {
      store.queuePcCommand('esc');
      await ctx.reply('🛑 <i>Enviando Escape a Antigravity para pausar...</i>', { parse_mode: 'HTML' });
    };
    this.bot.command('esc', handleEsc);
    this.bot.command('stop', handleEsc);

    this.bot.command('enter', async (ctx) => {
      store.queuePcCommand('enter');
      await ctx.reply('✅ <i>Enviando Enter a Antigravity...</i>', { parse_mode: 'HTML' });
    });

    // Ejecutar comandos en Windows
    this.bot.command('cmd', async (ctx) => {
      const commandLine = ctx.message.text.replace(/^\/cmd\s*/i, '').trim();
      if (!commandLine) {
        return ctx.reply('⚠️ <i>Escribe: /cmd &lt;comando de powershell&gt;</i>', { parse_mode: 'HTML' });
      }
      const pcStatus = store.getPcStatus();
      if (!pcStatus.online) {
        return ctx.reply('🔴 <b>Tu PC está apagada o sin conexión.</b>', { parse_mode: 'HTML' });
      }
      store.queuePcCommand('cmd', { commandLine });
      await ctx.reply(`⚡ <i>Ejecutando en Windows:</i> <code>${formatters.escapeHtml(commandLine)}</code>`, { parse_mode: 'HTML' });
    });

    // Estado de la PC
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
    this.bot.command('stats', sendPcStatus);
    this.bot.hears('💻 Estado de mi PC', sendPcStatus);

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

    this.bot.action('pc_screenshot', async (ctx) => {
      try {
        await ctx.answerCbQuery('Solicitando captura...');
        await handleScreenshot(ctx);
      } catch (err) {}
    });

    this.bot.action('pc_refresh', async (ctx) => {
      try {
        await ctx.answerCbQuery('Estado actualizado');
        const pcStatus = store.getPcStatus();
        const text = formatters.formatPcStatus(pcStatus);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...keyboards.getPcKeyboard(pcStatus.online)
        });
      } catch (err) {}
    });

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
      } catch (err) {}
    });

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
      } catch (err) {}
    });

    this.bot.action('pc_cancel_shutdown', async (ctx) => {
      try {
        await ctx.answerCbQuery('Apagado cancelado');
        const pcStatus = store.getPcStatus();
        const text = formatters.formatPcStatus(pcStatus);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...keyboards.getPcKeyboard(pcStatus.online)
        });
      } catch (err) {}
    });
  }

  /**
   * Envía una notificación nueva o actualiza en tiempo real el mensaje existente en Telegram
   * evitando notificaciones duplicadas para un mismo pedido.
   */
  async sendOrUpdateOrderNotification(order, previousStatus = null) {
    if (!this.isReady || !this.bot) {
      console.warn('[Telegram] No se puede enviar notificación, bot no inicializado.');
      return false;
    }

    const recipients = config.telegram.adminChatIds;
    if (!recipients || recipients.length === 0) {
      console.warn('[Telegram] No hay ADMIN_CHAT_ID configurado para recibir alertas.');
      return false;
    }

    const htmlMessage = formatters.formatOrderNotification(order, previousStatus);
    const options = {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    let delivered = false;

    for (const chatId of recipients) {
      const existingMessageId = store.getOrderTelegramMessage(order.id, chatId);

      if (existingMessageId) {
        // Intentar actualizar el mensaje existente en tiempo real
        try {
          await this.bot.telegram.editMessageText(chatId, existingMessageId, null, htmlMessage, options);
          console.log(`[Telegram] ✅ Mensaje de pedido #${order.id} actualizado en tiempo real en chat ${chatId}`);
          delivered = true;
          continue;
        } catch (err) {
          const errMsg = err.message || '';
          if (errMsg.includes('message is not modified')) {
            // El contenido no cambió, se considera éxito
            delivered = true;
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
        delivered = true;
      } catch (err) {
        console.error(`[Telegram] Error enviando mensaje a Chat ID ${chatId}:`, err.message);
      }
    }

    return delivered;
  }

  /**
   * Envía un mensaje a todos los administradores configurados
   */
  async broadcast(htmlMessage, extra = {}) {
    if (!this.isReady || !this.bot) {
      console.warn('[Telegram] No se puede enviar broadcast, bot no inicializado.');
      return false;
    }

    const recipients = config.telegram.adminChatIds;
    if (!recipients || recipients.length === 0) {
      console.warn('[Telegram] No hay ADMIN_CHAT_ID configurado para recibir alertas.');
      return false;
    }

    const options = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    };

    let delivered = false;

    for (const chatId of recipients) {
      try {
        await this.bot.telegram.sendMessage(chatId, htmlMessage, options);
        delivered = true;
      } catch (err) {
        console.error(`[Telegram] Error enviando mensaje a Chat ID ${chatId}:`, err.message);
      }
    }

    return delivered;
  }

  /**
   * Envía una foto a todos los administradores configurados
   */
  async sendPhoto(photoBuffer, caption = '', extra = {}) {
    if (!this.isReady || !this.bot) {
      console.warn('[Telegram] No se puede enviar foto, bot no inicializado.');
      return false;
    }

    const recipients = config.telegram.adminChatIds;
    if (!recipients || recipients.length === 0) {
      console.warn('[Telegram] No hay ADMIN_CHAT_ID configurado para recibir fotos.');
      return false;
    }

    const options = {
      caption,
      parse_mode: 'HTML',
      ...extra
    };

    let delivered = false;

    for (const chatId of recipients) {
      try {
        await this.bot.telegram.sendPhoto(chatId, { source: photoBuffer }, options);
        delivered = true;
      } catch (err) {
        console.error(`[Telegram] Error enviando foto a Chat ID ${chatId}:`, err.message);
      }
    }

    return delivered;
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
