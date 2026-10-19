/**
 * CDKeysPerú - Agente PC en Node.js (Sin dependencias externas)
 * Compatible con Node 18+ nativo (usa fetch)
 */

const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
let config = {
  serverUrl: 'http://localhost:3005',
  token: 'cdkeys-pc-default-secret-token',
  heartbeatIntervalSeconds: 5
};

if (fs.existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (e) {
    console.warn('[Agente PC] Error leyendo config.json, usando valores por defecto');
  }
}

const serverUrl = config.serverUrl.replace(/\/$/, '');
const token = config.token;
const intervalMs = (config.heartbeatIntervalSeconds || 5) * 1000;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

console.log('====================================================');
console.log('💻 AGENTE PC NODE.JS - CDKEYSPERÚ INICIADO');
console.log(`• Servidor:  ${serverUrl}`);
console.log(`• Intervalo: ${config.heartbeatIntervalSeconds}s`);
console.log(`• Equipo:    ${os.hostname()}`);
console.log('====================================================');

async function loop() {
  try {
    const headers = {
      'x-pc-token': token,
      'Content-Type': 'application/json'
    };

    // 1. Enviar Heartbeat
    await fetch(`${serverUrl}/api/pc/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        hostname: os.hostname(),
        platform: os.platform(),
        uptimeSeconds: Math.floor(os.uptime()),
        localIp: getLocalIp()
      })
    });

    // 2. Consultar Comandos
    const pollRes = await fetch(`${serverUrl}/api/pc/poll`, {
      method: 'GET',
      headers
    });

    const data = await pollRes.json();
    if (data.command) {
      console.log(`\n⚡ [ORDEN RECIBIDA] Comando: ${data.command} (ID: ${data.commandId})`);

      if (data.command === 'shutdown') {
        console.log('🛑 Ejecutando shutdown en Windows...');

        // Confirmar al servidor
        await fetch(`${serverUrl}/api/pc/ack`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            commandId: data.commandId,
            status: 'shutdown_initiated',
            message: 'Windows ejecutando shutdown /s /f /t 5'
          })
        }).catch(() => {});

        // Ejecutar apagado forzado de Windows en 5 segundos
        exec('shutdown /s /f /t 5 /c "Apagado remoto solicitado desde Telegram Bot CDKeysPeru"', (err) => {
          if (err) console.error('Error ejecutando shutdown:', err);
        });

        process.exit(0);
      }
    }
  } catch (err) {
    // Error silencioso para no spamear consola si el servidor está reiniciando
  }

  setTimeout(loop, intervalMs);
}

loop();
