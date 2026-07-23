/**
 * Núcleo del runner de Computer Use VISUAL (demo Miracle) — AGNÓSTICO DEL TRANSPORTE.
 *
 * Toda la lógica del loop y del mapeo acción→CDP vive aquí, dependiendo solo de
 * costuras inyectables:
 *   - cdpSend(method, params) -> Promise   (los "ojos y manos": CDP Input/Page)
 *   - io.navigate(url) / io.sleep(ms) / io.fetchTurn(body) / io.onLog / io.shouldStop / io.getUrl
 *
 * El MISMO código corre:
 *   - en la extensión:  cdpSend = chrome.debugger.sendCommand({tabId}, ...)
 *   - en un harness Node: cdpSend = CDPSession.send(...)   (Playwright)  → prueba real.
 *
 * COORDENADAS (importante): NO se asume screenshot == viewport. Cada turno se miden
 * las dimensiones REALES del screenshot (px del PNG) y el tamaño CSS del viewport
 * (Page.getLayoutMetrics). El modelo recibe display = px del screenshot y devuelve
 * coordenadas en ESE espacio; el runner las transforma a px CSS del viewport (lo que
 * consume Input.dispatchMouseEvent) con scale = cssViewport / screenshotPx. Así es
 * correcto ante devicePixelRatio ≠ 1, zoom o redimensionado por el Side Panel.
 *
 * NO se usan los dominios DOM/Accessibility/Runtime para inspeccionar la página;
 * solo Page (capturar / lifecycle / layout-metrics) e Input (mouse/teclado).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VisualAgentCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tareas complejas (Calendar/ChatGPT) necesitan más turnos y tiempo; ChatGPT
  // puede esperar generaciones largas. STUCK_LIMIT corta loops sin progreso.
  const DEFAULTS = { width: 1280, height: 800, settleMs: 800, maxTurns: 60, maxMs: 8 * 60 * 1000, stuckLimit: 4 };

  /** Hash barato de un screenshot base64 para detectar frames idénticos. */
  function hashShot(b64) {
    let h = 5381;
    const step = Math.max(1, Math.floor(b64.length / 4096));
    for (let i = 0; i < b64.length; i += step) h = (((h << 5) + h) ^ b64.charCodeAt(i)) >>> 0;
    return `${b64.length}:${h}`;
  }

  // brain key ('enter'|'back'|<char>|...) → descriptor de tecla para CDP.
  const KEY_MAP = {
    enter: { key: 'Enter', code: 'Enter', vk: 13 },
    back: { key: 'Escape', code: 'Escape', vk: 27 }, // openaiBrain mapea ESC→'back'
    escape: { key: 'Escape', code: 'Escape', vk: 27 },
    tab: { key: 'Tab', code: 'Tab', vk: 9 },
    backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
    delete: { key: 'Delete', code: 'Delete', vk: 46 },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 }
  };

  async function enablePage(cdpSend) {
    try { await cdpSend('Page.enable', {}); } catch (e) { /* headless a veces ya está */ }
  }

  /** Baseline determinista: viewport fijo a DPR=1. Aun así se MIDE cada turno. */
  async function setupViewport(cdpSend, { width, height }) {
    try {
      await cdpSend('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    } catch (e) { /* si falla, el mapeo por métricas reales lo corrige igual */ }
  }

  async function captureScreenshot(cdpSend) {
    const res = await cdpSend('Page.captureScreenshot', { format: 'png' });
    return res && res.data ? res.data : '';
  }

  // ---- métricas reales para transformar coordenadas ----
  function b64Head(b64, n) {
    const slice = b64.slice(0, Math.ceil(n / 3) * 4);
    if (typeof atob === 'function') {
      const s = atob(slice); const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) a[i] = s.charCodeAt(i) & 0xff;
      return a;
    }
    return new Uint8Array(Buffer.from(slice, 'base64').slice(0, n));
  }
  /** Lee ancho/alto del header IHDR de un PNG base64 (sin decodificar la imagen). */
  function readPngSize(b64) {
    try {
      const a = b64Head(b64, 24);
      const rd = (o) => ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0;
      const w = rd(16), h = rd(20);
      return (w > 0 && h > 0 && w < 100000 && h < 100000) ? { w, h } : null;
    } catch (e) { return null; }
  }
  /** Tamaño CSS del viewport visible (Page.getLayoutMetrics). */
  async function getViewportMetrics(cdpSend) {
    try {
      const m = await cdpSend('Page.getLayoutMetrics', {});
      const vv = m.cssVisualViewport || m.visualViewport || {};
      const lv = m.cssLayoutViewport || m.layoutViewport || {};
      const w = Math.round(vv.clientWidth || lv.clientWidth || 0);
      const h = Math.round(vv.clientHeight || lv.clientHeight || 0);
      return { cssW: w, cssH: h };
    } catch (e) { return { cssW: 0, cssH: 0 }; }
  }

  const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

  /**
   * Ejecuta UNA acción del contrato real. `scale` = {x,y} transforma coords del
   * espacio del screenshot (lo que ve el modelo) a px CSS del viewport (CDP Input).
   * Devuelve { ok, orig?, sent?, note?, navigated? } para el trace.
   */
  async function executeAction(cdpSend, action, io, scale) {
    const a = action || {};
    const sx = scale && scale.x ? scale.x : 1;
    const sy = scale && scale.y ? scale.y : 1;
    const tx = (x) => Math.round(x * sx);
    const ty = (y) => Math.round(y * sy);

    switch (a.kind) {
      case 'tap': {
        if (!isNum(a.x) || !isNum(a.y)) return { ok: false, note: 'tap sin coordenadas' };
        const X = tx(a.x), Y = ty(a.y);
        await clickAt(cdpSend, X, Y);
        return { ok: true, orig: { x: a.x, y: a.y }, sent: { x: X, y: Y } };
      }
      case 'type': {
        const out = { ok: true };
        if (isNum(a.x) && isNum(a.y)) { const X = tx(a.x), Y = ty(a.y); await clickAt(cdpSend, X, Y); out.orig = { x: a.x, y: a.y }; out.sent = { x: X, y: Y }; }
        if (a.text) await cdpSend('Input.insertText', { text: `${a.text}` });
        out.text = a.text || '';
        return out;
      }
      case 'key': {
        const raw = `${a.key || ''}`.toLowerCase();
        const desc = KEY_MAP[raw];
        if (desc) {
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyDown', key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.vk, nativeVirtualKeyCode: desc.vk });
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyUp', key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.vk, nativeVirtualKeyCode: desc.vk });
        } else if (a.key) {
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyDown', text: `${a.key}`, key: `${a.key}` });
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyUp', key: `${a.key}` });
        }
        return { ok: true, key: a.key || '' };
      }
      case 'scroll': {
        const dy = a.down === false ? -600 : 600;
        // Scroll en el centro del viewport CSS (independiente de la escala).
        const cx = Math.round((io.__cssW || 640) / 2), cy = Math.round((io.__cssH || 400) / 2);
        await cdpSend('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: dy });
        return { ok: true, deltaY: dy };
      }
      case 'swipe': {
        const x1 = tx(a.x1), y1 = ty(a.y1), x2 = tx(a.x2), y2 = ty(a.y2);
        await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          await cdpSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1 });
        }
        await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, buttons: 0 });
        return { ok: true, orig: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }, sent: { x1, y1, x2, y2 } };
      }
      case 'wait':
        await io.sleep(Math.min(Math.max(Number(a.ms) || 1000, 100), 15000));
        return { ok: true, ms: Number(a.ms) || 1000 };
      case 'mcp':
        if (a.tool === 'navigate' && a.args && a.args.url) {
          await io.navigate(`${a.args.url}`);
          return { ok: true, navigated: `${a.args.url}` };
        }
        return { ok: false, note: `mcp no soportado en visual: ${a.tool}` };
      default:
        return { ok: false, note: `kind desconocido: ${a.kind}` };
    }
  }

  async function clickAt(cdpSend, x, y) {
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  }

  /**
   * Loop: observar (screenshot + métricas) → decidir → transformar+ejecutar → re-observar.
   * io: { cdpSend, navigate, sleep, fetchTurn, onLog, shouldStop, getUrl }
   * Devuelve { status: 'done'|'question'|'timeout'|'stopped'|'error', turns, ... }
   */
  async function runTaskLoop(io, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const log = io.onLog || (() => {});
    const startedAt = Date.now();

    await enablePage(io.cdpSend);
    await setupViewport(io.cdpSend, cfg);

    let session = null;
    let turnIndex = 0;
    let lastResults = [];
    let prevHash = null;
    let sameCount = 0;
    let lastActionable = false;

    while (true) {
      if (io.shouldStop && io.shouldStop()) return finish('stopped', turnIndex);
      if (turnIndex >= cfg.maxTurns) return finish('timeout', turnIndex, { reason: 'maxTurns' });
      if (Date.now() - startedAt > cfg.maxMs) return finish('timeout', turnIndex, { reason: 'maxMs' });

      // 1) OBSERVAR + medir la relación screenshot↔viewport
      const tCap = Date.now();
      const screenshot = await captureScreenshot(io.cdpSend);

      // Anti-loop: si la pantalla NO cambió tras un turno con acciones reales
      // (no `wait`), acumula; a los stuckLimit turnos sin progreso, corta.
      const shotHash = hashShot(screenshot);
      if (prevHash !== null && shotHash === prevHash && lastActionable) sameCount += 1; else sameCount = 0;
      prevHash = shotHash;
      if (sameCount >= cfg.stuckLimit) {
        return finish('stuck', turnIndex, { reason: 'la pantalla no cambió tras varias acciones' });
      }

      const png = readPngSize(screenshot) || { w: cfg.width, h: cfg.height };
      const vp = await getViewportMetrics(io.cdpSend);
      const cssW = vp.cssW || png.w;
      const cssH = vp.cssH || png.h;
      const scale = { x: png.w ? cssW / png.w : 1, y: png.h ? cssH / png.h : 1 };
      io.__cssW = cssW; io.__cssH = cssH;
      const url = io.getUrl ? await safe(io.getUrl) : '';

      // 2) DECIDIR — el modelo recibe display = px del screenshot
      const body = session
        ? { session, state: baseState(png, screenshot, url), results: lastResults }
        : { goal: cfg.goal, state: baseState(png, screenshot, url) };

      let turn;
      const tBrain = Date.now();
      try {
        turn = await io.fetchTurn(body);
      } catch (e) {
        log({ turnIndex, phase: 'brain-error', url, error: `${e && e.message || e}`, ms: Date.now() - tBrain });
        return finish('error', turnIndex, { error: `${e && e.message || e}` });
      }
      if (turn && turn.error) {
        log({ turnIndex, phase: 'brain-error', url, error: turn.error });
        return finish('error', turnIndex, { error: turn.error });
      }

      session = turn.session || session;
      const actions = Array.isArray(turn.actions) ? turn.actions : [];
      log({
        turnIndex, phase: 'decided', goal: cfg.goal, url,
        screenshotSize: { w: png.w, h: png.h }, viewportSize: { w: cssW, h: cssH },
        scale: { x: round3(scale.x), y: round3(scale.y) },
        actions: actions.map(describeAction),
        rawActions: actions,
        text: turn.text || '', narration: turn.narration || '',
        done: !!turn.done, question: turn.question || null,
        brainMs: Date.now() - tBrain, captureMs: tBrain - tCap,
        screenshot // el llamador decide si la guarda/miniaturiza
      });

      // 3) TERMINAR / PREGUNTAR
      if (turn.question) return finish('question', turnIndex, { question: turn.question });
      if (turn.done) return finish('done', turnIndex, { text: turn.text || '' });

      // 4) TRANSFORMAR + EJECUTAR (re-observamos en la próxima vuelta del while)
      lastResults = [];
      for (const action of actions) {
        if (io.shouldStop && io.shouldStop()) return finish('stopped', turnIndex);
        const tAct = Date.now();
        try {
          const r = await executeAction(io.cdpSend, action, io, scale);
          if (action.kind === 'mcp') lastResults.push(r && r.ok ? 'ok' : `error: ${r && r.note || 'fallo'}`);
          log({ turnIndex, phase: 'executed', action: describeAction(action), orig: r.orig || null, sent: r.sent || null, result: r, ms: Date.now() - tAct });
        } catch (e) {
          if (action.kind === 'mcp') lastResults.push(`error: ${e && e.message || e}`);
          log({ turnIndex, phase: 'exec-error', action: describeAction(action), error: `${e && e.message || e}`, ms: Date.now() - tAct });
        }
      }

      // ¿el turno tuvo acciones que deberían cambiar la pantalla? (para el anti-loop)
      lastActionable = actions.some((a) => a && a.kind !== 'wait');

      // 5) ASENTAR antes de volver a observar (estabilidad > velocidad)
      await io.sleep(cfg.settleMs);
      turnIndex += 1;
    }

    function finish(status, turns, extra) {
      const out = Object.assign({ status, turns, ms: Date.now() - startedAt }, extra || {});
      log({ turnIndex: turns, phase: 'finish', status, ms: out.ms, error: out.error || null, question: out.question || null });
      return out;
    }
  }

  function describeAction(a) {
    if (!a) return '?';
    if (a.kind === 'mcp') return `navigate ${a.args && a.args.url || ''}`;
    if (a.kind === 'tap') return `tap(${a.x},${a.y})`;
    if (a.kind === 'type') return `type("${(a.text || '').slice(0, 40)}")`;
    if (a.kind === 'key') return `key(${a.key})`;
    if (a.kind === 'scroll') return `scroll(${a.down === false ? 'up' : 'down'})`;
    if (a.kind === 'wait') return `wait(${a.ms})`;
    return a.kind;
  }

  function baseState(png, screenshot, url) {
    return {
      screen: url || 'about:blank',
      uiContext: '',
      width: png.w,     // display para el modelo = px reales del screenshot
      height: png.h,
      screenshot,
      mode: 'browser-visual',
      surfaceOrigin: originOf(url),
      surfacePathname: pathnameOf(url)
    };
  }

  function originOf(url) { try { return new URL(url).origin; } catch (e) { return ''; } }
  function pathnameOf(url) { try { return new URL(url).pathname; } catch (e) { return ''; } }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  async function safe(fn) { try { return await fn(); } catch (e) { return ''; } }

  return {
    DEFAULTS, KEY_MAP,
    enablePage, setupViewport, captureScreenshot, executeAction, runTaskLoop,
    readPngSize, getViewportMetrics
  };
});
