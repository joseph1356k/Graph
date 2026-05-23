(function () {
    function normalizeBaseUrl(value) {
        return `${value || ''}`.replace(/\/+$/, '');
    }

    function buildUrl(baseUrl, path) {
        const normalizedBase = normalizeBaseUrl(baseUrl);
        if (!normalizedBase) {
            return path;
        }
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
    }

    function createJsonRequest(baseUrl, path, init, fetchImpl) {
        const effectiveFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
        return effectiveFetch(buildUrl(baseUrl, path), init).then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Request failed: ${path}`);
            }
            return payload;
        });
    }

    function createClient(config) {
        const baseUrl = normalizeBaseUrl(config?.baseUrl || '');
        const fetchImpl = typeof config?.fetchImpl === 'function'
            ? config.fetchImpl
            : fetch;

        return {
            listWorkflows() {
                return createJsonRequest(baseUrl, '/api/workflows', {}, fetchImpl);
            },
            getRecorderStatus() {
                return createJsonRequest(baseUrl, '/api/status', {}, fetchImpl);
            },
            startWorkflow(description, context) {
                return createJsonRequest(baseUrl, '/api/workflow/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description: description || '',
                        context: context || {}
                    })
                }, fetchImpl);
            },
            appendWorkflowStep(step, sessionId) {
                return createJsonRequest(baseUrl, '/api/step', {
                    method: 'POST',
                    keepalive: true,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...(step || {}),
                        sessionId: sessionId || step?.sessionId || ''
                    })
                }, fetchImpl);
            },
            stopWorkflow(sessionId) {
                return createJsonRequest(baseUrl, '/api/workflow/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: sessionId || ''
                    })
                }, fetchImpl);
            },
            resetWorkflow() {
                return createJsonRequest(baseUrl, '/api/reset', {
                    method: 'POST'
                }, fetchImpl);
            },
            deleteWorkflow(workflowId) {
                return createJsonRequest(baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}`, {
                    method: 'DELETE'
                }, fetchImpl);
            },
            appendWorkflowContextNote(note, sessionId) {
                return createJsonRequest(baseUrl, '/api/workflow/context-note', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        note: note || {},
                        sessionId: sessionId || note?.sessionId || ''
                    })
                }, fetchImpl);
            },
            ensureSurfaceProfile(context, pageSnapshot) {
                return createJsonRequest(baseUrl, '/api/surface-profile/ensure', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        context: context || {},
                        pageSnapshot: pageSnapshot || {}
                    })
                }, fetchImpl);
            },
            getExecutionPlan(workflowId, variables, context) {
                return createJsonRequest(baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}/plan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        variables: variables || {},
                        context: context || {}
                    })
                }, fetchImpl);
            },
            requestExecutionIntelligence(workflowId, payload) {
                return createJsonRequest(baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}/intelligence`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                }, fetchImpl);
            },
            sendAgentMessage(message, history, context) {
                return createJsonRequest(baseUrl, '/api/agent/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message,
                        history: history || [],
                        context: context || {},
                        executionMode: 'browser'
                    })
                }, fetchImpl);
            },
            generatePitchArtifacts(payload) {
                return createJsonRequest(baseUrl, '/api/pitch/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                }, fetchImpl);
            },
            createPhoneSession(payload) {
                return createJsonRequest(baseUrl, '/api/voice/phone-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                }, fetchImpl);
            },
            processVoiceComplaints(payload) {
                return createJsonRequest(baseUrl, '/api/voice/complaints/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                }, fetchImpl);
            },
            createOpenAiRealtimeSession(sdp, headers) {
                return fetchImpl(buildUrl(baseUrl, '/api/voice/openai/session'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/sdp',
                        ...(headers || {})
                    },
                    body: sdp
                });
            }
        };
    }

    window.GraphPluginApi = {
        createClient
    };
})();
