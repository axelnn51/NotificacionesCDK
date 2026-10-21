# 💻 Agente de PC - CDKeysPerú

Este agente se ejecuta en tu PC con Windows y se comunica de forma segura con el Bot de Telegram alojado en Docker/Portainer.

## ¿Qué hace?
1. **Reporta estado Online/Offline**: Cada 5 segundos envía una señal (*heartbeat*) con el nombre de tu equipo, tiempo encendido (*uptime*) e IP local.
2. **Apagado remoto**: Si presionas **🛑 Apagar PC** en Telegram y confirmas la orden, el agente recibe la señal y ejecuta `shutdown /s /t 10`, apagando el equipo en 10 segundos.

---

## ⚙️ Configuración (`config.json`)

Edita el archivo `config.json`:

```json
{
  "serverUrl": "http://IP_O_DOMINIO_PORTAINER:3005",
  "token": "tu_token_secreto_configurado_en_env",
  "heartbeatIntervalSeconds": 5
}
```

- **`serverUrl`**:
  - Si el bot corre en esta misma PC: `"http://localhost:3005"`
  - Si el bot corre en un servidor local (NAS, Proxmox, otra PC): `"http://192.168.1.X:3005"`
  - Si el bot corre en una VPS o túnel Cloudflare: `"https://tu-dominio.com"`
- **`token`**: Debe coincidir exactamente con la variable `PC_AGENT_TOKEN` de tu archivo `.env` en Portainer.

---

## 🚀 Cómo Ejecutarlo

### Opción A: Inicio rápido manual
Haz doble clic sobre:
👉 `iniciar_agente.bat`

Se abrirá una ventana de PowerShell mostrando los pings y esperando órdenes.

---

### Opción B: Inicio automático con Windows (Recomendado)
Para que el agente se ejecute silenciosamente en segundo plano cada vez que inicies sesión en Windows (sin ventanas emergentes):

1. Haz clic derecho sobre `instalar_inicio_automatico.bat` y selecciona **"Ejecutar como Administrador"**.
2. ¡Listo! Creará una tarea programada en Windows que se ejecutará en segundo plano.

Para actualizar o reiniciar el agente después de cambios de código:
👉 Ejecuta `reiniciar_agente.bat`

Si algún día deseas quitarlo, haz clic derecho sobre `desinstalar_inicio_automatico.bat` y selecciona "Ejecutar como Administrador".
