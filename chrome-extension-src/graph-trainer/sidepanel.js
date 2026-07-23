// Side Panel del agente visual: configura backend + API key, lanza/detiene la
// tarea y muestra el estado en vivo (log de turnos + última captura). Toda la
// ejecución vive en el service worker (visual-agent.js); aquí solo se controla y
// observa. El estado llega por mira:agent-update y mira:agent-get-state.

const DEFAULT_BACKEND_URL = 'https://miracle-zeta.vercel.app';

const $ = (id) => document.getElementById(id);
const backendUrlEl = $('backendUrl');
const apiKeyEl = $('apiKey');
const userIdEl = $('userId');
const vercelBypassEl = $('vercelBypass');
const goalEl = $('goal');
const useCurrentEl = $('useCurrent');
const startBtn = $('start');
const stopBtn = $('stop');
const statusBar = $('statusBar');
const shotImg = $('shot');
const logEl = $('log');
const cfgEl = $('cfg');
const metricsEl = $('metrics');
const copyTraceBtn = $('copyTrace');
const clearTraceBtn = $('clearTrace');

let lastState = null;

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!res || !res.ok) return reject(new Error((res && res.error) || 'Sin respuesta del runner.'));
      resolve(res.payload);
    });
  });
}

function loadConfig() {
  return new Promise((resolve) => {
    (chrome.storage.sync || chrome.storage.local).get(
      { backendUrl: DEFAULT_BACKEND_URL, agentApiKey: '', agentUserId: '', agentVercelBypass: '' },
      (s) => {
        backendUrlEl.value = s.backendUrl || DEFAULT_BACKEND_URL;
        apiKeyEl.value = s.agentApiKey || '';
        userIdEl.value = s.agentUserId || '';
        if (vercelBypassEl) vercelBypassEl.value = s.agentVercelBypass || '';
        resolve();
      }
    );
  });
}

function saveConfig() {
  (chrome.storage.sync || chrome.storage.local).set({
    backendUrl: `${backendUrlEl.value || DEFAULT_BACKEND_URL}`.trim(),
    agentApiKey: `${apiKeyEl.value || ''}`.trim(),
    agentUserId: `${userIdEl.value || ''}`.trim(),
    agentVercelBypass: `${(vercelBypassEl && vercelBypassEl.value) || ''}`.trim()
  });
}
[backendUrlEl, apiKeyEl, userIdEl, vercelBypassEl].filter(Boolean).forEach((el) => el.addEventListener('change', saveConfig));

function render(state) {
  if (!state) return;
  lastState = state;
  const running = !!state.running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;

  const statusText = {
    idle: 'Listo.', running: `Trabajando… (turno ${state.turns || 0})`, stopping: 'Deteniendo…',
    done: `✔ Terminado en ${state.turns || 0} turnos.`, stopped: 'Detenido.',
    timeout: `⏱ Límite alcanzado (${state.turns || 0} turnos).`,
    stuck: `⚠ Sin cambios en pantalla; detenido (${state.turns || 0} turnos). Revisa el trace.`,
    question: `❓ Pregunta: ${(state.result && state.result.question) || ''}`,
    error: `✖ Error: ${(state.result && state.result.error) || ''}`
  }[state.status] || state.status;
  statusBar.textContent = statusText;
  statusBar.className = running ? 'run' : (state.status === 'error' ? 'err' : '');

  if (state.lastScreenshot) {
    shotImg.src = `data:image/png;base64,${state.lastScreenshot}`;
    shotImg.style.display = 'block';
  }

  // Línea de métricas de calibración del último turno observado.
  const lastDecided = [...(state.log || [])].reverse().find((e) => e.phase === 'decided');
  if (lastDecided) {
    const s = lastDecided.screenshotSize, v = lastDecided.viewportSize, sc = lastDecided.scale;
    metricsEl.textContent = `URL: ${lastDecided.url || '—'} · shot ${s ? s.w + '×' + s.h : '?'} · viewport ${v ? v.w + '×' + v.h : '?'} · escala ${sc ? sc.x : '?'}`;
  }

  logEl.innerHTML = '';
  (state.log || []).slice().reverse().forEach((e) => {
    const div = document.createElement('div');
    div.className = 'entry';
    let body = '';
    if (e.phase === 'decided') {
      body = `<span class="k">turno ${e.turnIndex}</span> ${(e.actions || []).join(', ') || '(fin)'}` +
        (e.narration ? ` — <em>${escapeHtml(e.narration)}</em>` : '') +
        (e.text ? ` — ${escapeHtml(e.text)}` : '');
    } else if (e.phase === 'executed' && (e.orig || e.sent)) {
      body = `<small>↳ ${escapeHtml(e.action || '')}${e.orig ? ` orig(${e.orig.x},${e.orig.y})→css(${e.sent.x},${e.sent.y})` : ''}</small>`;
    } else if (e.phase === 'exec-error' || e.phase === 'brain-error') {
      body = `<span class="x">error</span> ${escapeHtml(e.error || '')}`;
    } else if (e.phase === 'finish') {
      body = `<span class="k">fin</span> ${e.status} · ${Math.round((e.ms || 0) / 1000)}s`;
    } else {
      return;
    }
    div.innerHTML = `${body} <small>${new Date(e.t || Date.now()).toLocaleTimeString()}</small>`;
    logEl.appendChild(div);
  });
}

if (copyTraceBtn) {
  copyTraceBtn.addEventListener('click', async () => {
    const trace = JSON.stringify((lastState && lastState.log) || [], null, 2);
    try { await navigator.clipboard.writeText(trace); copyTraceBtn.textContent = '¡Copiado!'; }
    catch (e) { copyTraceBtn.textContent = 'No se pudo copiar'; }
    setTimeout(() => { copyTraceBtn.textContent = 'Copiar trace'; }, 1500);
  });
}
if (clearTraceBtn) {
  clearTraceBtn.addEventListener('click', () => { logEl.innerHTML = ''; metricsEl.textContent = ''; });
}

// Ejemplos de meta (solo prefill del textarea; NO son flujos hardcodeados).
document.querySelectorAll('.ex').forEach((btn) => {
  btn.addEventListener('click', () => { goalEl.value = btn.getAttribute('data-goal') || ''; goalEl.focus(); });
});

function escapeHtml(s) { return `${s}`.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

startBtn.addEventListener('click', async () => {
  saveConfig();
  const goal = `${goalEl.value || ''}`.trim();
  if (!goal) { statusBar.textContent = 'Escribe una meta.'; return; }
  if (!`${apiKeyEl.value || ''}`.trim()) { statusBar.textContent = 'Falta la API key.'; cfgEl.open = true; return; }
  startBtn.disabled = true;
  statusBar.textContent = 'Iniciando…';
  try {
    let tabId;
    if (useCurrentEl.checked) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab && tab.id;
    }
    await sendMessage({ type: 'mira:agent-start', goal, tabId });
  } catch (e) {
    statusBar.textContent = `No se pudo iniciar: ${e.message || e}`;
    statusBar.className = 'err';
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try { await sendMessage({ type: 'mira:agent-stop' }); } catch (e) { /* ignore */ }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'mira:agent-update') render(message.state);
});

(async () => {
  await loadConfig();
  try { render(await sendMessage({ type: 'mira:agent-get-state' })); } catch (e) { /* runner aún sin estado */ }
})();
