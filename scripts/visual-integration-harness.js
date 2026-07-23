// Integración: loop CDP real (visual-agent-core) + AgentTurnService REAL como
// fetchTurn (con cerebro mock). Solo el LLM es simulado; todo lo demás es el
// código de producción: gating de modo visual, encode/decode HMAC de sesión,
// passthrough de acciones. Prueba la CONTINUIDAD real de sesión entre turnos.
//
//   NODE_PATH=/opt/node22/lib/node_modules node harness_integration.js

const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');
const core = require('../chrome-extension-src/graph-trainer/visual-agent-core.js');
const AgentTurnService = require('../src/application/use-cases/AgentTurnService');

let failures = 0;
const check = (n, fn) => { try { fn(); console.log('  ✓', n); } catch (e) { failures++; console.log('  ✗', n, '\n      ', e.message); } };

const PAGE1 = `<!doctype html><html><head><meta charset=utf8><title>start</title>
<style>body{margin:0}#b{position:absolute;left:200px;top:120px;width:160px;height:60px}</style></head>
<body><button id=b onclick="document.title='OK'">Boton</button></body></html>`;

// Cerebro MOCK con forma real de runProviderTurn: recibe {session,tools,state,...},
// devuelve {session, turn}. Verifica gating visual y simula el hilo de OpenAI.
let brainCalls = 0;
const seenTools = [];
const seenPrev = [];
function mockBrain(inp) {
  brainCalls += 1;
  seenTools.push(inp.tools.map((t) => t.name).join(','));
  seenPrev.push(inp.session.previousId || '');
  const s = inp.session;
  s.previousId = `resp-${brainCalls}`; // simula previous_response_id de OpenAI
  const turn = (actions, done = false) => ({ session: s, turn: { actions, done, question: null, text: done ? 'listo' : '', needsScreenshot: true, narration: '', intents: [] } });
  if (brainCalls === 1) return turn([{ kind: 'mcp', tool: 'navigate', args: { url: inp.state.__base + '/p1' } }]);
  if (brainCalls === 2) return turn([{ kind: 'tap', x: 280, y: 150 }]); // click boton
  return turn([], true);
}

(async () => {
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE1); });
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  const svc = new AgentTurnService({
    memoryRepository: { forPrompt: async () => '', remember: async () => {} },
    runProviderTurn: mockBrain,
    resolveConfig: () => ({ configured: true, provider: 'openai', apiKey: 'k', model: 'm', effort: 'low' })
  });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('about:blank');
  const cdp = await context.newCDPSession(page);

  const io = {
    cdpSend: (m, p) => cdp.send(m, p || {}),
    sleep: (ms) => page.waitForTimeout(ms),
    navigate: async (url) => { await page.goto(url, { waitUntil: 'load' }); },
    getUrl: async () => page.url(),
    onLog: (e) => { if (e.phase === 'decided' || e.phase === 'finish') console.log(`    · turn ${e.turnIndex} ${e.phase} ${JSON.stringify(e.actions || e.status || '')}`); },
    shouldStop: () => false,
    // fetchTurn = AgentTurnService REAL (inyecta __base para que el mock arme el URL)
    fetchTurn: async (body) => {
      body.state.__base = BASE;
      const res = await svc.handleTurn(body);
      if (res.status !== 200) throw new Error(res.json.error);
      return res.json;
    }
  };

  console.log('\n[Integración: core + AgentTurnService real + sesión HMAC]');
  const result = await core.runTaskLoop(io, { goal: 'prueba de integración', width: 1280, height: 800, settleMs: 120, maxTurns: 10 });

  check('terminó en done', () => assert.strictEqual(result.status, 'done'));
  check('gating visual real: cada turno el cerebro recibió SOLO navigate', () => {
    seenTools.forEach((t, i) => assert.strictEqual(t, 'navigate', `turno ${i + 1} tools=${t}`));
  });
  check('continuidad real: la sesión (HMAC) sobrevivió turnos (previousId se reenvió)', () => {
    // turno 1: previousId '' ; turno 2: 'resp-1' ; turno 3: 'resp-2'
    assert.strictEqual(seenPrev[0], '', `turno1 previd=${seenPrev[0]}`);
    assert.strictEqual(seenPrev[1], 'resp-1', `turno2 previd=${seenPrev[1]}`);
    assert.ok(seenPrev.length >= 3 ? seenPrev[2] === 'resp-2' : true);
  });
  const finalTitle = await page.title();
  check('navigate real + click por coordenada pegó (title OK)', () => assert.strictEqual(finalTitle, 'OK', `title=${finalTitle}`));

  await cdp.detach().catch(() => {});
  await browser.close();
  await new Promise((r) => server.close(r));
  console.log(`\n${failures === 0 ? '✅ INTEGRACIÓN OK' : `❌ ${failures} fallo(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
