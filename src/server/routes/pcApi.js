const express = require('express');
const config = require('../../config');
const store = require('../../services/store');
const telegram = require('../../bot/telegram');

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
  const { hostname, platform, uptimeSeconds, localIp } = req.body || {};

  store.updatePcHeartbeat({
    hostname,
    platform,
    uptimeSeconds,
    localIp
  });

  return res.json({
    ok: true,
    serverTime: Date.now()
  });
});

/**
 * Endpoint de Consulta de Comandos: La PC consulta si hay órdenes pendientes (ej: apagar)
 */
router.get('/poll', requirePcToken, (req, res) => {
  const pending = store.getPcPendingCommand();
  return res.json({
    ok: true,
    command: pending.command,
    commandId: pending.commandId
  });
});

/**
 * Endpoint de Confirmación (Ack): La PC avisa que ejecutó la orden
 */
router.post('/ack', requirePcToken, async (req, res) => {
  const { commandId, status, message } = req.body || {};

  const acknowledged = store.ackPcCommand(commandId, { status, message });

  if (acknowledged) {
    console.log(`[PC] Comando #${commandId} confirmado por el agente (${status}: ${message || ''})`);
    if (status === 'executing' || status === 'shutdown_initiated') {
      await telegram.broadcast(
        `🔌 <b>CONFIRMACIÓN DE APAGADO DE PC</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `El agente de Windows ha recibido la orden y ha iniciado el protocolo de apagado del equipo.\n` +
        `<i>El sistema se desconectará en breve.</i>`
      );
    }
  }

  return res.json({ ok: true, acknowledged });
});

module.exports = router;
