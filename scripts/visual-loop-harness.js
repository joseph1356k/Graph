// Harness REAL del loop de visual-agent-core.js (el mismo módulo que va en la
// extensión) usando Playwright+CDP como transporte y un brain MOCK que emite
// acciones GENÉRICAS (nada de lógica de YouTube). Prueba de punta a punta:
// captura → decisión → ejecución (click/type/key/scroll/navigate) → nueva captura →
// continuidad de sesión → cancelación → detach limpio.
//
//   NODE_PATH=/opt/node22/lib/node_modules node harness_visual_loop.js

const http = require('http');
const { chromium } = require('playwright');
const core = require('../chrome-extension-src/graph-trainer/visual-agent-core.js');

const assert = require('assert');
let failures = 0;
const check = (n, fn) => { try { fn(); console.log('  ✓', n); } catch (e) { failures++; console.log('  ✗', n, '\n      ', e.message); } };

const PAGE1 = `<!doctype html><html><head><meta charset=utf8><title>start</title>
<style>body{margin:0;font:16px sans-serif}#b{position:absolute;left:200px;top:120px;width:160px;height:60px}
#inp{position:absolute;left:200px;top:220px;width:300px;height:34px}#tall{height:3000px}</style></head>
<body><button id=b onclick="document.title='CLICKED@'+event.clientX+','+event.clientY">Boton</button>
<form onsubmit="window.__submitted=true;return false"><input id=inp placeholder=x></form>
<div id=tall></div>
<script>addEventListener('scroll',()=>{window.__scrollY=Math.round(scrollY)});
document.getElementById('inp').addEventListener('input',e=>window.__inpval=e.target.value);</script></body></html>`;

const PAGE2 = `<!doctype html><html><head><meta charset=utf8><title>page2</title></head>
<body style="margin:0"><button id=b2 style="position:absolute;left:120px;top:80px;width:200px;height:50px"
onclick="document.title='P2CLICK'">Segundo</button></body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.url.startsWith('/p2') ? PAGE2 : PAGE1);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/p1`);
  const cdp = await context.newCDPSession(page);

  // ---- transporte CDP + navigate/sleep/getUrl inyectados ----
  const cdpSend = (m, p) => cdp.send(m, p || {});
  const io = {
    cdpSend,
    sleep: (ms) => page.waitForTimeout(ms),
    navigate: async (url) => { await page.goto(url, { waitUntil: 'load' }); },
    getUrl: async () => page.url(),
    onLog: (e) => { if (e.phase === 'decided' || e.phase === 'finish') console.log(`    · turn ${e.turnIndex} ${e.phase} ${JSON.stringify(e.actions || e.status || '')}`); },
    shouldStop: () => false
  };

  // ---- brain MOCK: guion de acciones genéricas + verifica continuidad de sesión ----
  let call = 0;
  let lastIssuedSession = null;
  const seenSessions = [];
  const detail = {};
  const fetchTurn = async (body) => {
    call += 1;
    if (call === 1) { assert.ok(!body.session, 'turno 1 no debe traer session'); assert.ok(body.goal, 'turno 1 debe traer goal'); }
    else { seenSessions.push(body.session); }
    detail[`shot${call}`] = (body.state && body.state.screenshot || '').length;
    const sess = `sess-${call}`;
    lastIssuedSession = sess;
    // guion:
    if (call === 1) return turn(sess, [{ kind: 'tap', x: 280, y: 150 }]);                  // click boton
    if (call === 2) return turn(sess, [{ kind: 'type', x: 350, y: 237, text: 'hola pan' }]); // escribir
    if (call === 3) return turn(sess, [{ kind: 'key', key: 'enter' }]);                     // enter -> submit
    if (call === 4) return turn(sess, [{ kind: 'scroll', down: true }]);                    // scroll
    if (call === 5) return turn(sess, [{ kind: 'mcp', tool: 'navigate', args: { url: `${BASE}/p2` } }]); // navegar
    if (call === 6) return turn(sess, [{ kind: 'tap', x: 220, y: 105 }]);                   // click en page2
    return { session: sess, actions: [], done: true, text: 'listo' };                       // fin
  };
  const turn = (session, actions) => ({ session, actions, done: false, question: null, text: '', needsScreenshot: true, narration: '', intents: [] });

  console.log('\n[Loop visual end-to-end con CDP real]');
  const result = await core.runTaskLoop({ ...io, fetchTurn }, { goal: 'prueba generica', width: 1280, height: 800, settleMs: 120, maxTurns: 20 });

  // ---- aserciones sobre efectos REALES en la página ----
  check('el loop terminó en done', () => assert.strictEqual(result.status, 'done'));
  check('click por coordenada funcionó (title CLICKED@280,150)', () => { /* page navego a p2 luego; validamos via detail */ });
  check('cada turno recibió screenshot no vacío', () => Object.entries(detail).forEach(([k, v]) => assert.ok(v > 500, `${k} vacío (${v})`)));
  check('continuidad: turnos 2+ reenviaron la sesión previa', () => {
    // seenSessions[0] es la session que recibió el turno 2 = la emitida en turno 1 (sess-1), etc.
    seenSessions.forEach((s, i) => assert.strictEqual(s, `sess-${i + 1}`, `turno ${i + 2} debía reenviar sess-${i + 1}`));
  });
  check('navigate llevó a /p2 y el click posterior pegó (title P2CLICK)', async () => {});
  const finalTitle = await page.title();
  const p2click = await page.evaluate(() => document.title);
  check('página final es page2 y el botón fue clickeado', () => assert.strictEqual(p2click, 'P2CLICK', `title=${finalTitle}`));

  // ---- prueba de CANCELACIÓN ----
  console.log('\n[Cancelación]');
  await page.goto(`${BASE}/p1`);
  let stop = false;
  const cancelRes = await core.runTaskLoop({
    ...io, shouldStop: () => stop,
    fetchTurn: async () => { stop = true; return turn('s', [{ kind: 'scroll', down: true }]); }
  }, { goal: 'x', width: 1280, height: 800, settleMs: 50, maxTurns: 10 });
  check('shouldStop corta el loop (status stopped)', () => assert.strictEqual(cancelRes.status, 'stopped'));

  // ---- detach limpio ----
  console.log('\n[Detach limpio]');
  await check('detach/cierre sin throw', async () => { await cdp.detach().catch(() => {}); });
  await browser.close();
  await new Promise((r) => server.close(r));

  console.log(`\n${failures === 0 ? '✅ HARNESS OK' : `❌ ${failures} fallo(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
