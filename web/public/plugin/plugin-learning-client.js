(function () {
    function create(deps = {}) {
        const getOptions = typeof deps.getOptions === 'function' ? deps.getOptions : () => ({});
        const runtime = typeof deps.runtime === 'function' ? deps.runtime : () => null;
        const getPageContext = typeof deps.getPageContext === 'function' ? deps.getPageContext : () => ({});
        const emitPluginEvent = typeof deps.emitPluginEvent === 'function' ? deps.emitPluginEvent : () => {};
        const markWorkflowPanelDirty = typeof deps.markWorkflowPanelDirty === 'function' ? deps.markWorkflowPanelDirty : () => {};

        function isAnonymousUser(user) {
            if (!user) return true;
            if (user.role === 'local-dev') return false;
            if (user.is_anonymous === true) return true;
            const provider = `${user.app_metadata?.provider || user.user_metadata?.provider || ''}`.trim().toLowerCase();
            const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
            return provider === 'anonymous'
                || providers.some((value) => `${value || ''}`.trim().toLowerCase() === 'anonymous');
        }

        function setLearningAvailable(available, message = '') {
            const button = document.getElementById('btn-record-toggle');
            const status = document.getElementById('recording-status');
            if (button) {
                button.disabled = !available;
                button.title = available ? 'Grabar workflow' : (message || 'Los workflows requieren una cuenta');
                button.setAttribute('aria-label', button.title);
            }
            if (!available && status) {
                status.innerText = message || 'Los workflows requieren una cuenta';
            }
        }

        async function startWorkflow() {
            const options = getOptions();
            const descField = document.getElementById('wf-desc');
            const description = (descField?.value || '').trim() || options.workflowDescription || document.title;
            if (descField && !descField.value) {
                descField.value = description;
            }

            runtime()?.pinBottomRight?.();
            runtime()?.speak?.(`Empece a aprender este recorrido: "${description}".`, { mode: 'recording' });
            emitPluginEvent('learning.session.requested', {
                description,
                context: getPageContext()
            });
            await window.WorkflowRecorder.startWorkflow(description, getPageContext());
            markWorkflowPanelDirty();
        }

        async function stopWorkflow() {
            runtime()?.unpin?.();
            runtime()?.speak?.('Listo, guarde este recorrido.', { mode: 'idle' });
            await window.WorkflowRecorder.stopWorkflow();
            emitPluginEvent('learning.session.stop_requested', {
                context: getPageContext()
            });
            markWorkflowPanelDirty();
        }

        async function resetWorkflow() {
            await window.WorkflowRecorder.resetWorkflow();
            markWorkflowPanelDirty();
        }

        async function syncRecorderStatus() {
            if (getOptions()?.autoSyncStatus && window.WorkflowRecorder?.syncStatus) {
                try {
                    if (window.MiracleAuth?.whenAuthenticated) {
                        await window.MiracleAuth.whenAuthenticated();
                        const user = window.MiracleAuth.getUser?.() || null;
                        if (isAnonymousUser(user)) {
                            setLearningAvailable(false, 'Inicia sesión con una cuenta para grabar workflows');
                            return;
                        }
                    }
                    await window.WorkflowRecorder.syncStatus();
                    setLearningAvailable(true);
                } catch (error) {
                    setLearningAvailable(false, error.message || 'No se pudo conectar con el servicio de workflows');
                    emitPluginEvent('learning.status.unavailable', {
                        message: error.message || 'workflow status unavailable'
                    });
                }
            }
        }

        return {
            startWorkflow,
            stopWorkflow,
            resetWorkflow,
            syncRecorderStatus
        };
    }

    window.GraphPluginLearningClient = {
        create
    };
})();
