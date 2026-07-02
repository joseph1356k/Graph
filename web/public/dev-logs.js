(function () {
    // Standalone developer log viewer. Self-mounts a floating "Logs" button.
    // Captures console, uncaught errors, fetch (with body for /api/voice·medical·clinical)
    // and WebSocket lifecycle (with Deepgram frame + audio-send instrumentation).
    if (window.__miracleDevLogsInstalled) return;
    window.__miracleDevLogsInstalled = true;

    const LOG_LIMIT = 800;
    const logEntries = [];
    let toggleButton = null;
    let panel = null;
    let listEl = null;

    function nowStamp() {
        const d = new Date();
        return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    }

    function serializeArg(arg) {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try { return JSON.stringify(arg); } catch (error) { return String(arg); }
    }

    function updateBadge() {
        if (!toggleButton) return;
        const errors = logEntries.reduce((count, entry) => count + (entry.level === 'error' ? 1 : 0), 0);
        toggleButton.textContent = errors > 0 ? `Logs (${errors})` : 'Logs';
        toggleButton.dataset.errors = errors > 0 ? 'true' : 'false';
    }

    function renderEntry(entry) {
        if (!listEl) return;
        const row = document.createElement('div');
        row.className = `mdl-row mdl-${entry.level}`;
        row.textContent = `${entry.t}  ${entry.level.toUpperCase()}  ${entry.message}`;
        listEl.appendChild(row);
        listEl.scrollTop = listEl.scrollHeight;
    }

    function append(level, message) {
        const entry = { t: nowStamp(), level, message: `${message}` };
        logEntries.push(entry);
        if (logEntries.length > LOG_LIMIT) logEntries.shift();
        renderEntry(entry);
        updateBadge();
    }

    function installCapture() {
        ['log', 'info', 'warn', 'error'].forEach((level) => {
            const original = typeof console[level] === 'function' ? console[level].bind(console) : null;
            console[level] = (...args) => {
                try { append(level === 'log' ? 'info' : level, args.map(serializeArg).join(' ')); } catch (error) { /* ignore */ }
                if (original) original(...args);
            };
        });

        window.addEventListener('error', (event) => {
            append('error', `window.onerror: ${event.message} @ ${event.filename || ''}:${event.lineno || 0}`);
        });
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            append('error', `unhandledrejection: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : serializeArg(reason)}`);
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
                            bodyPreview = text.length > 900 ? `${text.slice(0, 900)}…` : text;
                        } catch (error) { bodyPreview = '<sin cuerpo legible>'; }
                        append(response.ok ? 'info' : 'error', `${method} ${url} → ${response.status} (${ms}ms) ${bodyPreview}`.trim());
                    }
                    return response;
                } catch (error) {
                    const ms = Date.now() - startedAt;
                    append('error', `${method} ${url} → ERROR DE RED (${ms}ms) ${error && error.message ? error.message : error}`);
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
                append('info', `WS → conectando ${shortUrl}${isDeepgram ? ' (Deepgram)' : ''}`);
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
                                    append('info', `WS send audio #${sentChunks} (${size}B, total ${sentBytes}B) ${shortUrl}`);
                                }
                            } else if (typeof payload === 'string') {
                                append('info', `WS send texto: ${payload.slice(0, 120)}`);
                            }
                        } catch (error) { /* ignore */ }
                        return originalSend(payload);
                    };
                } catch (error) { /* ignore */ }
                ws.addEventListener('open', () => append('info', `WS ✓ abierto ${shortUrl}`));
                ws.addEventListener('error', () => append('error', `WS ✗ error ${shortUrl}`));
                ws.addEventListener('close', (event) => {
                    append(event.code === 1000 ? 'info' : 'error',
                        `WS ✗ cerrado code=${event.code} reason="${event.reason || ''}" enviados=${sentChunks}chunks/${sentBytes}B recibidos=${messageCount}msgs finales=${finalCount} ${shortUrl}`);
                });
                ws.addEventListener('message', (event) => {
                    messageCount += 1;
                    if (!isDeepgram) return;
                    let data = null;
                    try { data = JSON.parse(event.data); } catch (error) { return; }
                    if (data && data.type && data.type !== 'Results') {
                        const dump = JSON.stringify(data);
                        append('info', `WS Deepgram ${data.type}: ${dump.length > 600 ? `${dump.slice(0, 600)}…` : dump}`);
                        return;
                    }
                    const alt = data && data.channel && Array.isArray(data.channel.alternatives) ? data.channel.alternatives[0] : null;
                    const transcript = alt && typeof alt.transcript === 'string' ? alt.transcript : '';
                    if (data && data.is_final && transcript) {
                        finalCount += 1;
                        append('info', `WS Deepgram FINAL #${finalCount}: "${transcript}"`);
                    } else if (messageCount <= 4) {
                        append('info', `WS Deepgram msg#${messageCount} is_final=${data && data.is_final} transcript="${transcript}"`);
                    }
                });
                return ws;
            };
            WrappedWebSocket.prototype = OriginalWebSocket.prototype;
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => { WrappedWebSocket[key] = OriginalWebSocket[key]; });
            WrappedWebSocket.__miracleWrapped = true;
            try { window.WebSocket = WrappedWebSocket; } catch (error) { /* ignore */ }
        }

        append('info', 'Dev logs activos (consola, errores, fetch /api/voice·medical·clinical y WebSocket Deepgram).');
    }

    function copyLogs() {
        const text = logEntries.map((entry) => `${entry.t} ${entry.level.toUpperCase()} ${entry.message}`).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                () => { if (toggleButton) toggleButton.textContent = 'Copiado'; setTimeout(updateBadge, 1200); },
                () => {}
            );
        }
    }

    function clearLogs() {
        logEntries.length = 0;
        if (listEl) listEl.textContent = '';
        updateBadge();
    }

    function installStyles() {
        if (document.getElementById('miracle-dev-logs-styles')) return;
        const style = document.createElement('style');
        style.id = 'miracle-dev-logs-styles';
        style.textContent = `
            .mdl-toggle {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483000;
                padding: 9px 14px;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 999px;
                background: #0b1220;
                color: #e2e8f0;
                font: 700 12px/1 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
                cursor: pointer;
                box-shadow: 0 12px 30px rgba(2,8,20,0.35);
            }
            .mdl-toggle[data-errors="true"] { background: #7f1d1d; color: #fff; }
            .mdl-panel {
                position: fixed;
                right: 16px;
                bottom: 60px;
                z-index: 2147483000;
                width: min(600px, calc(100vw - 32px));
                max-height: min(60vh, 560px);
                display: flex;
                flex-direction: column;
                border: 1px solid rgba(15,23,42,0.2);
                border-radius: 14px;
                background: #0b1220;
                color: #e2e8f0;
                box-shadow: 0 24px 60px rgba(2,8,20,0.45);
                overflow: hidden;
            }
            .mdl-panel[hidden] { display: none; }
            .mdl-bar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                background: rgba(255,255,255,0.06);
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            .mdl-bar strong { flex: 1; font: 700 12px/1.1 Inter, system-ui, sans-serif; color: #f8fafc; }
            .mdl-bar button {
                border: 0;
                border-radius: 8px;
                padding: 6px 10px;
                background: rgba(255,255,255,0.12);
                color: #e2e8f0;
                font: 700 11px/1 Inter, system-ui, sans-serif;
                cursor: pointer;
            }
            .mdl-list {
                flex: 1;
                overflow-y: auto;
                padding: 8px 10px;
                font: 11px/1.5 "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .mdl-row { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .mdl-info { color: #cbd5e1; }
            .mdl-warn { color: #fbbf24; }
            .mdl-error { color: #fca5a5; }
        `;
        document.head.appendChild(style);
    }

    function mount() {
        if (toggleButton || !document.body) return;
        installStyles();

        toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'mdl-toggle';
        toggleButton.textContent = 'Logs';
        toggleButton.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden && listEl) listEl.scrollTop = listEl.scrollHeight;
        });

        panel = document.createElement('div');
        panel.className = 'mdl-panel';
        panel.hidden = true;

        const bar = document.createElement('div');
        bar.className = 'mdl-bar';
        const barTitle = document.createElement('strong');
        barTitle.textContent = 'Dev logs';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copiar';
        copyBtn.addEventListener('click', copyLogs);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Limpiar';
        clearBtn.addEventListener('click', clearLogs);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Cerrar';
        closeBtn.addEventListener('click', () => { panel.hidden = true; });
        bar.append(barTitle, copyBtn, clearBtn, closeBtn);

        listEl = document.createElement('div');
        listEl.className = 'mdl-list';
        logEntries.forEach(renderEntry);

        panel.append(bar, listEl);
        document.body.append(toggleButton, panel);
        updateBadge();
    }

    installCapture();

    if (document.body) {
        mount();
    } else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
    }

    window.MiracleDevLogs = {
        toggle() { if (panel) panel.hidden = !panel.hidden; },
        entries() { return logEntries.slice(); }
    };
})();
