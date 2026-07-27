/**
 * EMR Expanded — sonda de diagnóstico (solo lectura, no modifica el repo).
 * Carga /emr-workspace.html con una sesión válida y mide:
 *  - errores de consola y peticiones fallidas
 *  - inventario de capas fijas / overlays
 *  - hit-testing real (elementFromPoint) de cada control interactivo
 *  - controles que el snapshot del plugin reporta vs. los realmente visibles
 *  - uso de espacio vertical
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;
const BASE = 'http://127.0.0.1:4173';
const TOKEN = fs.readFileSync(path.join(OUT, 'token.txt'), 'utf8').trim();

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'miracle_admin_session', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();

    const consoleMessages = [];
    const failedRequests = [];
    page.on('console', (m) => consoleMessages.push({ type: m.type(), text: m.text().slice(0, 300) }));
    page.on('pageerror', (e) => consoleMessages.push({ type: 'pageerror', text: String(e).slice(0, 300) }));
    page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), err: r.failure()?.errorText }));
    page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() }); });

    await page.goto(`${BASE}/emr-workspace.html`, { waitUntil: 'load' });
    await page.waitForTimeout(3500);

    const report = await page.evaluate(() => {
        const out = {};

        // --- 1. Capas fijas / sticky en el documento -------------------------
        out.fixedLayers = Array.from(document.querySelectorAll('body *'))
            .filter((el) => {
                const s = getComputedStyle(el);
                return s.position === 'fixed' || s.position === 'sticky';
            })
            .map((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return {
                    tag: el.tagName.toLowerCase(),
                    id: el.id || '',
                    cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
                    z: s.zIndex,
                    pe: s.pointerEvents,
                    display: s.display,
                    opacity: s.opacity,
                    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                    coversViewport: r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9
                };
            });

        // --- 2. Hit-testing de cada control ---------------------------------
        const CONTROLS = 'input, textarea, select, button, a, [role="button"]';
        const nodes = Array.from(document.querySelectorAll(CONTROLS));
        const visible = [];
        const hidden = [];
        const mismatches = [];
        nodes.forEach((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const isVisible = s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
            const key = el.id || el.dataset.testid || `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)}`;
            (isVisible ? visible : hidden).push(key);
            if (!isVisible) return;
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return; // fuera del viewport
            const hit = document.elementFromPoint(cx, cy);
            if (hit !== el && !el.contains(hit) && !hit?.contains(el)) {
                mismatches.push({
                    control: key,
                    hitBy: `${hit?.tagName?.toLowerCase() || 'null'}#${hit?.id || ''}.${(hit?.className || '').toString().slice(0, 40)}`
                });
            }
        });
        out.hitTest = { visibleCount: visible.length, hiddenCount: hidden.length, mismatches, hiddenSample: hidden.slice(0, 12) };

        // --- 3. Snapshot que el plugin envía al modelo ------------------------
        let snap = null;
        try { snap = window.GraphPluginContext?.capturePageSnapshot?.() || null; } catch (e) { snap = { error: String(e) }; }
        if (snap && snap.controls) {
            const invisibleReported = snap.controls.filter((c) => !c.visible);
            out.snapshot = {
                totalControlCount: snap.totalControlCount,
                reportedControls: snap.controls.length,
                controlsTruncated: snap.controlsTruncated,
                currentSurfaceSection: snap.currentSurfaceSection,
                invisibleReportedCount: invisibleReported.length,
                invisibleReportedSample: invisibleReported.slice(0, 15).map((c) => ({
                    selector: c.selector, label: c.label, section: c.surfaceSection, editable: c.editable
                })),
                fieldLabelsCount: (snap.fieldLabels || []).length,
                buttonsReported: (snap.buttons || []).length
            };
        } else {
            out.snapshot = snap;
        }

        // --- 4. Espacio vertical ---------------------------------------------
        const main = document.querySelector('.main-panel');
        out.layout = {
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: innerHeight,
            screensToScroll: +(document.documentElement.scrollHeight / innerHeight).toFixed(2),
            workspaceBodyMinHeight: getComputedStyle(document.querySelector('.workspace-body')).minHeight,
            mainPanelHeight: main ? Math.round(main.getBoundingClientRect().height) : null,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };

        // --- 5. Globals inyectados -------------------------------------------
        out.globals = Object.keys(window).filter((k) => /^(Graph|Miracle|Trainer|Workflow|Page|EMR|Deepgram|Assistant)/i.test(k)).sort();

        // --- 6. Hojas de estilo inyectadas ------------------------------------
        out.injectedStyleIds = Array.from(document.querySelectorAll('style[id]')).map((s) => s.id);
        out.totalStyleTags = document.querySelectorAll('style').length;

        // --- 7. Elementos del asistente presentes -----------------------------
        out.assistantNodes = [
            'graph-assistant-shell', 'graph-assistant-bubble', 'graph-assistant-user-bubble',
            'graph-assistant-chat-toggle', 'graph-assistant-chat-composer', 'graph-assistant-note-toggle',
            'graph-assistant-note-panel', 'graph-assistant-spotlight', 'teaching-console', 'workflow-overlay',
            'miracle-auth-gate'
        ].reduce((acc, id) => {
            const el = document.getElementById(id);
            if (!el) { acc[id] = 'ausente'; return acc; }
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            acc[id] = { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], z: s.zIndex, pe: s.pointerEvents, display: s.display, opacity: s.opacity };
            return acc;
        }, {});

        return out;
    });

    report.consoleMessages = consoleMessages;
    report.failedRequests = failedRequests;

    await page.screenshot({ path: path.join(OUT, 'emr-intake-1440.png'), fullPage: false });
    await page.screenshot({ path: path.join(OUT, 'emr-intake-full.png'), fullPage: true });

    // --- 8. Prueba de intercepción de clic por clinical-review.js -------------
    const interception = await page.evaluate(async () => {
        const log = [];
        // Simula lo que hace page-state.js cuando la IA escribe un campo.
        document.dispatchEvent(new CustomEvent('miracle-field-change', {
            detail: { id: 'intake-phone', value: '+57 300 555 1134', source: 'ai', evidence: 'dictado', confidence: 0.9 }
        }));
        log.push({ step: 'marcado IA', unconfirmed: window.MiracleReview?.getUnconfirmed?.() });

        // Ir al módulo de órdenes y pulsar "Firmar nota clínica".
        document.querySelector('[data-view-target="orders"]').click();
        const signBtn = document.getElementById('assessment-sign-note');
        signBtn.disabled = false;
        let handlerRan = false;
        const before = document.getElementById('assessment-feedback').innerText;
        signBtn.addEventListener('click', () => { handlerRan = true; });
        signBtn.click();
        await new Promise((r) => setTimeout(r, 300));
        log.push({
            step: 'click en Firmar nota clínica',
            ownHandlerRan: handlerRan,
            feedbackBefore: before,
            feedbackAfter: document.getElementById('assessment-feedback').innerText,
            activeElementAfterClick: document.activeElement?.id || document.activeElement?.tagName,
            activeElementVisible: (() => {
                const el = document.activeElement;
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            })()
        });
        return log;
    });
    report.clickInterception = interception;

    // --- 9. Prueba: ¿el foco salta a un campo de una vista oculta? ------------
    const hiddenFocus = await page.evaluate(async () => {
        window.MiracleReview?.confirmAll?.();
        // Marca un campo que vive en la vista "closure" (oculta mientras estamos en orders).
        document.dispatchEvent(new CustomEvent('miracle-field-change', {
            detail: { id: 'closure-billing-code', value: '890201', source: 'ai', evidence: 'x', confidence: 0.5 }
        }));
        const target = document.getElementById('closure-billing-code');
        const targetRect = target.getBoundingClientRect();
        const btn = document.getElementById('assessment-sign-note');
        btn.disabled = false;
        btn.click();
        await new Promise((r) => setTimeout(r, 300));
        return {
            currentView: document.querySelector('[data-view-target].active')?.getAttribute('data-view-target'),
            markedFieldInHiddenView: !!target.closest('[data-view][hidden]'),
            markedFieldRect: [targetRect.width, targetRect.height],
            activeElementAfter: document.activeElement?.id || document.activeElement?.tagName,
            feedback: document.getElementById('assessment-feedback').innerText
        };
    });
    report.hiddenFieldFocusTrap = hiddenFocus;

    fs.writeFileSync(path.join(OUT, 'probe-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2).slice(0, 12000));
    await browser.close();
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
