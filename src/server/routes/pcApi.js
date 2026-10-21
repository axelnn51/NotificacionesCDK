const express = require('express');
const config = require('../../config');
const store = require('../../services/store');
const telegram = require('../../bot/telegram');
const formatters = require('../../bot/formatters');
const keyboards = require('../../bot/keyboards');

const router = express.Router();

// Middleware de autenticación para el agente PC
function requirePcToken(req, res, next) {
  const token = req.headers['x-pc-token'] || req.query.token;
  if (!token || token !== config.pcAgent.token) {
    return res.status(401).json({ error: 'Token de agente PC inválido o ausente' });
  }
  next();
}

/**
 * Endpoint de Heartbeat: La PC llama aquí periódicamente (cada 5 a 10s)
 */
router.post('/heartbeat', requirePcToken, (req, res) => {
  const { hostname, platform, uptimeSeconds, localIp, cpuPercent, ramUsedMb, ramTotalMb, activeWindow } = req.body || {};

  store.updatePcHeartbeat({
    hostname,
    platform,
    uptimeSeconds,
    localIp,
    cpuPercent,
    ramUsedMb,
    ramTotalMb,
    activeWindow
  });

  return res.json({
    ok: true,
    serverTime: Date.now()
  });
});

/**
 * Endpoint de Consulta de Comandos: La PC consulta si hay órdenes pendientes
 */
router.get('/poll', requirePcToken, (req, res) => {
  const pending = store.getPcPendingCommand();
  return res.json({
    ok: true,
    command: pending.command,
    commandId: pending.commandId,
    payload: pending.payload || {}
  });
});

/**
 * Endpoint para recibir Capturas de Pantalla enviadas por el Agente de Windows
 */
router.post('/screenshot', requirePcToken, async (req, res) => {
  try {
    const { imageBase64, windowTitle, screens, panoramic, target } = req.body || {};
    const title = windowTitle || 'Pantalla de Windows';
    const timestampStr = new Date().toLocaleTimeString('es-PE', { timeZone: 'America/Lima' });

    // Caso A: Se recibieron múltiples pantallas y el target es "all" (álbum interactivo)
    if (Array.isArray(screens) && screens.length > 1 && (!target || target === 'all')) {
      const mediaItems = screens.map((s, idx) => {
        const buffer = Buffer.from(s.imageBase64, 'base64');
        let caption = '';
        if (idx === 0) {
          caption = `📸 <b>Captura en Vivo (${screens.length} Monitores)</b>\n🕒 <code>${timestampStr}</code>\n🪟 <b>Ventana activa:</b> <i>${formatters.escapeHtml(title)}</i>\n\n🖥️ <b>${formatters.escapeHtml(s.name)}</b> (${s.resolution})`;
        } else {
          caption = `🖥️ <b>${formatters.escapeHtml(s.name)}</b> (${s.resolution})`;
        }
        return {
          type: 'photo',
          media: { source: buffer },
          caption,
          parse_mode: 'HTML'
        };
      });

      await telegram.sendMediaGroup(mediaItems);

      // Enviar selector interactivo con botones
      await telegram.broadcast(
        `👆 <i>Álbum de ${screens.length} pantallas recibido. Puedes seleccionar abajo para ver una pantalla individual o la panorámica completa:</i>`,
        {
          reply_markup: keyboards.getScreenSelectKeyboard(screens).reply_markup
        }
      );

      return res.json({ ok: true, delivered: true, count: screens.length });
    }

    // Caso B: Si target es 'panoramic' y viene la imagen panorámica completa
    if (target === 'panoramic' && panoramic && panoramic.imageBase64) {
      const buffer = Buffer.from(panoramic.imageBase64, 'base64');
      const caption = `🌐 <b>Vista Panorámica Total (${panoramic.resolution || 'VirtualScreen'})</b>\n🕒 <code>${timestampStr}</code>\n🪟 <b>Ventana activa:</b> <i>${formatters.escapeHtml(title)}</i>`;
      await telegram.sendPhoto(buffer, caption, {
        reply_markup: keyboards.getScreenSelectKeyboard(screens).reply_markup
      });
      return res.json({ ok: true, delivered: true, type: 'panoramic' });
    }

    // Caso C: Pantalla individual (o única pantalla detectada)
    const singleScreen = (Array.isArray(screens) && screens.length === 1) ? screens[0] : null;
    const finalB64 = singleScreen ? singleScreen.imageBase64 : imageBase64;
    const screenLabel = singleScreen ? singleScreen.name : 'Pantalla de Windows';
    const resolutionStr = singleScreen ? ` (${singleScreen.resolution})` : '';

    if (!finalB64) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen de pantalla' });
    }

    const imageBuffer = Buffer.from(finalB64, 'base64');
    const caption = `📸 <b>Captura de ${formatters.escapeHtml(screenLabel)}${resolutionStr}</b>\n🕒 <code>${timestampStr}</code>\n🪟 <b>Ventana activa:</b> <i>${formatters.escapeHtml(title)}</i>`;

    await telegram.sendPhoto(imageBuffer, caption, {
      reply_markup: keyboards.getScreenSelectKeyboard(screens).reply_markup
    });

    return res.json({ ok: true, delivered: true, screen: screenLabel });
  } catch (err) {
    console.error('[PC] Error procesando captura de pantalla:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint de Confirmación (Ack): La PC avisa que ejecutó la orden
 */
router.post('/ack', requirePcToken, async (req, res) => {
  const { commandId, status, message, output } = req.body || {};

  const acknowledged = store.ackPcCommand(commandId, { status, message, output });

  if (acknowledged) {
    console.log(`[PC] Comando #${commandId} confirmado por el agente (${status}: ${message || ''})`);

    // Notificaciones según el tipo de comando
    if (status === 'prompt_sent') {
      await telegram.broadcast(
        `💬 <b>SOLICITUD ENVIADA A ANTIGRAVITY</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ El prompt fue inyectado y enviado con éxito a la ventana de <b>Antigravity IDE</b>.\n` +
        `<i>Antigravity está trabajando en la solución...</i>`
      );
    } else if (status === 'cmd_executed') {
      const cleanOut = (output || 'Comando completado sin salida.').slice(0, 3500);
      await telegram.broadcast(
        `💻 <b>RESULTADO DE COMANDO REMOTO</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<pre>${formatters.escapeHtml(cleanOut)}</pre>`
      );
    } else if (status === 'key_sent') {
      await telegram.broadcast(`⌨️ <b>Tecla enviada a Antigravity:</b> <code>${formatters.escapeHtml(message || 'OK')}</code>`);
    } else if (status === 'executing' || status === 'shutdown_initiated') {
      await telegram.broadcast(
        `🔌 <b>CONFIRMACIÓN DE APAGADO DE PC</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `El agente de Windows ha recibido la orden y ha iniciado el protocolo de apagado del equipo.\n` +
        `<i>El sistema se desconectará en breve.</i>`
      );

      // A los 12 segundos, confirmar apagado
      setTimeout(async () => {
        try {
          store.completeShutdown();
          const currentStatus = store.getPcStatus();
          await telegram.broadcast(
            `🔴 <b>PC APAGADA TOTALMENTE</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ El equipo (<code>${formatters.escapeHtml(currentStatus.hostname || 'PC')}</code>) ha finalizado el apagado.\n` +
            `<i>Estado actual: Apagado / Desconectado.</i>`
          );
        } catch (e) {
          console.error('[PC] Error enviando notificación de confirmación de apagado:', e.message);
        }
      }, 12000);
    }
  }

  return res.json({ ok: true, acknowledged });
});

module.exports = router;
