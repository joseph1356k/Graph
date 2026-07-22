(function () {
    const state = {
        account: null,
        graph: null,
        miracleProduct: null,
        miracleStt: null,
    };

    const dom = {
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

        assistantPill: document.getElementById('assistant-provider-pill'),
        assistantMetric: document.getElementById('assistant-provider-metric'),
        assistantCurrent: document.getElementById('assistant-provider-current'),
        assistantForm: document.getElementById('assistant-provider-form'),
        assistantSelect: document.getElementById('assistant-provider-select'),
        assistantBaseUrlField: document.getElementById('assistant-provider-base-url-field'),
        assistantBaseUrl: document.getElementById('assistant-provider-base-url'),
        assistantModelField: document.getElementById('assistant-provider-model-field'),
        assistantModel: document.getElementById('assistant-provider-model'),
        assistantApiKeyField: document.getElementById('assistant-provider-api-key-field'),
        assistantApiKey: document.getElementById('assistant-provider-api-key'),
        assistantApiKeyToggle: document.getElementById('assistant-provider-api-key-toggle'),
        assistantRefresh: document.getElementById('assistant-provider-refresh'),
        assistantSubmit: document.getElementById('assistant-provider-submit'),
        assistantMessage: document.getElementById('assistant-provider-message'),

        biopsyPill: document.getElementById('biopsy-provider-pill'),
        biopsyMetric: document.getElementById('biopsy-provider-metric'),
        biopsyCurrent: document.getElementById('biopsy-provider-current'),
        biopsyForm: document.getElementById('biopsy-provider-form'),
        biopsySelect: document.getElementById('biopsy-provider-select'),
        biopsyBaseUrlField: document.getElementById('biopsy-provider-base-url-field'),
        biopsyBaseUrl: document.getElementById('biopsy-provider-base-url'),
        biopsyModelField: document.getElementById('biopsy-provider-model-field'),
        biopsyModel: document.getElementById('biopsy-provider-model'),
        biopsyApiKeyField: document.getElementById('biopsy-provider-api-key-field'),
        biopsyApiKey: document.getElementById('biopsy-provider-api-key'),
        biopsyApiKeyToggle: document.getElementById('biopsy-provider-api-key-toggle'),
        biopsyRefresh: document.getElementById('biopsy-provider-refresh'),
        biopsySubmit: document.getElementById('biopsy-provider-submit'),
        biopsyMessage: document.getElementById('biopsy-provider-message'),

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

        consciousPill: document.getElementById('conscious-pill'),
        consciousMetric: document.getElementById('conscious-metric'),
        consciousCurrent: document.getElementById('conscious-current'),
        consciousForm: document.getElementById('conscious-form'),
        consciousSelect: document.getElementById('conscious-select'),
        consciousBaseUrlField: document.getElementById('conscious-base-url-field'),
        consciousBaseUrl: document.getElementById('conscious-base-url'),
        consciousModelField: document.getElementById('conscious-model-field'),
        consciousModel: document.getElementById('conscious-model'),
        consciousApiKeyField: document.getElementById('conscious-api-key-field'),
        consciousApiKey: document.getElementById('conscious-api-key'),
        consciousApiKeyToggle: document.getElementById('conscious-api-key-toggle'),
        consciousRefresh: document.getElementById('conscious-refresh'),
        consciousSubmit: document.getElementById('conscious-submit'),
        consciousMessage: document.getElementById('conscious-message'),

        teachPill: document.getElementById('teach-pill'),
        teachMetric: document.getElementById('teach-metric'),
        teachCurrent: document.getElementById('teach-current'),
        teachForm: document.getElementById('teach-form'),
        teachSelect: document.getElementById('teach-select'),
        teachBaseUrlField: document.getElementById('teach-base-url-field'),
        teachBaseUrl: document.getElementById('teach-base-url'),
        teachModelField: document.getElementById('teach-model-field'),
        teachModel: document.getElementById('teach-model'),
        teachApiKeyField: document.getElementById('teach-api-key-field'),
        teachApiKey: document.getElementById('teach-api-key'),
        teachApiKeyToggle: document.getElementById('teach-api-key-toggle'),
        teachRefresh: document.getElementById('teach-refresh'),
        teachSubmit: document.getElementById('teach-submit'),
        teachMessage: document.getElementById('teach-message'),

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

    function syncAssistantFields() {
        const provider = currentProvider(state.assistant?.providers, dom.assistantSelect);
        dom.assistantApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.assistantBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.assistantModelField.classList.toggle('is-hidden', !provider?.requires_model);
        applyStoredApiKey(dom.assistantApiKey, provider);
        if (provider) {
            renderModelOptions(dom.assistantModel, provider);
        }
        if (provider && !dom.assistantBaseUrl.value) {
            dom.assistantBaseUrl.value = provider.default_base_url || '';
        }
    }

    function syncBiopsyFields() {
        const provider = currentProvider(state.biopsy?.providers, dom.biopsySelect);
        dom.biopsyApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.biopsyBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.biopsyModelField.classList.toggle('is-hidden', !provider?.requires_model);
        applyStoredApiKey(dom.biopsyApiKey, provider);
        if (provider) {
            renderModelOptions(dom.biopsyModel, provider);
        }
        if (provider && !dom.biopsyBaseUrl.value) {
            dom.biopsyBaseUrl.value = provider.default_base_url || '';
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

    function renderAssistant(payload) {
        state.assistant = payload;
        renderOptions(dom.assistantSelect, payload.providers || []);
        const current = payload.current_setup || payload.status || {};
        if (current.provider) {
            dom.assistantSelect.value = current.provider;
        }
        dom.assistantBaseUrl.value = current.base_url || '';
        renderModelOptions(dom.assistantModel, currentProvider(payload.providers, dom.assistantSelect), current.model || '');
        syncAssistantFields();
        dom.assistantCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.source || 'runtime actual'}`
            : 'Sin provider explicito para el asistente. Chat clinico deshabilitado.';
        const assistantConfigured = Boolean(current.configured);
        dom.assistantMetric.textContent = formatSummary(current);
        setPill(dom.assistantPill, assistantConfigured ? 'Configurado' : 'Sin credenciales', assistantConfigured ? 'ready' : 'danger');
        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        if (!vercelReady) {
            setMessage(
                dom.assistantMessage,
                `Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel. Estrategia de deploy: ${redeployMode}.`,
                'warning'
            );
        } else if (dom.assistantMessage.dataset.tone === 'warning') {
            setMessage(dom.assistantMessage, '');
        }
    }

    function renderBiopsy(payload) {
        state.biopsy = payload;
        renderOptions(dom.biopsySelect, payload.providers || []);
        const current = payload.current_setup || payload.status || {};
        if (current.provider) {
            dom.biopsySelect.value = current.provider;
        }
        dom.biopsyBaseUrl.value = current.base_url || '';
        renderModelOptions(dom.biopsyModel, currentProvider(payload.providers, dom.biopsySelect), current.model || '');
        syncBiopsyFields();
        dom.biopsyCurrent.textContent = current.provider
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'} - ${current.source || 'runtime actual'}`
            : 'Sin provider explicito para biopsia. Lectura de fotos deshabilitada.';
        const biopsyConfigured = Boolean(current.configured);
        dom.biopsyMetric.textContent = formatSummary(current);
        setPill(dom.biopsyPill, biopsyConfigured ? 'Configurado' : 'Sin credenciales', biopsyConfigured ? 'ready' : 'danger');
        const vercelReady = payload?.vercel?.write_enabled;
        const redeployMode = payload?.vercel?.deploy_hook_configured ? 'deploy hook' : 'redeploy API/manual';
        if (!vercelReady) {
            setMessage(
                dom.biopsyMessage,
                `Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel. Estrategia de deploy: ${redeployMode}.`,
                'warning'
            );
        } else if (dom.biopsyMessage.dataset.tone === 'warning') {
            setMessage(dom.biopsyMessage, '');
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
        const [graph, assistant, biopsy, miracleProduct, miracleStt, conscious, teach] = await Promise.all([
            fetchJson('/api/providers/graph/status'),
            fetchJson('/api/providers/assistant/status'),
            fetchJson('/api/providers/biopsy/status'),
            fetchJson('/api/product-llm/status'),
            fetchJson('/api/providers/miracle-stt/status'),
            fetchJson('/api/providers/conscious/status'),
            fetchJson('/api/providers/teach-video/status')
        ]);
        renderGraph(graph);
        renderAssistant(assistant);
        renderBiopsy(biopsy);
        renderMiracleProduct(miracleProduct);
        renderMiracleStt(miracleStt);
        renderConscious(conscious);
        renderTeach(teach);
        dom.overallStatus.textContent = 'Listo';
    }

    async function submitAssistant(event) {
        event.preventDefault();
        const provider = currentProvider(state.assistant?.providers, dom.assistantSelect);
        if (!provider) return;
        dom.assistantSubmit.disabled = true;
        setMessage(dom.assistantMessage, 'Guardando configuracion del Asistente en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/assistant/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    base_url: dom.assistantBaseUrl.value,
                    model: dom.assistantModel.value,
                    api_key: dom.assistantApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.assistantMessage, `Asistente actualizado.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.assistantMessage, error.message || 'No fue posible guardar el Asistente.', 'error');
        } finally {
            dom.assistantSubmit.disabled = false;
        }
    }

    async function submitBiopsy(event) {
        event.preventDefault();
        const provider = currentProvider(state.biopsy?.providers, dom.biopsySelect);
        if (!provider) return;
        dom.biopsySubmit.disabled = true;
        setMessage(dom.biopsyMessage, 'Guardando configuracion de Biopsia en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/biopsy/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    base_url: dom.biopsyBaseUrl.value,
                    model: dom.biopsyModel.value,
                    api_key: dom.biopsyApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.biopsyMessage, `Biopsia actualizada.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.biopsyMessage, error.message || 'No fue posible guardar Biopsia.', 'error');
        } finally {
            dom.biopsySubmit.disabled = false;
        }
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

    // -------- Superficie Windows: agente de escritorio (conscious) --------
    function syncConsciousFields() {
        const provider = currentProvider(state.conscious?.providers, dom.consciousSelect);
        dom.consciousApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.consciousBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.consciousModelField.classList.toggle('is-hidden', !provider?.requires_model);
        applyStoredApiKey(dom.consciousApiKey, provider);
        if (provider) {
            renderModelOptions(dom.consciousModel, provider);
        }
    }

    function renderConscious(payload) {
        state.conscious = payload;
        renderOptions(dom.consciousSelect, payload.providers || []);
        const current = payload.current_setup || {};
        if (current.provider) {
            dom.consciousSelect.value = current.provider;
        }
        const provider = currentProvider(payload.providers, dom.consciousSelect);
        renderModelOptions(dom.consciousModel, provider, current.model || provider?.default_model || '');
        syncConsciousFields();
        dom.consciousCurrent.textContent = current.provider && current.provider !== 'disabled'
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'}`
            : 'Actual: cerebro deshabilitado.';
        const configured = Boolean(payload.status?.configured);
        dom.consciousMetric.textContent = formatSummary({ ...current, configured });
        setPill(dom.consciousPill, configured ? 'Configurado' : 'Sin configurar', configured ? 'ready' : 'danger');
        const vercelReady = payload?.vercel?.write_enabled;
        if (!vercelReady) {
            setMessage(dom.consciousMessage, 'Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel.', 'warning');
        } else if (dom.consciousMessage.dataset.tone === 'warning') {
            setMessage(dom.consciousMessage, '');
        }
    }

    async function submitConscious(event) {
        event.preventDefault();
        const provider = currentProvider(state.conscious?.providers, dom.consciousSelect);
        if (!provider) return;
        dom.consciousSubmit.disabled = true;
        setMessage(dom.consciousMessage, 'Guardando agente de escritorio en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/conscious/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    model: dom.consciousModel.value,
                    api_key: dom.consciousApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.consciousMessage, `Agente de escritorio actualizado.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.consciousMessage, error.message || 'No fue posible guardar el agente.', 'error');
        } finally {
            dom.consciousSubmit.disabled = false;
        }
    }

    // -------- Superficie Windows: enseñanza por video (teach) --------
    function syncTeachFields() {
        const provider = currentProvider(state.teach?.providers, dom.teachSelect);
        dom.teachApiKeyField.classList.toggle('is-hidden', !provider?.requires_api_key);
        dom.teachBaseUrlField.classList.toggle('is-hidden', !provider?.requires_base_url);
        dom.teachModelField.classList.toggle('is-hidden', !provider?.requires_model);
        applyStoredApiKey(dom.teachApiKey, provider);
        if (provider) {
            renderModelOptions(dom.teachModel, provider);
        }
    }

    function renderTeach(payload) {
        state.teach = payload;
        renderOptions(dom.teachSelect, payload.providers || []);
        const current = payload.current_setup || {};
        if (current.provider) {
            dom.teachSelect.value = current.provider;
        }
        const provider = currentProvider(payload.providers, dom.teachSelect);
        renderModelOptions(dom.teachModel, provider, current.model || provider?.default_model || '');
        syncTeachFields();
        dom.teachCurrent.textContent = current.provider && current.provider !== 'disabled'
            ? `Actual: ${current.label || current.provider} - ${current.model || 'sin modelo'}`
            : 'Actual: enseñanza por video deshabilitada.';
        const configured = Boolean(payload.status?.configured);
        dom.teachMetric.textContent = formatSummary({ ...current, configured });
        setPill(dom.teachPill, configured ? 'Configurado' : 'Sin configurar', configured ? 'ready' : 'danger');
        const vercelReady = payload?.vercel?.write_enabled;
        if (!vercelReady) {
            setMessage(dom.teachMessage, 'Falta GRAPH_VERCEL_API_TOKEN en el servidor para guardar secretos en Vercel.', 'warning');
        } else if (dom.teachMessage.dataset.tone === 'warning') {
            setMessage(dom.teachMessage, '');
        }
    }

    async function submitTeach(event) {
        event.preventDefault();
        const provider = currentProvider(state.teach?.providers, dom.teachSelect);
        if (!provider) return;
        dom.teachSubmit.disabled = true;
        setMessage(dom.teachMessage, 'Guardando enseñanza por video en Vercel...');
        try {
            const payload = await fetchJson('/api/providers/teach-video/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider.id,
                    model: dom.teachModel.value,
                    api_key: dom.teachApiKey.value
                })
            });
            await refreshAll();
            const deploymentMessage = payload?.deployment?.triggered
                ? ' Vercel ya empezo el redeploy.'
                : ` ${payload?.deployment?.message || 'Recuerda redeployar para aplicar el cambio.'}`;
            setMessage(dom.teachMessage, `Enseñanza por video actualizada.${deploymentMessage}`, 'success');
        } catch (error) {
            setMessage(dom.teachMessage, error.message || 'No fue posible guardar la enseñanza.', 'error');
        } finally {
            dom.teachSubmit.disabled = false;
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
        bindCollapsible('assistant-provider-card', 'assistant-provider-toggle');
        bindCollapsible('biopsy-provider-card', 'biopsy-provider-toggle');
        bindCollapsible('conscious-card', 'conscious-toggle');
        bindCollapsible('teach-card', 'teach-toggle');

        bindApiKeyToggle(dom.graphApiKeyToggle, dom.graphApiKey);
        bindApiKeyToggle(dom.assistantApiKeyToggle, dom.assistantApiKey);
        bindApiKeyToggle(dom.biopsyApiKeyToggle, dom.biopsyApiKey);
        bindApiKeyToggle(dom.miracleProductApiKeyToggle, dom.miracleProductApiKey);
        bindApiKeyToggle(dom.miracleSttApiKeyToggle, dom.miracleSttApiKey);
        bindApiKeyToggle(dom.consciousApiKeyToggle, dom.consciousApiKey);
        bindApiKeyToggle(dom.teachApiKeyToggle, dom.teachApiKey);

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

        dom.assistantSelect.addEventListener('change', () => {
            dom.assistantModel.value = '';
            syncAssistantFields();
        });
        dom.assistantRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.assistantMessage, error.message, 'error'));
        });
        dom.assistantForm.addEventListener('submit', (event) => {
            submitAssistant(event).catch((error) => setMessage(dom.assistantMessage, error.message, 'error'));
        });

        dom.biopsySelect.addEventListener('change', () => {
            dom.biopsyModel.value = '';
            syncBiopsyFields();
        });
        dom.biopsyRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.biopsyMessage, error.message, 'error'));
        });
        dom.biopsyForm.addEventListener('submit', (event) => {
            submitBiopsy(event).catch((error) => setMessage(dom.biopsyMessage, error.message, 'error'));
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

        dom.consciousSelect.addEventListener('change', () => {
            dom.consciousModel.value = '';
            syncConsciousFields();
        });
        dom.consciousRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.consciousMessage, error.message, 'error'));
        });
        dom.consciousForm.addEventListener('submit', (event) => {
            submitConscious(event).catch((error) => setMessage(dom.consciousMessage, error.message, 'error'));
        });

        dom.teachSelect.addEventListener('change', () => {
            dom.teachModel.value = '';
            syncTeachFields();
        });
        dom.teachRefresh.addEventListener('click', () => {
            refreshAll().catch((error) => setMessage(dom.teachMessage, error.message, 'error'));
        });
        dom.teachForm.addEventListener('submit', (event) => {
            submitTeach(event).catch((error) => setMessage(dom.teachMessage, error.message, 'error'));
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

// ---------------------------------------------------------------------------
// Superficies (Web App / Windows App / Android App) + panel Android:
// config distribuida y telemetría de instalaciones. Módulo independiente,
// mismo patrón de fetch autenticado que el resto del archivo.
// ---------------------------------------------------------------------------
(function () {
    const tabs = Array.from(document.querySelectorAll('.studio-surface-tab'));
    const panels = Array.from(document.querySelectorAll('[data-surface-panel]'));
    if (!tabs.length || !panels.length) return;

    const dom = {
        configMetric: document.getElementById('android-config-metric'),
        configPill: document.getElementById('android-config-pill'),
        configForm: document.getElementById('android-config-form'),
        openaiKey: document.getElementById('android-openai-key'),
        geminiKey: document.getElementById('android-gemini-key'),
        deepgramKey: document.getElementById('android-deepgram-key'),
        defaultProvider: document.getElementById('android-default-provider'),
        openaiModel: document.getElementById('android-openai-model'),
        geminiModel: document.getElementById('android-gemini-model'),
        configRefresh: document.getElementById('android-config-refresh'),
        configSubmit: document.getElementById('android-config-submit'),
        configMessage: document.getElementById('android-config-message'),

        breadcrumb: document.getElementById('android-breadcrumb'),
        usersRefresh: document.getElementById('android-users-refresh'),
        viewUsers: document.getElementById('android-view-users'),
        usersGrid: document.getElementById('android-users-grid'),
        viewUser: document.getElementById('android-view-user'),
        userTitle: document.getElementById('android-user-title'),
        userSubtitle: document.getElementById('android-user-subtitle'),
        deviceLogsButton: document.getElementById('android-device-logs-button'),
        promptsList: document.getElementById('android-prompts-list'),
        viewLogs: document.getElementById('android-view-logs'),
        logsTitle: document.getElementById('android-logs-title'),
        terminal: document.getElementById('android-logs-terminal'),
        usersMessage: document.getElementById('android-users-message'),

        windowsDownloadSplit: document.getElementById('windows-download-split'),
        windowsDownloadCaret: document.getElementById('windows-download-caret'),
        windowsDownloadMenu: document.getElementById('windows-download-menu'),
        windowsDistributeTrigger: document.getElementById('windows-distribute-trigger'),
        windowsBuildProgress: document.getElementById('windows-build-progress'),
        windowsBuildProgressTitle: document.getElementById('windows-build-progress-title'),
        windowsBuildProgressDetail: document.getElementById('windows-build-progress-detail'),
        windowsBuildMeta: document.getElementById('windows-build-meta')
    };

    const state = {
        loaded: false,
        active: false,
        view: 'users', // users | user | logs
        users: [],
        currentUser: null,
        currentPrompt: null, // null cuando la vista de logs es "device"
        logsMode: 'prompt', // prompt | device
        usersTimer: null,
        logsTimer: null,
        windowsBuildTimer: null,
        windowsBuildStartedAt: 0
    };

    const WINDOWS_BUILD_POLL_MS = 4000;
    const WINDOWS_BUILD_TIMEOUT_MS = 15 * 60 * 1000;

    const STATUS_LABELS = {
        running: 'En ejecución',
        ok: 'OK',
        error: 'Error',
        cancelled: 'Cancelado'
    };

    async function authedFetch(url, init = {}) {
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
        const response = await authedFetch(url, init);
        const text = await response.text();
        let payload = {};
        if (text.trim()) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                if (!response.ok) throw new Error(text.slice(0, 220) || `HTTP ${response.status}`);
                throw error;
            }
        }
        if (!response.ok) {
            throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    function setMessage(element, text, tone = '') {
        if (!element) return;
        element.textContent = text || '';
        if (tone) element.dataset.tone = tone;
        else delete element.dataset.tone;
    }

    function setPill(element, label, tone) {
        if (!element) return;
        element.textContent = label;
        element.dataset.tone = tone;
    }

    function timeAgo(iso) {
        const stamp = Date.parse(iso || '');
        if (!Number.isFinite(stamp)) return 'sin registro';
        const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
        if (seconds < 60) return 'hace segundos';
        if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
        if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
        return `hace ${Math.floor(seconds / 86400)} d`;
    }

    function formatClock(iso) {
        const stamp = Date.parse(iso || '');
        if (!Number.isFinite(stamp)) return '--:--:--';
        return new Date(stamp).toLocaleTimeString('es-CO', { hour12: false });
    }

    function formatDateTime(iso) {
        const stamp = Date.parse(iso || '');
        if (!Number.isFinite(stamp)) return '';
        return new Date(stamp).toLocaleString('es-CO', { hour12: false });
    }

    function formatDuration(startedAt, finishedAt) {
        const start = Date.parse(startedAt || '');
        const end = Date.parse(finishedAt || '');
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
        const seconds = Math.round((end - start) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ${seconds % 60}s`;
    }

    // -------------------------- tabs de superficies --------------------------

    function activateSurface(surface) {
        tabs.forEach((tab) => {
            const isActive = tab.dataset.surface === surface;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        panels.forEach((panel) => {
            panel.classList.toggle('is-hidden', panel.dataset.surfacePanel !== surface);
        });

        const enteringAndroid = surface === 'android';
        if (enteringAndroid && !state.active) {
            state.active = true;
            ensureAndroidLoaded();
            startUsersPolling();
            resumeLogsPollingIfNeeded();
        } else if (!enteringAndroid && state.active) {
            state.active = false;
            stopUsersPolling();
            stopLogsPolling();
        }
    }

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => activateSurface(tab.dataset.surface));
    });

    // ------------------- distribución de la app de Windows ------------------

    function closeWindowsDownloadMenu() {
        if (!dom.windowsDownloadMenu) return;
        dom.windowsDownloadMenu.classList.add('is-hidden');
        dom.windowsDownloadCaret?.setAttribute('aria-expanded', 'false');
    }

    function toggleWindowsDownloadMenu() {
        if (!dom.windowsDownloadMenu) return;
        const opening = dom.windowsDownloadMenu.classList.contains('is-hidden');
        dom.windowsDownloadMenu.classList.toggle('is-hidden', !opening);
        dom.windowsDownloadCaret?.setAttribute('aria-expanded', String(opening));
    }

    function setWindowsBuildProgress(visible, title, detail) {
        if (!dom.windowsBuildProgress) return;
        dom.windowsBuildProgress.classList.toggle('is-hidden', !visible);
        if (title !== undefined && dom.windowsBuildProgressTitle) {
            dom.windowsBuildProgressTitle.textContent = title;
        }
        if (detail !== undefined && dom.windowsBuildProgressDetail) {
            dom.windowsBuildProgressDetail.textContent = detail;
        }
    }

    function stopWindowsBuildPolling() {
        if (state.windowsBuildTimer) {
            window.clearInterval(state.windowsBuildTimer);
            state.windowsBuildTimer = null;
        }
    }

    function finishWindowsBuild(title, detail) {
        stopWindowsBuildPolling();
        setWindowsBuildProgress(true, title, detail);
        if (dom.windowsDistributeTrigger) dom.windowsDistributeTrigger.disabled = false;
        window.setTimeout(() => setWindowsBuildProgress(false), 8000);
    }

    function pollWindowsBuild(requestId, version) {
        stopWindowsBuildPolling();
        state.windowsBuildStartedAt = Date.now();
        state.windowsBuildTimer = window.setInterval(async () => {
            if (Date.now() - state.windowsBuildStartedAt > WINDOWS_BUILD_TIMEOUT_MS) {
                finishWindowsBuild('Tiempo de espera agotado', 'El build sigue corriendo en GitHub Actions; revísalo allá.');
                return;
            }
            try {
                const status = await fetchJson(`/api/providers/windows-app/build/status?request_id=${encodeURIComponent(requestId)}`);
                if (status.phase === 'success') {
                    finishWindowsBuild('Build publicado', `Versión ${version} distribuida correctamente.`);
                    loadWindowsBuildMeta();
                } else if (status.phase === 'failure') {
                    finishWindowsBuild('El build falló', status.runUrl ? `Revisa el run en GitHub: ${status.runUrl}` : 'Revisa el workflow en GitHub Actions.');
                } else {
                    setWindowsBuildProgress(true, status.phase === 'running' ? 'Construyendo…' : 'En cola…', `Versión ${version}`);
                }
            } catch (error) {
                finishWindowsBuild('No se pudo leer el estado', error.message || 'Intenta de nuevo desde Provider Studio.');
            }
        }, WINDOWS_BUILD_POLL_MS);
    }

    async function triggerWindowsDistribute() {
        if (!dom.windowsDistributeTrigger || dom.windowsDistributeTrigger.disabled) return;
        closeWindowsDownloadMenu();
        dom.windowsDistributeTrigger.disabled = true;
        setWindowsBuildProgress(true, 'Iniciando build…', 'Disparando el workflow en GitHub Actions.');
        try {
            const { requestId, version } = await fetchJson('/api/providers/windows-app/build', { method: 'POST' });
            setWindowsBuildProgress(true, 'Construyendo…', `Versión ${version}`);
            pollWindowsBuild(requestId, version);
        } catch (error) {
            finishWindowsBuild('No se pudo iniciar el build', error.message || 'Intenta de nuevo.');
        }
    }

    async function loadWindowsBuildMeta() {
        if (!dom.windowsBuildMeta) return;
        try {
            const info = await fetchJson('/api/providers/windows-app/build-info');
            if (!info.lastBuildAt) {
                dom.windowsBuildMeta.textContent = 'Aún no se ha distribuido ningún build.';
                return;
            }
            const when = formatDateTime(info.lastBuildAt);
            const freshness = info.upToDate === true
                ? 'al día con main'
                : info.upToDate === false
                    ? 'desactualizado, main tiene cambios nuevos'
                    : '';
            dom.windowsBuildMeta.textContent = freshness
                ? `Último build: ${when} · ${freshness}`
                : `Último build: ${when}`;
        } catch (error) {
            dom.windowsBuildMeta.textContent = '';
        }
    }

    // ------------------------- config distribuida ---------------------------

    function fillConfig(config) {
        dom.openaiKey.value = config.openai_key || '';
        dom.geminiKey.value = config.gemini_key || '';
        dom.deepgramKey.value = config.deepgram_key || '';
        dom.defaultProvider.value = config.default_provider || 'OPENAI';
        dom.openaiModel.value = config.default_openai_model || '';
        dom.geminiModel.value = config.default_gemini_model || '';
        [dom.openaiKey, dom.geminiKey, dom.deepgramKey].forEach((input) => {
            input.type = 'password';
            const toggle = input.parentElement?.querySelector('.field-key-toggle');
            if (toggle) toggle.setAttribute('aria-pressed', 'false');
        });

        const keysReady = [config.openai_key, config.gemini_key].filter(Boolean).length;
        dom.configMetric.textContent = `${config.default_provider || 'OPENAI'} · ${config.updated_at ? `actualizada ${timeAgo(config.updated_at)}` : 'sin guardar'}`;
        setPill(dom.configPill, keysReady ? 'Configurado' : 'Sin keys', keysReady ? 'ready' : 'danger');
    }

    async function loadConfig() {
        try {
            const payload = await fetchJson('/api/android/client-config');
            fillConfig(payload.config || {});
        } catch (error) {
            dom.configMetric.textContent = 'Error';
            setPill(dom.configPill, 'Error', 'danger');
            setMessage(dom.configMessage, error.message || 'No fue posible leer la config distribuida.', 'error');
        }
    }

    async function submitConfig(event) {
        event.preventDefault();
        dom.configSubmit.disabled = true;
        setMessage(dom.configMessage, 'Guardando config distribuida…');
        try {
            const payload = await fetchJson('/api/android/client-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    openai_key: dom.openaiKey.value,
                    gemini_key: dom.geminiKey.value,
                    deepgram_key: dom.deepgramKey.value,
                    default_provider: dom.defaultProvider.value,
                    default_openai_model: dom.openaiModel.value,
                    default_gemini_model: dom.geminiModel.value
                })
            });
            fillConfig(payload.config || {});
            setMessage(dom.configMessage, 'Config distribuida guardada. Las apps la descargan en su próximo arranque.', 'success');
        } catch (error) {
            setMessage(dom.configMessage, error.message || 'No fue posible guardar la config distribuida.', 'error');
        } finally {
            dom.configSubmit.disabled = false;
        }
    }

    // ------------------------------ navegación ------------------------------

    function renderBreadcrumb() {
        dom.breadcrumb.innerHTML = '';
        const crumbs = [{ label: 'Usuarios', action: showUsersView }];
        if (state.view === 'user' || state.view === 'logs') {
            const name = state.currentUser?.display_name || state.currentUser?.device_id || 'Usuario';
            crumbs.push({ label: name, action: () => openUser(state.currentUser) });
        }
        if (state.view === 'logs') {
            crumbs.push({
                label: state.logsMode === 'device' ? 'Logs del dispositivo' : 'Logs del prompt',
                action: null
            });
        }
        crumbs.forEach((crumb, index) => {
            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'android-crumb-sep';
                sep.textContent = '/';
                dom.breadcrumb.appendChild(sep);
            }
            const isLast = index === crumbs.length - 1;
            const el = document.createElement(isLast ? 'span' : 'button');
            el.className = `android-crumb${isLast ? ' is-current' : ''}`;
            el.textContent = crumb.label;
            if (!isLast) {
                el.type = 'button';
                el.addEventListener('click', crumb.action);
            }
            dom.breadcrumb.appendChild(el);
        });
    }

    function switchView(view) {
        state.view = view;
        dom.viewUsers.classList.toggle('is-hidden', view !== 'users');
        dom.viewUser.classList.toggle('is-hidden', view !== 'user');
        dom.viewLogs.classList.toggle('is-hidden', view !== 'logs');
        if (view !== 'logs') {
            stopLogsPolling();
        }
        renderBreadcrumb();
    }

    function showUsersView() {
        state.currentUser = state.view === 'users' ? null : state.currentUser;
        state.currentPrompt = null;
        switchView('users');
        renderUsers();
    }

    // -------------------------------- usuarios ------------------------------

    function renderUsers() {
        dom.usersGrid.innerHTML = '';
        if (!state.users.length) {
            const empty = document.createElement('p');
            empty.className = 'android-empty';
            empty.textContent = 'Aún no hay instalaciones registradas de la app Android.';
            dom.usersGrid.appendChild(empty);
            return;
        }
        state.users.forEach((user) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'android-user-card';

            const name = document.createElement('strong');
            name.className = 'android-user-name';
            name.textContent = user.display_name || user.device_id;

            const meta = document.createElement('span');
            meta.className = 'android-user-meta';
            meta.textContent = [user.device_model, user.app_version ? `v${user.app_version}` : '']
                .filter(Boolean).join(' · ') || 'Dispositivo desconocido';

            const seen = document.createElement('span');
            seen.className = 'android-user-seen';
            seen.textContent = `Visto ${timeAgo(user.last_seen_at)}`;

            const count = document.createElement('span');
            count.className = 'android-user-count';
            count.textContent = user.prompt_count === 1 ? '1 prompt' : `${user.prompt_count || 0} prompts`;

            card.append(name, meta, seen, count);
            card.addEventListener('click', () => openUser(user));
            dom.usersGrid.appendChild(card);
        });
    }

    async function loadUsers({ silent = false } = {}) {
        if (!silent) setMessage(dom.usersMessage, 'Cargando usuarios…');
        try {
            const payload = await fetchJson('/api/android/users');
            state.users = Array.isArray(payload.users) ? payload.users : [];
            if (state.view === 'users') renderUsers();
            if (!silent) setMessage(dom.usersMessage, '');
        } catch (error) {
            if (!silent) setMessage(dom.usersMessage, error.message || 'No fue posible leer los usuarios.', 'error');
        }
    }

    function startUsersPolling() {
        stopUsersPolling();
        state.usersTimer = window.setInterval(() => {
            loadUsers({ silent: true });
        }, 10000);
    }

    function stopUsersPolling() {
        if (state.usersTimer) {
            window.clearInterval(state.usersTimer);
            state.usersTimer = null;
        }
    }

    // -------------------------------- prompts -------------------------------

    function statusBadge(status) {
        const badge = document.createElement('span');
        badge.className = 'android-badge';
        badge.dataset.status = status || 'running';
        badge.textContent = STATUS_LABELS[status] || status || '?';
        return badge;
    }

    function renderPrompts(prompts) {
        dom.promptsList.innerHTML = '';
        if (!prompts.length) {
            const empty = document.createElement('p');
            empty.className = 'android-empty';
            empty.textContent = 'Este usuario aún no ha ejecutado prompts.';
            dom.promptsList.appendChild(empty);
            return;
        }
        prompts.forEach((prompt) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'android-prompt-row';

            const head = document.createElement('div');
            head.className = 'android-prompt-head';
            const time = document.createElement('span');
            time.className = 'android-prompt-time';
            time.textContent = formatDateTime(prompt.started_at);
            head.appendChild(time);
            head.appendChild(statusBadge(prompt.status));
            const duration = formatDuration(prompt.started_at, prompt.finished_at);
            if (duration) {
                const dur = document.createElement('span');
                dur.className = 'android-prompt-duration';
                dur.textContent = duration;
                head.appendChild(dur);
            }

            const text = document.createElement('p');
            text.className = 'android-prompt-text';
            text.textContent = prompt.prompt || '';

            row.append(head, text);
            if (prompt.summary) {
                const summary = document.createElement('p');
                summary.className = 'android-prompt-summary';
                summary.textContent = prompt.summary;
                row.appendChild(summary);
            }
            row.addEventListener('click', () => openPromptLogs(prompt));
            dom.promptsList.appendChild(row);
        });
    }

    async function openUser(user) {
        if (!user) return;
        state.currentUser = user;
        state.currentPrompt = null;
        dom.userTitle.textContent = user.display_name || user.device_id;
        dom.userSubtitle.textContent = [
            user.device_model,
            user.app_version ? `v${user.app_version}` : '',
            `visto ${timeAgo(user.last_seen_at)}`
        ].filter(Boolean).join(' · ');
        switchView('user');
        dom.promptsList.innerHTML = '<p class="android-empty">Cargando prompts…</p>';
        try {
            const payload = await fetchJson(`/api/android/users/${encodeURIComponent(user.device_id)}/prompts`);
            renderPrompts(Array.isArray(payload.prompts) ? payload.prompts : []);
        } catch (error) {
            dom.promptsList.innerHTML = '';
            setMessage(dom.usersMessage, error.message || 'No fue posible leer los prompts.', 'error');
        }
    }

    // ---------------------------------- logs --------------------------------

    function renderLogs(logs) {
        dom.terminal.innerHTML = '';
        if (!logs.length) {
            const empty = document.createElement('p');
            empty.className = 'android-terminal-empty';
            empty.textContent = 'Sin líneas de log todavía.';
            dom.terminal.appendChild(empty);
            return;
        }
        const stickToBottom = dom.terminal.scrollHeight - dom.terminal.scrollTop - dom.terminal.clientHeight < 40;
        logs.forEach((log) => {
            const line = document.createElement('div');
            line.className = 'android-log-line';
            const time = document.createElement('span');
            time.className = 'android-log-time';
            time.textContent = formatClock(log.at);
            const tag = document.createElement('span');
            tag.className = 'android-log-tag';
            tag.textContent = log.tag ? `[${log.tag}]` : '[—]';
            const message = document.createElement('span');
            message.className = 'android-log-message';
            message.textContent = log.message || '';
            line.append(time, tag, message);
            dom.terminal.appendChild(line);
        });
        if (stickToBottom) {
            dom.terminal.scrollTop = dom.terminal.scrollHeight;
        }
    }

    async function refreshLogs({ silent = false } = {}) {
        try {
            const url = state.logsMode === 'device'
                ? `/api/android/users/${encodeURIComponent(state.currentUser.device_id)}/logs`
                : `/api/android/prompts/${encodeURIComponent(state.currentPrompt.id)}/logs`;
            const payload = await fetchJson(url);
            renderLogs(Array.isArray(payload.logs) ? payload.logs : []);
            if (!silent) setMessage(dom.usersMessage, '');
        } catch (error) {
            if (!silent) setMessage(dom.usersMessage, error.message || 'No fue posible leer los logs.', 'error');
        }
    }

    function startLogsPolling() {
        stopLogsPolling();
        state.logsTimer = window.setInterval(() => {
            refreshLogs({ silent: true });
        }, 5000);
    }

    function stopLogsPolling() {
        if (state.logsTimer) {
            window.clearInterval(state.logsTimer);
            state.logsTimer = null;
        }
    }

    function resumeLogsPollingIfNeeded() {
        if (state.view === 'logs'
            && state.logsMode === 'prompt'
            && state.currentPrompt?.status === 'running') {
            startLogsPolling();
        }
    }

    async function openPromptLogs(prompt) {
        state.currentPrompt = prompt;
        state.logsMode = 'prompt';
        switchView('logs');
        const headBits = [formatDateTime(prompt.started_at), STATUS_LABELS[prompt.status] || prompt.status];
        const duration = formatDuration(prompt.started_at, prompt.finished_at);
        if (duration) headBits.push(duration);
        dom.logsTitle.textContent = `${headBits.join(' · ')} — ${prompt.prompt || ''}`;
        dom.terminal.innerHTML = '<p class="android-terminal-empty">Cargando logs…</p>';
        await refreshLogs();
        if (prompt.status === 'running') {
            startLogsPolling();
        }
    }

    async function openDeviceLogs() {
        if (!state.currentUser) return;
        state.currentPrompt = null;
        state.logsMode = 'device';
        switchView('logs');
        dom.logsTitle.textContent = `Últimos logs de ${state.currentUser.display_name || state.currentUser.device_id} (incluye líneas sin prompt)`;
        dom.terminal.innerHTML = '<p class="android-terminal-empty">Cargando logs…</p>';
        await refreshLogs();
    }

    // --------------------------------- setup --------------------------------

    function ensureAndroidLoaded() {
        if (state.loaded) return;
        state.loaded = true;
        loadConfig();
        loadUsers();
        renderBreadcrumb();
    }

    function bindKeyToggle(input) {
        const toggle = input?.parentElement?.querySelector('.field-key-toggle');
        if (!toggle) return;
        toggle.addEventListener('click', () => {
            const revealed = input.type === 'text';
            input.type = revealed ? 'password' : 'text';
            toggle.setAttribute('aria-pressed', revealed ? 'false' : 'true');
            toggle.setAttribute('aria-label', revealed ? 'Mostrar API key' : 'Ocultar API key');
        });
    }

    [dom.openaiKey, dom.geminiKey, dom.deepgramKey].forEach(bindKeyToggle);

    dom.configForm.addEventListener('submit', (event) => {
        submitConfig(event).catch((error) => setMessage(dom.configMessage, error.message, 'error'));
    });
    dom.configRefresh.addEventListener('click', () => {
        loadConfig();
        setMessage(dom.configMessage, '');
    });

    dom.usersRefresh.addEventListener('click', () => {
        if (state.view === 'users') loadUsers();
        else if (state.view === 'user') openUser(state.currentUser);
        else refreshLogs();
    });
    dom.deviceLogsButton.addEventListener('click', () => {
        openDeviceLogs().catch((error) => setMessage(dom.usersMessage, error.message, 'error'));
    });

    if (dom.windowsDownloadCaret) {
        dom.windowsDownloadCaret.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleWindowsDownloadMenu();
        });
    }
    if (dom.windowsDistributeTrigger) {
        dom.windowsDistributeTrigger.addEventListener('click', () => {
            triggerWindowsDistribute();
        });
    }
    // Delegado: cualquier item del menú (incluida "Descargar extensión", que
    // vive en el módulo principal del archivo) cierra el dropdown al hacer clic.
    dom.windowsDownloadMenu?.addEventListener('click', (event) => {
        if (event.target.closest('.studio-split-menu-item')) {
            closeWindowsDownloadMenu();
        }
    });
    document.addEventListener('click', (event) => {
        if (dom.windowsDownloadSplit && !dom.windowsDownloadSplit.contains(event.target)) {
            closeWindowsDownloadMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeWindowsDownloadMenu();
    });
    loadWindowsBuildMeta();
})();
