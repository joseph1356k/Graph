/**
 * EMR Expanded — sonda 2: con sesión válida (gate cerrado).
 * Verifica hipótesis concretas sobre clics, campos fantasma, capas y layout.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;
const BASE = 'http://127.0.0.1:4173';
const TOKEN = fs.readFileSync(path.join(OUT, 'token.txt'), 'utf8').trim();
const R = {};

const hitTestScript = () => {
    const CONTROLS = 'input, textarea, select, button, a, [role="button"]';
    const mismatches = [];
    let tested = 0;
    Array.from(document.querySelectorAll(CONTROLS)).forEach((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || r.width <= 0 || r.height <= 0) return;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
        tested += 1;
        const hit = document.elementFromPoint(cx, cy);
        if (hit !== el && !el.contains(hit) && !hit?.contains(el)) {
            mismatches.push({
                control: el.id || el.dataset.testid || el.tagName.toLowerCase(),
                hitBy: `${hit?.tagName?.toLowerCase() || 'null'}#${hit?.id || ''}`
            });
        }
    });
    return { tested, mismatches };
};

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'miracle_admin_session', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
    await context.addInitScript((token) => {
        window.localStorage.setItem('miracle-admin-session-v1', JSON.stringify({
            accessToken: token, user: { email: 'audit@miracle.local', username: 'audit@miracle.local' }
        }));
    }, TOKEN);
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

    await page.goto(`${BASE}/emr-workspace.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    R.gateState = await page.evaluate(() => {
        const g = document.getElementById('miracle-auth-gate');
        if (!g) return 'ausente';
        const s = getComputedStyle(g);
        return { display: s.display, inDom: g.isConnected, z: s.zIndex, pe: s.pointerEvents };
    });

    // --- A. Hit-test por módulo + espacio vertical -------------------------
    R.porModulo = {};
    for (const view of ['intake', 'anamnesis', 'orders', 'closure']) {
        await page.evaluate((v) => document.querySelector(`[data-view-target="${v}"]`).click(), view);
        await page.waitForTimeout(400);
        const hit = await page.evaluate(hitTestScript);
        const metrics = await page.evaluate(() => ({
            docHeight: document.documentElement.scrollHeight,
            screens: +(document.documentElement.scrollHeight / innerHeight).toFixed(2),
            visibleControls: Array.from(document.querySelectorAll('input,textarea,select,button,a')).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }).length,
            snapshotControls: window.GraphPluginContext.capturePageSnapshot().controls.length,
            snapshotInvisible: window.GraphPluginContext.capturePageSnapshot().controls.filter((c) => !c.visible).length,
            cardCount: document.querySelectorAll('.form-card').length,
            borderedBoxes: Array.from(document.querySelectorAll('.main-panel *')).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && getComputedStyle(el).borderStyle !== 'none';
            }).length
        }));
        R.porModulo[view] = { ...hit, ...metrics };
        await page.screenshot({ path: path.join(OUT, `view-${view}.png`) });
    }

    // --- B. clinical-review.js: intercepción de clics ----------------------
    R.interceptacionClics = await page.evaluate(async () => {
        const results = [];
        window.MiracleReview.confirmAll();

        async function press(id, label) {
            const btn = document.getElementById(id);
            btn.disabled = false;
            const feedbackId = { 'anamnesis-save-note': 'anamnesis-feedback', 'assessment-sign-note': 'assessment-feedback', 'closure-complete': 'closure-feedback', 'intake-save-patient': 'intake-feedback' }[id];
            const before = document.getElementById(feedbackId).innerText;
            btn.click();
            await new Promise((r) => setTimeout(r, 200));
            results.push({
                boton: label,
                id,
                unconfirmedAntes: window.MiracleReview.getUnconfirmed().length,
                feedbackAntes: before,
                feedbackDespues: document.getElementById(feedbackId).innerText,
                accionEjecutada: document.getElementById(feedbackId).innerText !== before,
                focoDespues: document.activeElement?.id || '',
                focoEnVistaOculta: !!document.activeElement?.closest?.('[data-view][hidden]')
            });
        }

        // Estado limpio: sin campos marcados por IA -> los botones deben funcionar.
        document.querySelector('[data-view-target="orders"]').click();
        document.getElementById('assessment-primary-diagnosis').value = 'Faringitis aguda viral';
        await press('assessment-sign-note', 'Firmar nota clínica (sin marcas IA)');

        // Ahora simulamos exactamente lo que hace page-state.js cuando Miracle
        // escribe un campo: un miracle-field-change con source:'ai'.
        document.dispatchEvent(new CustomEvent('miracle-field-change', {
            detail: { id: 'intake-phone', value: '+57 300 555 1134', source: 'ai', evidence: 'dictado', confidence: 0.92 }
        }));
        document.getElementById('assessment-feedback').innerText = '';
        await press('assessment-sign-note', 'Firmar nota clínica (con 1 campo IA sin confirmar)');
        await press('anamnesis-save-note', 'Guardar nota médica (con 1 campo IA sin confirmar)');
        await press('closure-complete', 'Cerrar encuentro (con 1 campo IA sin confirmar)');
        await press('intake-save-patient', 'Guardar admisión (con 1 campo IA sin confirmar)');
        return results;
    });

    // --- C. ¿La automatización se auto-bloquea? ----------------------------
    // El executor llama element.click(); clinical-review escucha en captura sobre
    // document, así que intercepta también los clics sintéticos del propio motor.
    R.autobloqueoAutomatizacion = await page.evaluate(async () => {
        window.MiracleReview.confirmAll();
        // Ruta real de escritura de la IA
        window.PageState.current.applyProgrammaticField('assessment-primary-diagnosis', 'Faringitis aguda viral', { source: 'ai', evidence: 'nota dictada', confidence: 0.9 });
        const marcados = window.MiracleReview.getUnconfirmed();
        const btn = document.getElementById('assessment-sign-note');
        btn.disabled = false;
        const antes = document.getElementById('assessment-feedback').innerText = '';
        btn.click(); // exactamente lo que hace plugin-execution-client.js
        await new Promise((r) => setTimeout(r, 200));
        return {
            camposMarcadosPorLaIA: marcados,
            clicDelMotorEjecutado: document.getElementById('assessment-feedback').innerText !== antes,
            feedback: document.getElementById('assessment-feedback').innerText
        };
    });

    // --- D. Escritura en campos de vistas ocultas ---------------------------
    R.escrituraEnVistaOculta = await page.evaluate(async () => {
        document.querySelector('[data-view-target="intake"]').click();
        await new Promise((r) => setTimeout(r, 200));
        const target = document.getElementById('closure-billing-code'); // vista 'closure', oculta
        const rect = target.getBoundingClientRect();
        const ok = window.PageState.current.applyProgrammaticField('closure-billing-code', '890201', { source: 'ai', evidence: 'x', confidence: 0.4 });
        return {
            vistaActiva: document.querySelector('[data-view-target].active')?.getAttribute('data-view-target'),
            campoEstaOculto: !!target.closest('[data-view][hidden]'),
            rectDelCampo: [rect.width, rect.height],
            escrituraAceptada: ok,
            valorEscrito: target.value,
            marcadoComoNoConfirmado: target.classList.contains('miracle-unconfirmed'),
            visibleParaElUsuario: false
        };
    });

    // --- E. Cobertura del asistente sobre la superficie clínica -------------
    R.coberturaAsistente = await page.evaluate(() => {
        const ids = ['graph-assistant-shell', 'graph-assistant-note-panel', 'graph-assistant-chat-composer', 'graph-assistant-bubble', 'teaching-console'];
        const runtime = window.MiracleAssistantRuntime || window.GraphAssistantRuntime;
        const out = { runtimeApi: runtime ? Object.keys(runtime) : null, capas: {} };
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) { out.capas[id] = 'ausente'; return; }
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            // ¿Qué controles del EMR quedan debajo de esta caja?
            const tapados = Array.from(document.querySelectorAll('.main-panel input, .main-panel textarea, .main-panel select, .main-panel button'))
                .filter((c) => {
                    const cr = c.getBoundingClientRect();
                    if (cr.width === 0) return false;
                    return !(cr.right < r.left || cr.left > r.right || cr.bottom < r.top || cr.top > r.bottom);
                })
                .map((c) => c.id);
            out.capas[id] = {
                rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                z: s.zIndex, display: s.display, opacity: s.opacity, pointerEvents: s.pointerEvents,
                controlesSolapados: tapados
            };
        });
        return out;
    });

    // --- F. Panel de nota abierto: ¿cuánto tapa? ----------------------------
    R.notaAbierta = await page.evaluate(async () => {
        const runtime = window.MiracleAssistantRuntime || window.GraphAssistantRuntime;
        // Abrir la carita y la hoja de notas por la API pública del runtime.
        try { runtime.setExpanded?.(true); } catch (e) { /* */ }
        document.body.dataset.assistantExpanded = 'true';
        const panel = document.getElementById('graph-assistant-note-panel');
        panel.dataset.visible = 'true';
        await new Promise((r) => setTimeout(r, 300));
        const r0 = panel.getBoundingClientRect();
        const tapados = Array.from(document.querySelectorAll('.main-panel input, .main-panel textarea, .main-panel select, .main-panel button'))
            .filter((c) => {
                const cr = c.getBoundingClientRect();
                if (cr.width === 0) return false;
                return !(cr.right < r0.left || cr.left > r0.right || cr.bottom < r0.top || cr.top > r0.bottom);
            });
        const bloqueados = tapados.filter((c) => {
            const cr = c.getBoundingClientRect();
            const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
            return hit !== c && !c.contains(hit);
        }).map((c) => c.id);
        return {
            rect: [Math.round(r0.x), Math.round(r0.y), Math.round(r0.width), Math.round(r0.height)],
            porcentajeDeViewport: +((r0.width * r0.height) / (innerWidth * innerHeight) * 100).toFixed(1),
            controlesSolapados: tapados.map((c) => c.id),
            controlesRealmenteBloqueados: bloqueados
        };
    });
    await page.screenshot({ path: path.join(OUT, 'nota-abierta.png') });

    // --- G. Persistencia entre módulos y localStorage -----------------------
    R.persistencia = await page.evaluate(() => {
        const raw = localStorage.getItem('graph-emr-form-state-v1');
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            claveUsada: 'graph-emr-form-state-v1',
            camposPersistidos: Object.keys(parsed).length,
            ejemplo: Object.entries(parsed).slice(0, 5),
            otrasClaves: Object.keys(localStorage)
        };
    });

    // --- H. Coste de arranque ------------------------------------------------
    R.arranque = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const scripts = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'));
        return {
            domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
            loadMs: Math.round(nav.loadEventEnd),
            scriptsCargados: scripts.length,
            bytesDeScripts: Math.round(scripts.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
            listaScripts: scripts.map((r) => ({ f: r.name.split('/').pop(), kb: Math.round((r.encodedBodySize || 0) / 1024) })).sort((a, b) => b.kb - a.kb)
        };
    });

    // --- I. Móvil -------------------------------------------------------------
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${BASE}/emr-workspace.html`, { waitUntil: 'load' });
    await mobile.waitForTimeout(2500);
    R.movil = await mobile.evaluate(() => {
        const shell = document.getElementById('graph-assistant-shell');
        const r = shell.getBoundingClientRect();
        return {
            docHeight: document.documentElement.scrollHeight,
            screens: +(document.documentElement.scrollHeight / innerHeight).toFixed(2),
            desbordeHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            caritaRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            caritaSeSaleDePantalla: r.right > innerWidth || r.bottom > innerHeight
        };
    });
    await mobile.screenshot({ path: path.join(OUT, 'movil-390.png') });

    R.errores = errors;
    fs.writeFileSync(path.join(OUT, 'probe2-report.json'), JSON.stringify(R, null, 2));
    console.log(JSON.stringify(R, null, 2));
    await browser.close();
})().catch((e) => { console.error('PROBE2 FAILED', e); process.exit(1); });
