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
    const EVENTS_POLL_MS = 2500;
    const GRAPH_REFRESH_MS = 30000;
    const MAX_LOGS = 500;
    const LIVE_WINDOW_MS = 2 * 60 * 1000;

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

    // ---------------------------------------------------------------- data
    async function authedFetch(url) {
        if (window.MiracleAuth?.whenAuthenticated) await window.MiracleAuth.whenAuthenticated();
        const token = window.MiracleAuth?.getAccessToken?.() || '';
        const res = await fetch(url, {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const text = await res.text();
        let payload = {};
        if (text.trim()) { try { payload = JSON.parse(text); } catch (e) { if (!res.ok) throw new Error(text.slice(0, 180)); throw e; } }
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        return payload;
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

        ROOT.append(head, stage, caption, logs);

        dom = { head, selector, stage, svg, layers, empty, detail, tip, caption, logs };
        setEmpty('loading', 'Cargando usuarios…', '');
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
    function buildLogs() {
        const wrap = h('div', { class: 'wl-logs is-open' });
        const badge = h('span', { class: 'wl-logs-badge', text: '0' });
        const head = h('div', {
            class: 'wl-logs-head', onclick: () => wrap.classList.toggle('is-open')
        }, [
            h('div', { class: 'wl-logs-head-left' }, [
                h('span', { class: 'wl-logs-title', text: 'Logs en vivo' }), badge
            ]),
            (() => { const s = el('svg', { class: 'wl-logs-chevron', viewBox: '0 0 16 16' }); s.appendChild(el('path', { d: 'm3 6 5 5 5-5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); return s; })()
        ]);
        const body = h('div', { class: 'wl-logs-body' });
        const term = h('div', { class: 'wl-terminal' });
        body.appendChild(term);
        wrap.append(head, body);
        wrap._term = term; wrap._badge = badge;
        return wrap;
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
    function appendLogs(events) {
        events.forEach((ev) => state.logs.push(ev));
        if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
        renderLogs();
    }
    function renderLogs() {
        const term = dom.logs._term;
        const atBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
        term.innerHTML = '';
        if (!state.logs.length) {
            term.appendChild(h('div', { class: 'wl-log-empty', text: 'Sin actividad todavía para este usuario.' }));
        } else {
            state.logs.forEach((ev) => {
                const tag = h('span', { class: 'wl-log-tag', text: (ev.kind || '').replace(/_/g, ' ') });
                tag.dataset.kind = ev.kind || '';
                if (ev.phase) tag.dataset.phase = ev.phase;
                const msg = logLabel(ev) + (ev.app_id ? `  ·  ${ev.app_id}` : '');
                term.appendChild(h('div', { class: 'wl-log-line' }, [
                    h('span', { class: 'wl-log-time', text: clock(ev.created_at || ev.client_at) }),
                    tag,
                    h('span', { class: 'wl-log-msg', text: msg })
                ]));
            });
        }
        dom.logs._badge.textContent = `${state.logs.length}`;
        if (atBottom) term.scrollTop = term.scrollHeight;
    }

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
        state.detailAppId = null;
        renderSelectorButton(); renderMenu(); renderLogs();
        closeDetail();
        setEmpty('loading', 'Cargando el sistema de este usuario…', '');
        stopEventsPolling();
        try {
            state.graph = await loadGraph(email);
            renderGraph();
        } catch (e) {
            setEmpty('info', 'No pudimos cargar el grafo', e.message || '');
        }
        startEventsPolling();
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

    async function pollEvents() {
        if (!state.selectedEmail || !state.graph) return;
        try {
            const { events, lastId } = await loadEvents(state.selectedEmail, state.lastEventId);
            if (Number.isFinite(lastId)) state.lastEventId = lastId;
            if (!events || !events.length) return;
            appendLogs(events);
            // la primera tanda solo siembra logs; a partir de ahí, pulsos en vivo
            if (state.seededEvents) {
                events.forEach((ev, i) => setTimeout(() => pulseForEvent(ev), i * 140));
            } else {
                state.seededEvents = true;
            }
        } catch (e) { /* silencioso: la telemetría no debe romper la UI */ }
    }

    // -------------------------------------------------------------- timers
    function startUsersPolling() { stopUsersPolling(); state.timers.users = setInterval(refreshUsers, USERS_POLL_MS); }
    function stopUsersPolling() { clearInterval(state.timers.users); state.timers.users = null; }
    function startEventsPolling() {
        stopEventsPolling();
        state.timers.events = setInterval(pollEvents, EVENTS_POLL_MS);
        state.timers.graph = setInterval(async () => {
            if (!state.selectedEmail) return;
            try { const g = await loadGraph(state.selectedEmail); if (g) { state.graph = g; if (!state.detailAppId) renderGraph(); } } catch (e) { /* */ }
        }, GRAPH_REFRESH_MS);
    }
    function stopEventsPolling() { clearInterval(state.timers.events); clearInterval(state.timers.graph); state.timers.events = null; state.timers.graph = null; }

    // -------------------------------------------------------------- activate
    function activate() {
        if (state.active) return;
        state.active = true;
        if (!state.booted) { buildShell(); state.booted = true; }
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
        return panel && !panel.classList.contains('is-hidden');
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
