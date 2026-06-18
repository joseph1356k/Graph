(function () {
    function create(deps = {}) {
        const runtime = typeof deps.runtime === 'function' ? deps.runtime : () => null;
        const longPressMs = Number.isFinite(deps.longPressMs) ? deps.longPressMs : 650;
        const isWorkflowOverlayVisible = typeof deps.isWorkflowOverlayVisible === 'function' ? deps.isWorkflowOverlayVisible : () => false;
        const isFeedbackOverlayVisible = typeof deps.isFeedbackOverlayVisible === 'function' ? deps.isFeedbackOverlayVisible : () => false;
        const renderWorkflowOverlay = typeof deps.renderWorkflowOverlay === 'function' ? deps.renderWorkflowOverlay : () => {};
        const renderFeedbackOverlay = typeof deps.renderFeedbackOverlay === 'function' ? deps.renderFeedbackOverlay : () => {};
        const loadWorkflowPanel = typeof deps.loadWorkflowPanel === 'function' ? deps.loadWorkflowPanel : async () => {};
        const loadImprovementPanel = typeof deps.loadImprovementPanel === 'function' ? deps.loadImprovementPanel : async () => {};
        const toggleFeedbackOverlay = typeof deps.toggleFeedbackOverlay === 'function' ? deps.toggleFeedbackOverlay : () => {};
        const runPitchGeneration = typeof deps.runPitchGeneration === 'function' ? deps.runPitchGeneration : async () => {};
        const executeWorkflowFromPanel = typeof deps.executeWorkflowFromPanel === 'function' ? deps.executeWorkflowFromPanel : async () => {};
        const getWorkflowEntryById = typeof deps.getWorkflowEntryById === 'function' ? deps.getWorkflowEntryById : () => null;
        const toggleWorkflowOverlay = typeof deps.toggleWorkflowOverlay === 'function' ? deps.toggleWorkflowOverlay : () => {};
        const hideWorkflowOverlay = typeof deps.hideWorkflowOverlay === 'function' ? deps.hideWorkflowOverlay : () => {};
        const deleteWorkflowFromPanel = typeof deps.deleteWorkflowFromPanel === 'function' ? deps.deleteWorkflowFromPanel : async () => {};
        const markWorkflowPanelDirty = typeof deps.markWorkflowPanelDirty === 'function' ? deps.markWorkflowPanelDirty : () => {};
        const onStartWorkflow = typeof deps.onStartWorkflow === 'function' ? deps.onStartWorkflow : async () => {};
        const onStopWorkflow = typeof deps.onStopWorkflow === 'function' ? deps.onStopWorkflow : async () => {};
        const onStopWorkflowExecution = typeof deps.onStopWorkflowExecution === 'function' ? deps.onStopWorkflowExecution : async () => {};
        const onWorkflowRecordingCheck = typeof deps.onWorkflowRecordingCheck === 'function' ? deps.onWorkflowRecordingCheck : () => false;

        let longPressTimer = null;
        let longPressTriggered = false;

        function updateConsoleExpandedState() {
            const consoleEl = document.getElementById('teaching-console');
            const panel = document.getElementById('workflow-panel');
            const improvementPanel = document.getElementById('improvement-panel');
            if (!consoleEl || !panel || !improvementPanel) return;

            const shouldExpand = panel.classList.contains('open')
                || improvementPanel.classList.contains('open');
            consoleEl.classList.toggle('compact-open', shouldExpand);
        }

        function closeWorkflowPanel() {
            const panel = document.getElementById('workflow-panel');
            if (!panel) return;
            panel.classList.remove('open');
            updateConsoleExpandedState();
        }

        function closeImprovementPanel() {
            const panel = document.getElementById('improvement-panel');
            if (!panel) return;
            panel.classList.remove('open');
            updateConsoleExpandedState();
        }

        function openChatPanel() {
            closeWorkflowPanel();
            closeImprovementPanel();
            updateConsoleExpandedState();
            runtime()?.setExpanded?.(true, { source: 'console-chat' });
            runtime()?.openChatComposer?.({ focus: true });
            runtime()?.speak?.('Estoy listo para ayudarte con esta pagina cuando quieras.', { mode: 'listening' });
        }

        function openWorkflowPanel() {
            const panel = document.getElementById('workflow-panel');
            const improvementPanel = document.getElementById('improvement-panel');
            if (!panel || !improvementPanel) return;
            runtime()?.setExpanded?.(true, { source: 'workflow-panel' });
            runtime()?.closeChatComposer?.();
            improvementPanel.classList.remove('open');
            panel.classList.add('open');
            updateConsoleExpandedState();
        }

        function openImprovementPanel() {
            const panel = document.getElementById('improvement-panel');
            const workflowPanel = document.getElementById('workflow-panel');
            if (!panel || !workflowPanel) return;
            runtime()?.setExpanded?.(true, { source: 'improvement-panel' });
            runtime()?.closeChatComposer?.();
            workflowPanel.classList.remove('open');
            panel.classList.add('open');
            updateConsoleExpandedState();
        }

        function toggleWorkflowPanel() {
            const panel = document.getElementById('workflow-panel');
            if (!panel) return;
            if (panel.classList.contains('open')) {
                closeWorkflowPanel();
                return;
            }
            openWorkflowPanel();
            loadWorkflowPanel(true);
        }

        function toggleImprovementPanel() {
            const panel = document.getElementById('improvement-panel');
            if (!panel) return;
            if (panel.classList.contains('open')) {
                closeImprovementPanel();
                return;
            }
            openImprovementPanel();
            loadImprovementPanel(true);
        }

        function updateWorkflowPanelStatus(text) {
            const status = document.getElementById('workflow-panel-status');
            if (status) {
                status.textContent = text;
            }
        }

        function updateImprovementPanelStatus(text) {
            const status = document.getElementById('improvement-panel-status');
            if (status) {
                status.textContent = text;
            }
        }

        function updateVoiceStatus(text) {
            const status = document.getElementById('voice-status');
            if (status) {
                status.textContent = text || '';
            }
        }

        function setVoiceButton(active) {
            const button = document.getElementById('voice-toggle');
            if (button) {
                button.dataset.active = active ? 'true' : 'false';
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
                button.title = active ? 'Detener conversacion de voz' : 'Conversacion de voz';
            }
            runtime()?.setVoiceButtonActive?.(active);
            runtime()?.setActivityIndicators?.({ voice: active });
        }

        function setExecutionStopButtonVisible(active) {
            const button = document.getElementById('btn-stop-execution');
            if (button) {
                button.hidden = !active;
                button.disabled = !active;
                button.setAttribute('aria-hidden', active ? 'false' : 'true');
            }
            runtime()?.setActivityIndicators?.({ executing: active });
        }

        function clearLongPressTimer() {
            if (longPressTimer) {
                window.clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        function bindLongPressGesture(buttonId, onLongPress, onClick) {
            const button = document.getElementById(buttonId);
            if (!button) return;

            button.addEventListener('pointerdown', () => {
                longPressTriggered = false;
                clearLongPressTimer();
                longPressTimer = window.setTimeout(() => {
                    longPressTriggered = true;
                    onLongPress();
                }, longPressMs);
            });

            ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
                button.addEventListener(eventName, clearLongPressTimer);
            });

            button.addEventListener('click', async (event) => {
                if (longPressTriggered) {
                    event.preventDefault();
                    event.stopPropagation();
                    longPressTriggered = false;
                    return;
                }

                await onClick();
            });
        }

        function bindControls() {
            document.getElementById('btn-start').addEventListener('click', onStartWorkflow);
            document.getElementById('btn-stop').addEventListener('click', onStopWorkflow);
            document.getElementById('btn-stop-execution').addEventListener('click', onStopWorkflowExecution);

            bindLongPressGesture('btn-record-toggle', toggleWorkflowPanel, async () => {
                closeImprovementPanel();
                closeWorkflowPanel();

                if (onWorkflowRecordingCheck()) {
                    await onStopWorkflow();
                    return;
                }
                await onStartWorkflow();
            });

            document.getElementById('workflow-panel-close').addEventListener('click', () => {
                closeWorkflowPanel();
            });

            document.getElementById('improvement-panel-refresh').addEventListener('click', () => {
                loadImprovementPanel(true);
            });
            document.getElementById('feedback-overlay-toggle').addEventListener('click', () => {
                toggleFeedbackOverlay();
            });
            document.getElementById('improvement-run-pitch').addEventListener('click', async () => {
                await runPitchGeneration();
            });
            window.addEventListener('scroll', () => {
                if (isFeedbackOverlayVisible()) {
                    renderFeedbackOverlay();
                }
                if (isWorkflowOverlayVisible()) {
                    renderWorkflowOverlay();
                }
            }, { passive: true });
            window.addEventListener('resize', () => {
                if (isFeedbackOverlayVisible()) {
                    renderFeedbackOverlay();
                }
                if (isWorkflowOverlayVisible()) {
                    renderWorkflowOverlay();
                }
            });

            document.getElementById('workflow-panel-list').addEventListener('click', async (event) => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;

                const workflowId = button.getAttribute('data-workflow-id');
                const action = button.getAttribute('data-action');
                if (!workflowId || !action) return;

                if (action === 'run-workflow') {
                    button.disabled = true;
                    try {
                        await executeWorkflowFromPanel(workflowId);
                    } catch (error) {
                        updateWorkflowPanelStatus(error.message || 'No pude completar la automatizacion.');
                    } finally {
                        button.disabled = false;
                    }
                    return;
                }

                if (action === 'view-workflow') {
                    const workflow = getWorkflowEntryById(workflowId);
                    if (!workflow) {
                        updateWorkflowPanelStatus(`No encontré el workflow ${workflowId}.`);
                        return;
                    }
                    toggleWorkflowOverlay(workflow);
                    return;
                }

                if (action === 'delete-workflow') {
                    const confirmed = window.confirm(`¿Borrar el workflow ${workflowId}? Esta accion no se puede deshacer.`);
                    if (!confirmed) {
                        return;
                    }

                    button.disabled = true;
                    try {
                        hideWorkflowOverlay();
                        await deleteWorkflowFromPanel(workflowId);
                        markWorkflowPanelDirty();
                        await loadWorkflowPanel(true);
                    } catch (error) {
                        updateWorkflowPanelStatus(error.message || 'No se pudo borrar el workflow.');
                    } finally {
                        button.disabled = false;
                    }
                }
            });
        }

        return {
            updateConsoleExpandedState,
            closeWorkflowPanel,
            closeImprovementPanel,
            openChatPanel,
            openWorkflowPanel,
            openImprovementPanel,
            toggleWorkflowPanel,
            toggleImprovementPanel,
            updateWorkflowPanelStatus,
            updateImprovementPanelStatus,
            updateVoiceStatus,
            setVoiceButton,
            setExecutionStopButtonVisible,
            bindControls
        };
    }

    window.GraphPluginTrainerShell = {
        create
    };
})();
