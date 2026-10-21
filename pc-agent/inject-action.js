// ==============================================================================
// Inyector de Acciones (Esc / Enter / Cancel / Submit) via CDP
// ==============================================================================

const action = process.argv[2] || 'enter';

async function perform() {
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
    const expr = `(() => {
      const act = "${action}";
      if (act === 'esc' || act === 'stop') {
        // Buscar botón Cancel del agente
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return aria.includes('cancel') || aria.includes('stop');
        });
        if (cancelBtn) {
          cancelBtn.click();
          return 'CANCEL_CLICKED';
        }
      } else if (act === 'enter' || act === 'accept') {
        // Buscar Send message o Submit
        const sendBtn = document.querySelector('button[aria-label="Send message"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return 'SEND_CLICKED';
        }
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return txt === 'submit' || txt === 'accept' || txt === 'proceed';
        });
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
          return 'SUBMIT_CLICKED';
        }
      }
      return 'NO_MATCH';
    })()`;
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id === 1) {
      clearTimeout(timeoutTimer);
      const resVal = data.result?.result?.value || 'DONE';
      console.log(resVal);
      ws.close();
      process.exit(0);
    }
  };
}

perform().catch(err => {
  console.log('ERROR:', err.message);
  process.exit(1);
});
