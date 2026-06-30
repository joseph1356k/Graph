(function () {
    const state = {
        account: null,
        graph: null,
        miracleProduct: null,
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
        const [graph, miracleProduct] = await Promise.all([
            fetchJson('/api/providers/graph/status'),
            fetchJson('/api/product-llm/status')
        ]);
        renderGraph(graph);
        renderMiracleProduct(miracleProduct);
        dom.overallStatus.textContent = 'Listo';
    }

    async function submitGraph(event) {
        event.preventDefault();
        const provider = currentProvider(state.graph?.providers, dom.graphSelect);
        if (!provider) return;
        dom.graphSubmit.disabled = true;
        setMessage(dom.graphMessage, 'Guardando configuracion de Graph...');
        try {
            await fetchJson('/api/providers/graph/configure', {
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
            setMessage(dom.graphMessage, 'Graph quedo actualizado.', 'success');
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
        setMessage(dom.miracleProductMessage, 'Actualizando Product LLM...');
        try {
            await fetchJson('/api/setup/product-llm', {
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
            setMessage(dom.miracleProductMessage, 'Product LLM actualizado.', 'success');
        } catch (error) {
            setMessage(dom.miracleProductMessage, error.message || 'No fue posible guardar el Product LLM.', 'error');
        } finally {
            dom.miracleProductSubmit.disabled = false;
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
    }

    bindEvents();
    refreshAll().catch((error) => {
        dom.overallStatus.textContent = 'Error';
        renderAccessState(false, error.message || 'No pudimos cargar el Provider Studio.');
    });
})();
