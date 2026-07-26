/* ============================================================================
   Windows Live — renderer del sistema en vivo por usuario (panel Windows).
   Construye dentro de #windows-live: (1) selector de usuarios arriba-derecha,
   (2) la visualización azul eléctrica consciente/subconsciente con pulsos que
   salen de eventos REALES, (3) el subconsciente = apps -> workflows -> nodos
   desde Neo4j (pill con nombre, hover -> coordenada/URL, click -> zoom detalle),
   (4) un panel de logs por usuario (separado de la viz).

   Datos: /api/windows/users, /api/windows/users/:email/graph y
   /api/windows/users/:email/events (polling incremental). Auth Bearer via
   window.MiracleAuth (mismo patrón que provider-studio.js).

   Modo mock (para verificar sin backend): define window.__WINDOWS_LIVE_MOCK__ =
   { users:[...], graph:{...}, makeEvents:()=>[...] } antes de cargar este script.
   ============================================================================ */
(function () {
    const ROOT = document.getElementById('windows-live');
    if (!ROOT) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const USERS_POLL_MS = 10000;
    const EVENTS_POLL_MS = 2500;   // solo red de seguridad: el camino normal es el stream
    const GRAPH_REFRESH_MS = 30000;
    const STATS_REFRESH_MS = 15000;
    const MAX_LOGS = 500;
    const LIVE_WINDOW_MS = 2 * 60 * 1000;

    // Reconexión del stream. Al 'bye' (cierre planificado del servidor a los ~50 s)
    // se reconecta sin esperar; solo los fallos de red escalan por esta escalera.
    const STREAM_BACKOFF_MS = [1000, 2000, 5000];
    const STREAM_MAX_FAILS = 3;
    // Una conexión que sirvió más de esto y luego cayó no cuenta como "el stream
    // no funciona": fue una caída puntual, no un problema estructural.
    const STREAM_HEALTHY_MS = 10000;
    // Cuántos eventos de una misma tanda se animan. 200 pulsos a la vez se ven
    // peor que 12 y ahogan el rAF; el resto igual queda escrito en los logs.
    const MAX_PULSE_BURST = 12;

    const MOCK = window.__WINDOWS_LIVE_MOCK__ || null;

    const state = {
        active: false,
        booted: false,
        users: [],
        selectedEmail: null,
        graph: null,
        lastEventId: 0,
        seededEvents: false,
        logs: [],
        engines: [],       // catálogo de motores (las tabs), del servidor
        engineTab: 'all',
        engineCounts: {},  // engine -> eventos vistos en esta sesión
        stats: null,       // marcador de pruebas (/stats)
        stream: { on: false, ctrl: null, fails: 0, mode: 'idle' },
        menuOpen: false,
        search: '',
        detailAppId: null,
        nodes: {},        // id -> { group, cx, cy, r }
        wires: {},        // id -> path element
        appWires: {},     // appId -> path (MCP -> app)
        timers: {}
    };

    // ---------------------------------------------------------------- utils
    function el(tag, attrs, children) {
        const node = document.createElementNS(SVG_NS, tag);
        if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
        if (children) [].concat(children).forEach((c) => c && node.appendChild(c));
        return node;
    }
    function h(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
        }
        if (children) [].concat(children).forEach((c) => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return node;
    }
    function initials(name, email) {
        const src = `${name || email || '?'}`.trim();
        const parts = src.split(/[\s@._-]+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }
    function timeAgo(iso) {
        const t = Date.parse(iso || '');
        if (!Number.isFinite(t)) return 'sin actividad';
        const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
        if (s < 60) return 'hace segundos';
        if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
        if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
        return `hace ${Math.floor(s / 86400)} d`;
    }
    function clock(iso) {
        const t = Date.parse(iso || '');
        if (!Number.isFinite(t)) return '--:--:--';
        return new Date(t).toLocaleTimeString('es-CO', { hour12: false });
    }
    function isLive(iso) {
        const t = Date.parse(iso || '');
        return Number.isFinite(t) && (Date.now() - t) < LIVE_WINDOW_MS;
    }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // ---------------------------------------------------------------- data
    async function authToken() {
        if (window.MiracleAuth?.whenAuthenticated) await window.MiracleAuth.whenAuthenticated();
        return window.MiracleAuth?.getAccessToken?.() || '';
    }
    async function readJson(res) {
        const text = await res.text();
        let payload = {};
        if (text.trim()) { try { payload = JSON.parse(text); } catch (e) { if (!res.ok) throw new Error(text.slice(0, 180)); throw e; } }
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        return payload;
    }
    async function authedFetch(url) {
        const token = await authToken();
        return readJson(await fetch(url, {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        }));
    }
    // Misma autenticación que authedFetch pero con cuerpo: el panel dejó de ser
    // solo-lectura cuando apareció la bitácora de avances.
    async function authedSend(url, method, body) {
        const token = await authToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        return readJson(await fetch(url, {
            method: method || 'POST',
            cache: 'no-store',
            headers,
            body: body == null ? undefined : JSON.stringify(body)
        }));
    }

    async function loadUsers() {
        if (MOCK) return { users: MOCK.users || [] };
        return authedFetch('/api/windows/users');
    }
    async function loadGraph(email) {
        if (MOCK) return MOCK.graph || { email, totals: { apps: 0, workflows: 0, steps: 0 }, apps: [] };
        return authedFetch(`/api/windows/users/${encodeURIComponent(email)}/graph`);
    }
    async function loadEvents(email, since) {
        if (MOCK) {
            const events = typeof MOCK.makeEvents === 'function' ? MOCK.makeEvents(since) : [];
            const lastId = events.length ? events[events.length - 1].id : since;
            return { events, lastId };
        }
        return authedFetch(`/api/windows/users/${encodeURIComponent(email)}/events?since=${since || 0}&limit=200`);
    }
    async function loadEngines() {
        if (MOCK) return { engines: MOCK.engines || [] };
        return authedFetch('/api/windows/engines');
    }
    async function loadStats(email) {
        if (MOCK) return MOCK.stats || { engines: [] };
        return authedFetch(`/api/windows/users/${encodeURIComponent(email)}/stats`);
    }

    // ---------------------------------------------------------------- shell
    let dom = {};
    function buildShell() {
        ROOT.innerHTML = '';

        // cabecera + selector
        const head = h('div', { class: 'wl-head' });
        const copy = h('div', { class: 'wl-head-copy' }, [
            h('p', { class: 'wl-kicker', text: 'Windows · en vivo' }),
            h('h2', { class: 'wl-title', text: 'Cómo funciona por dentro' })
        ]);
        const selector = buildSelector();
        head.append(copy, selector);

        // stage
        const stage = h('div', { class: 'wl-stage' });
        const svg = el('svg', { viewBox: '0 0 1000 480', role: 'img', 'aria-label': 'Consciente y subconsciente en vivo' });
        svg.appendChild(buildDefs());
        const layers = {
            bg: el('g', { class: 'wl-constellation' }),
            wires: el('g'),
            trails: el('g'),
            sub: el('g'),        // apps del subconsciente
            core: el('g'),       // nodos conscientes + MCP + barras
            waves: el('g'),
            pulses: el('g')
        };
        Object.values(layers).forEach((g) => svg.appendChild(g));
        stage.appendChild(svg);

        const empty = h('div', { class: 'wl-empty' });
        stage.appendChild(empty);

        const detail = buildDetailOverlay();
        stage.appendChild(detail);

        const tip = h('div', { class: 'wl-tip' });
        stage.appendChild(tip);

        const caption = h('p', { class: 'wl-caption' });

        // logs
        const logs = buildLogs();

        // El modal y el aviso cuelgan de ROOT a propósito: las variables --wl-*
        // están declaradas en #windows-live, fuera de ahí no heredan color.
        const modal = buildProgressModal();
        const toast = h('div', { class: 'wl-toast' });

        ROOT.append(head, stage, caption, logs, modal, toast);

        dom = { head, selector, stage, svg, layers, empty, detail, tip, caption, logs, modal, toast };
        setEmpty('loading', 'Cargando usuarios…', '');
        renderTabs();
        renderLogs();
    }

    function buildDefs() {
        const defs = el('defs');
        const filter = el('filter', { id: 'wl-glow', x: '-80%', y: '-80%', width: '260%', height: '260%' });
        filter.appendChild(el('feGaussianBlur', { stdDeviation: '4', result: 'b' }));
        const merge = el('feMerge');
        merge.appendChild(el('feMergeNode', { in: 'b' }));
        merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
        filter.appendChild(merge);
        defs.appendChild(filter);

        const grad = el('radialGradient', { id: 'wl-app-fill', cx: '35%', cy: '30%', r: '75%' });
        grad.appendChild(el('stop', { offset: '0%', 'stop-color': 'rgba(76,141,255,0.5)' }));
        grad.appendChild(el('stop', { offset: '100%', 'stop-color': 'rgba(11,20,40,0)' }));
        defs.appendChild(grad);

        const arrow = el('marker', { id: 'wl-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
        arrow.appendChild(el('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'rgba(127,178,255,0.7)' }));
        defs.appendChild(arrow);
        return defs;
    }

    // ------------------------------------------------------------- selector
    function buildSelector() {
        const wrap = h('div', { class: 'wl-selector' });
        const btn = h('button', {
            class: 'wl-selector-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
            onclick: (e) => { e.stopPropagation(); toggleMenu(); }
        });
        const menu = h('div', { class: 'wl-menu', role: 'listbox' });
        const search = h('div', { class: 'wl-search' }, [
            iconSvg('M11 4a7 7 0 1 0 4.9 12l4 4 1.4-1.4-4-4A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z'),
            h('input', { type: 'text', placeholder: 'Buscar por nombre o correo…', oninput: (e) => { state.search = e.target.value; renderMenu(); } })
        ]);
        const list = h('div', { class: 'wl-menu-list' });
        menu.append(search, list);
        wrap.append(btn, menu);
        wrap._btn = btn; wrap._menu = menu; wrap._list = list; wrap._search = search.querySelector('input');
        return wrap;
    }
    function iconSvg(d, cls) {
        const svg = el('svg', { viewBox: '0 0 24 24' });
        if (cls) svg.setAttribute('class', cls);
        svg.appendChild(el('path', { d, fill: 'currentColor' }));
        return svg;
    }
    function toggleMenu(force) {
        state.menuOpen = force != null ? force : !state.menuOpen;
        dom.selector.classList.toggle('is-open', state.menuOpen);
        dom.selector._btn.setAttribute('aria-expanded', String(state.menuOpen));
        if (state.menuOpen) { renderMenu(); setTimeout(() => dom.selector._search.focus(), 40); }
    }
    document.addEventListener('click', (e) => { if (state.menuOpen && !dom.selector.contains(e.target)) toggleMenu(false); });

    function renderSelectorButton() {
        const btn = dom.selector._btn;
        btn.innerHTML = '';
        const user = state.users.find((u) => u.email === state.selectedEmail);
        if (!user) {
            btn.append(
                h('span', { class: 'wl-avatar', text: '—' }),
                h('span', { class: 'wl-selector-id' }, [
                    h('span', { class: 'wl-selector-name', text: state.users.length ? 'Elige un usuario' : 'Sin usuarios' }),
                    h('span', { class: 'wl-selector-sub', text: state.users.length ? `${state.users.length} registrados` : 'Aún nadie instaló la app' })
                ]),
                caretSvg()
            );
            return;
        }
        btn.append(
            h('span', { class: `wl-live-dot ${isLive(user.last_event_at || user.last_seen_at) ? 'is-live' : ''}` }),
            h('span', { class: 'wl-avatar', text: initials(user.display_name, user.email) }),
            h('span', { class: 'wl-selector-id' }, [
                h('span', { class: 'wl-selector-name', text: user.display_name || user.email }),
                h('span', { class: 'wl-selector-sub', text: user.email })
            ]),
            caretSvg()
        );
    }
    function caretSvg() {
        const svg = el('svg', { class: 'wl-selector-caret', viewBox: '0 0 16 16' });
        svg.appendChild(el('path', { d: 'm3 6 5 5 5-5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        return svg;
    }

    function renderMenu() {
        const list = dom.selector._list;
        list.innerHTML = '';
        const q = state.search.trim().toLowerCase();
        const users = state.users.filter((u) =>
            !q || `${u.display_name || ''} ${u.email}`.toLowerCase().includes(q));
        if (!users.length) {
            list.appendChild(h('div', { class: 'wl-menu-empty', text: state.users.length ? 'Sin coincidencias.' : 'Aún no hay usuarios de la app Windows.' }));
            return;
        }
        users.forEach((u) => {
            const row = h('button', {
                class: `wl-user-row ${u.email === state.selectedEmail ? 'is-selected' : ''}`, type: 'button', role: 'option',
                onclick: () => { toggleMenu(false); selectUser(u.email); }
            }, [
                h('span', { class: `wl-live-dot ${isLive(u.last_event_at || u.last_seen_at) ? 'is-live' : ''}` }),
                h('span', { class: 'wl-avatar', text: initials(u.display_name, u.email) }),
                h('span', { class: 'wl-user-main' }, [
                    h('span', { class: 'wl-user-name', text: u.display_name || u.email }),
                    h('span', { class: 'wl-user-mail', text: u.email })
                ]),
                h('span', { class: 'wl-user-meta' }, [
                    h('span', { class: 'wl-user-count', text: `${u.event_count || 0}` }),
                    h('span', { class: 'wl-user-seen', text: timeAgo(u.last_event_at || u.last_seen_at) })
                ])
            ]);
            list.appendChild(row);
        });
    }

    // -------------------------------------------------------------- empty
    function setEmpty(kind, title, sub) {
        if (!kind) { dom.empty.style.display = 'none'; dom.empty.innerHTML = ''; return; }
        dom.empty.style.display = 'grid';
        dom.empty.innerHTML = '';
        const inner = h('div', { class: 'wl-empty-inner' });
        if (kind === 'loading') inner.appendChild(h('div', { class: 'wl-spinner' }));
        if (title) inner.appendChild(h('div', { class: 'wl-empty-title', text: title }));
        if (sub) inner.appendChild(h('div', { class: 'wl-empty-sub', text: sub }));
        dom.empty.appendChild(inner);
    }

    // ---------------------------------------------------- build the stage
    function nodeGroup(id, cx, cy, r, opts = {}) {
        const g = el('g', { class: 'wl-node' });
        g.appendChild(el('circle', { class: 'wl-node-halo', cx, cy, r: r + 9 }));
        const ring = el('circle', { class: `wl-node-ring ${opts.breathe ? 'wl-breathe' : ''}`, cx, cy, r });
        g.appendChild(ring);
        if (opts.label) {
            const lines = [].concat(opts.label);
            lines.forEach((line, i) => g.appendChild(el('text', {
                class: 'wl-node-label', x: cx, y: cy + (i - (lines.length - 1) / 2) * 18
            }, [document.createTextNode(line)])));
        }
        state.nodes[id] = { group: g, ring, cx, cy, r };
        return g;
    }
    function wire(id, d, cls) {
        const p = el('path', { class: `wl-wire ${cls || ''}`, d });
        state.wires[id] = p;
        return p;
    }

    function buildStageCore() {
        const L = dom.layers;
        L.wires.innerHTML = ''; L.core.innerHTML = ''; L.sub.innerHTML = '';
        L.trails.innerHTML = ''; L.pulses.innerHTML = ''; L.waves.innerHTML = '';
        L.bg.innerHTML = '';
        state.nodes = {}; state.wires = {}; state.appWires = {};

        drawConstellation(L.bg);

        // barras base
        L.core.appendChild(barGroup(40, 430, 300, 'Consciente'));
        L.core.appendChild(barGroup(560, 430, 400, 'Subconsciente'));

        // wires conscientes (se dibujan primero, bajo los nodos)
        L.wires.appendChild(wire('consc_analyze', 'M150 430 C150 360 150 300 150 214'));
        L.wires.appendChild(wire('analyze_clic', 'M206 178 C245 192 262 196 282 202', 'wl-wire'));
        state.wires.analyze_clic.setAttribute('marker-end', 'url(#wl-arrow)');
        L.wires.appendChild(wire('clic_consc', 'M330 264 C330 320 330 380 330 430'));
        L.wires.appendChild(wire('clic_mcp', 'M380 224 C430 244 460 248 492 250'));
        L.wires.appendChild(wire('mcp_subc', 'M520 282 C540 340 552 388 620 430', 'wl-wire-dash'));

        // nodos conscientes + MCP
        L.core.appendChild(nodeGroup('analyze', 150, 150, 62, { label: ['Analizar', 'pantalla'], breathe: true }));
        L.core.appendChild(nodeGroup('clic', 330, 205, 50, { label: 'Clic', breathe: true }));
        const mcp = nodeGroup('mcp', 520, 250, 30, { breathe: true });
        mcp.appendChild(el('text', { class: 'wl-mcp-label', x: 520, y: 209 }, [document.createTextNode('MCP')]));
        L.core.appendChild(mcp);
    }

    function barGroup(x, y, w, label) {
        const g = el('g');
        g.appendChild(el('rect', { class: 'wl-bar', x, y, width: w, height: 40, rx: 11 }));
        g.appendChild(el('text', { class: 'wl-bar-label', x: x + w / 2, y: y + 25 }, [document.createTextNode(label)]));
        return g;
    }

    function drawConstellation(layer) {
        // puntitos deterministas (sin Math.random para que no salte en cada render)
        const pts = [];
        let seed = 7;
        const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        for (let i = 0; i < 46; i++) pts.push({ x: rnd() * 1000, y: rnd() * 480 });
        pts.forEach((p, i) => {
            const q = pts[(i + 3) % pts.length];
            if (Math.hypot(p.x - q.x, p.y - q.y) < 160) layer.appendChild(el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y }));
            layer.appendChild(el('circle', { cx: p.x, cy: p.y, r: rnd() * 1.2 + 0.4 }));
        });
    }

    // apps del subconsciente (una por app real)
    function buildSubconscious(graph) {
        const L = dom.layers;
        const apps = (graph && graph.apps) || [];
        const anchor = { x: 545, y: 246 };
        const positions = layoutApps(apps.length);

        apps.forEach((app, i) => {
            const pos = positions[i];
            // wire MCP -> app
            const d = `M${anchor.x} ${anchor.y} C${(anchor.x + pos.x) / 2} ${anchor.y - 20}, ${(anchor.x + pos.x) / 2} ${pos.y}, ${pos.x} ${pos.y}`;
            const w = el('path', { class: 'wl-wire wl-wire-soft', d });
            L.wires.appendChild(w);
            state.appWires[app.appId] = w;

            L.sub.appendChild(appGroup(app, pos));
        });
    }

    // layout: arco (pocas apps, como la referencia) o grilla (muchas)
    function layoutApps(n) {
        const out = [];
        if (n === 0) return out;
        if (n <= 7) {
            const cx = 545, cy = 246;
            const startA = -1.15, endA = 0.62; // radianes, abanicándose arriba-derecha
            for (let i = 0; i < n; i++) {
                const t = n === 1 ? 0.5 : i / (n - 1);
                const a = startA + (endA - startA) * t;
                const R = 250 + (i % 2) * 34;
                out.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: 0 });
            }
            return out;
        }
        // grilla en la mitad derecha
        const region = { x0: 620, y0: 70, x1: 968, y1: 410 };
        const cols = Math.ceil(Math.sqrt(n * (region.x1 - region.x0) / (region.y1 - region.y0)));
        const rows = Math.ceil(n / cols);
        const cw = (region.x1 - region.x0) / cols;
        const ch = (region.y1 - region.y0) / rows;
        for (let i = 0; i < n; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            out.push({ x: region.x0 + cw * (c + 0.5), y: region.y0 + ch * (r + 0.5), r: 0 });
        }
        return out;
    }

    function appRadius(app, total) {
        const base = total <= 7 ? 50 : Math.max(16, 46 - total);
        const bump = Math.min(14, Math.log2((app.workflowCount || 0) + 1) * 5);
        return Math.min(60, base + bump);
    }

    function appGroup(app, pos) {
        const total = (state.graph.apps || []).length;
        const r = appRadius(app, total);
        pos.r = r;
        const g = el('g', { class: 'wl-app' });
        g.dataset.appId = app.appId;
        g.appendChild(el('circle', { class: 'wl-app-glow', cx: pos.x, cy: pos.y, r: r + 6 }));
        const ring = el('circle', { class: 'wl-app-ring wl-breathe', cx: pos.x, cy: pos.y, r });
        g.appendChild(ring);
        state.nodes[`app:${app.appId}`] = { group: g, ring, cx: pos.x, cy: pos.y, r };

        // mini-grafo interno (nodos reales, hasta un cap segun tamaño)
        if (r >= 24) drawMiniGraph(g, pos.x, pos.y, r, app);
        else g.appendChild(el('circle', { class: 'wl-wf-node', cx: pos.x, cy: pos.y, r: 2.4 }));

        // pill con el nombre de la app (hover -> coordenada/URL)
        drawPill(g, pos.x, pos.y - r - 4, app);

        // conteo debajo
        g.appendChild(el('text', { class: 'wl-app-count', x: pos.x, y: pos.y + r + 15 },
            [document.createTextNode(`${app.workflowCount} ${app.workflowCount === 1 ? 'flujo' : 'flujos'} · ${app.stepCount} nodos`)]));

        g.addEventListener('click', () => openDetail(app.appId));
        return g;
    }

    function drawMiniGraph(g, cx, cy, r, app) {
        const cap = r >= 44 ? 16 : r >= 32 ? 9 : 5;
        // aplanar nodos de los primeros workflows
        const flat = [];
        (app.workflows || []).forEach((wf) => (wf.nodes || []).forEach((nd) => flat.push({ wf: wf.id, nd })));
        const shown = flat.slice(0, cap);
        const inner = r * 0.6;
        const pts = shown.map((_, i) => {
            const a = (i / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
            const rr = inner * (0.4 + 0.6 * ((i % 3) / 2));
            return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
        });
        // edges secuenciales dentro del mismo workflow
        for (let i = 1; i < shown.length; i++) {
            if (shown[i].wf === shown[i - 1].wf) {
                g.appendChild(el('path', { class: 'wl-wf-edge', d: `M${pts[i - 1].x} ${pts[i - 1].y} L${pts[i].x} ${pts[i].y}` }));
            }
        }
        pts.forEach((p, i) => g.appendChild(el('circle', { class: i === 0 ? 'wl-wf-node' : 'wl-wf-node-dim', cx: p.x, cy: p.y, r: r >= 44 ? 2.4 : 1.8 })));
        if (flat.length > cap) {
            g.appendChild(el('text', { class: 'wl-app-count', x: cx, y: cy + 3 }, [document.createTextNode(`+${flat.length - cap}`)]));
        }
    }

    function drawPill(g, cx, cy, app) {
        const label = app.label || app.appId;
        const w = Math.max(46, label.length * 7.2 + 16);
        const pill = el('g', { class: 'wl-app-pilltag' });
        pill.appendChild(el('rect', { class: 'wl-pill-bg', x: cx - w / 2, y: cy - 20, width: w, height: 19, rx: 9.5 }));
        pill.appendChild(el('text', { class: 'wl-pill-text', x: cx, y: cy - 7 }, [document.createTextNode(label)]));
        pill.style.cursor = 'help';
        pill.addEventListener('mouseenter', (e) => showTip(e, `${app.label} · ${app.coordinate}${app.origins && app.origins.length > 1 ? ` (+${app.origins.length - 1})` : ''}`));
        pill.addEventListener('mousemove', moveTip);
        pill.addEventListener('mouseleave', hideTip);
        g.appendChild(pill);
    }

    // -------------------------------------------------------------- tooltip
    function showTip(e, text) {
        dom.tip.textContent = text;
        dom.tip.classList.add('is-visible');
        moveTip(e);
    }
    function moveTip(e) {
        const rect = dom.stage.getBoundingClientRect();
        let x = e.clientX - rect.left + 12;
        let y = e.clientY - rect.top + 12;
        const tw = dom.tip.offsetWidth, th = dom.tip.offsetHeight;
        if (x + tw > rect.width - 8) x = rect.width - tw - 8;
        if (y + th > rect.height - 8) y = e.clientY - rect.top - th - 12;
        dom.tip.style.left = `${Math.max(8, x)}px`;
        dom.tip.style.top = `${Math.max(8, y)}px`;
    }
    function hideTip() { dom.tip.classList.remove('is-visible'); }

    // -------------------------------------------------------------- pulses
    function firePulse(pathEl, opts = {}) {
        if (!pathEl) return;
        const len = pathEl.getTotalLength();
        if (!len) { opts.onArrive && opts.onArrive(); return; }
        const dur = opts.duration || 1100;
        const r = opts.r || 5;
        const pg = el('g');
        const glow = el('circle', { class: 'wl-pulse-glow', r });
        const core = el('circle', { class: 'wl-pulse-core', r: r * 0.5 });
        pg.append(glow, core);
        dom.layers.pulses.appendChild(pg);

        const trail = el('path', { class: 'wl-wire-trail', d: pathEl.getAttribute('d') });
        trail.style.strokeDasharray = `26 ${len}`;
        dom.layers.trails.appendChild(trail);

        const start = performance.now();
        function frame(now) {
            let t = (now - start) / dur; if (t > 1) t = 1;
            const e = easeInOut(t);
            const pt = pathEl.getPointAtLength(e * len);
            pg.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
            trail.style.strokeDashoffset = `${len - e * len}`;
            trail.style.opacity = `${0.85 * Math.sin(Math.min(1, t) * Math.PI)}`;
            if (t < 1) requestAnimationFrame(frame);
            else { pg.remove(); trail.remove(); opts.onArrive && opts.onArrive(); }
        }
        requestAnimationFrame(frame);
    }

    function igniteNode(id) {
        const n = state.nodes[id];
        if (!n) return;
        n.ring.classList.remove('wl-ignite');
        void n.ring.getBBox();
        n.ring.classList.add('wl-ignite');
        setTimeout(() => n.ring && n.ring.classList.remove('wl-ignite'), 1000);
        // onda de energía
        const wave = el('circle', { class: 'wl-ring-wave', cx: n.cx, cy: n.cy, r: n.r });
        dom.layers.waves.appendChild(wave);
        const start = performance.now();
        (function grow(now) {
            let t = (now - start) / 850; if (t > 1) t = 1;
            wave.setAttribute('r', `${n.r + t * n.r * 0.9}`);
            wave.style.opacity = `${0.55 * (1 - t)}`;
            if (t < 1) requestAnimationFrame(grow); else wave.remove();
        })(start);
    }

    // El mapa del sistema (windows-lab.js) escucha esto para encender su estación.
    // Va separado del pulso porque el mapa quiere TODOS los eventos, mientras que
    // la viz solo puede animar unos pocos por tanda sin atragantarse.
    function notifyLab(ev) {
        try { window.dispatchEvent(new CustomEvent('wl:event', { detail: ev })); } catch (e) { /* */ }
    }

    // Traduce un evento real a un pulso + ignición en la viz.
    function pulseForEvent(ev) {
        switch (ev.kind) {
            case 'conscious_run_start':
                firePulse(state.wires.consc_analyze, { onArrive: () => igniteNode('analyze') }); break;
            case 'analyze':
                firePulse(state.wires.consc_analyze, { r: 4, onArrive: () => igniteNode('analyze') }); break;
            case 'action':
                firePulse(state.wires.analyze_clic, { r: 6, onArrive: () => igniteNode('clic') }); break;
            case 'mcp':
                firePulse(state.wires.clic_mcp, { onArrive: () => igniteNode('mcp') }); break;
            case 'conscious_run_end':
                firePulse(state.wires.clic_consc, { r: 4 }); break;
            case 'workflow_start':
            case 'workflow_step':
            case 'workflow_end': {
                const w = state.appWires[ev.app_id];
                if (w) firePulse(w, { r: ev.kind === 'workflow_step' ? 4 : 6, onArrive: () => igniteNode(`app:${ev.app_id}`) });
                else firePulse(state.wires.mcp_subc, { onArrive: () => igniteNode('mcp') });
                break;
            }
            default: break;
        }
    }

    // -------------------------------------------------------------- detalle
    function buildDetailOverlay() {
        const wrap = h('div', { class: 'wl-detail' });
        const head = h('div', { class: 'wl-detail-head' }, [
            h('button', { class: 'wl-detail-back', type: 'button', onclick: closeDetail }, [
                iconSvg('M15 5l-7 7 7 7', 'x'), document.createTextNode('Volver')
            ]),
            h('div', { class: 'wl-detail-title' }, [
                h('strong', { class: 'wl-detail-app', text: '' }),
                h('span', { class: 'wl-detail-coord', text: '' })
            ])
        ]);
        const body = h('div', { class: 'wl-detail-body' });
        wrap.append(head, body);
        wrap._title = head.querySelector('.wl-detail-app');
        wrap._coord = head.querySelector('.wl-detail-coord');
        wrap._body = body;
        return wrap;
    }
    function openDetail(appId) {
        const app = (state.graph.apps || []).find((a) => a.appId === appId);
        if (!app) return;
        state.detailAppId = appId;
        const d = dom.detail;
        d._title.textContent = `${app.label} · ${app.workflowCount} ${app.workflowCount === 1 ? 'flujo' : 'flujos'}`;
        d._coord.textContent = app.coordinate + (app.origins && app.origins.length > 1 ? `  ·  +${app.origins.length - 1} orígenes` : '');
        d._body.innerHTML = '';
        if (!app.workflows.length) {
            d._body.appendChild(h('div', { class: 'wl-empty-sub', text: 'Esta app aún no tiene workflows aprendidos.' }));
        }
        app.workflows.forEach((wf) => d._body.appendChild(workflowCard(wf)));
        d.classList.add('is-open');
    }
    function closeDetail() { state.detailAppId = null; dom.detail.classList.remove('is-open'); }

    function workflowCard(wf) {
        const card = h('div', { class: 'wl-wf-card' });
        const dot = h('span', { class: 'wl-status-dot' }); dot.dataset.status = wf.status || 'done';
        const head = h('div', { class: 'wl-wf-card-head' }, [
            h('div', { class: 'wl-wf-card-title' }, [dot, document.createTextNode(wf.title || wf.id)]),
            h('div', { class: 'wl-wf-card-meta', text: `${wf.stepCount} nodos${wf.branchCount ? ` · ${wf.branchCount} ramas` : ''}` })
        ]);
        const graphWrap = h('div', { class: 'wl-wf-card-graph' });
        graphWrap.appendChild(workflowChain(wf));
        card.append(head, graphWrap);
        return card;
    }

    // cadena horizontal de nodos reales (order izq->der), etiqueta debajo
    function workflowChain(wf) {
        const nodes = wf.nodes || [];
        const gap = 118, padX = 24, topY = 34, r = 9;
        const width = Math.max(300, padX * 2 + Math.max(1, nodes.length - 1) * gap + 40);
        const height = 92;
        const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
        if (!nodes.length) {
            svg.appendChild(el('text', { x: padX, y: topY + 4, fill: 'rgba(200,220,255,0.5)', 'font-size': '12' }, [document.createTextNode('Sin pasos registrados')]));
            return svg;
        }
        const modeColor = { fixed: '#7fb2ff', dynamic: '#56e0ff', flexible: '#b9a7ff' };
        for (let i = 0; i < nodes.length; i++) {
            const x = padX + i * gap + 12;
            if (i < nodes.length - 1) {
                svg.appendChild(el('path', { d: `M${x + r} ${topY} L${x + gap - r} ${topY}`, stroke: 'rgba(127,178,255,0.4)', 'stroke-width': '1.4', 'marker-end': 'url(#wl-arrow)', fill: 'none' }));
            }
            const nd = nodes[i];
            svg.appendChild(el('circle', { cx: x, cy: topY, r, fill: 'rgba(9,18,38,0.9)', stroke: modeColor[nd.valueMode] || '#7fb2ff', 'stroke-width': '1.6' }));
            svg.appendChild(el('text', { x, y: topY + 4, 'text-anchor': 'middle', fill: '#cfe2ff', 'font-size': '9' }, [document.createTextNode(`${i + 1}`)]));
            const label = (nd.label || nd.actionType || 'paso').slice(0, 16);
            svg.appendChild(el('text', { x, y: topY + 26, 'text-anchor': 'middle', fill: 'rgba(200,220,255,0.7)', 'font-size': '10.5' }, [document.createTextNode(label)]));
            if (nd.actionType) svg.appendChild(el('text', { x, y: topY + 40, 'text-anchor': 'middle', fill: 'rgba(200,220,255,0.4)', 'font-size': '9' }, [document.createTextNode(nd.actionType.slice(0, 14))]));
        }
        return svg;
    }

    // -------------------------------------------------------------- logs
    function chevronSvg(cls) {
        const s = el('svg', { class: cls, viewBox: '0 0 16 16' });
        s.appendChild(el('path', { d: 'm3 6 5 5 5-5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        return s;
    }
    function buildLogs() {
        const wrap = h('div', { class: 'wl-logs is-open' });
        const badge = h('span', { class: 'wl-logs-badge', text: '0' });
        const live = h('span', { class: 'wl-logs-live', text: 'en espera' });
        const record = h('button', {
            class: 'wl-logs-record', type: 'button', text: 'Registrar avance',
            // El head entero togglea el colapso: sin esto, abrir el formulario
            // plegaría el panel debajo.
            onclick: (e) => { e.stopPropagation(); openProgress(); }
        });
        const head = h('div', {
            class: 'wl-logs-head', onclick: () => wrap.classList.toggle('is-open')
        }, [
            h('div', { class: 'wl-logs-head-left' }, [
                h('span', { class: 'wl-logs-title', text: 'Logs en vivo' }), badge, live
            ]),
            h('div', { class: 'wl-logs-head-right' }, [record, chevronSvg('wl-logs-chevron')])
        ]);
        const body = h('div', { class: 'wl-logs-body' });
        // Herramientas ANTES de la terminal: la tab dice qué se está mirando, la
        // pregunta dice qué responde esa tab y el marcador dice si hoy funciona.
        const tools = h('div', { class: 'wl-logs-tools' });
        const tabs = h('div', { class: 'wl-tabs', role: 'tablist' });
        const question = h('div', { class: 'wl-tab-question' });
        const score = h('div', { class: 'wl-score' });
        tools.append(tabs, question, score);
        const term = h('div', { class: 'wl-terminal' });
        body.append(tools, term);
        wrap.append(head, body);
        wrap._term = term; wrap._badge = badge; wrap._live = live;
        wrap._tabs = tabs; wrap._question = question; wrap._score = score;
        return wrap;
    }

    // Estado del transporte, visible: si el stream se cayó y estamos en el sondeo
    // de respaldo, quien mira los logs tiene que saberlo (la latencia cambia).
    function setStreamStatus(kind, text) {
        if (!dom.logs) return;
        dom.logs._live.textContent = text;
        dom.logs._live.dataset.kind = kind;
    }

    // ------------------------------------------------------------ tabs/motores
    const ALL_TAB = {
        key: 'all', label: 'Todo', accent: 'var(--wl-blue-bright)',
        question: '¿Qué está pasando en la máquina, sin filtrar?'
    };
    function engineDefs() {
        const defs = state.engines.slice();
        const known = new Set(defs.map((e) => e.key));
        // Un motor que llega en los eventos pero no está en el catálogo es una
        // señal (el catálogo se quedó corto), así que se muestra igual.
        Object.keys(state.engineCounts).forEach((key) => {
            if (!known.has(key)) defs.push({ key, label: key, question: '', doc: '', accent: '#9aa6bf' });
        });
        return defs;
    }
    function tabDefs() { return [ALL_TAB].concat(engineDefs()); }
    function tabCount(key) { return key === 'all' ? state.logs.length : (state.engineCounts[key] || 0); }

    function renderTabs() {
        if (!dom.logs) return;
        const bar = dom.logs._tabs;
        bar.innerHTML = '';
        const defs = tabDefs();
        if (!defs.some((d) => d.key === state.engineTab)) state.engineTab = 'all';
        defs.forEach((def) => {
            const count = tabCount(def.key);
            // Un motor mudo NO se oculta: que no llegue nada es información (o no
            // está instrumentado, o nadie lo ha ejercitado hoy).
            const btn = h('button', {
                class: `wl-tab${state.engineTab === def.key ? ' is-active' : ''}${count ? '' : ' is-mute'}`,
                type: 'button', role: 'tab', title: def.question || '',
                onclick: () => selectEngineTab(def.key)
            }, [
                h('span', { class: 'wl-tab-label', text: def.label }),
                h('span', { class: 'wl-tab-count', text: `${count}` })
            ]);
            btn.dataset.engine = def.key;
            if (state.engineTab === def.key && def.accent) btn.style.borderBottomColor = def.accent;
            bar.appendChild(btn);
        });
        const active = defs.find((d) => d.key === state.engineTab) || ALL_TAB;
        dom.logs._question.textContent = active.question || '';
    }
    function updateTabCounts() {
        if (!dom.logs) return;
        const shown = new Set(Array.from(dom.logs._tabs.children).map((b) => b.dataset.engine));
        // Apareció un motor que no tiene tab: hay que reconstruir la barra.
        if (Object.keys(state.engineCounts).some((k) => !shown.has(k))) { renderTabs(); return; }
        Array.from(dom.logs._tabs.children).forEach((btn) => {
            const count = tabCount(btn.dataset.engine);
            const span = btn.querySelector('.wl-tab-count');
            if (span) span.textContent = `${count}`;
            btn.classList.toggle('is-mute', !count);
        });
    }
    function selectEngineTab(key) {
        if (state.engineTab === key) return;
        state.engineTab = key;
        renderTabs();
        renderLogs();   // cambio de filtro: aquí sí toca repintar entero
        renderScore();
        refreshStats();
    }

    // -------------------------------------------------------- marcador (stats)
    function pct(rate) { return rate == null ? null : `${rate}%`; }
    function versionLabel(v) {
        const raw = `${v || ''}`.trim();
        if (!raw || raw === 'sin-versión') return 'sin versión';
        return /^v/i.test(raw) ? raw : `v${raw}`;
    }
    function aggregateEngines(rows) {
        // "Todo" suma los motores. Las versiones también se suman entre motores:
        // app_version es global, así que "v0.4.3 en conjunto" sí significa algo.
        const total = { engine: 'all', events: 0, attempts: 0, ok: 0, error: 0, skipped: 0, lastError: null };
        const byVersion = new Map();
        rows.forEach((row) => {
            ['events', 'attempts', 'ok', 'error', 'skipped'].forEach((k) => { total[k] += row[k] || 0; });
            (row.versions || []).forEach((v) => {
                if (!byVersion.has(v.version)) byVersion.set(v.version, { version: v.version, attempts: 0, ok: 0, error: 0, skipped: 0, events: 0 });
                const acc = byVersion.get(v.version);
                ['events', 'attempts', 'ok', 'error', 'skipped'].forEach((k) => { acc[k] += v[k] || 0; });
            });
            if (row.lastError && (!total.lastError || `${row.lastError.at}` > `${total.lastError.at}`)) total.lastError = row.lastError;
        });
        total.successRate = total.attempts ? Math.round((total.ok / total.attempts) * 100) : null;
        total.versions = Array.from(byVersion.values())
            .map((v) => ({ ...v, successRate: v.attempts ? Math.round((v.ok / v.attempts) * 100) : null }))
            .sort((a, b) => (a.version < b.version ? 1 : -1));
        return total;
    }
    function scoreForTab() {
        const rows = (state.stats && state.stats.engines) || [];
        if (!rows.length) return null;
        if (state.engineTab === 'all') return aggregateEngines(rows);
        return rows.find((r) => r.engine === state.engineTab) || null;
    }
    function renderScore() {
        if (!dom.logs) return;
        const box = dom.logs._score;
        box.innerHTML = '';
        const row = scoreForTab();
        if (!row) {
            box.appendChild(h('span', { class: 'wl-score-idle', text: state.stats ? 'este motor todavía no ha reportado nada' : 'marcador no disponible' }));
            return;
        }
        box.append(
            h('span', { class: 'wl-score-cell', text: `intentos ${row.attempts}` }),
            h('span', { class: 'wl-score-sep', text: '·' }),
            h('span', { class: 'wl-score-cell is-ok', text: `ok ${row.ok}` }),
            h('span', { class: 'wl-score-sep', text: '·' }),
            h('span', { class: 'wl-score-cell is-err', text: `error ${row.error}` }),
            h('span', { class: 'wl-score-sep', text: '·' }),
            // null NO es 0%: "sin intentos medibles" es un motor sin instrumentar,
            // no un motor roto. Confundirlos manda a arreglar lo que no falla.
            h('span', { class: `wl-score-rate${row.successRate == null ? ' is-void' : ''}`, text: pct(row.successRate) || 'sin intentos medibles' })
        );

        const versions = (row.versions || []).slice().reverse();   // el API las da desc; se leen de vieja a nueva
        if (versions.length > 1) {
            const line = h('span', { class: 'wl-score-versions' });
            let prev = null;
            versions.forEach((v, i) => {
                if (i) line.appendChild(h('span', { class: 'wl-score-arrowsep', text: '→' }));
                const rate = pct(v.successRate) || '—';
                const cell = h('span', { class: 'wl-score-ver', title: v.successRate == null ? 'sin intentos medibles' : `${v.ok}/${v.attempts} intentos` }, [
                    h('b', { text: versionLabel(v.version) }), document.createTextNode(` ${rate}`)
                ]);
                if (prev != null && v.successRate != null) {
                    const up = v.successRate >= prev;
                    cell.appendChild(h('span', { class: `wl-score-trend ${up ? 'is-up' : 'is-down'}`, text: up ? '▲' : '▼' }));
                }
                if (v.successRate != null) prev = v.successRate;
                line.appendChild(cell);
            });
            box.appendChild(line);
        }
        if (row.lastError) {
            box.appendChild(h('span', {
                class: 'wl-score-lasterr',
                title: `${row.lastError.kind || ''} · ${row.lastError.at || ''}`,
                text: `último fallo: ${row.lastError.label || row.lastError.kind || '—'}`
            }));
        }
    }
    async function refreshStats() {
        if (!state.selectedEmail) return;
        try { state.stats = await loadStats(state.selectedEmail); }
        catch (e) { state.stats = null; }
        renderScore();
    }

    function logLabel(ev) {
        if (ev.label) return ev.label;
        const map = {
            conscious_run_start: 'Inicia ejecución consciente',
            conscious_run_end: 'Fin de ejecución',
            analyze: 'Analiza la pantalla',
            action: 'Acción en pantalla',
            mcp: 'Consulta al subconsciente (MCP)',
            workflow_start: 'Inicia workflow',
            workflow_step: 'Paso de workflow',
            workflow_end: 'Fin de workflow'
        };
        return map[ev.kind] || ev.kind;
    }
    function eventEngine(ev) { return ev.engine || 'otros'; }
    function matchesTab(ev) { return state.engineTab === 'all' || eventEngine(ev) === state.engineTab; }
    function engineLabel(key) {
        const def = state.engines.find((e) => e.key === key);
        return def ? def.label : key;
    }
    function hasDetail(ev) {
        return ev.detail && typeof ev.detail === 'object' && Object.keys(ev.detail).length > 0;
    }

    // Una entrada = la línea + (opcional) su detalle desplegable.
    function logEntry(ev) {
        const entry = h('div', { class: 'wl-log-entry' });

        const tag = h('span', { class: 'wl-log-tag', text: (ev.kind || '').replace(/_/g, ' ') });
        tag.dataset.kind = ev.kind || '';
        if (ev.phase) tag.dataset.phase = ev.phase;
        if (ev.outcome) tag.dataset.outcome = ev.outcome;

        // La hora que importa es la de la MÁQUINA (client_at). created_at es la de
        // llegada al servidor: con la red de por medio pueden diferir segundos, y
        // depurar contra la hora equivocada manda a buscar donde no es. El title
        // muestra las dos, que es como se ve el desfase.
        const time = h('span', { class: 'wl-log-time', text: clock(ev.client_at || ev.created_at) });
        time.title = `máquina: ${ev.client_at || '—'}\nservidor: ${ev.created_at || '—'}`;

        const msg = logLabel(ev) + (ev.app_id ? `  ·  ${ev.app_id}` : '');
        const line = h('div', { class: 'wl-log-line' }, [
            time,
            tag,
            h('span', { class: 'wl-log-engine', text: engineLabel(eventEngine(ev)) }),
            h('span', { class: 'wl-log-msg', text: msg })
        ]);
        entry.appendChild(line);

        // El detalle es donde está la información útil (el payload real del
        // cliente) y hasta ahora no se veía en ninguna parte. Colapsado por
        // defecto para no romper la lectura del feed.
        if (hasDetail(ev)) {
            const pre = h('pre', { class: 'wl-log-detail' });
            let painted = false;
            const toggle = h('button', { class: 'wl-log-toggle', type: 'button', title: 'Ver detalle' }, [chevronSvg('wl-log-caret')]);
            toggle.addEventListener('click', () => {
                const open = entry.classList.toggle('is-detail-open');
                // Serializar solo al abrir: 500 líneas con JSON.stringify de golpe
                // es trabajo tirado para algo que casi nadie despliega.
                if (open && !painted) { pre.textContent = JSON.stringify(ev.detail, null, 2); painted = true; }
            });
            line.appendChild(toggle);
            entry.appendChild(pre);
        }
        return entry;
    }

    function logsEmptyNode() {
        return h('div', { class: 'wl-log-empty', text: state.engineTab === 'all'
            ? 'Sin actividad todavía para este usuario.'
            : 'Este motor todavía no ha reportado nada. Puede que no esté instrumentado.' });
    }

    function appendLogs(events) {
        events.forEach((ev) => {
            state.logs.push(ev);
            const key = eventEngine(ev);
            state.engineCounts[key] = (state.engineCounts[key] || 0) + 1;
        });
        if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);

        // Render INCREMENTAL: repintar 500 líneas en cada tanda hacía que el feed
        // parpadeara y perdía el scroll. Solo se anexa lo nuevo y se recorta por
        // el frente. El repintado completo queda para el cambio de tab/usuario.
        const term = dom.logs._term;
        const atBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
        const visible = events.filter(matchesTab);
        if (visible.length) {
            const empty = term.querySelector('.wl-log-empty');
            if (empty) empty.remove();
            const frag = document.createDocumentFragment();
            visible.forEach((ev) => frag.appendChild(logEntry(ev)));
            term.appendChild(frag);
            while (term.childElementCount > MAX_LOGS) term.removeChild(term.firstElementChild);
            if (atBottom) term.scrollTop = term.scrollHeight;
        }
        dom.logs._badge.textContent = `${state.logs.length}`;
        updateTabCounts();
    }

    // Repintado completo. Solo al cambiar de tab o de usuario.
    function renderLogs() {
        if (!dom.logs) return;
        const term = dom.logs._term;
        term.innerHTML = '';
        const visible = state.logs.filter(matchesTab);
        if (!visible.length) {
            term.appendChild(logsEmptyNode());
        } else {
            const frag = document.createDocumentFragment();
            visible.slice(-MAX_LOGS).forEach((ev) => frag.appendChild(logEntry(ev)));
            term.appendChild(frag);
        }
        dom.logs._badge.textContent = `${state.logs.length}`;
        term.scrollTop = term.scrollHeight;
    }

    // ------------------------------------------------- bitácora de avances
    // El marcador sabe contar ok/error, pero no sabe QUÉ se intentó ni POR QUÉ
    // falló. Eso solo lo sabe quien lo hizo, y hoy se pierde: este formulario es
    // el sitio donde ese relato queda pegado al motor que lo produjo.
    const OUTCOME_OPTIONS = [
        { value: 'funciono', label: 'Funcionó' },
        { value: 'no_funciono', label: 'No funcionó' },
        { value: 'parcial', label: 'Parcial' },
        { value: 'en_curso', label: 'En curso' }
    ];
    function field(labelText, control, hint) {
        return h('label', { class: 'wl-field' }, [
            h('span', { class: 'wl-field-label', text: labelText }),
            control,
            hint ? h('span', { class: 'wl-field-hint', text: hint }) : null
        ]);
    }
    function buildProgressModal() {
        const overlay = h('div', { class: 'wl-modal' });
        const title = h('input', { class: 'wl-input', type: 'text', maxlength: '200', placeholder: 'Qué se probó, en una línea' });
        const body = h('textarea', { class: 'wl-input wl-textarea', rows: '9', placeholder: 'Contexto: qué se intentó, qué se midió, qué pasó, qué queda pendiente. Pega aquí lo que haga falta.' });
        const outcome = h('select', { class: 'wl-input' });
        OUTCOME_OPTIONS.forEach((o) => outcome.appendChild(h('option', { value: o.value, text: o.label })));
        outcome.value = 'en_curso';
        const engine = h('select', { class: 'wl-input' });
        const version = h('input', { class: 'wl-input', type: 'text', placeholder: 'v0.0.0' });
        const err = h('div', { class: 'wl-modal-error' });
        const save = h('button', { class: 'wl-btn is-primary', type: 'submit', text: 'Guardar avance' });

        const card = h('form', { class: 'wl-modal-card' }, [
            h('div', { class: 'wl-modal-head' }, [
                h('strong', { text: 'Registrar avance' }),
                h('button', { class: 'wl-modal-x', type: 'button', text: '×', onclick: closeProgress })
            ]),
            h('div', { class: 'wl-modal-body' }, [
                field('Título', title),
                field('Qué pasó', body, 'Se guarda tal cual: el valor está en el relato, no en el formato.'),
                h('div', { class: 'wl-field-row' }, [
                    field('Veredicto', outcome),
                    field('Motor', engine),
                    field('Versión de la app', version)
                ]),
                err
            ]),
            h('div', { class: 'wl-modal-foot' }, [
                h('button', { class: 'wl-btn', type: 'button', text: 'Cancelar', onclick: closeProgress }),
                save
            ])
        ]);
        card.addEventListener('submit', submitProgress);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeProgress(); });
        overlay.appendChild(card);
        overlay._title = title; overlay._body = body; overlay._outcome = outcome;
        overlay._engine = engine; overlay._version = version; overlay._err = err; overlay._save = save;
        return overlay;
    }
    function openProgress() {
        const m = dom.modal;
        m._engine.innerHTML = '';
        m._engine.appendChild(h('option', { value: '', text: '— sin motor —' }));
        engineDefs().forEach((def) => m._engine.appendChild(h('option', { value: def.key, text: def.label })));
        // El motor y la versión se precargan de lo que ya está en pantalla: un
        // avance mal anclado es un avance que nadie vuelve a encontrar.
        m._engine.value = state.engineTab === 'all' ? '' : state.engineTab;
        const user = state.users.find((u) => u.email === state.selectedEmail);
        m._version.value = (user && user.app_version) || '';
        m._err.textContent = '';
        m.classList.add('is-open');
        setTimeout(() => m._title.focus(), 40);
    }
    function closeProgress() {
        if (!dom.modal) return;
        dom.modal.classList.remove('is-open');
        dom.modal._title.value = '';
        dom.modal._body.value = '';
    }
    async function submitProgress(e) {
        e.preventDefault();
        const m = dom.modal;
        const title = m._title.value.trim();
        if (!title) { m._err.textContent = 'El avance necesita un título.'; m._title.focus(); return; }
        const engineKey = m._engine.value;
        const def = engineDefs().find((d) => d.key === engineKey);
        m._save.disabled = true;
        m._err.textContent = '';
        try {
            await authedSend('/api/studio/progress', 'POST', {
                engine: engineKey,
                docId: (def && def.doc) || '',
                title,
                body: m._body.value,
                outcome: m._outcome.value,
                appVersion: m._version.value.trim(),
                tags: []
            });
            closeProgress();
            showToast('Avance registrado.');
        } catch (err) {
            m._err.textContent = err.message || 'No fue posible guardar el avance.';
        } finally {
            m._save.disabled = false;
        }
    }
    function showToast(text) {
        if (!dom.toast) return;
        dom.toast.textContent = text;
        dom.toast.classList.add('is-visible');
        clearTimeout(state.timers.toast);
        state.timers.toast = setTimeout(() => dom.toast.classList.remove('is-visible'), 2600);
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.modal && dom.modal.classList.contains('is-open')) closeProgress();
    });

    // -------------------------------------------------------------- render
    function renderGraph() {
        buildStageCore();
        buildSubconscious(state.graph);
        const t = state.graph.totals || { apps: 0, workflows: 0, steps: 0 };
        if (!t.apps) {
            setEmpty('info', 'Sin subconsciente aún', 'Este usuario todavía no ha enseñado workflows. Cuando lo haga, cada app aparecerá aquí con sus flujos y nodos.');
        } else {
            setEmpty(null);
            dom.caption.innerHTML = '';
            dom.caption.append(
                document.createTextNode('El consciente analiza la pantalla y actúa; lo aprendido vive en el subconsciente. '),
                h('b', { text: `${t.apps} apps · ${t.workflows} flujos · ${t.steps} nodos` }),
                document.createTextNode('. Toca una app para ver sus workflows.')
            );
        }
    }

    // -------------------------------------------------------------- flow
    async function selectUser(email) {
        if (!email) return;
        state.selectedEmail = email;
        state.graph = null; state.logs = []; state.lastEventId = 0; state.seededEvents = false;
        state.engineCounts = {}; state.stats = null;
        state.detailAppId = null;
        renderSelectorButton(); renderMenu();
        renderTabs(); renderLogs(); renderScore();
        closeDetail();
        setEmpty('loading', 'Cargando el sistema de este usuario…', '');
        stopEventsPolling();
        try { window.dispatchEvent(new CustomEvent('wl:user', { detail: { email } })); } catch (e) { /* */ }
        try {
            state.graph = await loadGraph(email);
            renderGraph();
        } catch (e) {
            setEmpty('info', 'No pudimos cargar el grafo', e.message || '');
        }
        startEventsPolling();
    }

    // El catálogo de tabs viene del servidor: añadir un motor no debe obligar a
    // tocar este archivo. Si falla, las tabs se reconstruyen igual desde los
    // motores que aparezcan en los propios eventos.
    async function refreshEngines() {
        if (state.engines.length) return;
        try {
            const { engines } = await loadEngines();
            state.engines = Array.isArray(engines) ? engines : [];
        } catch (e) { state.engines = []; }
        renderTabs();
    }

    async function refreshUsers() {
        try {
            const { users } = await loadUsers();
            state.users = Array.isArray(users) ? users : [];
            renderSelectorButton();
            if (state.menuOpen) renderMenu();
            if (!state.selectedEmail && state.users.length) {
                await selectUser(state.users[0].email);
            } else if (!state.users.length) {
                setEmpty('info', 'Aún no hay usuarios', 'Cuando alguien instale la app de Windows y escriba su nombre y correo, aparecerá aquí para verlo en vivo.');
            }
        } catch (e) {
            setEmpty('info', 'No pudimos leer los usuarios', e.message || '');
        }
    }

    // Punto único de entrada de eventos: lo usan el stream y el sondeo de
    // respaldo, para que el comportamiento no dependa del transporte.
    function ingestEvents(events, lastId) {
        if (Number.isFinite(lastId)) state.lastEventId = Math.max(state.lastEventId, lastId);
        if (!events || !events.length) return;
        appendLogs(events);
        // la primera tanda es historia, no vida: siembra logs y no anima nada
        if (!state.seededEvents) { state.seededEvents = true; return; }
        events.forEach(notifyLab);
        // Sin escalonado: los pulsos salen ya. Si la tanda es grande solo se
        // animan los primeros MAX_PULSE_BURST — el resto entra a los logs, que es
        // donde se lee. Animarlos todos ahoga el rAF y no se distingue nada.
        events.slice(0, MAX_PULSE_BURST).forEach(pulseForEvent);
    }

    async function pollEvents() {
        if (!state.selectedEmail || !state.graph) return;
        try {
            const { events, lastId } = await loadEvents(state.selectedEmail, state.lastEventId);
            ingestEvents(events, lastId);
        } catch (e) { /* silencioso: la telemetría no debe romper la UI */ }
    }

    // ----------------------------------------------------------- stream (SSE)
    // Es SSE por el formato, pero NO usamos EventSource: no admite cabeceras, así
    // que autenticarlo obligaría a poner el Bearer en el query string, donde queda
    // escrito en logs de acceso e historial. Con fetch() el token viaja en
    // Authorization como el resto del panel y parseamos el formato a mano.
    function parseSseFrame(raw) {
        let event = 'message';
        const data = [];
        raw.split('\n').forEach((line) => {
            if (!line || line[0] === ':') return;   // ':' = comentario SSE (los pings)
            const i = line.indexOf(':');
            const fieldName = i < 0 ? line : line.slice(0, i);
            const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
            if (fieldName === 'event') event = value;
            else if (fieldName === 'data') data.push(value);
        });
        if (!data.length) return null;
        try { return { event, data: JSON.parse(data.join('\n')) }; } catch (e) { return null; }
    }

    // Abre una conexión y la consume hasta que el servidor se despide. Devuelve
    // 'bye' (cierre planificado) o lanza: cualquier otro final es una caída.
    async function openStream(email) {
        const token = await authToken();
        const ctrl = new AbortController();
        state.stream.ctrl = ctrl;
        const res = await fetch(
            `/api/windows/users/${encodeURIComponent(email)}/events/stream?since=${state.lastEventId || 0}`,
            { cache: 'no-store', signal: ctrl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        setStreamStatus('live', 'en vivo');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let cut = buffer.indexOf('\n\n');
            while (cut >= 0) {
                const frame = parseSseFrame(buffer.slice(0, cut));
                buffer = buffer.slice(cut + 2);
                if (frame) {
                    if (frame.event === 'events') ingestEvents(frame.data.events, frame.data.lastId);
                    else if (frame.event === 'open') {
                        // Un usuario sin historial nunca manda tanda de siembra, y
                        // sin esto su PRIMER evento real se tragaría como historia
                        // (sin pulso). Si en este margen no llegó nada, no hay
                        // historia que sembrar: lo que venga después es vida.
                        const who = state.selectedEmail;
                        setTimeout(() => { if (state.selectedEmail === who) state.seededEvents = true; }, 1500);
                    }
                    else if (frame.event === 'warn') setStreamStatus('warn', 'el servidor reporta un problema');
                    else if (frame.event === 'bye') {
                        // El lastId del servidor evita el hueco entre el cierre y
                        // la siguiente conexión.
                        if (Number.isFinite(frame.data.lastId)) state.lastEventId = Math.max(state.lastEventId, frame.data.lastId);
                        try { reader.cancel(); } catch (e) { /* */ }
                        return 'bye';
                    }
                }
                cut = buffer.indexOf('\n\n');
            }
        }
        throw new Error('el stream se cortó sin despedirse');
    }

    async function runStream(email) {
        while (state.stream.on && state.selectedEmail === email) {
            const openedAt = Date.now();
            try {
                await openStream(email);
                state.stream.fails = 0;   // cierre planificado: reconecta YA, sin espera
                continue;
            } catch (err) {
                if (!state.stream.on || state.selectedEmail !== email) return;
                if (err && err.name === 'AbortError') return;
                // Una conexión que sirvió un buen rato y luego cayó no significa
                // "el stream no funciona": solo cuentan los fallos encadenados.
                if (Date.now() - openedAt > STREAM_HEALTHY_MS) state.stream.fails = 0;
                state.stream.fails += 1;
                if (state.stream.fails >= STREAM_MAX_FAILS) { fallbackToPolling(); return; }
                const wait = STREAM_BACKOFF_MS[Math.min(state.stream.fails - 1, STREAM_BACKOFF_MS.length - 1)];
                setStreamStatus('warn', `reconectando en ${Math.round(wait / 1000)} s…`);
                await sleep(wait);
            }
        }
    }

    // Red de seguridad: si el stream no se sostiene, el panel sigue vivo con el
    // sondeo de siempre. Se dice en la UI porque la latencia deja de ser la misma.
    function fallbackToPolling() {
        state.stream.on = false;
        state.stream.mode = 'polling';
        setStreamStatus('fallback', 'sin stream · sondeo 2,5 s');
        clearInterval(state.timers.events);
        state.timers.events = setInterval(pollEvents, EVENTS_POLL_MS);
        pollEvents();
    }

    // -------------------------------------------------------------- timers
    function startUsersPolling() { stopUsersPolling(); state.timers.users = setInterval(refreshUsers, USERS_POLL_MS); }
    function stopUsersPolling() { clearInterval(state.timers.users); state.timers.users = null; }
    function startEventsPolling() {
        stopEventsPolling();
        state.timers.graph = setInterval(async () => {
            if (!state.selectedEmail) return;
            try { const g = await loadGraph(state.selectedEmail); if (g) { state.graph = g; if (!state.detailAppId) renderGraph(); } } catch (e) { /* */ }
        }, GRAPH_REFRESH_MS);
        state.timers.stats = setInterval(refreshStats, STATS_REFRESH_MS);
        refreshStats();

        if (MOCK) {
            // El modo mock no tiene servidor que streamear: sigue con el sondeo.
            state.stream.mode = 'polling';
            setStreamStatus('fallback', 'mock · sondeo 2,5 s');
            state.timers.events = setInterval(pollEvents, EVENTS_POLL_MS);
            pollEvents();
            return;
        }
        state.stream.on = true;
        state.stream.fails = 0;
        state.stream.mode = 'stream';
        setStreamStatus('warn', 'conectando…');
        runStream(state.selectedEmail);
    }
    function stopEventsPolling() {
        // Abortar el stream es obligatorio al cambiar de usuario: si no, la
        // conexión vieja sigue empujando eventos del anterior a los logs del nuevo.
        state.stream.on = false;
        if (state.stream.ctrl) { try { state.stream.ctrl.abort(); } catch (e) { /* */ } }
        state.stream.ctrl = null;
        state.stream.mode = 'idle';
        setStreamStatus('idle', 'en espera');
        clearInterval(state.timers.events); clearInterval(state.timers.graph); clearInterval(state.timers.stats);
        state.timers.events = null; state.timers.graph = null; state.timers.stats = null;
    }

    // -------------------------------------------------------------- activate
    function activate() {
        if (state.active) return;
        state.active = true;
        if (!state.booted) { buildShell(); state.booted = true; }
        refreshEngines();
        refreshUsers();
        startUsersPolling();
        if (state.selectedEmail) startEventsPolling();
    }
    function deactivate() {
        if (!state.active) return;
        state.active = false;
        stopUsersPolling();
        stopEventsPolling();
    }
    function windowsPanelVisible() {
        const panel = document.querySelector('[data-surface-panel="windows"]');
        // Sin panel de superficies estamos en página propia (windows-lab.html): siempre visible.
        if (!panel) return true;
        return !panel.classList.contains('is-hidden');
    }
    function syncActive() { if (windowsPanelVisible()) activate(); else deactivate(); }

    // los tabs los maneja provider-studio.js; reaccionamos a los clicks
    document.querySelectorAll('.studio-surface-tab').forEach((tab) => {
        tab.addEventListener('click', () => setTimeout(syncActive, 0));
    });
    // por si el módulo entra tarde o el tab ya está activo
    if (document.readyState !== 'loading') syncActive();
    else document.addEventListener('DOMContentLoaded', syncActive);
    // modo mock: forzar activación para ver el render aunque no haya tabs
    if (MOCK) { buildShell(); state.booted = true; activate(); }
})();
