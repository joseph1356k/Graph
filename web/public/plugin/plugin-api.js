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

    async function waitForAuthReady() {
        try {
            if (window.MiracleAuth && typeof window.MiracleAuth.whenAuthenticated === 'function') {
                await window.MiracleAuth.whenAuthenticated();
            }
        } catch (error) { /* ignore */ }
    }

    // Attaches the Supabase access token after MiracleAuth has resolved. In
    // local mode there is no token, and the server falls back to local-dev-user.
    async function withAuth(init = {}) {
        await waitForAuthReady();
        try {
            const token = window.MiracleAuth && typeof window.MiracleAuth.getAccessToken === 'function'
                ? window.MiracleAuth.getAccessToken()
                : '';
            if (token) {
                return { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
            }
        } catch (error) { /* ignore */ }
        return init;
    }

    function createJsonRequest(baseUrl, path, init, fetchImpl) {
        const effectiveFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
        return withAuth(init).then((authenticatedInit) => effectiveFetch(buildUrl(baseUrl, path), authenticatedInit)).then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Request failed: ${path}`);
            }
            return payload;
        });
    }

    function createClient(config) {
        const baseUrl = normalizeBaseUrl(config?.baseUrl || '');
        const miracleBaseUrl = normalizeBaseUrl(config?.miracleBaseUrl || '');
        const voiceGatewayUrl = normalizeBaseUrl(config?.voiceGatewayUrl || '');
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
            requestNoteFieldMatches(workflowId, payload) {
                return createJsonRequest(baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}/note-field-matches`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                }, fetchImpl);
            },
            requestDiagnosisSuggestions(noteContent) {
                return createJsonRequest(baseUrl, '/api/clinical/diagnosis-suggestions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ noteContent: `${noteContent || ''}` })
                }, fetchImpl);
            },
            recordBranchObservation(workflowId, payload) {
                return createJsonRequest(baseUrl, `/api/workflows/${encodeURIComponent(workflowId)}/branch-observation`, {
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
            getPhoneSessionEvents(sessionId, afterId) {
                const query = Number(afterId) > 0 ? `?after=${encodeURIComponent(Number(afterId))}` : '';
                return createJsonRequest(baseUrl, `/api/voice/phone-session/${encodeURIComponent(sessionId || '')}/events${query}`, {
                    method: 'GET'
                }, fetchImpl);
            },
            createMiracleStreamSession() {
                if (!miracleBaseUrl) {
                    return Promise.reject(new Error('El motor medico Miracle no esta configurado en Vercel. Render no se usa como fallback.'));
                }
                return createJsonRequest(miracleBaseUrl, '/api/voice/stream-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }, fetchImpl);
            },
            sendMiracleOrchestratorEvent(payload) {
                if (!miracleBaseUrl) {
                    return Promise.reject(new Error('El motor medico Miracle no esta configurado en Vercel. Render no se usa como fallback.'));
                }
                return createJsonRequest(miracleBaseUrl, '/api/voice/orchestrator/events', {
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
                return withAuth({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/sdp',
                        ...(headers || {})
                    },
                    body: sdp
                }).then((authenticatedInit) => fetchImpl(buildUrl(baseUrl, '/api/voice/openai/session'), authenticatedInit));
            }
        };
    }

    window.GraphPluginApi = {
        createClient
    };

    function installBranchObservationWrapper() {
        let executionClientValue = window.GraphPluginExecutionClient;

        function wrapExecutionClient(client) {
            if (!client || typeof client.create !== 'function' || client.__branchObservationWrapped) {
                return client;
            }

            const originalCreate = client.create;
            const wrappedClient = {
                ...client,
                __branchObservationWrapped: true,
                create(deps = {}) {
                    const executionClient = originalCreate.call(client, deps);
                    if (!executionClient || typeof executionClient.executeWorkflowPlan !== 'function') {
                        return executionClient;
                    }

                    const originalExecuteWorkflowPlan = executionClient.executeWorkflowPlan;
                    return {
                        ...executionClient,
                        async executeWorkflowPlan(plan, trigger = 'panel') {
                            const branchContext = plan?.branchContext || null;
                            if (!branchContext?.branchKey || !branchContext?.affordanceTarget) {
                                return originalExecuteWorkflowPlan.call(executionClient, plan, trigger);
                            }

                            const decisions = [];
                            const onLog = (event) => {
                                const detail = event?.detail || {};
                                const details = detail.details || {};
                                if (detail.scope !== 'execution' || details.workflowId !== plan.workflowId) {
                                    return;
                                }
                                if (details.resolution !== 'runtime_intelligence_applied') {
                                    return;
                                }
                                decisions.push({
                                    action: details.runtimeAction || '',
                                    reason: details.runtimeReason || '',
                                    stepIndex: details.stepIndex,
                                    stepOrder: details.stepOrder,
                                    skipStepOrders: Array.isArray(details.skipStepOrders) ? details.skipStepOrders : [],
                                    stepPatches: Array.isArray(details.runtimeStepPatches) ? details.runtimeStepPatches : []
                                });
                            };

                            document.addEventListener('graph-trainer-extension-log', onLog);
                            try {
                                const result = await originalExecuteWorkflowPlan.call(executionClient, plan, trigger);
                                const skippedBaseStepOrders = [];
                                const stepPatches = [];
                                decisions.forEach((decision) => {
                                    (decision.skipStepOrders || []).forEach((stepOrder) => {
                                        const numeric = Number(stepOrder);
                                        if (Number.isFinite(numeric) && !skippedBaseStepOrders.includes(numeric)) {
                                            skippedBaseStepOrders.push(numeric);
                                        }
                                    });
                                    (decision.stepPatches || []).forEach((patch) => {
                                        if (patch && Number.isFinite(Number(patch.stepOrder))) {
                                            stepPatches.push(patch);
                                        }
                                    });
                                });

                                if (skippedBaseStepOrders.length > 0 || stepPatches.length > 0) {
                                    const config = window.TrainerPlugin?.getConfig?.() || {};
                                    const host = window.GraphPluginHost?.createHost?.(config) || null;
                                    createClient({
                                        baseUrl: host?.apiBaseUrl || config.apiBaseUrl || '',
                                        fetchImpl: host?.fetchImpl || null
                                    }).recordBranchObservation(plan.workflowId, {
                                        source: 'browser_runtime',
                                        trigger,
                                        completed: true,
                                        branchContext,
                                        skippedBaseStepOrders,
                                        stepPatches,
                                        notes: decisions
                                            .map((decision) => decision.reason)
                                            .filter(Boolean),
                                        decisions
                                    }).catch(() => {});
                                }

                                return result;
                            } finally {
                                document.removeEventListener('graph-trainer-extension-log', onLog);
                            }
                        }
                    };
                }
            };

            return wrappedClient;
        }

        Object.defineProperty(window, 'GraphPluginExecutionClient', {
            configurable: true,
            get() {
                return executionClientValue;
            },
            set(value) {
                executionClientValue = wrapExecutionClient(value);
            }
        });

        if (executionClientValue) {
            executionClientValue = wrapExecutionClient(executionClientValue);
        }
    }

    installBranchObservationWrapper();
})();
