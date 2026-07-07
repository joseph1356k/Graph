(function () {
    const DEFAULTS = {
        workflowDescription: '',
        title: 'Trainer',
        aiPlaceholder: 'Pide a Miracle ejecutar un flujo guardado',
        autoSyncStatus: true,
        apiBaseUrl: '',
        miracleBaseUrl: '',
        adapter: null,
        assistantProfile: null,
        assistantRuntime: {
            name: 'Miracle',
            accentColor: '#0f5f8c',
            idleMessage: 'Puedo ayudarte con esta pagina cuando quieras.'
        }
    };

    const LONG_PRESS_MS = 650;

    let options = { ...DEFAULTS };
    let agentHistory = [];
    let mounted = false;
    let workflowPanelLoaded = false;
    let authLifecycleBound = false;
    let runtimeTouchBound = false;
    let workflowOverlayVisible = false;
    let workflowOverlayWorkflow = null;
    let surfaceProfileHydration = null;
    let workflowPanelEntries = [];
    const executionState = {
        running: false,
        cancelRequested: false,
        workflowId: ''
    };
    const miracleNoteState = {
        visible: false,
        active: false,
        busy: false,
        socket: null,
        streamSession: null,
        mediaRecorder: null,
        mediaRecorderStopped: null,
        mediaStream: null,
        finalizeQuietTimer: null,
        timesliceMs: 250,
        voiceSessionId: '',
        eventSequence: 0,
        finalSegmentCount: 0,
        committedTranscript: '',
        pendingDraft: '',
        noteContent: '',
        noteTitle: 'Hoja en blanco',
        diagnosisSuggestions: [],
        diagnosisReviewNotice: '',
        diagnosisStatus: '',
        diagnosisError: '',
        diagnosisBusy: false,
        diagnosisSourceContent: '',
        diagnosisRequestId: 0,
        dictationStartedAt: 0,
        fillSummary: '',
        undoAvailable: false
    };
    const EXECUTION_STORAGE_PREFIX = 'graph-browser-workflow-execution-v1';
    const MIRACLE_FIRST_OPEN_STORAGE_KEY = 'miracle-floating-assistant-first-open-v1';
    const EXECUTION_WAIT_TIMEOUT_MS = 15000;
    const EXECUTION_STEP_DELAY_MS = 180;
    const trustedHtmlPolicy = (() => {
        if (!window.trustedTypes?.createPolicy) {
            return null;
        }
        try {
            return window.trustedTypes.createPolicy('graph-trainer-plugin-html', {
                createHTML(value) {
                    return value;
                }
            });
        } catch (error) {
            return null;
        }
    })();


    function lifecycleLog(scope, message, details = null) {
        const normalizedScope = `${scope || ''}`.trim() || 'page';
        const detailPayload = {
            level: 'info',
            scope: normalizedScope,
            message: `${message || 'lifecycle_event'}`.trim() || 'lifecycle_event',
            details: details && typeof details === 'object' ? details : null
        };

        try {
            document.dispatchEvent(new CustomEvent('graph-trainer-extension-log', {
                detail: detailPayload
            }));
        } catch (error) {
            // Ignore logging bridge issues.
        }

        try {
            window.postMessage({
                source: 'graph-trainer-extension',
                type: 'log',
                detail: detailPayload
            }, '*');
        } catch (error) {
            // Ignore logging bridge issues.
        }
    }

    function setElementHtml(element, html) {
        if (!element) {
            return;
        }
        const safeHtml = trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(html) : html;
        element.innerHTML = safeHtml;
    }

    function pluginHost() {
        return options?.host
            || window.GraphPluginHost?.createHost?.(options)
            || null;
    }

    async function waitForAuthReady() {
        try {
            if (window.MiracleAuth && typeof window.MiracleAuth.whenAuthenticated === 'function') {
                await window.MiracleAuth.whenAuthenticated();
            }
        } catch (error) { /* ignore */ }
    }


    function runtime() {
        return window.GraphAssistantRuntime || null;
    }

    function pluginEvents() {
        return window.GraphPluginEvents || null;
    }

    function emitPluginEvent(eventName, payload) {
        pluginEvents()?.emit?.(eventName, payload || {});
    }

    function surfaceProfileClient() {
        return window.GraphPluginSurfaceProfileClient?.create?.({
            getOptions: () => options,
            setOptions: (nextOptions) => {
                options = nextOptions || options;
            },
            getDefaults: () => DEFAULTS,
            runtime,
            requireApiClient,
            emitPluginEvent
        }) || null;
    }

    function requireSurfaceProfileClient() {
        const client = surfaceProfileClient();
        if (!client) {
            throw new Error('No hay cliente de surface profile configurado para este plugin.');
        }
        return client;
    }

    function executionClient() {
        return window.GraphPluginExecutionClient?.create?.({
            getOptions: () => options,
            getPluginHost: pluginHost,
            runtime,
            emitPluginEvent,
            updateWorkflowPanelStatus,
            executionState,
            executionStoragePrefix: EXECUTION_STORAGE_PREFIX,
            waitTimeoutMs: EXECUTION_WAIT_TIMEOUT_MS,
            stepDelayMs: EXECUTION_STEP_DELAY_MS,
            requestRuntimeIntelligence: (workflowId, payload) => requireApiClient().requestExecutionIntelligence(workflowId, payload)
        }) || null;
    }

    function requireExecutionClient() {
        const client = executionClient();
        if (!client) {
            throw new Error('No hay cliente de ejecucion configurado para este plugin.');
        }
        return client;
    }

    function learningClient() {
        return window.GraphPluginLearningClient?.create?.({
            getOptions: () => options,
            runtime,
            getPageContext,
            emitPluginEvent,
            markWorkflowPanelDirty: () => {
                workflowPanelLoaded = false;
            }
        }) || null;
    }

    function requireLearningClient() {
        const client = learningClient();
        if (!client) {
            throw new Error('No hay cliente de aprendizaje configurado para este plugin.');
        }
        return client;
    }


    function trainerShell() {
        return window.GraphPluginTrainerShell?.create?.({
            runtime,
            longPressMs: LONG_PRESS_MS,
            isWorkflowOverlayVisible: () => workflowOverlayVisible,
            renderWorkflowOverlay,
            loadWorkflowPanel,
            executeWorkflowFromPanel,
            getWorkflowEntryById,
            toggleWorkflowOverlay,
            hideWorkflowOverlay,
            deleteWorkflowFromPanel,
            markWorkflowPanelDirty: () => {
                workflowPanelLoaded = false;
            },
            onStartWorkflow: startWorkflow,
            onStopWorkflow: stopWorkflow,
            onStopWorkflowExecution: stopWorkflowExecution,
            onWorkflowRecordingCheck: () => window.WorkflowRecorder.isRecording()
        }) || null;
    }

    function requireTrainerShell() {
        const shell = trainerShell();
        if (!shell) {
            throw new Error('No hay trainer shell configurado para este plugin.');
        }
        return shell;
    }

    function getSurfaceAdapter() {
        return options?.adapter || window.GraphPluginAdapters?.resolve?.(options) || null;
    }

    function buildMountOptions(config = {}) {
        const adapter = window.GraphPluginAdapters?.resolve?.(config) || null;
        const adapterDefaults = adapter?.mountDefaults || {};
        const host = window.GraphPluginHost?.createHost?.({
            ...adapterDefaults,
            ...config
        }) || null;
        return {
            ...DEFAULTS,
            ...adapterDefaults,
            ...config,
            assistantRuntime: {
                ...DEFAULTS.assistantRuntime,
                ...(adapterDefaults.assistantRuntime || {}),
                ...(config.assistantRuntime || {})
            },
            assistantProfile: config.assistantProfile || adapterDefaults.assistantProfile || DEFAULTS.assistantProfile,
            adapter,
            host
        };
    }

    function apiClient() {
        return window.GraphPluginApi?.createClient?.({
            baseUrl: pluginHost()?.apiBaseUrl || options.apiBaseUrl || '',
            miracleBaseUrl: options.miracleBaseUrl || pluginHost()?.apiBaseUrl || options.apiBaseUrl || DEFAULTS.miracleBaseUrl,
            fetchImpl: pluginHost()?.fetchImpl || null
        }) || null;
    }

    function requireApiClient() {
        const client = apiClient();
        if (!client) {
            throw new Error('No hay cliente API configurado para este plugin.');
        }
        return client;
    }

    function recordUsageEvent(payload = {}) {
        const client = apiClient();
        if (!client || typeof client.recordUsageEvent !== 'function') {
            return Promise.resolve(null);
        }
        return client.recordUsageEvent(payload).catch(() => null);
    }

    async function persistLearningContextNote(note) {
        return requireSurfaceProfileClient().persistLearningContextNote(note);
    }

    function getPageContext() {
        return requireSurfaceProfileClient().getPageContext();
    }

    function isGenericWorkflowDescription(value) {
        return requireSurfaceProfileClient().isGenericWorkflowDescription(value);
    }

    function applySurfaceProfileToOptions(surfaceProfile) {
        return requireSurfaceProfileClient().applySurfaceProfileToOptions(surfaceProfile);
    }

    async function hydrateSurfaceProfile() {
        if (surfaceProfileHydration) {
            return surfaceProfileHydration;
        }
        surfaceProfileHydration = requireSurfaceProfileClient().hydrateSurfaceProfile();
        return surfaceProfileHydration;
    }

    function ensureStyles() {
        if (document.getElementById('trainer-plugin-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'trainer-plugin-styles';
        style.textContent = `
            .console {
                position: fixed;
                left: 50%;
                bottom: 18px;
                transform: translateX(-50%);
                width: auto;
                min-width: 124px;
                padding: 10px 12px;
                z-index: 50;
                background: rgba(255,255,255,0.95);
                backdrop-filter: blur(18px);
                display: grid;
                gap: 10px;
                justify-items: center;
                border-radius: 999px;
                transition: width 180ms ease, border-radius 180ms ease, padding 180ms ease, opacity 180ms ease, transform 180ms ease;
                border: 1px solid rgba(24, 39, 53, 0.12);
                box-shadow: 0 20px 48px rgba(16, 31, 44, 0.12);
            }
            body[data-assistant-expanded="false"] .console {
                opacity: 0;
                pointer-events: none;
                transform: translateX(-50%) translateY(12px) scale(0.94);
            }
            .console.compact-open {
                border-radius: 24px;
                width: min(560px, calc(100vw - 24px));
            }
            .console-toolbar {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                position: relative;
                width: 100%;
                padding-top: 6px;
            }
            .console button.icon-btn {
                width: 46px;
                height: 46px;
                border-radius: 999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                flex: 0 0 auto;
                border: none;
                cursor: pointer;
                font: inherit;
            }
            .console button.icon-btn svg {
                width: 20px;
                height: 20px;
            }
            .console button.execution-stop-btn {
                background: #c62828;
                color: #ffffff;
            }
            .console button.execution-stop-btn[hidden] {
                display: none;
            }
            #btn-record-toggle[data-recording="true"] {
                background: #bbf7d0;
                color: #111111;
            }
            #btn-record-toggle[data-recording="false"] {
                background: #111111;
                color: white;
            }
            .console-chat,
            .workflow-panel {
                display: none;
                width: 100%;
            }
            .console-chat.open,
            .workflow-panel.open {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .console-chat-log {
                max-height: 220px;
                overflow: auto;
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding-right: 4px;
            }
            .chat-bubble {
                white-space: pre-wrap;
                line-height: 1.45;
                font-size: 13px;
                padding: 10px 12px;
                border-radius: 14px;
                background: #f5f8fb;
                color: #1d2a33;
            }
            .chat-bubble.user {
                background: #ffffff;
                color: #102033;
                align-self: flex-end;
                box-shadow: 0 20px 44px rgba(5, 10, 20, 0.14);
            }
            .chat-meta {
                display: block;
                margin-top: 6px;
                font-size: 11px;
                opacity: 0.8;
            }
            .voice-status {
                min-height: 18px;
                color: #526170;
                font-size: 12px;
                line-height: 1.4;
            }
            .workflow-panel {
                padding-top: 2px;
            }
            .workflow-panel-header,
            .workflow-panel-empty,
            .workflow-panel-status {
                color: #1d2a33;
                font-size: 13px;
            }
            .workflow-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .workflow-panel-header strong {
                font-size: 14px;
            }
            .workflow-panel-header button,
            .workflow-item-actions button {
                border: none;
                border-radius: 999px;
                padding: 8px 12px;
                cursor: pointer;
                font: inherit;
                font-size: 12px;
                font-weight: 700;
            }
            .workflow-panel-header button {
                width: 34px;
                height: 34px;
                padding: 0;
                border-radius: 999px;
                background: #ffffff;
                color: #111111;
                box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.08);
            }
            .workflow-panel-list {
                max-height: 260px;
                overflow: auto;
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding-right: 4px;
            }
            .workflow-item {
                border: 1px solid #d8e2ec;
                border-radius: 16px;
                padding: 12px;
                background: #f9fbfd;
                display: grid;
                gap: 8px;
            }
            .workflow-item-title {
                margin: 0;
                font-size: 13px;
                font-weight: 800;
                color: #1b2733;
            }
            .workflow-item-meta {
                font-size: 12px;
                color: #526170;
                line-height: 1.45;
            }
            .workflow-item-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .workflow-item-actions button {
                min-width: 40px;
                height: 40px;
                padding: 0 12px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .workflow-item-actions button svg {
                width: 16px;
                height: 16px;
                flex: 0 0 auto;
            }
            .workflow-item-actions .run-btn {
                background: #0f5f8c;
                color: white;
            }
            .workflow-item-actions .view-btn {
                background: #eef4f8;
                color: #21415a;
            }
            .workflow-item-actions .delete-btn {
                background: #fff1f1;
                color: #b42318;
            }
            .sr-only {
                position: absolute;
                width: 1px;
                height: 1px;
                padding: 0;
                margin: -1px;
                overflow: hidden;
                clip: rect(0, 0, 0, 0);
                white-space: nowrap;
                border: 0;
            }
            .feedback-overlay {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 2147482998;
            }
            .feedback-overlay[hidden] {
                display: none;
            }
            .feedback-pin {
                position: absolute;
                transform: translate(-10px, -10px);
                display: grid;
                gap: 10px;
                align-items: start;
                max-width: min(320px, calc(100vw - 40px));
            }
            .feedback-pin[data-side="left"] {
                justify-items: end;
            }
            .feedback-dot {
                width: 24px;
                height: 24px;
                border-radius: 999px;
                background: linear-gradient(180deg, #111827 0%, #374151 100%);
                color: white;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: -0.02em;
                box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
                border: 1px solid rgba(255, 255, 255, 0.9);
            }
            .feedback-card {
                pointer-events: auto;
                background: rgba(255, 255, 255, 0.82);
                backdrop-filter: blur(18px);
                border: 1px solid rgba(255, 255, 255, 0.7);
                border-radius: 22px;
                padding: 14px 16px;
                box-shadow: 0 28px 56px rgba(15, 23, 42, 0.16);
                color: #111827;
                line-height: 1.55;
            }
            .feedback-card-eyebrow {
                display: inline-flex;
                align-items: center;
                width: fit-content;
                margin-bottom: 8px;
                padding: 5px 10px;
                border-radius: 999px;
                background: rgba(248, 250, 252, 0.96);
                border: 1px solid rgba(148, 163, 184, 0.16);
                color: #64748b;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            .feedback-card strong {
                display: block;
                font-size: 15px;
                font-weight: 700;
                letter-spacing: -0.02em;
                margin-bottom: 8px;
            }
            .feedback-card blockquote {
                margin: 0;
                padding: 0;
                display: block;
                font-size: 13px;
                color: #475569;
                line-height: 1.6;
            }
            .feedback-card small {
                display: block;
                margin-top: 10px;
                font-size: 11px;
                color: #111827;
                line-height: 1.55;
            }
            @media (max-width: 768px) {
                .feedback-pin {
                    max-width: min(240px, calc(100vw - 32px));
                }
                .feedback-card {
                    padding: 12px 13px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureConsole() {
        let consoleEl = document.getElementById('teaching-console');
        if (consoleEl) {
            return consoleEl;
        }

        consoleEl = document.createElement('section');
        consoleEl.className = 'console';
        consoleEl.id = 'teaching-console';
        setElementHtml(consoleEl, `
            <div class="workflow-panel" id="workflow-panel" aria-live="polite">
                <div class="workflow-panel-header">
                    <div>
                        <strong>Workflows aprendidos</strong>
                        <div class="workflow-panel-status" id="workflow-panel-status">Manten el lapiz oprimido para ver los flujos aprendidos.</div>
                    </div>
                    <button id="workflow-panel-close" type="button" aria-label="Cerrar workflows">×</button>
                </div>
                <div class="workflow-panel-list" id="workflow-panel-list"></div>
                <div class="workflow-panel-empty" id="workflow-panel-empty" hidden>No hay workflows grabados para esta pagina todavia.</div>
            </div>
            <div class="console-chat" id="console-chat">
                <div class="console-chat-log" id="console-chat-log" aria-live="polite" aria-label="AI chat messages"></div>
                <div class="voice-status" id="voice-status"></div>
            </div>
            <div class="console-toolbar">
                <button class="icon-btn" id="btn-record-toggle" type="button" title="Grabar workflow" aria-label="Grabar workflow" aria-pressed="false" data-recording="false"></button>
                <button class="icon-btn execution-stop-btn" id="btn-stop-execution" type="button" title="Detener automatizacion" aria-label="Detener automatizacion" hidden>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" fill="currentColor"/></svg>
                </button>
            </div>
            <input id="wf-desc" class="sr-only" value="">
            <textarea id="step-explanation" class="sr-only"></textarea>
            <div id="recording-status" class="sr-only">Idle</div>
            <button id="btn-start" class="sr-only" type="button">Start</button>
            <button id="btn-stop" class="sr-only" type="button">Stop</button>
        `);
        document.body.appendChild(consoleEl);
        return consoleEl;
    }

    function ensureWorkflowOverlay() {
        let overlay = document.getElementById('workflow-overlay');
        if (overlay) {
            return overlay;
        }

        overlay = document.createElement('div');
        overlay.className = 'feedback-overlay';
        overlay.id = 'workflow-overlay';
        overlay.hidden = true;
        document.body.appendChild(overlay);
        return overlay;
    }

    function updateConsoleExpandedState() {
        return requireTrainerShell().updateConsoleExpandedState();
    }

    function closeWorkflowPanel() {
        return requireTrainerShell().closeWorkflowPanel();
    }

    function openChatPanel() {
        return requireTrainerShell().openChatPanel();
    }

    function openWorkflowPanel() {
        return requireTrainerShell().openWorkflowPanel();
    }

    function toggleWorkflowPanel() {
        return requireTrainerShell().toggleWorkflowPanel();
    }

    function escapeHtml(value) {
        return `${value || ''}`
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function resolveOverlayAnchors(items) {
        return (items || []).map((item, index) => {
            let element = document.body;
            if (item?.selector) {
                try {
                    element = document.querySelector(item.selector) || document.body;
                } catch (error) {
                    element = document.body;
                }
            }
            const rect = element.getBoundingClientRect();
            const safeHeight = Math.max(rect.height, 24);
            const safeWidth = Math.max(rect.width, 24);
            const top = rect.top + window.scrollY + Math.min(safeHeight * 0.22, safeHeight - 12);
            const left = rect.left + window.scrollX + Math.min(safeWidth * 0.12, safeWidth - 12);
            const side = rect.left > window.innerWidth * 0.56 ? 'left' : 'right';

            return {
                ...item,
                order: index + 1,
                top,
                left,
                side
            };
        });
    }

    function renderCardsOverlay(overlay, entries) {
        if (!overlay) {
            return;
        }
        overlay.style.width = `${Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)}px`;
        overlay.style.height = `${Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)}px`;
        overlay.replaceChildren();

        entries.forEach((entry) => {
            const item = document.createElement('div');
            item.className = 'feedback-pin';
            item.dataset.side = entry.side;
            item.style.top = `${entry.top}px`;
            item.style.left = `${entry.left}px`;
            setElementHtml(item, `
                <div class="feedback-dot">${entry.order}</div>
                <div class="feedback-card">
                    <div class="feedback-card-eyebrow">${escapeHtml(entry.area || 'Momento detectado')}</div>
                    <strong>${escapeHtml(entry.title || 'Comentario')}</strong>
                    <blockquote>${escapeHtml(entry.evidence || entry.summary || '')}</blockquote>
                    <small>${escapeHtml(entry.opportunity || '')}</small>
                </div>
            `);
            overlay.appendChild(item);
        });
    }

    function getWorkflowOverlayItems(workflow) {
        return window.GraphWorkflowOverlayBridge?.buildOverlayItems?.(workflow || null) || [];
    }

    function renderWorkflowOverlay() {
        if (!workflowOverlayWorkflow) {
            return;
        }
        renderCardsOverlay(ensureWorkflowOverlay(), resolveOverlayAnchors(getWorkflowOverlayItems(workflowOverlayWorkflow)));
    }

    function showWorkflowOverlay(workflow) {
        if (!workflow) {
            return;
        }
        workflowOverlayVisible = true;
        workflowOverlayWorkflow = workflow;
        renderWorkflowOverlay();
        ensureWorkflowOverlay().hidden = false;
        updateWorkflowPanelStatus(`Mostrando pasos de ${workflow.description || workflow.id}.`);
    }

    function hideWorkflowOverlay() {
        workflowOverlayVisible = false;
        workflowOverlayWorkflow = null;
        ensureWorkflowOverlay().hidden = true;
    }

    function toggleWorkflowOverlay(workflow) {
        if (workflowOverlayVisible && workflowOverlayWorkflow?.id === workflow?.id) {
            hideWorkflowOverlay();
            return false;
        }
        showWorkflowOverlay(workflow);
        return true;
    }

    function appendAgentMessage(role, text, meta, pushHistory = true, options = {}) {
        const agentChatLog = document.getElementById('console-chat-log');
        if (!agentChatLog) return;

        if (pushHistory) {
            agentHistory.push({ role, content: text });
        }

        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'assistant'}`;
        bubble.textContent = text;

        if (meta) {
            const metaEl = document.createElement('span');
            metaEl.className = 'chat-meta';
            metaEl.textContent = meta;
            bubble.appendChild(metaEl);
        }

        agentChatLog.appendChild(bubble);
        agentChatLog.scrollTop = agentChatLog.scrollHeight;

        if (role === 'assistant' && text) {
            const shouldSpeakAudibly = options.audible === undefined
                ? true
                : Boolean(options.audible);
            runtime()?.speak(text, { mode: 'assistant', audible: shouldSpeakAudibly });
        } else if (role === 'user' && text) {
            runtime()?.showUserSpeech?.(text);
        }
    }

    function isPageExecutionFunctionName(functionName) {
        const normalized = `${functionName || ''}`.trim();
        return normalized === 'execute_workflow_on_page'
            || normalized === 'execute_reservation_on_page';
    }

    function statusField() {
        return document.getElementById('recording-status');
    }

    function updateWorkflowPanelStatus(text) {
        return requireTrainerShell().updateWorkflowPanelStatus(text);
    }

    function updateVoiceStatus(text) {
        return requireTrainerShell().updateVoiceStatus(text);
    }

    function setVoiceButton(active) {
        return requireTrainerShell().setVoiceButton(active);
    }

    function setExecutionStopButtonVisible(active) {
        return requireTrainerShell().setExecutionStopButtonVisible(active);
    }

    function syncMiracleNotePanel(statusText = null, options = {}) {
        runtime()?.setNotePanelState?.({
            visible: miracleNoteState.visible,
            title: miracleNoteState.noteTitle,
            content: miracleNoteState.noteContent,
            forceContentUpdate: Boolean(options.forceContentUpdate),
            status: statusText !== null ? statusText : undefined,
            recording: miracleNoteState.active,
            busy: miracleNoteState.busy,
            diagnosisSuggestions: miracleNoteState.diagnosisSuggestions,
            diagnosisReviewNotice: miracleNoteState.diagnosisReviewNotice,
            diagnosisStatus: miracleNoteState.diagnosisStatus,
            diagnosisError: miracleNoteState.diagnosisError,
            diagnosisBusy: miracleNoteState.diagnosisBusy,
            fillSummary: miracleNoteState.fillSummary,
            undoAvailable: miracleNoteState.undoAvailable,
            diagnosisDisabled: !miracleNoteState.noteContent.trim()
                || miracleNoteState.active
                || miracleNoteState.busy
                || miracleNoteState.diagnosisBusy
        });
    }

    function clearMiracleDiagnosisSuggestions() {
        miracleNoteState.diagnosisRequestId += 1;
        miracleNoteState.diagnosisSuggestions = [];
        miracleNoteState.diagnosisReviewNotice = '';
        miracleNoteState.diagnosisStatus = '';
        miracleNoteState.diagnosisError = '';
        miracleNoteState.diagnosisBusy = false;
        miracleNoteState.diagnosisSourceContent = '';
    }

    function updateMiracleNoteContent(content) {
        const nextContent = `${content || ''}`;
        if (nextContent !== miracleNoteState.noteContent) {
            clearMiracleDiagnosisSuggestions();
        }
        miracleNoteState.noteContent = nextContent;
    }

    function formatMiracleFillSummary(detail = {}) {
        const completedCount = Math.max(0, Number(detail.completedCount) || 0);
        const confirmationCount = Math.max(0, Number(detail.confirmationCount) || 0);
        const completedLabel = completedCount === 1 ? '1 campo completado' : `${completedCount} campos completados`;
        const confirmationLabel = confirmationCount === 1
            ? '1 campo requiere confirmacion'
            : `${confirmationCount} campos requieren confirmacion`;
        return `Nota lista para revisar. ${completedLabel}. ${confirmationLabel}.`;
    }

    function updateMiracleFillSummary(detail = {}) {
        miracleNoteState.fillSummary = formatMiracleFillSummary(detail);
        miracleNoteState.undoAvailable = Boolean(detail.undoAvailable ?? miracleDynamicFillSession?.canUndoLastFill?.());
        syncMiracleNotePanel('Nota lista para revisar.');
    }

    async function requestMiracleDiagnosisSuggestions() {
        const editor = document.getElementById('graph-assistant-note-editor');
        const noteContent = `${miracleNoteState.noteContent || editor?.innerText || ''}`;

        if (!noteContent.trim()) {
            miracleNoteState.diagnosisError = 'Escribe o dicta información clínica antes de solicitar sugerencias.';
            syncMiracleNotePanel();
            return;
        }
        if (miracleNoteState.active || miracleNoteState.busy) {
            miracleNoteState.diagnosisError = 'Detén el dictado antes de solicitar sugerencias.';
            syncMiracleNotePanel();
            return;
        }

        const requestId = miracleNoteState.diagnosisRequestId + 1;
        miracleNoteState.diagnosisRequestId = requestId;
        miracleNoteState.diagnosisBusy = true;
        miracleNoteState.diagnosisError = '';
        miracleNoteState.diagnosisStatus = 'Generando sugerencias para revisión médica...';
        miracleNoteState.diagnosisSuggestions = [];
        miracleNoteState.diagnosisReviewNotice = '';
        miracleNoteState.diagnosisSourceContent = noteContent;
        syncMiracleNotePanel();

        try {
            const payload = await requireApiClient().requestDiagnosisSuggestions(noteContent);
            const currentContent = `${miracleNoteState.noteContent || ''}`;
            if (requestId !== miracleNoteState.diagnosisRequestId || currentContent !== noteContent) {
                return;
            }
            miracleNoteState.diagnosisSuggestions = Array.isArray(payload?.suggestions)
                ? payload.suggestions
                : [];
            miracleNoteState.diagnosisReviewNotice = miracleNoteState.diagnosisSuggestions.length > 0
                ? `${payload?.reviewNotice || ''}`
                : '';
            miracleNoteState.diagnosisStatus = miracleNoteState.diagnosisSuggestions.length > 0
                ? ''
                : 'La nota no contiene información suficiente para sugerir un diagnóstico diferencial.';
        } catch (error) {
            if (requestId !== miracleNoteState.diagnosisRequestId) {
                return;
            }
            miracleNoteState.diagnosisError = error.message || 'No fue posible generar sugerencias diagnósticas.';
            miracleNoteState.diagnosisStatus = '';
        } finally {
            if (requestId === miracleNoteState.diagnosisRequestId) {
                miracleNoteState.diagnosisBusy = false;
                syncMiracleNotePanel();
            }
        }
    }

    function mergeMiracleTranscript(base, addition) {
        const next = `${addition || ''}`.trim();
        if (!next) {
            return `${base || ''}`.trim();
        }
        if (!`${base || ''}`.trim()) {
            return next;
        }
        return `${`${base || ''}`.trim()} ${next}`;
    }

    async function sendMiracleFinalSegment(transcript, language) {
        const trimmedTranscript = `${transcript || ''}`.trim();
        if (!trimmedTranscript) {
            return;
        }

        if (!miracleNoteState.voiceSessionId) {
            miracleNoteState.voiceSessionId = crypto.randomUUID();
        }

        miracleNoteState.eventSequence += 1;
        miracleNoteState.finalSegmentCount += 1;
        syncMiracleNotePanel('Miracle esta organizando la nota...');
        runtime()?.speak('Organizando la nota.', { mode: 'organizing' });

        const segmentId = `graph_seg_${miracleNoteState.finalSegmentCount}`;
        recordUsageEvent({
            sourceRepo: 'miracle',
            eventType: 'miracle_segment_submitted',
            provider: 'miracle',
            apiFamily: 'voice_orchestration',
            sessionId: miracleNoteState.voiceSessionId,
            segmentId,
            feature: 'dictation_note_fill',
            status: 'submitted',
            metadata: {
                language: language || '',
                transcriptLength: trimmedTranscript.length,
                noteLength: `${miracleNoteState.noteContent || ''}`.length
            }
        });
        lifecycleLog('voice', 'Miracle note segment submitted for organization.', {
            sessionId: miracleNoteState.voiceSessionId,
            segmentId,
            transcriptLength: trimmedTranscript.length,
            noteLength: `${miracleNoteState.noteContent || ''}`.length
        });

        let response;
        try {
            response = await requireApiClient().sendMiracleOrchestratorEvent({
                voice_session_id: miracleNoteState.voiceSessionId,
                note_path: null,
                note_title: miracleNoteState.noteTitle,
                note_content: miracleNoteState.noteContent,
                tab_id: window.location.href,
                event_id: `graph_evt_${miracleNoteState.eventSequence}`,
                sequence: miracleNoteState.eventSequence,
                segment: {
                    segment_id: segmentId,
                    kind: 'final',
                    transcript: trimmedTranscript,
                    language: language || null
                }
            });
        } catch (error) {
            lifecycleLog('voice', 'Miracle note organization failed.', {
                sessionId: miracleNoteState.voiceSessionId,
                segmentId,
                message: error?.message || 'Unknown organization error'
            });
            throw error;
        }

        updateMiracleNoteContent(response?.resolved_note_content || '');
        lifecycleLog('voice', 'Miracle note organization completed.', {
            sessionId: miracleNoteState.voiceSessionId,
            segmentId,
            resolvedNoteLength: `${response?.resolved_note_content || ''}`.length,
            noteLength: `${miracleNoteState.noteContent || ''}`.length
        });
        recordUsageEvent({
            sourceRepo: 'miracle',
            eventType: 'miracle_note_resolved',
            provider: 'miracle',
            apiFamily: 'voice_orchestration',
            sessionId: miracleNoteState.voiceSessionId,
            segmentId,
            feature: 'dictation_note_fill',
            status: 'resolved',
            metadata: {
                resolvedNoteLength: `${response?.resolved_note_content || ''}`.length,
                noteLength: `${miracleNoteState.noteContent || ''}`.length
            }
        });
        if (response?.usage) {
            recordUsageEvent({
                sourceRepo: 'miracle',
                eventType: 'miracle_note_orchestration_usage',
                provider: response.usage.provider || 'openai',
                apiFamily: response.usage.api_family || response.usage.apiFamily || 'responses',
                model: response.usage.model || '',
                inputTokens: Number(response.usage.input_tokens ?? response.usage.inputTokens) || 0,
                outputTokens: Number(response.usage.output_tokens ?? response.usage.outputTokens) || 0,
                sessionId: miracleNoteState.voiceSessionId,
                segmentId,
                feature: 'dictation_note_fill',
                status: 'ok',
                metadata: {
                    totalTokens: Number(response.usage.total_tokens ?? response.usage.totalTokens) || 0,
                    backendStatus: response?.backend_status || '',
                    transcriptLength: trimmedTranscript.length,
                    resolvedNoteLength: `${response?.resolved_note_content || ''}`.length
                }
            });
        }
        syncMiracleNotePanel(miracleNoteState.noteContent ? 'Miracle organizo la nota.' : 'Segmento enviado a Miracle.', {
            forceContentUpdate: true
        });
        dispatchMiracleNoteToDynamicFill(miracleNoteState.noteContent);
    }

    let miracleDictationInstance = null;
    function miracleDictation() {
        if (miracleDictationInstance) {
            return miracleDictationInstance;
        }
        const engine = window.MiracleDeepgramDictation;
        if (!engine || typeof engine.create !== 'function') {
            throw new Error('El motor de dictado compartido (MiracleDeepgramDictation) no esta cargado.');
        }
        miracleDictationInstance = engine.create({
            createStreamSession: async () => {
                lifecycleLog('voice', 'Creating Miracle voice stream session.', {
                    appId: options.appId || '',
                    apiBaseUrl: pluginHost()?.apiBaseUrl || options.apiBaseUrl || '',
                    miracleBaseUrl: options.miracleBaseUrl || pluginHost()?.apiBaseUrl || options.apiBaseUrl || ''
                });
                try {
                    const session = await requireApiClient().createMiracleStreamSession();
                    lifecycleLog('voice', 'Miracle voice stream session created.', {
                        model: session?.model || session?.stream?.model || '',
                        hasWebsocketUrl: Boolean(session?.websocket_url || session?.websocketUrl)
                    });
                    return session;
                } catch (error) {
                    lifecycleLog('voice', 'Miracle voice stream session failed.', {
                        message: error?.message || 'Unknown stream-session error'
                    });
                    throw error;
                }
            },
            onDebug: (event, details) => {
                lifecycleLog('voice', `Miracle dictation debug: ${event}`, details || {});
                if (event === 'deepgram.session.created' && details && details.model) {
                    miracleNoteState.streamModel = details.model;
                }
            },
            onError: (message) => {
                lifecycleLog('voice', 'Miracle dictation error.', { message });
                syncMiracleNotePanel(message);
            },
            onUnexpectedClose: () => {
                lifecycleLog('voice', 'Miracle dictation stream closed unexpectedly.', {});
                miracleNoteState.active = false;
                miracleNoteState.busy = false;
                syncMiracleNotePanel('El stream de Miracle se cerro antes de tiempo.');
            },
            onPartialTranscript: (transcript) => {
                miracleNoteState.pendingDraft = transcript;
                syncMiracleNotePanel('Transcribiendo con Miracle...');
                runtime()?.speak('Escuchando.', { mode: 'listening' });
            },
            onFinalTranscript: (segment) => {
                miracleNoteState.committedTranscript = mergeMiracleTranscript(
                    miracleNoteState.committedTranscript,
                    segment.transcript
                );
                miracleNoteState.pendingDraft = '';
                syncMiracleNotePanel('Miracle esta organizando la nota...');
                sendMiracleFinalSegment(segment.transcript, segment.language || null).catch((error) => {
                    syncMiracleNotePanel(error.message || 'No pude enviar el segmento a Miracle.');
                });
            }
        });
        return miracleDictationInstance;
    }

    async function startMiracleNoteDictation() {
        miracleNoteState.busy = true;
        syncMiracleNotePanel('Preparando dictado con Miracle...');
        runtime()?.speak('Preparando dictado.', { mode: 'organizing' });
        try {
            lifecycleLog('voice', 'Starting Miracle note dictation.', {
                appId: options.appId || '',
                page: window.location.pathname
            });
            if (!miracleNoteState.voiceSessionId) {
                miracleNoteState.voiceSessionId = crypto.randomUUID();
            }
            miracleNoteState.committedTranscript = '';
            miracleNoteState.pendingDraft = '';
            miracleNoteState.finalSegmentCount = 0;
            miracleNoteState.fillSummary = '';
            miracleNoteState.undoAvailable = false;
            miracleNoteState.dictationStartedAt = Date.now();
            miracleNoteState.streamModel = '';
            await miracleDictation().start();
            recordUsageEvent({
                sourceRepo: 'miracle',
                eventType: 'deepgram_stream_started',
                provider: 'deepgram',
                apiFamily: 'streaming_stt',
                model: miracleNoteState.streamModel || '',
                sessionId: miracleNoteState.voiceSessionId,
                feature: 'dictation_note_fill',
                status: 'started'
            });
            miracleNoteState.active = true;
            syncMiracleNotePanel('Dictando hacia Miracle...');
            runtime()?.speak('Escuchando.', { mode: 'listening' });
        } catch (error) {
            lifecycleLog('voice', 'Miracle note dictation failed to start.', {
                message: error?.message || 'Unknown dictation start error'
            });
            throw error;
        } finally {
            miracleNoteState.busy = false;
            syncMiracleNotePanel(miracleNoteState.active ? 'Dictando hacia Miracle...' : 'Lista para dictado con Miracle.');
        }
    }

    async function stopMiracleNoteDictation() {
        miracleNoteState.busy = true;
        syncMiracleNotePanel('Cerrando dictado...');
        const streamModel = miracleNoteState.streamModel || '';
        const dictationStartedAt = miracleNoteState.dictationStartedAt || 0;
        const finalSegmentCount = miracleNoteState.finalSegmentCount || 0;
        try {
            await miracleDictation().stop();
            miracleNoteState.pendingDraft = '';
        } finally {
            miracleNoteState.active = false;
            miracleNoteState.busy = false;
            const durationMs = dictationStartedAt ? Math.max(0, Date.now() - dictationStartedAt) : 0;
            if (durationMs > 0) {
                recordUsageEvent({
                    sourceRepo: 'miracle',
                    eventType: 'deepgram_stream_completed',
                    provider: 'deepgram',
                    apiFamily: 'streaming_stt',
                    model: streamModel,
                    deepgramMinutes: durationMs / 60000,
                    sessionId: miracleNoteState.voiceSessionId,
                    durationMs,
                    feature: 'dictation_note_fill',
                    status: 'completed',
                    metadata: {
                        segmentCount: finalSegmentCount,
                        noteLength: `${miracleNoteState.noteContent || ''}`.length
                    }
                });
            }
            miracleNoteState.dictationStartedAt = 0;
            syncMiracleNotePanel(miracleNoteState.noteContent ? 'Dictado detenido.' : 'Lista para dictado con Miracle.');
            runtime()?.speak(miracleNoteState.noteContent ? 'Nota lista para revisar.' : 'Lista para dictado.', {
                mode: miracleNoteState.noteContent ? 'review' : 'idle'
            });
        }
    }

    let miracleDynamicFillSession = null;
    let miracleDynamicFillBootstrapPromise = null;
    let miracleNoteEditorBound = false;

    async function findWorkflowForCurrentPage() {
        try {
            const payload = await requireApiClient().listWorkflows();
            const filtered = filterWorkflowsForCurrentPage(payload?.workflows || []);
            if (filtered.length === 0) {
                return null;
            }
            const currentPath = normalizePathname(window.location.pathname);
            const exactPath = filtered.find((workflow) => {
                const pathname = normalizePathname(workflow?.sourcePathname || '');
                return pathname && currentPath && pathname === currentPath;
            });
            return exactPath || filtered[0] || null;
        } catch (error) {
            emitExtensionLog('warn', 'Could not list workflows for dynamic fill.', {
                message: error?.message || 'Unknown listWorkflows error'
            });
            return null;
        }
    }

    async function ensureMiracleDynamicFillSession() {
        if (miracleDynamicFillSession) {
            return miracleDynamicFillSession;
        }
        if (miracleDynamicFillBootstrapPromise) {
            return miracleDynamicFillBootstrapPromise;
        }
        miracleDynamicFillBootstrapPromise = (async () => {
            const workflow = await findWorkflowForCurrentPage();
            if (!workflow?.id) {
                return null;
            }
            let plan = null;
            try {
                plan = await fetchExecutionPlan(workflow.id);
            } catch (error) {
                emitExtensionLog('warn', 'Could not fetch execution plan for dynamic fill.', {
                    workflowId: workflow.id,
                    message: error?.message || 'Unknown plan error'
                });
                return null;
            }
            if (!plan) {
                return null;
            }
            const session = requireExecutionClient().createDynamicFillSession(plan, {
                requestNoteFieldMatches: (workflowId, payload) => requireApiClient().requestNoteFieldMatches(workflowId, payload),
                getSessionId: () => miracleNoteState.voiceSessionId || '',
                onMetric: (detail) => {
                    recordUsageEvent({
                        sourceRepo: 'graph',
                        provider: detail?.provider || 'graph',
                        apiFamily: detail?.apiFamily || 'internal',
                        model: detail?.model || '',
                        eventType: detail?.eventType || 'dynamic_fill_event',
                        inputTokens: Number(detail?.inputTokens) || 0,
                        outputTokens: Number(detail?.outputTokens) || 0,
                        sessionId: detail?.sessionId || miracleNoteState.voiceSessionId || '',
                        workflowId: detail?.workflowId || workflow.id,
                        stepOrder: detail?.stepOrder ?? null,
                        durationMs: detail?.durationMs ?? null,
                        feature: detail?.feature || 'dynamic_fill',
                        status: detail?.status || '',
                        metadata: detail?.metadata || {}
                    });
                },
                onFieldFilled: (detail) => {
                    emitPluginEvent('note.field.filled', detail);
                },
                onFillSummary: (detail) => {
                    updateMiracleFillSummary({
                        ...detail,
                        undoAvailable: session.canUndoLastFill?.()
                    });
                    emitPluginEvent('note.session.summary', detail);
                },
                onUndoStateChanged: (detail) => {
                    miracleNoteState.undoAvailable = Boolean(detail?.canUndo);
                    syncMiracleNotePanel();
                },
                onReadyToSubmit: (detail) => {
                    emitPluginEvent('note.session.ready_submit', detail);
                }
            });
            miracleDynamicFillSession = session;
            emitExtensionLog('info', 'Dynamic note fill session started.', {
                workflowId: workflow.id,
                stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0
            });
            return session;
        })().finally(() => {
            miracleDynamicFillBootstrapPromise = null;
        });
        return miracleDynamicFillBootstrapPromise;
    }

    function stopMiracleDynamicFillSession() {
        if (miracleDynamicFillSession) {
            miracleDynamicFillSession.stop();
            miracleDynamicFillSession = null;
            miracleNoteState.undoAvailable = false;
            emitExtensionLog('info', 'Dynamic note fill session stopped.', {});
        }
    }

    function undoLastMiracleFill() {
        const result = miracleDynamicFillSession?.undoLastFill?.() || { undoneCount: 0 };
        const undoneCount = Math.max(0, Number(result?.undoneCount) || 0);
        miracleNoteState.undoAvailable = miracleDynamicFillSession?.canUndoLastFill?.() || false;
        miracleNoteState.fillSummary = undoneCount
            ? `${undoneCount === 1 ? '1 campo restaurado' : `${undoneCount} campos restaurados`}. Puedes seguir dictando o revisar la nota.`
            : 'No hay un llenado reciente para deshacer.';
        syncMiracleNotePanel(undoneCount ? 'Ultimo llenado deshecho.' : 'Nada para deshacer.');
        emitPluginEvent('note.session.undo_fill', { undoneCount });
    }

    function dispatchMiracleNoteToDynamicFill(content) {
        const session = miracleDynamicFillSession;
        if (!session || session.isStopped?.()) return;
        const text = `${content || ''}`;
        if (!text.trim()) return;
        session.ingestNoteContent(text);
    }

    function bindMiracleNoteEditorTyping() {
        if (miracleNoteEditorBound) return;
        const editor = document.getElementById('graph-assistant-note-editor');
        if (!editor) return;
        editor.addEventListener('input', () => {
            updateMiracleNoteContent(editor.innerText || '');
            syncMiracleNotePanel();
            dispatchMiracleNoteToDynamicFill(miracleNoteState.noteContent);
        });
        miracleNoteEditorBound = true;
    }

    async function toggleMiracleNoteDictation() {
        miracleNoteState.visible = true;
        runtime()?.setNotePanelState?.({ visible: true });
        bindMiracleNoteEditorTyping();
        try {
            if (miracleNoteState.active) {
                await stopMiracleNoteDictation();
                return;
            }
            await startMiracleNoteDictation();
            ensureMiracleDynamicFillSession().catch(() => {});
        } catch (error) {
            miracleNoteState.active = false;
            miracleNoteState.busy = false;
            miracleNoteState.pendingDraft = '';
            miracleDictation().reset();
            syncMiracleNotePanel(error.message || 'No fue posible procesar la transcripcion.');
        }
    }


    function normalizePathname(value) {
        return window.GraphPluginAdapters?.normalizePathname?.(value)
            || `${value || ''}`.trim();
    }

    function filterWorkflowsForCurrentPage(workflows) {
        const currentOrigin = `${window.location.origin || ''}`.trim();
        const currentAppId = `${options.appId || ''}`.trim();

        return (Array.isArray(workflows) ? workflows : []).filter((workflow) => {
            const workflowOrigin = `${workflow?.sourceOrigin || ''}`.trim();
            const workflowAppId = `${workflow?.appId || ''}`.trim();

            if (currentOrigin && workflowOrigin) {
                return workflowOrigin === currentOrigin;
            }
            if (currentAppId && workflowAppId) {
                return workflowAppId === currentAppId;
            }
            return true;
        });
    }

    function formatTimestamp(value) {
        if (!value) return 'Sin fecha';
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return 'Sin fecha';
        try {
            return new Date(numeric).toLocaleString();
        } catch (error) {
            return 'Sin fecha';
        }
    }

    function setWorkflowPanelLoadingState(isLoading) {
        const closeButton = document.getElementById('workflow-panel-close');
        if (closeButton) {
            closeButton.disabled = isLoading;
        }
    }

    function readPendingExecution() {
        return requireExecutionClient().readPendingExecution();
    }

    function clearPendingExecution() {
        return requireExecutionClient().clearPendingExecution();
    }

    function stopWorkflowExecution() {
        return requireExecutionClient().cancelExecution();
    }

    function emitExtensionLog(level, message, details = null) {
        return requireExecutionClient().emitExtensionLog(level, message, details);
    }

    async function executeWorkflowPlan(plan, trigger = 'panel') {
        return requireExecutionClient().executeWorkflowPlan(plan, trigger);
    }

    async function fetchExecutionPlan(workflowId, variables = {}) {
        const payload = await requireApiClient().getExecutionPlan(workflowId, variables, getPageContext());
        return payload?.executionPlan || null;
    }

    async function sendMessageToAgentBackend(message, options = {}) {
        const normalizedMessage = `${message || ''}`.trim();
        if (!normalizedMessage) {
            return null;
        }

        const {
            appendUser = true,
            focusInput = false,
            trigger = 'chat',
            speakReply = false
        } = options;

        const historyForRequest = agentHistory.slice(-8);
        if (appendUser) {
            appendAgentMessage('user', normalizedMessage);
        }

        emitPluginEvent('chat.message.sent', {
            message: normalizedMessage,
            trigger
        });

        let payload;
        try {
            payload = await requireApiClient().sendAgentMessage(normalizedMessage, historyForRequest, getPageContext());
        } catch (error) {
            const errorMessage = error.message || 'No pude procesar tu solicitud en este momento.';
            appendAgentMessage('assistant', errorMessage, null, false);
            throw new Error(errorMessage);
        }

        appendAgentMessage('assistant', payload.reply, null);
        emitPluginEvent('chat.reply.received', {
            reply: payload.reply || '',
            trigger,
            hasExecutionPlan: Boolean(payload.executionPlan)
        });
        if (speakReply && payload.reply) {
            runtime()?.speak(payload.reply, {
                mode: payload.executionPlan ? 'executing' : 'assistant'
                ,
                audible: true
            });
        }

        if (payload.executionPlan) {
            try {
                await executeWorkflowPlan(payload.executionPlan, trigger);
            } catch (error) {
                appendAgentMessage('assistant', error.message || 'No pude completar la automatizacion en esta pagina.', null, false);
                updateWorkflowPanelStatus(error.message || 'No pude completar la automatizacion en esta pagina.');
                throw error;
            }
        }

        if (focusInput) {
            runtime()?.openChatComposer?.({ focus: true });
        }

        return payload;
    }

    async function submitAssistantChatMessage(message, options = {}) {
        const normalizedMessage = `${message || ''}`.trim();
        if (!normalizedMessage) {
            return null;
        }

        runtime()?.setChatComposerBusy?.(true);
        try {
            const payload = await sendMessageToAgentBackend(normalizedMessage, {
                appendUser: true,
                focusInput: true,
                trigger: options.trigger || 'chat'
            });
            runtime()?.clearChatComposer?.();
            return payload;
        } finally {
            runtime()?.setChatComposerBusy?.(false);
        }
    }

    async function resumePendingExecution() {
        const pending = readPendingExecution();
        if (!pending || executionState.running) {
            return;
        }

        try {
            await executeWorkflowPlan(pending, pending.trigger || 'resume');
        } catch (error) {
            clearPendingExecution();
            updateWorkflowPanelStatus(error.message || 'No pude retomar la automatizacion en esta pagina.');
            appendAgentMessage('assistant', error.message || 'No pude retomar la automatizacion en esta pagina.', null, false);
        }
    }


    async function executeWorkflowFromPanel(workflowId) {
        updateWorkflowPanelStatus('Empezando la automatizacion...');
        runtime()?.speak('Voy a moverme por la pagina y encargarme de esta tarea por ti.', { mode: 'executing' });
        const executionPlan = await fetchExecutionPlan(workflowId, {});
        await executeWorkflowPlan(executionPlan, 'panel');
    }

    async function deleteWorkflowFromPanel(workflowId) {
        updateWorkflowPanelStatus(`Borrando ${workflowId}...`);
        await requireApiClient().deleteWorkflow(workflowId);
        updateWorkflowPanelStatus(`Workflow ${workflowId} borrado.`);
    }

    function renderWorkflowPanel(workflows) {
        const list = document.getElementById('workflow-panel-list');
        const empty = document.getElementById('workflow-panel-empty');
        if (!list || !empty) return;

        workflowPanelEntries = Array.isArray(workflows) ? workflows.slice() : [];
        list.replaceChildren();

        if (!workflows.length) {
            empty.hidden = false;
            updateWorkflowPanelStatus('No hay workflows disponibles todavia.');
            return;
        }

        empty.hidden = true;
        updateWorkflowPanelStatus(`${workflows.length} workflow(s) disponibles.`);

        workflows.forEach((workflow) => {
            const item = document.createElement('article');
            item.className = 'workflow-item';
            setElementHtml(item, `
                <h4 class="workflow-item-title">${workflow.description || workflow.id}</h4>
                <div class="workflow-item-meta">
                    <div><strong>ID:</strong> ${workflow.id}</div>
                    <div><strong>Estado:</strong> ${workflow.status || 'desconocido'} | <strong>Pasos:</strong> ${(workflow.steps || []).length}</div>
                    <div><strong>Actualizado:</strong> ${formatTimestamp(workflow.updatedAt || workflow.completedAt || workflow.createdAt)}</div>
                    <div>${workflow.summary || 'Sin resumen todavia.'}</div>
                </div>
                <div class="workflow-item-actions">
                    <button class="view-btn" type="button" data-action="view-workflow" data-workflow-id="${workflow.id}" aria-label="Ver workflow">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="currentColor"/></svg>
                        <span>Ver</span>
                    </button>
                    <button class="delete-btn" type="button" data-action="delete-workflow" data-workflow-id="${workflow.id}" aria-label="Borrar workflow">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Z" fill="currentColor"/></svg>
                    </button>
                    <button class="run-btn" type="button" data-action="run-workflow" data-workflow-id="${workflow.id}">Ejecutar</button>
                </div>
            `);
            list.appendChild(item);
        });
    }

    async function loadWorkflowPanel(force = false) {
        if (workflowPanelLoaded && !force) {
            return;
        }

        workflowPanelLoaded = true;
        setWorkflowPanelLoadingState(true);
        updateWorkflowPanelStatus('Buscando workflows disponibles...');

        try {
            const payload = await requireApiClient().listWorkflows();
            renderWorkflowPanel(filterWorkflowsForCurrentPage(payload.workflows || []));
        } catch (error) {
            workflowPanelLoaded = false;
            updateWorkflowPanelStatus(error.message || 'No se pudo cargar el panel.');
            const list = document.getElementById('workflow-panel-list');
            const empty = document.getElementById('workflow-panel-empty');
            if (list) list.replaceChildren();
            if (empty) {
                empty.hidden = false;
                empty.textContent = 'No fue posible cargar los workflows disponibles.';
            }
        } finally {
            setWorkflowPanelLoadingState(false);
        }
    }

    function getWorkflowEntryById(workflowId) {
        return workflowPanelEntries.find((workflow) => workflow.id === workflowId) || null;
    }

    async function startWorkflow() {
        return requireLearningClient().startWorkflow();
    }

    async function stopWorkflow() {
        return requireLearningClient().stopWorkflow();
    }

    async function resetWorkflow() {
        return requireLearningClient().resetWorkflow();
    }

    function bindControls() {
        return bindControlsDelegated();
    }

    function bindControlsDelegated() {
        requireTrainerShell().bindControls();
    }

    window.TrainerPlugin = {
        mount(config = {}) {
            options = buildMountOptions(config);
            document.body.dataset.assistantExpanded = 'false';
            ensureStyles();
            ensureConsole();
            runtime()?.mount(options.assistantRuntime || DEFAULTS.assistantRuntime);
            miracleNoteState.visible = false;
            clearMiracleDiagnosisSuggestions();
            runtime()?.setNotePanelState?.({
                visible: false,
                title: miracleNoteState.noteTitle,
                content: miracleNoteState.noteContent,
                status: 'Lista para dictado con Miracle.',
                recording: false,
                busy: false,
                diagnosisSuggestions: [],
                diagnosisReviewNotice: '',
                diagnosisStatus: '',
                diagnosisError: '',
                diagnosisBusy: false,
                fillSummary: miracleNoteState.fillSummary,
                undoAvailable: miracleNoteState.undoAvailable,
                diagnosisDisabled: !miracleNoteState.noteContent.trim()
            });
            bindMiracleNoteEditorTyping();
            if (!runtimeTouchBound) {
                runtime()?.subscribe?.('touched', () => {
                    let firstOpen = false;
                    try {
                        firstOpen = window.localStorage?.getItem(MIRACLE_FIRST_OPEN_STORAGE_KEY) !== 'seen';
                        if (firstOpen) {
                            window.localStorage?.setItem(MIRACLE_FIRST_OPEN_STORAGE_KEY, 'seen');
                        }
                    } catch (error) {
                        firstOpen = false;
                    }
                    const greeting = firstOpen
                        ? 'Dicta la consulta y yo preparo la nota.'
                        : `${options.assistantRuntime?.idleMessage || 'Puedo ayudarte en esta pagina. Solo dime que necesitas y yo me encargo.'}`.trim();
                    runtime()?.speak(greeting, { mode: 'listening' });
                });
                runtime()?.subscribe?.('chat-submit', async (payload) => {
                    try {
                        await submitAssistantChatMessage(payload?.message || '', {
                            trigger: 'chat'
                        });
                    } catch (error) {
                        // The helper already surfaced the error in chat.
                    }
                });
                runtime()?.subscribe?.('note-toggle', async (payload) => {
                    miracleNoteState.visible = Boolean(payload?.open);
                    if (payload?.open) {
                        syncMiracleNotePanel(miracleNoteState.active ? 'Dictando hacia Miracle...' : 'Lista para dictado con Miracle.');
                        return;
                    }
                    if (miracleNoteState.active) {
                        await stopMiracleNoteDictation().catch(() => {});
                    }
                    stopMiracleDynamicFillSession();
                });
                runtime()?.subscribe?.('note-mic-button', async () => {
                    await toggleMiracleNoteDictation();
                });
                runtime()?.subscribe?.('note-undo-fill', () => {
                    undoLastMiracleFill();
                });
                runtime()?.subscribe?.('note-diagnosis-button', async () => {
                    await requestMiracleDiagnosisSuggestions();
                });
                pluginEvents()?.on?.('learning.context.captured', (payload) => {
                    persistLearningContextNote(payload?.note || null);
                    lifecycleLog('learning', 'Learning context note captured.', {
                        sessionId: payload?.sessionId || '',
                        noteCount: Number(payload?.noteCount) || 0,
                        role: payload?.note?.role || '',
                        mode: payload?.note?.mode || ''
                    });
                });
                pluginEvents()?.on?.('learning.session.started', (payload) => {
                    lifecycleLog('learning', 'Learning session started.', {
                        sessionId: payload?.sessionId || '',
                        description: payload?.description || '',
                        sourceUrl: payload?.context?.sourceUrl || '',
                        sourceTitle: payload?.context?.sourceTitle || ''
                    });
                });
                pluginEvents()?.on?.('learning.step.captured', (payload) => {
                    lifecycleLog('learning', 'Learning step captured.', {
                        stepOrder: Number(payload?.step?.stepOrder) || null,
                        actionType: payload?.step?.actionType || '',
                        selector: payload?.step?.selector || '',
                        label: payload?.step?.label || '',
                        controlType: payload?.step?.controlType || ''
                    });
                });
                pluginEvents()?.on?.('learning.session.finished', (payload) => {
                    lifecycleLog('learning', 'Learning session finished.', {
                        sessionId: payload?.sessionId || '',
                        redirectTo: payload?.redirectTo || ''
                    });
                });
                pluginEvents()?.on?.('learning.session.reset', () => {
                    lifecycleLog('learning', 'Learning session reset.');
                });
                pluginEvents()?.on?.('workflow.execution.started', () => {
                    setExecutionStopButtonVisible(true);
                });
                pluginEvents()?.on?.('workflow.execution.finished', () => {
                    setExecutionStopButtonVisible(false);
                });
                pluginEvents()?.on?.('workflow.execution.cancelled', () => {
                    setExecutionStopButtonVisible(false);
                });
                pluginEvents()?.on?.('workflow.execution.failed', () => {
                    setExecutionStopButtonVisible(false);
                });
                runtimeTouchBound = true;
            }

            document.getElementById('wf-desc').value = options.workflowDescription || '';
            surfaceProfileHydration = null;
            requireSurfaceProfileClient().resetHydration();
            hydrateSurfaceProfile().catch(() => {});

            if (!mounted) {
                bindControlsDelegated();
                mounted = true;
            }

            workflowPanelLoaded = false;
            closeWorkflowPanel();
            hideWorkflowOverlay();
            setExecutionStopButtonVisible(Boolean(executionState.running));
            updateConsoleExpandedState();

            requireLearningClient().syncRecorderStatus();

            if (!authLifecycleBound) {
                window.addEventListener('miracle-auth-changed', () => {
                    requireLearningClient().syncRecorderStatus();
                });
                authLifecycleBound = true;
            }

            window.setTimeout(() => {
                resumePendingExecution().catch((error) => {
                    updateWorkflowPanelStatus(error.message || 'No pude retomar la automatizacion pendiente.');
                });
            }, 120);


        },
        appendAgentMessage,
        getConfig() {
            return { ...options };
        },
        resetWorkflow,
        startWorkflow,
        stopWorkflow,
        openWorkflowPanel() {
            openWorkflowPanel();
            loadWorkflowPanel(true);
        },
        showWorkflowOverlayById(workflowId) {
            const workflow = getWorkflowEntryById(workflowId);
            if (workflow) {
                showWorkflowOverlay(workflow);
            }
        },
        hideWorkflowOverlay() {
            hideWorkflowOverlay();
        }
    };
})();
