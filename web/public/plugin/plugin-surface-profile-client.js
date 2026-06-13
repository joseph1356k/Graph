(function () {
    function create(deps = {}) {
        const getOptions = typeof deps.getOptions === 'function' ? deps.getOptions : () => ({});
        const setOptions = typeof deps.setOptions === 'function' ? deps.setOptions : () => {};
        const getDefaults = typeof deps.getDefaults === 'function' ? deps.getDefaults : () => ({ assistantRuntime: {} });
        const runtime = typeof deps.runtime === 'function' ? deps.runtime : () => null;
        const requireApiClient = typeof deps.requireApiClient === 'function' ? deps.requireApiClient : null;
        const emitPluginEvent = typeof deps.emitPluginEvent === 'function' ? deps.emitPluginEvent : () => {};

        let hydrationPromise = null;

        function isAnonymousUser(user) {
            if (!user) return true;
            if (user.role === 'local-dev') return false;
            if (user.is_anonymous === true) return true;
            const provider = `${user.app_metadata?.provider || user.user_metadata?.provider || ''}`.trim().toLowerCase();
            const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
            return provider === 'anonymous'
                || providers.some((value) => `${value || ''}`.trim().toLowerCase() === 'anonymous');
        }

        function persistLearningContextNote(note) {
            if (!note || !note.transcript || !requireApiClient) {
                return Promise.resolve();
            }
            return requireApiClient().appendWorkflowContextNote(note, note.sessionId || '').catch((error) => {
                console.warn('[LearningContext] Could not persist note:', error.message || error);
            });
        }

        function getPageContext() {
            const options = getOptions();
            const normalizePathname = window.GraphPluginAdapters?.normalizePathname;
            return window.GraphPluginContext?.buildPageContext?.(options) || {
                appId: options.appId || '',
                sourceUrl: window.location.href,
                sourceOrigin: window.location.origin,
                sourcePathname: typeof normalizePathname === 'function'
                    ? normalizePathname(window.location.pathname)
                    : window.location.pathname,
                sourceTitle: document.title,
                browserLocale: navigator.language || '',
                browserLanguages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [],
                assistantProfile: options.assistantProfile || null,
                assistantPrompt: options.assistantPrompt || '',
                surfaceProfileId: options.surfaceProfile?.id || '',
                surfaceProfileScope: options.surfaceProfile?.scope || 'global',
                ownerId: options.surfaceProfile?.ownerId || '',
                languageCode: options.surfaceProfile?.languageCode || (navigator.language || 'es').split(/[-_]/)[0].toLowerCase()
            };
        }

        function isGenericWorkflowDescription(value) {
            const normalized = `${value || ''}`.trim();
            return !normalized || /^workflow on /i.test(normalized);
        }

        function applySurfaceProfileToOptions(surfaceProfile) {
            if (!surfaceProfile || typeof surfaceProfile !== 'object') {
                return;
            }

            const options = getOptions();
            options.surfaceProfile = surfaceProfile;

            if (surfaceProfile.assistantProfile && typeof surfaceProfile.assistantProfile === 'object') {
                options.assistantProfile = surfaceProfile.assistantProfile;
            }

            if (`${surfaceProfile.systemPromptAddendum || ''}`.trim()) {
                options.assistantPrompt = `${surfaceProfile.systemPromptAddendum || ''}`.trim();
            }

            if (surfaceProfile.assistantRuntime && typeof surfaceProfile.assistantRuntime === 'object') {
                options.assistantRuntime = {
                    ...options.assistantRuntime,
                    ...surfaceProfile.assistantRuntime
                };
            }

            if (isGenericWorkflowDescription(options.workflowDescription) && `${surfaceProfile.workflowDescription || ''}`.trim()) {
                options.workflowDescription = `${surfaceProfile.workflowDescription || ''}`.trim();
            }

            if (`${surfaceProfile.welcomeMessage || ''}`.trim()) {
                options.assistantRuntime = {
                    ...options.assistantRuntime,
                    idleMessage: `${surfaceProfile.welcomeMessage || ''}`.trim()
                };
            }

            setOptions(options);
        }

        async function hydrateSurfaceProfile() {
            if (hydrationPromise) {
                return hydrationPromise;
            }

            hydrationPromise = (async () => {
                try {
                    if (window.MiracleAuth?.whenAuthenticated) {
                        await window.MiracleAuth.whenAuthenticated();
                        const user = window.MiracleAuth.getUser?.() || null;
                        if (isAnonymousUser(user)) {
                            return null;
                        }
                    }
                    const context = getPageContext();
                    const pageSnapshot = window.GraphPluginContext?.capturePageSnapshot?.() || {};
                    const payload = await requireApiClient().ensureSurfaceProfile(context, pageSnapshot);
                    const surfaceProfile = payload?.surfaceProfile || null;
                    if (!surfaceProfile) {
                        return null;
                    }

                    applySurfaceProfileToOptions(surfaceProfile);
                    const options = getOptions();
                    runtime()?.mount(options.assistantRuntime || getDefaults().assistantRuntime || {});

                    const descriptionField = document.getElementById('wf-desc');
                    if (descriptionField && isGenericWorkflowDescription(descriptionField.value)) {
                        descriptionField.value = options.workflowDescription || '';
                    }

                    emitPluginEvent('surface.profile.hydrated', {
                        surfaceProfileId: surfaceProfile.id || '',
                        generated: Boolean(payload?.generated)
                    });
                    return surfaceProfile;
                } catch (error) {
                    console.warn('[SurfaceProfile] Could not hydrate surface profile:', error.message || error);
                    return null;
                }
            })();

            return hydrationPromise;
        }

        function resetHydration() {
            hydrationPromise = null;
        }

        return {
            persistLearningContextNote,
            getPageContext,
            isGenericWorkflowDescription,
            applySurfaceProfileToOptions,
            hydrateSurfaceProfile,
            resetHydration
        };
    }

    window.GraphPluginSurfaceProfileClient = {
        create
    };
})();
