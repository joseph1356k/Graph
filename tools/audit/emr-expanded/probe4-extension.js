/**
 * EMR Expanded — sonda 4: ¿qué pasa cuando la extensión Miracle está instalada
 * y el usuario abre el propio EMR de Graph? El manifest declara <all_urls> y no
 * excluye los dominios de Graph, así que el runtime se monta dos veces.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;
const BASE = 'http://127.0.0.1:4173';
const TOKEN = fs.readFileSync(path.join(OUT, 'token.txt'), 'utf8').trim();
const EXT = '/home/user/Graph/generated/chrome-extension/graph-trainer';
const R = {};

(async () => {
    const userDataDir = path.join(OUT, 'chrome-profile');
    fs.rmSync(userDataDir, { recursive: true, force: true });
    const context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: '/opt/pw-browsers/chromium',
        headless: false,
        args: [
            '--no-sandbox',
            '--headless=new',
            `--disable-extensions-except=${EXT}`,
            `--load-extension=${EXT}`
        ],
        viewport: { width: 1440, height: 900 }
    });
    await context.addCookies([{ name: 'miracle_admin_session', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
    await context.addInitScript((token) => {
        window.localStorage.setItem('miracle-admin-session-v1', JSON.stringify({
            accessToken: token, user: { email: 'audit@miracle.local' }
        }));
    }, TOKEN);

    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 180)}`));
    page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 180)}`));

    await page.goto(`${BASE}/emr-workspace.html`, { waitUntil: 'load' });
    await page.waitForTimeout(6000);

    R.extensionDetectada = await page.evaluate(() => ({
        marcaEnHtml: document.documentElement.dataset.graphTrainerExtensionMounted || null,
        widgetAuthExtension: !!document.getElementById('graph-trainer-auth-widget')
    }));

    R.duplicados = await page.evaluate(() => {
        const count = (sel) => document.querySelectorAll(sel).length;
        return {
            shellAsistente: count('#graph-assistant-shell, .graph-assistant-shell'),
            consolaEnsenanza: count('#teaching-console, .console'),
            estilosAsistente: count('#graph-assistant-runtime-styles'),
            estilosTrainer: count('#trainer-plugin-styles'),
            estilosReview: count('#miracle-review-styles'),
            asideAdmin: count('aside.miracle-admin-workspace'),
            todosLosStyleTags: count('style'),
            burbujas: count('.graph-assistant-bubble'),
            botonesNota: count('.graph-assistant-note-toggle'),
            clavesLocalStorage: Object.keys(localStorage)
        };
    });

    // ¿Cuántos listeners hay realmente sobre un campo? Medimos por efecto:
    // escribimos una vez y contamos cuántos eventos miracle-field-change llegan.
    R.eventosPorEscritura = await page.evaluate(async () => {
        const recibidos = [];
        const handler = (e) => recibidos.push(e.detail?.source || '?');
        document.addEventListener('miracle-field-change', handler);
        const el = document.getElementById('intake-first-name');
        el.value = 'Valentina';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        document.removeEventListener('miracle-field-change', handler);
        return { eventosRecibidos: recibidos.length, fuentes: recibidos };
    });

    R.hitTest = await page.evaluate(() => {
        const out = [];
        Array.from(document.querySelectorAll('.main-panel input, .main-panel select, .main-panel textarea, .main-panel button')).forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
            const hit = document.elementFromPoint(cx, cy);
            if (hit === el || el.contains(hit)) return;
            out.push({ campo: el.id, tapadoPor: `${hit?.tagName?.toLowerCase()}#${hit?.id || ''}.${(hit?.className || '').toString().slice(0, 40)}` });
        });
        return out;
    });

    await page.screenshot({ path: path.join(OUT, 'con-extension.png') });
    R.logs = logs.slice(0, 40);
    fs.writeFileSync(path.join(OUT, 'probe4-report.json'), JSON.stringify(R, null, 2));
    console.log(JSON.stringify(R, null, 2));
    await context.close();
})().catch((e) => { console.error('PROBE4 FAILED', e.message); process.exit(1); });
