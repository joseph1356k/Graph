// Prueba REAL del mapeo de coordenadas del núcleo (visual-agent-core) bajo
// devicePixelRatio = 1 y = 2, demostrando que screenshot≠viewport se maneja bien.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/visual-coords-harness.js
//
// Para cada DPR: mide px del screenshot (readPngSize) y css del viewport
// (getViewportMetrics), calcula scale, y ejecuta un tap dado en ESPACIO DEL
// SCREENSHOT (css*dpr). Verifica que el click aterriza en el botón (título cambia)
// y que las coords enviadas a CDP son las css correctas.

const assert = require('assert');
const { chromium } = require('playwright');
const core = require('../chrome-extension-src/graph-trainer/visual-agent-core.js');

let failures = 0;
const check = (n, fn) => { try { fn(); console.log('  ✓', n); } catch (e) { failures++; console.log('  ✗', n, '\n      ', e.message); } };

// Botón centrado en css (380,230).
const PAGE = `<!doctype html><html><head><meta charset=utf8><title>start</title>
<style>body{margin:0}#b{position:absolute;left:300px;top:200px;width:160px;height:60px}</style></head>
<body><button id=b onclick="document.title='HIT@'+Math.round(event.clientX)+','+Math.round(event.clientY)">B</button></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] });

  for (const dpr of [1, 2]) {
    console.log(`\n[DPR = ${dpr}]`);
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.setContent(PAGE);
    const cdp = await context.newCDPSession(page);
    const cdpSend = (m, p) => cdp.send(m, p || {});
    // Forzamos el DPR por CDP (fiable en headless): así captureScreenshot sí sale
    // a px = css × dpr y podemos ejercitar el mapeo real screenshot→viewport.
    await cdpSend('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: dpr, mobile: false });

    // medir
    const shot = await core.captureScreenshot(cdpSend);
    const png = core.readPngSize(shot);
    const vp = await core.getViewportMetrics(cdpSend);
    const scale = { x: vp.cssW / png.w, y: vp.cssH / png.h };
    console.log(`    screenshot=${png.w}x${png.h}  cssViewport=${vp.cssW}x${vp.cssH}  scale=${scale.x.toFixed(3)}`);

    check(`screenshot ≈ css × dpr (${dpr}x)`, () => {
      assert.ok(Math.abs(png.w - vp.cssW * dpr) <= 2, `png.w=${png.w} css*dpr=${vp.cssW * dpr}`);
    });
    check('scale ≈ 1/dpr', () => assert.ok(Math.abs(scale.x - 1 / dpr) < 0.02, `scale=${scale.x}`));

    // el modelo devuelve coords en espacio del screenshot: css(380,230) * dpr
    const modelX = 380 * dpr, modelY = 230 * dpr;
    const io = { __cssW: vp.cssW, __cssH: vp.cssH };
    const r = await core.executeAction(cdpSend, { kind: 'tap', x: modelX, y: modelY }, io, scale);
    await page.waitForTimeout(120);
    const title = await page.title();

    check('el click aterrizó en el botón (título HIT)', () => assert.ok(title.startsWith('HIT@'), `title=${title}`));
    check('coords enviadas a CDP ≈ css (380,230), no las del screenshot', () => {
      assert.ok(Math.abs(r.sent.x - 380) <= 2 && Math.abs(r.sent.y - 230) <= 2, `sent=${JSON.stringify(r.sent)}`);
    });
    check('clientX del click ≈ 380 (aterrizó donde debía)', () => {
      const m = /HIT@(\d+),(\d+)/.exec(title); const cx = m ? Number(m[1]) : -1;
      assert.ok(Math.abs(cx - 380) <= 3, `clientX=${cx}`);
    });

    await cdp.detach().catch(() => {});
    await context.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? '✅ COORDS OK (DPR 1 y 2)' : `❌ ${failures} fallo(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
