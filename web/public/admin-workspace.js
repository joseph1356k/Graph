(function () {
    const state = {
        account: null,
        mounted: false,
        root: null
    };

    // ---- Captura de logs del cliente (para depurar el flujo voz → nota) ----
    let logToggleButton = null;
    let logPanel = null;
    let logListEl = null;
    const LOG_LIMIT = 600;
    const logEntries = [];

    function nowStamp() {
        const d = new Date();
        return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }

    function serializeArg(arg) {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try { return JSON.stringify(arg); } catch (error) { return String(arg); }
    }

    function updateLogBadge() {
        if (!logToggleButton) return;
        const errors = logEntries.reduce((count, entry) => count + (entry.level === 'error' ? 1 : 0), 0);
        logToggleButton.textContent = errors > 0 ? `Logs (${errors})` : 'Logs';
    }

    function renderLogEntry(entry) {
        if (!logListEl) return;
        const row = document.createElement('div');
        row.className = `miracle-log-row miracle-log-${entry.level}`;
        row.textContent = `${entry.t}  ${entry.level.toUpperCase()}  ${entry.message}`;
        logListEl.appendChild(row);
        logListEl.scrollTop = logListEl.scrollHeight;
    }

    function appendLogEntry(level, message) {
        const entry = { t: nowStamp(), level, message: `${message}` };
        logEntries.push(entry);
        if (logEntries.length > LOG_LIMIT) logEntries.shift();
        renderLogEntry(entry);
        updateLogBadge();
    }

    function installLogCapture() {
        if (window.__miracleLogCaptureInstalled) return;
        window.__miracleLogCaptureInstalled = true;

        ['log', 'info', 'warn', 'error'].forEach((level) => {
            const original = typeof console[level] === 'function' ? console[level].bind(console) : null;
            console[level] = (...args) => {
                try { appendLogEntry(level === 'log' ? 'info' : level, args.map(serializeArg).join(' ')); } catch (error) { /* ignore */ }
                if (original) original(...args);
            };
        });

        window.addEventListener('error', (event) => {
            appendLogEntry('error', `window.onerror: ${event.message} @ ${event.filename || ''}:${event.lineno || 0}`);
        });
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            appendLogEntry('error', `unhandledrejection: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : serializeArg(reason)}`);
        });

        const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
        if (originalFetch) {
            window.fetch = async (input, init = {}) => {
                const method = `${init.method || (input && typeof input === 'object' ? input.method : '') || 'GET'}`.toUpperCase();
                const url = typeof input === 'string' ? input : (input && input.url) || `${input}`;
                const isVoiceFlow = /\/api\/(voice|medical|clinical)\b/.test(url);
                const startedAt = Date.now();
                try {
                    const response = await originalFetch(input, init);
                    const ms = Date.now() - startedAt;
                    if (!response.ok || isVoiceFlow) {
                        let bodyPreview = '';
                        try {
                            const text = await response.clone().text();
                            bodyPreview = text.length > 700 ? `${text.slice(0, 700)}…` : text;
                        } catch (error) { bodyPreview = '<sin cuerpo legible>'; }
                        appendLogEntry(response.ok ? 'info' : 'error', `${method} ${url} → ${response.status} (${ms}ms) ${bodyPreview}`.trim());
                    }
                    return response;
                } catch (error) {
                    const ms = Date.now() - startedAt;
                    appendLogEntry('error', `${method} ${url} → ERROR DE RED (${ms}ms) ${error && error.message ? error.message : error}`);
                    throw error;
                }
            };
        }

        const OriginalWebSocket = window.WebSocket;
        if (typeof OriginalWebSocket === 'function' && !OriginalWebSocket.__miracleWrapped) {
            const WrappedWebSocket = function (url, protocols) {
                const ws = protocols === undefined
                    ? new OriginalWebSocket(url)
                    : new OriginalWebSocket(url, protocols);
                const shortUrl = `${url}`.split('?')[0];
                const isDeepgram = /deepgram\.com/i.test(`${url}`);
                appendLogEntry('info', `WS → conectando ${shortUrl}${isDeepgram ? ' (Deepgram)' : ''}`);
                let messageCount = 0;
                let finalCount = 0;
                let sentChunks = 0;
                let sentBytes = 0;
                try {
                    const originalSend = ws.send.bind(ws);
                    ws.send = (payload) => {
                        try {
                            if (payload && typeof payload !== 'string') {
                                const size = payload.byteLength || payload.size || (payload.buffer && payload.buffer.byteLength) || 0;
                                sentChunks += 1;
                                sentBytes += size;
                                if (sentChunks <= 3 || sentChunks % 20 === 0) {
                                    appendLogEntry('info', `WS send audio #${sentChunks} (${size}B, total ${sentBytes}B) ${shortUrl}`);
                                }
                            } else if (typeof payload === 'string') {
                                appendLogEntry('info', `WS send texto: ${payload.slice(0, 120)}`);
                            }
                        } catch (error) { /* ignore */ }
                        return originalSend(payload);
                    };
                } catch (error) { /* ignore */ }
                ws.addEventListener('open', () => appendLogEntry('info', `WS ✓ abierto ${shortUrl}`));
                ws.addEventListener('error', () => appendLogEntry('error', `WS ✗ error ${shortUrl}`));
                ws.addEventListener('close', (event) => {
                    appendLogEntry(event.code === 1000 ? 'info' : 'error',
                        `WS ✗ cerrado code=${event.code} reason="${event.reason || ''}" enviados=${sentChunks}chunks/${sentBytes}B recibidos=${messageCount}msgs finales=${finalCount} ${shortUrl}`);
                });
                ws.addEventListener('message', (event) => {
                    messageCount += 1;
                    if (!isDeepgram) return;
                    let data = null;
                    try { data = JSON.parse(event.data); } catch (error) { return; }
                    if (data && data.type && data.type !== 'Results') {
                        appendLogEntry('info', `WS Deepgram ${data.type}${data.reason ? `: ${data.reason}` : ''}${data.description ? `: ${data.description}` : ''}`);
                        return;
                    }
                    const alt = data && data.channel && Array.isArray(data.channel.alternatives) ? data.channel.alternatives[0] : null;
                    const transcript = alt && typeof alt.transcript === 'string' ? alt.transcript : '';
                    if (data && data.is_final && transcript) {
                        finalCount += 1;
                        appendLogEntry('info', `WS Deepgram FINAL #${finalCount}: "${transcript}"`);
                    } else if (messageCount <= 4) {
                        appendLogEntry('info', `WS Deepgram msg#${messageCount} is_final=${data && data.is_final} transcript="${transcript}"`);
                    }
                });
                return ws;
            };
            WrappedWebSocket.prototype = OriginalWebSocket.prototype;
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => { WrappedWebSocket[key] = OriginalWebSocket[key]; });
            WrappedWebSocket.__miracleWrapped = true;
            try { window.WebSocket = WrappedWebSocket; } catch (error) { /* ignore */ }
        }

        appendLogEntry('info', 'Captura de logs activa (consola, errores, fetch /api/voice·medical·clinical y WebSocket Deepgram).');
    }

    installLogCapture();

    function copyLogs() {
        const text = logEntries.map((entry) => `${entry.t} ${entry.level.toUpperCase()} ${entry.message}`).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    }

    function clearLogs() {
        logEntries.length = 0;
        if (logListEl) logListEl.textContent = '';
        updateLogBadge();
    }

    function ensureLogPanel() {
        if (logPanel) return logPanel;
        const panel = document.createElement('div');
        panel.className = 'miracle-log-panel';
        panel.hidden = true;

        const bar = document.createElement('div');
        bar.className = 'miracle-log-bar';
        const barTitle = document.createElement('strong');
        barTitle.textContent = 'Logs del cliente';
        bar.append(
            barTitle,
            actionButton('Copiar', 'secondary', copyLogs),
            actionButton('Limpiar', 'secondary', clearLogs),
            actionButton('Cerrar', 'secondary', () => { panel.hidden = true; })
        );

        const list = document.createElement('div');
        list.className = 'miracle-log-list';
        logListEl = list;
        logEntries.forEach(renderLogEntry);

        panel.append(bar, list);
        document.body.appendChild(panel);
        logPanel = panel;
        return panel;
    }

    function toggleLogPanel() {
        const panel = ensureLogPanel();
        panel.hidden = !panel.hidden;
        if (!panel.hidden && logListEl) {
            logListEl.scrollTop = logListEl.scrollHeight;
        }
    }

    function getAccessToken() {
        return window.MiracleAuth && typeof window.MiracleAuth.getAccessToken === 'function'
            ? window.MiracleAuth.getAccessToken()
            : '';
    }

    function isAnonymousUser(user) {
        if (!user) return true;
        if (user.role === 'local-dev') return false;
        if (user.is_anonymous === true) return true;
        const provider = `${user.app_metadata?.provider || user.user_metadata?.provider || ''}`.trim().toLowerCase();
        const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
        return provider === 'anonymous'
            || providers.some((value) => `${value || ''}`.trim().toLowerCase() === 'anonymous');
    }

    async function authenticatedFetch(url, init = {}) {
        if (window.MiracleAuth && typeof window.MiracleAuth.whenAuthenticated === 'function') {
            await window.MiracleAuth.whenAuthenticated();
        }
        const token = getAccessToken();
        return fetch(url, {
            ...init,
            cache: 'no-store',
            headers: {
                ...(init.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
    }

    function installStyles() {
        if (document.getElementById('miracle-admin-workspace-styles')) return;
        const style = document.createElement('style');
        style.id = 'miracle-admin-workspace-styles';
        style.textContent = `
            .miracle-admin-workspace {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 2147482500;
                width: min(330px, calc(100vw - 32px));
                padding: 12px;
                border: 1px solid rgba(15, 23, 42, 0.16);
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.96);
                box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
                color: #0f172a;
                font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
                display: grid;
                gap: 10px;
            }
            .miracle-admin-workspace[aria-expanded="false"] {
                width: auto;
                padding: 8px 10px;
            }
            .miracle-admin-workspace[aria-expanded="false"] .miracle-admin-body,
            .miracle-admin-workspace[aria-expanded="false"] .miracle-admin-meta {
                display: none;
            }
            .miracle-admin-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .miracle-admin-title {
                display: grid;
                gap: 2px;
                min-width: 0;
            }
            .miracle-admin-title strong {
                font-size: 13px;
                line-height: 1.1;
            }
            .miracle-admin-meta {
                color: #64748b;
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .miracle-admin-toggle {
                width: 30px;
                height: 30px;
                border: 1px solid rgba(15, 23, 42, 0.14);
                border-radius: 999px;
                background: #f8fafc;
                color: #0f172a;
                cursor: pointer;
                font-weight: 800;
            }
            .miracle-admin-body {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .miracle-admin-action {
                border: 0;
                border-radius: 10px;
                padding: 10px 11px;
                background: #0f172a;
                color: #ffffff;
                cursor: pointer;
                font: inherit;
                font-size: 12px;
                font-weight: 700;
                text-align: center;
                text-decoration: none;
            }
            .miracle-admin-action.secondary {
                background: #eef2f7;
                color: #0f172a;
            }
            .miracle-admin-action.warning {
                background: #f59e0b;
                color: #111827;
            }
            .miracle-admin-action:disabled {
                cursor: not-allowed;
                opacity: 0.55;
            }
            .miracle-log-panel {
                position: fixed;
                right: 18px;
                bottom: 96px;
                z-index: 2147482499;
                width: min(560px, calc(100vw - 32px));
                max-height: min(52vh, 520px);
                display: flex;
                flex-direction: column;
                border: 1px solid rgba(15, 23, 42, 0.18);
                border-radius: 14px;
                background: #0b1220;
                color: #e2e8f0;
                box-shadow: 0 24px 60px rgba(2, 8, 20, 0.4);
                overflow: hidden;
            }
            .miracle-log-panel[hidden] {
                display: none;
            }
            .miracle-log-bar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                background: rgba(255, 255, 255, 0.06);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            .miracle-log-bar strong {
                flex: 1;
                font-size: 12px;
                color: #f8fafc;
            }
            .miracle-log-bar .miracle-admin-action {
                padding: 6px 10px;
                font-size: 11px;
                background: rgba(255, 255, 255, 0.12);
                color: #e2e8f0;
            }
            .miracle-log-list {
                flex: 1;
                overflow-y: auto;
                padding: 8px 10px;
                font: 11px/1.5 "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .miracle-log-row {
                padding: 2px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            }
            .miracle-log-info { color: #cbd5e1; }
            .miracle-log-warn { color: #fbbf24; }
            .miracle-log-error { color: #fca5a5; }
            @media (max-width: 680px) {
                .miracle-admin-workspace {
                    right: 12px;
                    bottom: 12px;
                }
                .miracle-admin-body {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function actionButton(label, className, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `miracle-admin-action ${className || ''}`.trim();
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    function actionLink(label, href, className) {
        const link = document.createElement('a');
        link.className = `miracle-admin-action ${className || ''}`.trim();
        link.textContent = label;
        link.href = href;
        return link;
    }

    function openWorkflowPanel() {
        if (window.TrainerPlugin && typeof window.TrainerPlugin.openWorkflowPanel === 'function') {
            window.TrainerPlugin.openWorkflowPanel();
            return;
        }
        window.location.href = '/visualize.html';
    }

    async function startWorkflowRecording() {
        if (!window.TrainerPlugin || typeof window.TrainerPlugin.startWorkflow !== 'function') {
            window.location.href = '/visualize.html';
            return;
        }

        const input = document.getElementById('wf-desc');
        const fallback = document.title ? `Workflow ${document.title}` : `Workflow ${new Date().toISOString()}`;
        const description = window.prompt('Nombre del workflow privado', input?.value || fallback);
        if (description === null) return;
        if (input) {
            input.value = description.trim() || fallback;
        }
        await window.TrainerPlugin.startWorkflow();
    }

    async function signOut() {
        if (window.MiracleAuth && typeof window.MiracleAuth.signOut === 'function') {
            await window.MiracleAuth.signOut();
        }
        window.location.reload();
    }

    function render(account) {
        installStyles();
        document.body.classList.add('miracle-admin-account');
        if (state.root) {
            state.root.remove();
        }

        const root = document.createElement('aside');
        root.className = 'miracle-admin-workspace';
        root.setAttribute('aria-label', 'Developer workspace');
        root.setAttribute('aria-expanded', window.localStorage.getItem('miracle-admin-workspace-collapsed') === 'true' ? 'false' : 'true');

        const top = document.createElement('div');
        top.className = 'miracle-admin-top';

        const title = document.createElement('div');
        title.className = 'miracle-admin-title';
        const label = document.createElement('strong');
        label.textContent = 'Developer workspace';
        const meta = document.createElement('span');
        meta.className = 'miracle-admin-meta';
        meta.textContent = account?.user?.email || 'admin';
        title.append(label, meta);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'miracle-admin-toggle';
        toggle.textContent = root.getAttribute('aria-expanded') === 'true' ? '-' : '+';
        toggle.title = 'Mostrar u ocultar workspace admin';
        toggle.addEventListener('click', () => {
            const expanded = root.getAttribute('aria-expanded') !== 'false';
            const next = expanded ? 'false' : 'true';
            root.setAttribute('aria-expanded', next);
            toggle.textContent = next === 'true' ? '-' : '+';
            window.localStorage.setItem('miracle-admin-workspace-collapsed', next === 'false' ? 'true' : 'false');
        });

        top.append(title, toggle);

        const body = document.createElement('div');
        body.className = 'miracle-admin-body';
        logToggleButton = actionButton('Logs', 'secondary', toggleLogPanel);
        updateLogBadge();
        body.append(
            logToggleButton,
            actionButton('Crear workflow', 'warning', () => {
                startWorkflowRecording().catch((error) => window.alert(error.message || 'No se pudo iniciar la grabacion.'));
            }),
            actionLink('Providers', '/provider-studio.html', 'secondary'),
            actionButton('Mis workflows', 'secondary', openWorkflowPanel),
            actionLink('Grafo y globales', '/visualize.html', ''),
            actionButton('Cerrar sesion', 'secondary', () => {
                signOut().catch(() => window.location.reload());
            })
        );

        root.append(top, body);
        document.body.appendChild(root);
        state.root = root;
        state.mounted = true;
    }

    async function loadAccount() {
        const response = await authenticatedFetch('/api/account/me');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'No se pudo cargar la cuenta.');
        }
        return payload;
    }

    async function init() {
        if (!window.MiracleAuth || typeof window.MiracleAuth.whenAuthenticated !== 'function') {
            return;
        }

        try {
            await window.MiracleAuth.whenAuthenticated();
            const user = window.MiracleAuth.getUser?.() || null;
            if (isAnonymousUser(user)) {
                return;
            }
            const account = await loadAccount();
            state.account = account;
            window.dispatchEvent(new CustomEvent('miracle-account-ready', { detail: account }));
            if (account?.permissions?.canManageGlobalWorkflows) {
                render(account);
            }
        } catch (error) {
            console.warn('[Miracle Admin] Workspace unavailable:', error.message || error);
        }
    }

    window.MiracleAdminWorkspace = {
        getAccount() {
            return state.account;
        },
        refresh() {
            return init();
        }
    };

    init();
})();
