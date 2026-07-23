/**
 * Runner de Computer Use VISUAL en el service worker de la extensión.
 *
 * Cablea el núcleo agnóstico (visual-agent-core.js) a las APIs reales de Chrome:
 *   - "ojos y manos": chrome.debugger + CDP (Page.captureScreenshot / Input.*)
 *   - transporte: chrome.tabs.create/update (navigate); nunca para resolver la tarea
 *   - decisión: fetch a POST {backendUrl}/api/v1/agent/turn con X-API-Key
 *
 * Mantiene UNA sola tarea activa. El estado (meta, status, turnos, log) vive en
 * chrome.storage.session y se difunde al Side Panel con mira:agent-update.
 *
 * Se carga en background.js con importScripts (junto a visual-agent-core.js).
 */
(function () {
  'use strict';
  const Core = self.VisualAgentCore;
  const DEFAULT_BACKEND_URL = 'https://miracle-zeta.vercel.app';
  const STATE_KEY = 'visualAgentState';
  const MAX_LOG = 60;

  let state = emptyState();

  function emptyState() {
    return { running: false, goal: '', tabId: null, status: 'idle', turns: 0, log: [], lastScreenshot: '', startedAt: 0, result: null };
  }

  // ---------- config ----------
  function storageGet(defaults) {
    return new Promise((resolve) => (chrome.storage.sync || chrome.storage.local).get(defaults, resolve));
  }
  async function getConfig() {
    const s = await storageGet({ backendUrl: DEFAULT_BACKEND_URL, agentApiKey: '', agentUserId: '' });
    return {
      backendUrl: `${s.backendUrl || DEFAULT_BACKEND_URL}`.trim().replace(/\/+$/, '') || DEFAULT_BACKEND_URL,
      apiKey: `${s.agentApiKey || ''}`.trim(),
      userId: `${s.agentUserId || ''}`.trim()
    };
  }

  // ---------- persistencia + difusión al side panel ----------
  function persist() {
    const snapshot = {
      running: state.running, goal: state.goal, tabId: state.tabId, status: state.status,
      turns: state.turns, log: state.log.slice(-MAX_LOG), lastScreenshot: state.lastScreenshot,
      startedAt: state.startedAt, result: state.result
    };
    try { chrome.storage.session.set({ [STATE_KEY]: snapshot }); } catch (e) { /* ignore */ }
    try { chrome.runtime.sendMessage({ type: 'mira:agent-update', state: snapshot }); } catch (e) { /* no listener */ }
  }

  // ---------- chrome.debugger promisificado ----------
  function dbgAttach(tabId) {
    return new Promise((resolve, reject) => chrome.debugger.attach({ tabId }, '1.3', () => {
      const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve();
    }));
  }
  function dbgDetach(tabId) {
    return new Promise((resolve) => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); }));
  }
  function mkCdpSend(tabId) {
    return (method, params) => new Promise((resolve, reject) => chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(res);
    }));
  }

  // ---------- tabs ----------
  function tabsGet(tabId) { return new Promise((resolve, reject) => chrome.tabs.get(tabId, (t) => { const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(t); })); }
  function tabsCreate(props) { return new Promise((resolve, reject) => chrome.tabs.create(props, (t) => { const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(t); })); }
  function tabsUpdate(tabId, props) { return new Promise((resolve, reject) => chrome.tabs.update(tabId, props, (t) => { const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(t); })); }

  function waitTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) {} resolve(); };
      const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(finish, timeoutMs);
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function mkNavigate(tabId, cdpSend) {
    return async (url) => {
      await tabsUpdate(tabId, { url });
      await waitTabComplete(tabId);
      // Reaplica DPR=1 tras la navegación (el override puede reiniciarse por página).
      try { await Core.setupViewport(cdpSend, { width: 1280, height: 800 }); } catch (e) { /* reintenta el loop */ }
      await sleep(400);
    };
  }
  function mkGetUrl(tabId) { return async () => { try { const t = await tabsGet(tabId); return t && t.url || ''; } catch (e) { return ''; } }; }

  function onLog(entry) {
    if (entry.phase === 'decided') {
      if (entry.screenshot) state.lastScreenshot = entry.screenshot;
      state.turns = Math.max(state.turns, (entry.turnIndex || 0) + 1);
    }
    const slim = Object.assign({}, entry); delete slim.screenshot; // no guardamos cada PNG en el log
    state.log.push(Object.assign({ t: Date.now() }, slim));
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG);
    persist();
  }

  // ---------- fetch al cerebro ----------
  function mkFetchTurn(cfg) {
    return async (body) => {
      const res = await fetch(`${cfg.backendUrl}/api/v1/agent/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.apiKey },
        body: JSON.stringify(cfg.userId ? Object.assign({ userId: cfg.userId }, body) : body)
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error(`respuesta no-JSON (${res.status}): ${text.slice(0, 160)}`); }
      if (!res.ok) throw new Error(json && json.error ? json.error : `HTTP ${res.status}`);
      return json;
    };
  }

  // ---------- API pública ----------
  async function startTask({ goal, tabId }) {
    if (state.running) throw new Error('Ya hay una tarea activa. Deténla primero.');
    const cfg = await getConfig();
    if (!cfg.apiKey) throw new Error('Falta la API key (X-API-Key) en la configuración del Side Panel.');
    if (!`${goal || ''}`.trim()) throw new Error('Escribe una meta.');

    let tab;
    if (tabId) tab = await tabsGet(tabId);
    else tab = await tabsCreate({ url: 'about:blank', active: true });

    state = emptyState();
    state.running = true; state.goal = `${goal}`.trim(); state.tabId = tab.id; state.status = 'running'; state.startedAt = Date.now();
    persist();

    try {
      await dbgAttach(tab.id);
    } catch (e) {
      state.running = false; state.status = 'error'; state.result = { status: 'error', error: `No se pudo adjuntar el debugger: ${e.message}` };
      persist();
      throw e;
    }

    // El loop corre en segundo plano (puede durar minutos); no bloquea la respuesta
    // al Side Panel. El progreso se difunde por mira:agent-update / getState.
    runLoop(tab.id, cfg);
    return { started: true, tabId: tab.id };
  }

  async function runLoop(tabId, cfg) {
    const cdpSend = mkCdpSend(tabId);
    const io = {
      cdpSend, sleep,
      navigate: mkNavigate(tabId, cdpSend),
      getUrl: mkGetUrl(tabId),
      onLog,
      fetchTurn: mkFetchTurn(cfg),
      shouldStop: () => !state.running
    };

    let result;
    try {
      result = await Core.runTaskLoop(io, { goal: state.goal, width: 1280, height: 800 });
    } catch (e) {
      result = { status: 'error', error: e && e.message ? e.message : `${e}` };
    } finally {
      await dbgDetach(tabId);
    }

    state.running = false;
    state.status = result.status;
    state.result = result;
    if (result.turns != null) state.turns = result.turns;
    persist();
  }

  async function stopTask() {
    if (!state.running) return { stopped: false };
    state.running = false;
    state.status = 'stopping';
    persist();
    return { stopped: true };
  }

  function getState() { return state; }

  self.VisualAgent = { startTask, stopTask, getState };
})();
