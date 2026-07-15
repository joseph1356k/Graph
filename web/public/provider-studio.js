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

        extensionDownload: document.getElementById('provider-studio-extension-download'),
        extensionLabel: document.getElementById('provider-studio-extension-label'),

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
        graphApiKeyToggle: document.getElementById('graph-provider-api-key-toggle'),
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
        miracleProductApiKeyToggle: document.getElementById('miracle-product-api-key-toggle'),
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
        miracleSttApiKeyToggle: document.getElementById('miracle-stt-api-key-toggle'),
        miracleSttRefresh: document.getElementById('miracle-stt-refresh'),
        miracleSttSubmit: document.getElementById('miracle-stt-submit'),
        miracleSttMessage: document.getElementById('miracle-stt-message'),

        medicalCard: document.getElementById('miracle-medical-card'),
        medicalPill: document.getElementById('miracle-medical-pill'),
        medicalForm: document.getElementById('miracle-medical-form'),
        medicalEnabled: document.getElementById('miracle-medical-enabled'),
        medicalSpecialtyField: document.getElementById('miracle-medical-specialty-field'),
        medicalSpecialty: document.getElementById('miracle-medical-specialty'),
        medicalCustomTerms: document.getElementById('miracle-medical-custom-terms'),
        medicalRefresh: document.getElementById('miracle-medical-refresh'),
        medicalSubmit: document.getElementById('miracle-medical-submit'),
        medicalMessage: document.getElementById('miracle-medical-message'),
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

    function renderModelOptions(select, provider, currentModel = '') {
        if (!select) return;
        const selectedModel = `${currentModel || select.value || provider?.default_model || ''}`.trim();
        const options = Array.from(new Set([
            ...(Array.isArray(provider?.model_options) ? provider.model_options : []),
            provider?.default_model || '',
            selectedModel
        ].map((value) => `${value || ''}`.trim()).filter(Boolean)));

        select.innerHTML = '';
        if (!options.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Sin modelo';
            select.appendChild(option);
            select.value = '';
            return;
        }

        options.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model === provider?.default_model ? `${model} (recomendado)` : model;
            select.appendChild(option);
        });
        select.value = options.includes(selectedModel) ? selectedModel : options[0];
    }

    // Prefills a password field with the key already stored for that specific
    // provider (kept server-side per provider, not overwritten when the user
    // switches to a different provider and back).
    function applyStoredApiKey(input, provider) {
        if (!input) return;
        input.value = provider?.stored_api_key || '';
        input.type = 'password';
        const toggle = input.parentElement?.querySelector('.field-key-toggle');
        if (toggle) {
            toggle.setAttribute('aria-pressed', 'false');
        }
    }

    function syncGraphFields() {
        const provider = currentProvider(state.graph?.providers, dom.graphSelect);
        dom.graphApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.graphBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.graphModelField.classList.toggle('is-hidden', !provider?.requires_model);
        applyStoredApiKey(dom.graphApiKey, provider);
        if (provider) {
            renderModelOptions(dom.graphModel, provider);
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
        applyStoredApiKey(dom.miracleProductApiKey, provider);
        if (provider) {
            renderModelOptions(dom.miracleProductModel, provider);
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
        applyStoredApiKey(dom.miracleSttApiKey, provider);
        if (dom.miracleSttApiKey && provider?.requires_api_key) {
            dom.miracleSttApiKey.placeholder = `Clave de ${provider.label || provider.id}`;
        }
        if (provider) {
            renderModelOptions(dom.miracleSttModel, provider);
        }
        if (provider && !dom.miracleSttLanguage.value) {
            dom.miracleSttLanguage.value = provider.default_language || 'es';
        }
    }

    function formatSummary(current, { includeLanguage = false } = {}) {
        if (!current || !current.provider || current.provider === 'disabled') {
            return 'Deshabilitado';
        }
        const configured = Boolean(current.configured);
        const bits = [current.label || current.provider];
        if (current.model) bits.push(current.model);
        if (includeLanguage && current.language) bits.push(current.language);
        bits.push(configured ? 'API key OK' : 'API key faltante');
        return bits.join(' · ');
    }

    function renderGraph(payload) {
        state.graph = payload;
        renderOptions(dom.graphSelect, payload.providers || []);
        const current = payload.current_setup || payload.status || {};
        if (current.provider) {
            dom.graphSelect.value = current.provider;
        }
        dom.graphBaseUrl.value = current.base_url || '';
        renderModelOptions(dom.graphModel, currentProvider(payload.providers, dom.graphSelect), current.model || '');
        syncGraphFields();
        dom.graphCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.source || 'runtime actual'}`
            : 'Sin provider explicito en Graph. Se usa el fallback actual del servidor.';
        const graphConfigured = Boolean(current.configured);
        dom.graphMetric.textContent = formatSummary(current);
        setPill(dom.graphPill, graphConfigured ? 'Configurado' : 'Sin credenciales', graphConfigured ? 'ready' : 'danger');
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
        renderModelOptions(dom.miracleProductModel, provider, current.model || provider?.default_model || '');
        syncMiracleProductFields();
        dom.miracleProductCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'}`
            : 'Actual: fallback heuristico de Miracle.';
        const productConfigured = Boolean(payload.status?.configured);
        dom.miracleProductMetric.textContent = current.provider
            ? formatSummary({ ...current, configured: productConfigured })
            : 'Fallback heuristico (sin API key)';
        setPill(dom.miracleProductPill, productConfigured ? 'Configurado' : 'Fallback', productConfigured ? 'ready' : 'danger');
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
        dom.miracleSttLanguage.value = current.language || provider?.default_language || 'es';
        renderModelOptions(dom.miracleSttModel, provider, current.model || provider?.default_model || '');
        syncMiracleSttFields();
        renderMedical(payload.medical || {});

        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        dom.miracleSttCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.language || 'sin idioma'} - ${vercelReady ? 'Vercel listo' : 'falta token de Vercel'}`
            : 'STT sin configuracion actual.';
        const sttConfigured = Boolean(current.configured);
        dom.miracleSttMetric.textContent = formatSummary(current, { includeLanguage: true });
        setPill(
            dom.miracleSttPill,
            sttConfigured ? 'Configurado' : 'Sin credenciales',
            sttConfigured ? 'ready' : 'danger'
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

    function syncMedicalFields() {
        const enabled = dom.medicalEnabled.value === 'medical';
        dom.medicalSpecialtyField.classList.toggle('is-hidden', !enabled);
        if (dom.medicalCustomTerms) {
            dom.medicalCustomTerms.disabled = !enabled;
        }
    }

    function renderMedical(medical) {
        // The medical vocabulary only affects Soniox (context field). Hide the
        // panel for other providers so it isn't mistaken as global STT config.
        const provider = currentProvider(state.miracleStt?.providers, dom.miracleSttSelect);
        const appliesToSoniox = (medical.applies_to || ['soniox']).includes(provider?.id);
        if (dom.medicalCard) {
            dom.medicalCard.classList.toggle('is-hidden', !appliesToSoniox);
        }

        const specialties = Array.isArray(medical.specialties) ? medical.specialties : [];
        dom.medicalSpecialty.innerHTML = '';
        specialties.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.label;
            dom.medicalSpecialty.appendChild(option);
        });
        dom.medicalEnabled.value = medical.enabled ? 'medical' : 'general';
        if (medical.specialty && specialties.some((item) => item.id === medical.specialty)) {
            dom.medicalSpecialty.value = medical.specialty;
        }
        dom.medicalCustomTerms.value = `${medical.custom_terms || ''}`;
        syncMedicalFields();

        const enabled = Boolean(medical.enabled);
        setPill(
            dom.medicalPill,
            enabled ? 'Médico activo' : 'General',
            enabled ? 'ready' : 'neutral'
        );
    }

    async function submitMedical(event) {
        event.preventDefault();
        setMessage(dom.medicalMessage, 'Guardando vocabulario…', 'info');
        const body = {
            domain: dom.medicalEnabled.value === 'medical' ? 'medical' : 'general',
            specialty: dom.medicalSpecialty.value || 'general',
            custom_terms: dom.medicalCustomTerms.value || ''
        };
        const payload = await fetchJson('/api/providers/miracle-stt/medical', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const summary = payload?.summary || {};
        const bits = [summary.enabled ? `Médico (${summary.specialty})` : 'General', `${summary.custom_terms_count || 0} términos`];
        if (summary.custom_terms_dropped) {
            bits.push(`${summary.custom_terms_dropped} recortados por límite`);
        }
        setMessage(dom.medicalMessage, `Guardado: ${bits.join(' · ')}. Aplica un redeploy.`, 'success');
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

    function bindCollapsible(cardId, toggleId) {
        const card = document.getElementById(cardId);
        const toggle = document.getElementById(toggleId);
        if (!card || !toggle) return;
        toggle.addEventListener('click', () => {
            const collapsed = card.classList.toggle('is-collapsed');
            toggle.setAttribute('aria-expanded', String(!collapsed));
        });
    }

    async function downloadExtension() {
        const button = dom.extensionDownload;
        const label = dom.extensionLabel;
        if (!button || button.disabled) {
            return;
        }
        const originalLabel = label ? label.textContent : '';
        button.disabled = true;
        if (label) {
            label.textContent = 'Generando…';
        }
        try {
            const response = await authenticatedFetch('/api/providers/chrome-extension/download', { method: 'GET' });
            if (!response.ok) {
                let message = `No fue posible generar la extensión (HTTP ${response.status}).`;
                try {
                    const payload = await response.json();
                    if (payload && payload.error) {
                        message = payload.error;
                    }
                } catch (_) { /* respuesta no-JSON */ }
                throw new Error(message);
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = 'miracle-chrome-extension.zip';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
        } finally {
            button.disabled = false;
            if (label) {
                label.textContent = originalLabel || 'Generar extensión';
            }
        }
    }

    function bindApiKeyToggle(toggle, input) {
        if (!toggle || !input) return;
        toggle.addEventListener('click', () => {
            const revealed = input.type === 'text';
            input.type = revealed ? 'password' : 'text';
            toggle.setAttribute('aria-pressed', revealed ? 'false' : 'true');
            toggle.setAttribute('aria-label', revealed ? 'Mostrar API key' : 'Ocultar API key');
        });
    }

    function bindEvents() {
        bindCollapsible('miracle-product-card', 'miracle-product-toggle');
        bindCollapsible('graph-provider-card', 'graph-provider-toggle');

        bindApiKeyToggle(dom.graphApiKeyToggle, dom.graphApiKey);
        bindApiKeyToggle(dom.miracleProductApiKeyToggle, dom.miracleProductApiKey);
        bindApiKeyToggle(dom.miracleSttApiKeyToggle, dom.miracleSttApiKey);

        if (dom.extensionDownload) {
            dom.extensionDownload.addEventListener('click', () => {
                downloadExtension().catch((error) => {
                    window.alert(error.message || 'No fue posible generar la extensión.');
                });
            });
        }

        dom.graphSelect.addEventListener('change', () => {
            dom.graphModel.value = '';
            syncGraphFields();
        });
        dom.graphRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.graphMessage, error.message, 'error'));
        });
        dom.graphForm.addEventListener('submit', (event) => {
            submitGraph(event).catch((error) => setMessage(dom.graphMessage, error.message, 'error'));
        });

        dom.miracleProductSelect.addEventListener('change', () => {
            dom.miracleProductModel.value = '';
            syncMiracleProductFields();
        });
        dom.miracleProductRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.miracleProductMessage, error.message, 'error'));
        });
        dom.miracleProductForm.addEventListener('submit', (event) => {
            submitMiracleProduct(event).catch((error) => setMessage(dom.miracleProductMessage, error.message, 'error'));
        });

        dom.miracleSttSelect.addEventListener('change', () => {
            dom.miracleSttModel.value = '';
            syncMiracleSttFields();
            renderMedical(state.miracleStt?.medical || {});
        });

        if (dom.medicalEnabled) {
            dom.medicalEnabled.addEventListener('change', syncMedicalFields);
        }
        if (dom.medicalRefresh) {
            dom.medicalRefresh.addEventListener('click', () => {
                refreshAll().catch((error) => setMessage(dom.medicalMessage, error.message, 'error'));
            });
        }
        if (dom.medicalForm) {
            dom.medicalForm.addEventListener('submit', (event) => {
                submitMedical(event).catch((error) => setMessage(dom.medicalMessage, error.message, 'error'));
            });
        }
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
