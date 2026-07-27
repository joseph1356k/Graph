/**
 * EMR Expanded — sonda 3: identidad exacta de capas bloqueantes, controles
 * ajenos al EMR reportados al modelo, y métricas visuales.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;
const BASE = 'http://127.0.0.1:4173';
const TOKEN = fs.readFileSync(path.join(OUT, 'token.txt'), 'utf8').trim();
const R = {};

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'miracle_admin_session', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
    await context.addInitScript((token) => {
        window.localStorage.setItem('miracle-admin-session-v1', JSON.stringify({
            accessToken: token, user: { email: 'audit@miracle.local' }
        }));
    }, TOKEN);
    const page = await context.newPage();
    await page.goto(`${BASE}/emr-workspace.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // --- 1. Controles del snapshot que NO pertenecen al EMR -----------------
    R.controlesAjenosEnSnapshot = await page.evaluate(() => {
        const snap = window.GraphPluginContext.capturePageSnapshot();
        const emrRoot = document.querySelector('.main-panel');
        const topbar = document.querySelector('.topbar');
        const ajenos = [];
        snap.controls.forEach((c) => {
            let el = null;
            try { el = document.querySelector(c.selector); } catch (e) { /* */ }
            if (!el) { ajenos.push({ ...c, motivo: 'selector no resuelve' }); return; }
            if (!emrRoot.contains(el) && !topbar.contains(el)) {
                ajenos.push({
                    selector: c.selector, label: c.label, tag: c.tagName, visible: c.visible,
                    duenio: el.closest('[class]')?.className?.toString?.().slice(0, 60) || el.parentElement?.tagName
                });
            }
        });
        return { totalSnapshot: snap.controls.length, ajenos };
    });

    // --- 2. Identidad exacta de cada bloqueador de clic ---------------------
    R.bloqueadores = await page.evaluate(() => {
        const out = [];
        Array.from(document.querySelectorAll('.main-panel input, .main-panel select, .main-panel textarea, .main-panel button')).forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
            const hit = document.elementFromPoint(cx, cy);
            if (hit === el || el.contains(hit)) return;
            const chain = [];
            let cur = hit;
            while (cur && cur !== document.body && chain.length < 4) {
                chain.push(`${cur.tagName.toLowerCase()}${cur.id ? '#' + cur.id : ''}${cur.className && typeof cur.className === 'string' ? '.' + cur.className.trim().split(/\s+/).join('.') : ''}`);
                cur = cur.parentElement;
            }
            const s = hit ? getComputedStyle(hit) : null;
            out.push({
                campoBloqueado: el.id,
                bloqueadoPor: chain.join(' < '),
                zIndexBloqueador: s?.zIndex, pointerEvents: s?.pointerEvents, position: s?.position
            });
        });
        return out;
    });

    // --- 3. ¿window.onload fue sobrescrito? ---------------------------------
    R.onload = await page.evaluate(() => ({
        tieneOnload: typeof window.onload === 'function',
        fuenteOnload: `${window.onload}`.slice(0, 220),
        pageStateInicializado: !!window.PageState?.current,
        trainerMontado: !!document.getElementById('teaching-console')
    }));

    // --- 4. moveToSelector sobre un campo invisible ---------------------------
    R.caritaSobreCampoInvisible = await page.evaluate(async () => {
        const rt = window.MiracleAssistantRuntime;
        const shell = document.getElementById('graph-assistant-shell');
        const antes = shell.getBoundingClientRect();
        rt.moveToSelector('#closure-billing-code', {}); // campo de una vista oculta
        await new Promise((r) => setTimeout(r, 800));
        const despues = shell.getBoundingClientRect();
        const spot = document.getElementById('graph-assistant-spotlight');
        return {
            vistaActiva: document.querySelector('[data-view-target].active')?.getAttribute('data-view-target'),
            posAntes: [Math.round(antes.x), Math.round(antes.y)],
            posDespues: [Math.round(despues.x), Math.round(despues.y)],
            seMovio: Math.round(antes.x) !== Math.round(despues.x) || Math.round(antes.y) !== Math.round(despues.y),
            spotlightVisible: spot?.dataset.visible,
            spotlightRect: spot ? [Math.round(spot.getBoundingClientRect().x), Math.round(spot.getBoundingClientRect().y)] : null
        };
    });

    // --- 5. Métricas visuales del módulo de registro ------------------------
    R.metricasVisuales = await page.evaluate(() => {
        const panel = document.querySelector('.main-panel');
        const all = Array.from(panel.querySelectorAll('*')).filter((el) => el.getBoundingClientRect().width > 0);
        const conBorde = all.filter((el) => {
            const s = getComputedStyle(el);
            return s.borderTopWidth !== '0px' || s.borderBottomWidth !== '0px';
        });
        const conSombra = all.filter((el) => getComputedStyle(el).boxShadow !== 'none');
        const conRadio = all.filter((el) => parseFloat(getComputedStyle(el).borderRadius) > 0);
        const labels = Array.from(panel.querySelectorAll('label'));
        const enMayusculas = labels.filter((l) => getComputedStyle(l).textTransform === 'uppercase');
        const alturaCampos = Array.from(panel.querySelectorAll('input,select')).map((el) => Math.round(el.getBoundingClientRect().height));
        const alturaTextareas = Array.from(panel.querySelectorAll('textarea')).map((el) => Math.round(el.getBoundingClientRect().height));
        const textoDescriptivo = Array.from(panel.querySelectorAll('.view-header p, .form-card-head p, .ribbon-card span'))
            .map((p) => (p.textContent || '').trim().length).reduce((a, b) => a + b, 0);
        return {
            elementosVisibles: all.length,
            cajasConBorde: conBorde.length,
            cajasConSombra: conSombra.length,
            cajasConBordeRedondeado: conRadio.length,
            etiquetas: labels.length,
            etiquetasEnMayusculas: enMayusculas.length,
            alturaMediaCampo: Math.round(alturaCampos.reduce((a, b) => a + b, 0) / (alturaCampos.length || 1)),
            alturaMediaTextarea: Math.round(alturaTextareas.reduce((a, b) => a + b, 0) / (alturaTextareas.length || 1)),
            numTextareas: alturaTextareas.length,
            caracteresDeTextoExplicativo: textoDescriptivo,
            pxVerticalesModuloRegistro: Math.round(panel.getBoundingClientRect().height),
            densidad: +(Array.from(panel.querySelectorAll('input,select,textarea')).filter((e) => e.getBoundingClientRect().width > 0).length / (panel.getBoundingClientRect().height / 1000)).toFixed(1) + ' campos por 1000px'
        };
    });

    // --- 6. CSS muerto: selectores sin elemento en la página ----------------
    R.cssMuerto = await page.evaluate(() => {
        const inline = Array.from(document.querySelectorAll('style')).find((s) => !s.id);
        if (!inline) return 'no encontrado';
        const reglas = Array.from(inline.sheet.cssRules).filter((r) => r.type === 1);
        const muertos = [];
        reglas.forEach((r) => {
            r.selectorText.split(',').map((s) => s.trim()).forEach((sel) => {
                const base = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, '').replace(/\[hidden\]/g, '').trim();
                if (!base || base === '*') return;
                try { if (document.querySelectorAll(base).length === 0) muertos.push(sel); } catch (e) { /* */ }
            });
        });
        return { totalReglas: reglas.length, selectoresSinUso: [...new Set(muertos)] };
    });

    // --- 7. Estado real de los 4 tabs vs. contenido del DOM -----------------
    R.tabs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.tab-btn')).map((b) => ({
            texto: b.textContent, target: b.dataset.viewTarget, activo: b.classList.contains('active'),
            colorFondo: getComputedStyle(b).backgroundColor
        }));
    });

    fs.writeFileSync(path.join(OUT, 'probe3-report.json'), JSON.stringify(R, null, 2));
    console.log(JSON.stringify(R, null, 2));
    await browser.close();
})().catch((e) => { console.error('PROBE3 FAILED', e); process.exit(1); });
