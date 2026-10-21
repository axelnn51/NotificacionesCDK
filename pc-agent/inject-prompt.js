// ==============================================================================
// Inyector Nativo de Prompts para Antigravity IDE via Chrome DevTools Protocol
// ==============================================================================

const arg = process.argv[2];
if (!arg) {
  console.log('NO_ARG');
  process.exit(1);
}

let promptText = '';
try {
  const parsed = JSON.parse(arg);
  promptText = parsed.text || '';
} catch {
  promptText = arg;
}

if (!promptText) {
  console.log('EMPTY_PROMPT');
  process.exit(1);
}

async function inject() {
  const res = await fetch('http://127.0.0.1:9000/json/list', { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.log('NO_PAGE');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const timeoutTimer = setTimeout(() => {
    try { ws.close(); } catch {}
    console.log('TIMEOUT');
    process.exit(1);
  }, 4000);

  ws.onopen = () => {
    // 1. Enfocar el input de chat Lexical de Antigravity
    const expr = `(() => {
      const el = document.querySelector('div[contenteditable="true"]');
      if (!el) return false;
      el.focus();
      return true;
    })()`;
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.id === 1) {
      if (!data.result?.result?.value) {
        console.log('INPUT_NOT_FOUND');
        clearTimeout(timeoutTimer);
        ws.close();
        process.exit(1);
      }
      // 2. Inyectar el texto directamente por el protocolo Chromium
      ws.send(JSON.stringify({ id: 2, method: 'Input.insertText', params: { text: promptText } }));
    } else if (data.id === 2) {
      // 3. Pulsar el botón 'Send message'
      const clickExpr = `(() => {
        const sendBtn = document.querySelector('button[aria-label="Send message"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return true;
        }
        return false;
      })()`;
      ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: clickExpr, returnByValue: true } }));
    } else if (data.id === 3) {
      clearTimeout(timeoutTimer);
      const clicked = data.result?.result?.value;
      console.log(clicked ? 'SENT_OK' : 'SEND_BTN_NOT_CLICKED');
      ws.close();
      process.exit(clicked ? 0 : 1);
    }
  };
}

inject().catch(err => {
  console.log('ERROR:', err.message);
  process.exit(1);
});
