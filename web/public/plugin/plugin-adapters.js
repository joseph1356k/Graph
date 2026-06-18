(function () {
    const MEDICAL_ASSISTANT_PROFILE = {
        tone: 'professional, calm, concise',
        style: 'clinical assistant',
        goals: [
            'Ask only for the information needed to execute the correct workflow.',
            'Stay direct and clear.',
            'Do not use a sales tone.'
        ]
    };

    function normalizePathname(value) {
        let pathname = `${value || ''}`.trim();
        if (!pathname) {
            return '';
        }

        pathname = pathname
            .replace(/^https?:\/\/[^/]+/i, '')
            .replace(/[?#].*$/, '')
            .replace(/\/{2,}/g, '/');

        if (!pathname.startsWith('/')) {
            pathname = `/${pathname}`;
        }

        if (pathname.toLowerCase().endsWith('/index.html')) {
            pathname = pathname.slice(0, -'/index.html'.length) || '/';
        }

        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }

        return pathname || '/';
    }

    function getSurfacePreset(config = {}) {
        const appId = `${config.appId || ''}`.trim();
        const pathname = normalizePathname(config.sourcePathname || window.location.pathname);

        if (appId === 'medical-demo') {
            if (pathname.endsWith('/page1.html')) {
                return {
                    title: 'Anamnesis Trainer',
                    workflowDescription: 'Anamnesis workflow'
                };
            }
            if (pathname.endsWith('/page2.html')) {
                return {
                    title: 'Assessment Trainer',
                    workflowDescription: 'Diagnosis and prescription workflow'
                };
            }
            return {
                title: 'Medical Intake Trainer',
                workflowDescription: 'Patient intake workflow'
            };
        }

        return {};
    }

    function getDefaultSuggestions() {
        return [
            {
                id: 'generic-cta-clarity',
                selector: 'main, body',
                title: 'La pagina necesita mas claridad en el siguiente paso',
                summary: 'Un usuario nuevo podria no identificar de inmediato cual es la accion principal para continuar.',
                evidence: '"La pagina se ve bien, pero no supe cual era el siguiente paso recomendado."',
                opportunity: 'Resaltar mejor la accion principal y reducir competencia visual.',
                source: 'Observacion de experiencia',
                priority: 'media',
                area: 'Experiencia general'
            }
        ];
    }

    function createAdapter(config) {
        const adapterConfig = config && typeof config === 'object' ? config : {};
        const preset = getSurfacePreset(adapterConfig);
        const assistantProfile = adapterConfig.assistantProfile
            || (adapterConfig.appId === 'medical-demo' ? MEDICAL_ASSISTANT_PROFILE : null);
        const baseAdapter = {
            id: adapterConfig.id || adapterConfig.appId || 'default-surface',
            appId: adapterConfig.appId || '',
            mountDefaults: {
                title: adapterConfig.title || preset.title || 'Trainer',
                workflowDescription: adapterConfig.workflowDescription || preset.workflowDescription || '',
                aiPlaceholder: adapterConfig.aiPlaceholder || 'Pide a Miracle ejecutar un flujo guardado',
                assistantProfile,
                assistantRuntime: adapterConfig.assistantRuntime || {
                    name: 'Miracle',
                    accentColor: adapterConfig.appId === 'medical-demo' ? '#22577a' : '#0f5f8c',
                    idleMessage: adapterConfig.appId === 'medical-demo'
                        ? 'Puedo ayudarte a completar este flujo clinico cuando quieras.'
                        : 'Puedo ayudarte con esta pagina cuando quieras.'
                }
            },
            capabilities: {
                learning: true,
                execution: true,
                voice: true,
                improvements: true,
                ...(adapterConfig.capabilities || {})
            },
            getDemoMode(context) {
                if (adapterConfig.demoMode !== undefined) {
                    return `${adapterConfig.demoMode || ''}`.trim();
                }
                return `${context?.demoMode || ''}`.trim();
            },
            decorateContext(context) {
                return {
                    ...context,
                    demoMode: this.getDemoMode(context),
                    capabilities: { ...(this.capabilities || {}) }
                };
            },
            matchesWorkflow(workflow, context) {
                if (!workflow) return false;
                const contextAppId = `${context?.appId || ''}`.trim();
                const workflowAppId = `${workflow.appId || ''}`.trim();
                if (contextAppId && workflowAppId && workflowAppId !== contextAppId) {
                    return false;
                }

                const contextPathname = normalizePathname(context?.sourcePathname);
                if (!contextPathname) {
                    return true;
                }

                return normalizePathname(workflow.sourcePathname) === contextPathname;
            },
            filterWorkflows(workflows, context) {
                return (workflows || []).filter((workflow) => this.matchesWorkflow(workflow, context));
            },
            getImprovementSuggestions() {
                return getDefaultSuggestions();
            }
        };

        return {
            ...baseAdapter,
            ...adapterConfig
        };
    }

    function resolve(config) {
        if (config?.__resolvedAdapter === true) {
            return config;
        }
        if (config?.adapter && config.adapter.__resolvedAdapter === true) {
            return config.adapter;
        }
        if (config?.adapter && typeof config.adapter === 'object') {
            return {
                __resolvedAdapter: true,
                ...createAdapter({
                    ...(config.adapter || {}),
                    appId: config.adapter.appId || config.appId || ''
                })
            };
        }

        return {
            __resolvedAdapter: true,
            ...createAdapter({
                appId: config?.appId || '',
                assistantProfile: config?.assistantProfile || null
            })
        };
    }

    window.GraphPluginAdapters = {
        createAdapter,
        getSurfacePreset,
        normalizePathname,
        resolve
    };
})();
