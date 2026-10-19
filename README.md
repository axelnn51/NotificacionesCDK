# 🛒 Bot de Pedidos CDKeysPerú & Monitor Remoto de PC

Sistema automatizado de **notificaciones en tiempo real para pedidos de WooCommerce** (cdkeysperu.com) vía **Telegram**, junto con un **módulo de monitoreo y apagado remoto de tu PC con Windows**.

Diseñado para ser desplegado fácilmente en **Portainer / Docker** y versionado de forma 100% segura en **Git** sin riesgo de filtrar credenciales.

---

## 🌟 Características Principales

### 1. 🔔 Notificaciones de Pedidos (100% Solo Lectura)
- **Cero Modificaciones:** El bot **solo lee** datos mediante la REST API de WooCommerce. No existen endpoints ni funciones de escritura, edición o eliminación en la tienda.
- **Todos los Estados:** Notifica inmediatamente cualquier pedido nuevo o transición de estado:
  - ⏳ **Pendiente de pago** (`pending`)
  - ⚙️ **En proceso / Confirmado** (`processing`)
  - ⏸️ **En espera** (`on-hold`)
  - ✅ **Completado / Entregado** (`completed`)
  - ❌ **Cancelado** (`cancelled`)
  - ↩️ **Reembolsado** (`refunded`)
  - ⚠️ **Fallido** (`failed`)
- **Mensajes Claros, Breves y Estructurados:**
  - Número de Pedido y Estado actual con iconos.
  - Nombre del cliente, email y teléfono con enlace directo a WhatsApp.
  - Lista detallada de productos adquiridos con cantidades y precios.
  - Método de pago utilizado (Yape, Plin, Mercado Pago, etc.) y total en Soles (S/).
  - Enlace directo de 1 clic para abrir el pedido en el panel de WordPress Admin.
- **Doble Confiabilidad (Sondeo + Webhook):**
  - **Sondeo Inteligente:** Revisa automáticamente cada 30 segundos sin necesidad de IPs públicas ni abrir puertos en el router.
  - **Webhook Opcional:** Si expones el puerto en tu servidor o usas Cloudflare Tunnel, soporta notificaciones instantáneas (`POST /webhook/woocommerce`).
  - **Sin Alertas Repetidas:** Almacena el estado en disco (`data/orders_state.json`) para que reiniciar el contenedor no reenvíe pedidos anteriores.

### 2. 💻 Monitor de PC y Apagado Remoto
- **Monitoreo en Tiempo Real:** Envía `/pc` o presiona el botón **💻 Estado de mi PC** en Telegram para ver si tu computadora está:
  - 🟢 **ENCENDIDA (Online):** Muestra nombre del equipo, IP local, tiempo de actividad (*uptime*) y último ping.
  - 🔴 **APAGADA / DESCONECTADA:** Muestra cuándo fue la última vez que estuvo encendida.
- **Botón de Apagado Directo:**
  - Presiona **🛑 Apagar PC**.
  - Telegram te solicitará una confirmación (`⚠️ ¿Confirmas apagar el equipo? [Sí] [Cancelar]`) para evitar toques accidentales.
  - Al confirmar, Windows recibe la orden en menos de 5 segundos y ejecuta el apagado limpio del sistema.

### 3. 🛡️ Seguridad y Preparación para Git
- `.gitignore` robusto que protege `.env`, `node_modules`, archivos de estado y bases de datos locales.
- Autorización estricta por `ADMIN_CHAT_ID`: solo los usuarios autorizados pueden interactuar con el bot.

---

## 📁 Estructura del Proyecto

```text
Pedidos CDKEYSPERU/
├── .dockerignore
├── .gitignore                    # Protege .env y credenciales de subirse a Git
├── .env.example                  # Plantilla documentada para variables de entorno
├── Dockerfile                    # Contenedor optimizado Node.js 20 Alpine
├── docker-compose.yml            # Stack listo para Portainer
├── package.json
├── src/
│   ├── index.js                  # Punto de entrada principal
│   ├── config.js                 # Validador de variables de entorno
│   ├── bot/
│   │   ├── telegram.js           # Manejador del Bot de Telegram (Telegraf)
│   │   ├── formatters.js         # Plantillas HTML de mensajes claros y limpios
│   │   └── keyboards.js          # Botones interactivos (menús e inline keyboards)
│   ├── services/
│   │   ├── woocommerce.js        # Cliente seguro SOLO LECTURA de WooCommerce
│   │   ├── orderMonitor.js       # Rastreador de nuevos pedidos y cambios de estado
│   │   └── store.js              # Persistencia local de pedidos y estado de PC
│   ├── server/
│   │   ├── app.js                # Servidor Express
│   │   └── routes/
│   │       ├── webhook.js        # Receptor de webhooks de WooCommerce
│   │       └── pcApi.js          # API para el agente de monitoreo de PC
│   └── scripts/
│       ├── test-wc.js            # Prueba rápida de conexión a WooCommerce
│       └── test-tg.js            # Prueba rápida de envío de mensaje a Telegram
└── pc-agent/                     # Agente ligero para tu PC con Windows
    ├── config.json               # Configuración del agente (IP del servidor y token)
    ├── pc-agent.ps1              # Script nativo de PowerShell (sin dependencias)
    ├── pc-agent.js               # Versión alternativa en Node.js
    ├── iniciar_agente.bat        # Lanzador manual
    ├── instalar_inicio_automatico.bat   # Lo instala como tarea programada al iniciar Windows
    ├── desinstalar_inicio_automatico.bat
    └── README.md
```

---

## 🚀 Despliegue en Portainer (Paso a Paso)

### Paso 1: Subir el proyecto a tu repositorio Git (GitHub / GitLab)

1. Abre una terminal en esta carpeta y agrega tus archivos:
   ```bash
   git add .
   git commit -m "feat: bot de notificaciones pedidos y monitor pc para cdkeysperu"
   ```
2. Conecta tu repositorio remoto de GitHub / GitLab:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git branch -M master
   git push -u origin master
   ```
   *(El archivo `.gitignore` impedirá automáticamente que tu `.env` se suba).*

---

### Paso 2: Crear el Stack en Portainer

1. En tu panel de **Portainer**, ve a **Stacks** > **Add stack**.
2. **Nombre:** `pedidos-cdkeysperu`.
3. **Build method:**
   - Puedes seleccionar **Repository** y pegar la URL de tu repositorio Git de GitHub/GitLab.
   - O seleccionar **Web editor** y pegar el contenido de `docker-compose.yml`.
4. En la sección **Environment variables** (Variables de entorno), agrega las siguientes claves (puedes copiarlas de `.env.example`):

| Variable | Valor / Descripción |
| :--- | :--- |
| `PORT` | `3005` |
| `TELEGRAM_BOT_TOKEN` | Token de tu bot de Telegram (de @BotFather) |
| `ADMIN_CHAT_ID` | Tu Chat ID personal (ej: `7233007906`) o grupo |
| `WC_URL` | `https://cdkeysperu.com` |
| `WC_CONSUMER_KEY` | `ck_xxxxxxxxxxxxxxxxxxxxxxxx` (Permiso Solo Lectura) |
| `WC_CONSUMER_SECRET` | `cs_xxxxxxxxxxxxxxxxxxxxxxxx` |
| `POLL_INTERVAL_SECONDS` | `30` (segundos entre consultas a la tienda) |
| `PC_AGENT_TOKEN` | Una clave secreta que tú inventes (ej: `clave_pc_axel_2026`) |
| `TZ` | `America/Lima` |

5. Haz clic en **Deploy the stack**. ¡Portainer descargará y pondrá en marcha el bot automáticamente!

---

## 💻 Configurar el Agente en tu PC con Windows

Para que el bot sepa si esta computadora está encendida y puedas apagarla desde Telegram:

1. Ve a la carpeta `pc-agent/` en tu PC.
2. Abre el archivo `config.json` con el bloc de notas:
   ```json
   {
     "serverUrl": "http://IP_DE_TU_SERVIDOR_O_PORTAINER:3005",
     "token": "LA_MISMA_CLAVE_PC_AGENT_TOKEN_QUE_PUSISTE_EN_PORTAINER",
     "heartbeatIntervalSeconds": 5
   }
   ```
   *Nota: Si Portainer corre en esta misma PC, pon `"http://localhost:3005"`.*
3. Para que inicie solo con Windows de manera invisible:
   - Haz clic derecho sobre **`instalar_inicio_automatico.bat`** y elige **"Ejecutar como Administrador"**.
4. ¡Listo! Cada vez que enciendas tu PC enviará su estado al bot y estará lista para recibir órdenes de apagado.

---

## 📱 Comandos del Bot en Telegram

| Comando / Botón | Acción |
| :--- | :--- |
| `/start` | Muestra el menú principal y activa los botones inferiores. |
| `🛍️ Últimos Pedidos` o `/pedidos` | Muestra los 5 pedidos más recientes con estado, cliente y montos. |
| `💻 Estado de mi PC` o `/pc` | Muestra si tu equipo está Online/Offline y el botón para apagarlo. |
| `/apagar` | Abre directamente el panel de confirmación de apagado de la PC. |
| `🔄 Sincronizar Ahora` | Fuerza una comprobación inmediata de pedidos en la tienda. |
| `ℹ️ Ayuda` o `/ayuda` | Muestra la guía de comandos y estado de seguridad. |

---

## 🧪 Pruebas Rápidas Locales

Antes de subirlo a Git, puedes probar los componentes directamente desde esta terminal:

```bash
# Probar conexión de lectura con WooCommerce
npm run test-wc

# Probar envío de notificación con formato a Telegram
npm run test-tg

# Iniciar el bot en modo local
npm start
```

---

## 🔒 Garantía de Integridad (Cero Modificaciones)
El servicio `woocommerce.js` ha sido programado de forma que **no contiene ningún método de escritura** (`post`, `put`, `delete`). Puedes estar 100% seguro de que el sistema solo realizará lecturas (`get`) para notificarte lo que ocurre en tu tienda.
