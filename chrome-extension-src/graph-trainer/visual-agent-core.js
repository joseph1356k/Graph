/**
 * Núcleo del runner de Computer Use VISUAL (demo Miracle) — AGNÓSTICO DEL TRANSPORTE.
 *
 * Toda la lógica del loop y del mapeo acción→CDP vive aquí, dependiendo solo de
 * dos costuras inyectables:
 *   - cdpSend(method, params) -> Promise   (los "ojos y manos": CDP Input/Page)
 *   - io.navigate(url) / io.sleep(ms) / io.fetchTurn(body) / io.onLog / io.shouldStop
 *
 * Así el MISMO código corre:
 *   - en la extensión:  cdpSend = chrome.debugger.sendCommand({tabId}, ...)
 *   - en un harness Node: cdpSend = CDPSession.send(...)   (Playwright)  → prueba real.
 *
 * Principios (ver PLAN_DEMO_COMPUTER_USE_VISUAL.md): dentro de la página TODO es
 * visual (screenshot + coordenadas). Se fuerza deviceScaleFactor=1 para que
 * px de imagen == px CSS == coordenadas de Input.dispatchMouseEvent (escala 1,
 * la misma que asume openaiBrain). NO se usan los dominios DOM/Accessibility/Runtime
 * para inspeccionar la página; solo Page (capturar/navegar) e Input (mouse/teclado).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VisualAgentCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = { width: 1280, height: 800, settleMs: 700, maxTurns: 40, maxMs: 5 * 60 * 1000 };

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
    // Solo Page (capturar / lifecycle de navegación). NO DOM/Accessibility/Runtime.
    try { await cdpSend('Page.enable', {}); } catch (e) { /* headless a veces ya está */ }
  }

  /** Fuerza viewport fijo a DPR=1 → escala 1 determinista (px imagen == px CSS). */
  async function setupViewport(cdpSend, { width, height }) {
    await cdpSend('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
  }

  /** Captura el viewport como PNG base64 (sin prefijo data:). */
  async function captureScreenshot(cdpSend) {
    const res = await cdpSend('Page.captureScreenshot', { format: 'png' });
    return res && res.data ? res.data : '';
  }

  const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

  /** Ejecuta UNA acción del contrato real (kind: tap|type|key|scroll|swipe|wait|mcp). */
  async function executeAction(cdpSend, action, io) {
    const a = action || {};
    switch (a.kind) {
      case 'tap':
        if (!isNum(a.x) || !isNum(a.y)) return { ok: false, note: 'tap sin coordenadas' };
        await clickAt(cdpSend, a.x, a.y);
        return { ok: true };

      case 'type': {
        if (isNum(a.x) && isNum(a.y)) await clickAt(cdpSend, a.x, a.y);
        if (a.text) await cdpSend('Input.insertText', { text: `${a.text}` });
        return { ok: true };
      }

      case 'key': {
        const raw = `${a.key || ''}`.toLowerCase();
        const desc = KEY_MAP[raw];
        if (desc) {
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyDown', key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.vk, nativeVirtualKeyCode: desc.vk });
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyUp', key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.vk, nativeVirtualKeyCode: desc.vk });
        } else if (a.key) {
          // Tecla imprimible suelta.
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyDown', text: `${a.key}`, key: `${a.key}` });
          await cdpSend('Input.dispatchKeyEvent', { type: 'keyUp', key: `${a.key}` });
        }
        return { ok: true };
      }

      case 'scroll': {
        const dy = a.down === false ? -600 : 600;
        await cdpSend('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: dy });
        return { ok: true };
      }

      case 'swipe': {
        const { x1, y1, x2, y2 } = a;
        await cdpSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          await cdpSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1 });
        }
        await cdpSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, buttons: 0 });
        return { ok: true };
      }

      case 'wait':
        await io.sleep(Math.min(Math.max(Number(a.ms) || 1000, 100), 15000));
        return { ok: true };

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
   * Loop completo: screenshot → brain → acciones → screenshot → …
   * io: { cdpSend, navigate, sleep, fetchTurn, onLog, shouldStop, getUrl }
   * opts: { goal, width, height, settleMs, maxTurns, maxMs }
   * Devuelve { status: 'done'|'question'|'timeout'|'stopped'|'error', turns, question?, error? }
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

    while (true) {
      if (io.shouldStop && io.shouldStop()) return finish('stopped', turnIndex);
      if (turnIndex >= cfg.maxTurns) return finish('timeout', turnIndex, { reason: 'maxTurns' });
      if (Date.now() - startedAt > cfg.maxMs) return finish('timeout', turnIndex, { reason: 'maxMs' });

      // 1) OBSERVAR
      const screenshot = await captureScreenshot(io.cdpSend);
      const url = io.getUrl ? await safe(io.getUrl) : '';

      // 2) DECIDIR
      const body = session
        ? { session, state: baseState(cfg, screenshot, url), results: lastResults }
        : { goal: cfg.goal, state: baseState(cfg, screenshot, url) };

      let turn;
      try {
        turn = await io.fetchTurn(body);
      } catch (e) {
        log({ turnIndex, phase: 'brain-error', error: `${e && e.message || e}` });
        return finish('error', turnIndex, { error: `${e && e.message || e}` });
      }
      if (turn && turn.error) {
        log({ turnIndex, phase: 'brain-error', error: turn.error });
        return finish('error', turnIndex, { error: turn.error });
      }

      session = turn.session || session;
      const actions = Array.isArray(turn.actions) ? turn.actions : [];
      log({
        turnIndex, phase: 'decided', url,
        actions: actions.map((a) => a.kind === 'mcp' ? `navigate ${a.args && a.args.url || ''}` : a.kind),
        text: turn.text || '', narration: turn.narration || '',
        done: !!turn.done, question: turn.question || null,
        screenshot // el llamador decide si la guarda/miniaturiza
      });

      // 3) TERMINAR / PREGUNTAR
      if (turn.question) return finish('question', turnIndex, { question: turn.question, session });
      if (turn.done) return finish('done', turnIndex, { text: turn.text || '' });

      // 4) EJECUTAR
      lastResults = [];
      for (const action of actions) {
        if (io.shouldStop && io.shouldStop()) return finish('stopped', turnIndex);
        try {
          const r = await executeAction(io.cdpSend, action, io);
          if (action.kind === 'mcp') lastResults.push(r && r.ok ? 'ok' : `error: ${r && r.note || 'fallo'}`);
          log({ turnIndex, phase: 'executed', action: action.kind === 'mcp' ? `navigate ${action.args && action.args.url || ''}` : action.kind, result: r });
        } catch (e) {
          if (action.kind === 'mcp') lastResults.push(`error: ${e && e.message || e}`);
          log({ turnIndex, phase: 'exec-error', action: action.kind, error: `${e && e.message || e}` });
        }
      }

      // 5) ASENTAR
      await io.sleep(cfg.settleMs);
      turnIndex += 1;
    }

    function finish(status, turns, extra) {
      const out = Object.assign({ status, turns, ms: Date.now() - startedAt }, extra || {});
      log({ turnIndex: turns, phase: 'finish', status, ms: out.ms });
      return out;
    }
  }

  function baseState(cfg, screenshot, url) {
    return {
      screen: url || 'about:blank',
      uiContext: '',
      width: cfg.width,
      height: cfg.height,
      screenshot,
      mode: 'browser-visual',
      surfaceOrigin: originOf(url),
      surfacePathname: pathnameOf(url)
    };
  }

  function originOf(url) { try { return new URL(url).origin; } catch (e) { return ''; } }
  function pathnameOf(url) { try { return new URL(url).pathname; } catch (e) { return ''; } }
  async function safe(fn) { try { return await fn(); } catch (e) { return ''; } }

  return {
    DEFAULTS, KEY_MAP,
    enablePage, setupViewport, captureScreenshot, executeAction, runTaskLoop
  };
});
