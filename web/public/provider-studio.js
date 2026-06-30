(function () {
    const state = {
        account: null,
        graph: null,
        miracleProduct: null,
        miracleStt: null,
    };

    const dom = {
        accountEmail: document.getElementById('provider-studio-account-email'),
        accountRole: document.getElementById('provider-studio-account-role'),
        overallStatus: document.getElementById('provider-studio-overall-status'),
        access: document.getElementById('provider-studio-access'),
        grid: document.getElementById('provider-studio-grid'),

        graphPill: document.getElementById('graph-provider-pill'),
        graphMetric: document.getElementById('graph-provider-metric'),
        graphCurrent: document.getElementById('graph-provider-current'),
        graphForm: document.getElementById('graph-provider-form'),
        graphSelect: document.getElementById('graph-provider-select'),
        graphBaseUrlField: document.getElementById('graph-provider-base-url-field'),
        graphBaseUrl: document.getElementById('graph-provider-base-url'),
        graphModelField: document.getElementById('graph-provider-model-field'),
        graphModel: document.getElementById('graph-provider-model'),
        graphApiKeyField: document.getElementById('graph-provider-api-key-field'),
        graphApiKey: document.getElementById('graph-provider-api-key'),
        graphRefresh: document.getElementById('graph-provider-refresh'),
        graphSubmit: document.getElementById('graph-provider-submit'),
        graphMessage: document.getElementById('graph-provider-message'),

        miracleProductPill: document.getElementById('miracle-product-pill'),
        miracleProductMetric: document.getElementById('miracle-product-metric'),
        miracleProductCurrent: document.getElementById('miracle-product-current'),
        miracleProductForm: document.getElementById('miracle-product-form'),
        miracleProductSelect: document.getElementById('miracle-product-select'),
        miracleProductBaseUrlField: document.getElementById('miracle-product-base-url-field'),
        miracleProductBaseUrl: document.getElementById('miracle-product-base-url'),
        miracleProductModelField: document.getElementById('miracle-product-model-field'),
        miracleProductModel: document.getElementById('miracle-product-model'),
        miracleProductApiKeyField: document.getElementById('miracle-product-api-key-field'),
        miracleProductApiKey: document.getElementById('miracle-product-api-key'),
        miracleProductRefresh: document.getElementById('miracle-product-refresh'),
        miracleProductSubmit: document.getElementById('miracle-product-submit'),
        miracleProductMessage: document.getElementById('miracle-product-message'),

        miracleSttPill: document.getElementById('miracle-stt-pill'),
        miracleSttMetric: document.getElementById('miracle-stt-metric'),
        miracleSttCurrent: document.getElementById('miracle-stt-current'),
        miracleSttForm: document.getElementById('miracle-stt-form'),
        miracleSttSelect: document.getElementById('miracle-stt-select'),
        miracleSttModelField: document.getElementById('miracle-stt-model-field'),
        miracleSttModel: document.getElementById('miracle-stt-model'),
        miracleSttLanguageField: document.getElementById('miracle-stt-language-field'),
        miracleSttLanguage: document.getElementById('miracle-stt-language'),
        miracleSttApiKeyField: document.getElementById('miracle-stt-api-key-field'),
        miracleSttApiKey: document.getElementById('miracle-stt-api-key'),
        miracleSttRefresh: document.getElementById('miracle-stt-refresh'),
        miracleSttSubmit: document.getElementById('miracle-stt-submit'),
        miracleSttMessage: document.getElementById('miracle-stt-message'),
    };

    async function authenticatedFetch(url, init = {}) {
        if (window.MiracleAuth?.whenAuthenticated) {
            await window.MiracleAuth.whenAuthenticated();
        }
        const token = window.MiracleAuth?.getAccessToken?.() || '';
        return fetch(url, {
            ...init,
            cache: 'no-store',
            headers: {
                ...(init.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
    }

    async function fetchJson(url, init = {}) {
        const response = await authenticatedFetch(url, init);
        const text = await response.text();
        let payload = {};
        if (text.trim()) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                if (!response.ok) {
                    throw new Error(text.slice(0, 220) || `HTTP ${response.status}`);
                }
                throw error;
            }
        }
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    function setPill(element, label, tone = 'warning') {
        element.textContent = label;
        element.dataset.tone = tone;
    }

    function setMessage(element, text, tone = '') {
        element.textContent = text || '';
        if (tone) {
            element.dataset.tone = tone;
        } else {
            delete element.dataset.tone;
        }
    }

    function renderOptions(select, providers = []) {
        select.innerHTML = '';
        providers.forEach((provider) => {
            const option = document.createElement('option');
            option.value = provider.id;
            option.textContent = provider.label;
            if (provider.recommended) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    function currentProvider(providers, select) {
        return (providers || []).find((item) => item.id === select.value) || null;
    }

    function syncGraphFields() {
        const provider = currentProvider(state.graph?.providers, dom.graphSelect);
        dom.graphApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.graphBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.graphModelField.classList.toggle('is-hidden', !provider?.requires_model);
        if (provider && !dom.graphModel.value) {
            dom.graphModel.value = provider.default_model || '';
        }
        if (provider && !dom.graphBaseUrl.value) {
            dom.graphBaseUrl.value = provider.default_base_url || '';
        }
    }

    function syncMiracleProductFields() {
        const provider = currentProvider(state.miracleProduct?.providers, dom.miracleProductSelect);
        dom.miracleProductApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.miracleProductBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.miracleProductModelField.classList.toggle('is-hidden', !provider?.requires_model);
        if (provider && !dom.miracleProductModel.value) {
            dom.miracleProductModel.value = provider.default_model || '';
        }
        if (provider && !dom.miracleProductBaseUrl.value) {
            dom.miracleProductBaseUrl.value = provider.default_base_url || '';
        }
    }

    function syncMiracleSttFields() {
        const provider = currentProvider(state.miracleStt?.providers, dom.miracleSttSelect);
        dom.miracleSttApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.miracleSttModelField.classList.toggle('is-hidden', !provider?.requires_model);
        dom.miracleSttLanguageField.classList.toggle('is-hidden', provider?.id === 'disabled');
        if (provider && !dom.miracleSttModel.value) {
            dom.miracleSttModel.value = provider.default_model || '';
        }
        if (provider && !dom.miracleSttLanguage.value) {
            dom.miracleSttLanguage.value = provider.default_language || 'es';
        }
    }

    function renderGraph(payload) {
        state.graph = payload;
        renderOptions(dom.graphSelect, payload.providers || []);
        const current = payload.current_setup || payload.status || {};
        if (current.provider) {
            dom.graphSelect.value = current.provider;
        }
        dom.graphBaseUrl.value = current.base_url || '';
        dom.graphModel.value = current.model || '';
        dom.graphApiKey.value = '';
        syncGraphFields();
        dom.graphCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.source || 'runtime actual'}`
            : 'Sin provider explicito en Graph. Se usa el fallback actual del servidor.';
        dom.graphMetric.textContent = current.model || current.label || current.provider || 'No configurado';
        setPill(dom.graphPill, current.configured ? 'Configurado' : 'Sin credenciales', current.configured ? 'ready' : 'warning');
        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        if (!vercelReady) {
            setMessage(
                dom.graphMessage,
                `Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel. Estrategia de deploy: ${redeployMode}.`,
                'warning'
            );
        } else if (dom.graphMessage.dataset.tone === 'warning') {
            setMessage(dom.graphMessage, '');
        }
    }

    function renderMiracleProduct(payload) {
        state.miracleProduct = payload;
        renderOptions(dom.miracleProductSelect, payload.providers || []);
        const current = payload.current_setup || {};
        if (current.provider) {
            dom.miracleProductSelect.value = current.provider;
        }
        const provider = currentProvider(payload.providers, dom.miracleProductSelect);
        dom.miracleProductBaseUrl.value = current.base_url || provider?.default_base_url || '';
        dom.miracleProductModel.value = current.model || provider?.default_model || '';
        dom.miracleProductApiKey.value = '';
        syncMiracleProductFields();
        dom.miracleProductCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'}`
            : 'Actual: fallback heuristico de Miracle.';
        dom.miracleProductMetric.textContent = current.model || current.label || current.provider || 'Heuristico';
        setPill(dom.miracleProductPill, payload.status?.configured ? 'Configurado' : 'Fallback', payload.status?.configured ? 'ready' : 'warning');
        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        if (!vercelReady) {
            setMessage(
                dom.miracleProductMessage,
                `Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel. Estrategia de deploy: ${redeployMode}.`,
                'warning'
            );
        } else if (dom.miracleProductMessage.dataset.tone === 'warning') {
            setMessage(dom.miracleProductMessage, '');
        }
    }

    function renderMiracleStt(payload) {
        state.miracleStt = payload;
        renderOptions(dom.miracleSttSelect, payload.providers || []);
        const current = payload.current_setup || payload.status || {};
        if (current.provider) {
            dom.miracleSttSelect.value = current.provider;
        }
        const provider = currentProvider(payload.providers, dom.miracleSttSelect);
        dom.miracleSttModel.value = current.model || provider?.default_model || '';
        dom.miracleSttLanguage.value = current.language || provider?.default_language || 'es';
        dom.miracleSttApiKey.value = '';
        syncMiracleSttFields();

        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        dom.miracleSttCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.language || 'sin idioma'} - ${vercelReady ? 'Vercel listo' : 'falta token de Vercel'}`
            : 'STT sin configuracion actual.';
        dom.miracleSttMetric.textContent = current.model || current.label || current.provider || 'Deshabilitado';
        setPill(
            dom.miracleSttPill,
            current.configured ? 'Configurado' : 'Sin credenciales',
            current.configured ? 'ready' : 'warning'
        );
        if (!vercelReady) {
            setMessage(
                dom.miracleSttMessage,
                `Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel. Estrategia de deploy: ${redeployMode}.`,
                'warning'
            );
        } else if (dom.miracleSttMessage.dataset.tone === 'warning') {
            setMessage(dom.miracleSttMessage, '');
        }
    }

    async function loadAccount() {
        const payload = await fetchJson('/api/account/me');
        state.account = payload;
        dom.accountEmail.textContent = payload?.user?.email || 'Cuenta activa';
        dom.accountRole.textContent = payload?.permissions?.canManageGlobalWorkflows
            ? 'Admin con permiso para providers globales'
            : 'Sesion autenticada sin permiso de administracion';
        return payload;
    }

    function renderAccessState(allowed, message) {
        dom.access.classList.toggle('is-hidden', allowed);
        dom.grid.classList.toggle('is-hidden', !allowed);
        dom.access.textContent = allowed ? '' : message;
    }

    async function refreshAll() {
        dom.overallStatus.textContent = 'Sincronizando';
        const account = await loadAccount();
        if (!account?.permissions?.canManageGlobalWorkflows) {
            renderAccessState(false, 'Esta superficie esta reservada para cuentas con permisos de administracion global.');
            dom.overallStatus.textContent = 'Acceso restringido';
            return;
        }

        renderAccessState(true, '');
        const [graph, miracleProduct, miracleStt] = await Promise.all([
            fetchJson('/api/providers/graph/status'),
            fetchJson('/api/product-llm/status'),
            fetchJson('/api/providers/miracle-stt/status')
        ]);
        renderGraph(graph);
        renderMiracleProduct(miracleProduct);
        renderMiracleStt(miracleStt);
        dom.overallStatus.textContent = 'Listo';
    }

    async function submitGraph(event) {
        event.preventDefault();
        const provider = currentProvider(state.graph?.providers, dom.graphSelect);
        if (!provider) return;
        dom.graphSubmit.disabled = true;
        setMessage(dom.graphMessage, 'Guardando configuracion de Graph en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/graph/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    base_url: dom.graphBaseUrl.value,
                    model: dom.graphModel.value,
                    api_key: dom.graphApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.graphMessage, `Graph actualizado.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.graphMessage, error.message || 'No fue posible guardar Graph.', 'error');
        } finally {
            dom.graphSubmit.disabled = false;
        }
    }

    async function submitMiracleProduct(event) {
        event.preventDefault();
        const provider = currentProvider(state.miracleProduct?.providers, dom.miracleProductSelect);
        if (!provider) return;
        dom.miracleProductSubmit.disabled = true;
        setMessage(dom.miracleProductMessage, 'Guardando hoja en blanco en Vercel...');
        try {
            const payload = await fetchJson('/api/setup/product-llm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    base_url: dom.miracleProductBaseUrl.value,
                    model: dom.miracleProductModel.value,
                    api_key: dom.miracleProductApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.miracleProductMessage, `Hoja en blanco actualizada.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.miracleProductMessage, error.message || 'No fue posible guardar el Product LLM.', 'error');
        } finally {
            dom.miracleProductSubmit.disabled = false;
        }
    }

    async function submitMiracleStt(event) {
        event.preventDefault();
        const provider = currentProvider(state.miracleStt?.providers, dom.miracleSttSelect);
        if (!provider) return;
        dom.miracleSttSubmit.disabled = true;
        setMessage(dom.miracleSttMessage, 'Guardando STT Provider en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/miracle-stt/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    model: dom.miracleSttModel.value,
                    language: dom.miracleSttLanguage.value,
                    api_key: dom.miracleSttApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.miracleSttMessage, `STT actualizado.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.miracleSttMessage, error.message || 'No fue posible guardar el STT Provider.', 'error');
        } finally {
            dom.miracleSttSubmit.disabled = false;
        }
    }

    function bindEvents() {
        dom.graphSelect.addEventListener('change', syncGraphFields);
        dom.graphRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.graphMessage, error.message, 'error'));
        });
        dom.graphForm.addEventListener('submit', (event) => {
            submitGraph(event).catch((error) => setMessage(dom.graphMessage, error.message, 'error'));
        });

        dom.miracleProductSelect.addEventListener('change', syncMiracleProductFields);
        dom.miracleProductRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.miracleProductMessage, error.message, 'error'));
        });
        dom.miracleProductForm.addEventListener('submit', (event) => {
            submitMiracleProduct(event).catch((error) => setMessage(dom.miracleProductMessage, error.message, 'error'));
        });

        dom.miracleSttSelect.addEventListener('change', syncMiracleSttFields);
        dom.miracleSttRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.miracleSttMessage, error.message, 'error'));
        });
        dom.miracleSttForm.addEventListener('submit', (event) => {
            submitMiracleStt(event).catch((error) => setMessage(dom.miracleSttMessage, error.message, 'error'));
        });
    }

    bindEvents();
    refreshAll().catch((error) => {
        dom.overallStatus.textContent = 'Error';
        renderAccessState(false, error.message || 'No pudimos cargar el Provider Studio.');
    });
})();
