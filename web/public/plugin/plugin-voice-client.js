(function () {
    function create(deps = {}) {
        const voiceState = deps.voiceState || {};
        const voiceLog = typeof deps.voiceLog === 'function' ? deps.voiceLog : () => {};
        const runtime = typeof deps.runtime === 'function' ? deps.runtime : () => null;
        const openChatPanel = typeof deps.openChatPanel === 'function' ? deps.openChatPanel : () => {};
        const updateVoiceStatus = typeof deps.updateVoiceStatus === 'function' ? deps.updateVoiceStatus : () => {};
        const setVoiceButton = typeof deps.setVoiceButton === 'function' ? deps.setVoiceButton : () => {};
        const setPhonePairingVisible = typeof deps.setPhonePairingVisible === 'function' ? deps.setPhonePairingVisible : () => {};
        const setPhoneConnectionActive = typeof deps.setPhoneConnectionActive === 'function' ? deps.setPhoneConnectionActive : () => {};
        const getStoredPhoneSessionId = typeof deps.getStoredPhoneSessionId === 'function' ? deps.getStoredPhoneSessionId : () => '';
        const setStoredPhoneSessionId = typeof deps.setStoredPhoneSessionId === 'function' ? deps.setStoredPhoneSessionId : () => {};
        const getRealtimeSocketUrl = typeof deps.getRealtimeSocketUrl === 'function' ? deps.getRealtimeSocketUrl : () => '';
        const getPageContext = typeof deps.getPageContext === 'function' ? deps.getPageContext : () => ({});
        const requireApiClient = typeof deps.requireApiClient === 'function' ? deps.requireApiClient : null;
        const appendAgentMessage = typeof deps.appendAgentMessage === 'function' ? deps.appendAgentMessage : () => {};
        const agentHistory = typeof deps.getAgentHistory === 'function' ? deps.getAgentHistory : () => [];
        const playLinear16Audio = typeof deps.playLinear16Audio === 'function' ? deps.playLinear16Audio : async () => {};
        const handleRemoteVoiceSocketMessage = typeof deps.handleRemoteVoiceSocketMessage === 'function' ? deps.handleRemoteVoiceSocketMessage : async () => {};
        const handleRealtimeServerEvent = typeof deps.handleRealtimeServerEvent === 'function' ? deps.handleRealtimeServerEvent : async () => {};
        const resetRealtimeTranscriptState = typeof deps.resetRealtimeTranscriptState === 'function' ? deps.resetRealtimeTranscriptState : () => {};
        const getRealtimeDataChannel = typeof deps.getRealtimeDataChannel === 'function' ? deps.getRealtimeDataChannel : () => null;
        const sendRealtimeEvent = typeof deps.sendRealtimeEvent === 'function' ? deps.sendRealtimeEvent : () => {};
        const executionMode = typeof deps.getExecutionMode === 'function' ? deps.getExecutionMode : () => 'openai-realtime';
        const updateImprovementPanelStatus = typeof deps.updateImprovementPanelStatus === 'function' ? deps.updateImprovementPanelStatus : () => {};

        async function startVoiceConversation(config = {}) {
            return deps.startVoiceConversationImpl?.(config);
        }

        function stopVoiceConversation(options = {}) {
            return deps.stopVoiceConversationImpl?.(options);
        }

        async function openPhoneMicPairing() {
            openChatPanel();
            setPhoneConnectionActive(false);
            voiceState.phoneSession = null;
            setStoredPhoneSessionId('');

            if (!requireApiClient) {
                throw new Error('No hay cliente API configurado para preparar el microfono del telefono.');
            }

            if (voiceState.active) {
                stopVoiceConversation({ announce: false, clearStatus: false });
            }

            setPhonePairingVisible(false);
            updateVoiceStatus('Preparando QR seguro para usar el telefono como microfono...');
            voiceLog('phone_microphone_pairing_requested');

            try {
                const session = await requireApiClient().createPhoneSession({
                    context: getPageContext(),
                    history: agentHistory().slice(-10)
                });
                if (!session?.id || !session?.phoneUrl || !session?.qrDataUrl) {
                    throw new Error('El servidor no devolvio un QR valido para el microfono del telefono.');
                }

                voiceState.phoneSession = {
                    id: session.id,
                    phoneUrl: session.phoneUrl,
                    qrDataUrl: session.qrDataUrl,
                    expiresAt: session.expiresAt || ''
                };
                setStoredPhoneSessionId(session.id);
                setPhonePairingVisible(true);
                updateVoiceStatus('Escanea el QR con tu telefono y toca activar microfono.');
                appendAgentMessage('assistant', 'Escanea el QR con tu telefono. El celular usara WebRTC y el computador recibira la transcripcion aqui.', null, false);
                await startVoiceConversation({ phoneSessionId: session.id });
                return session;
            } catch (error) {
                voiceState.phoneSession = null;
                setStoredPhoneSessionId('');
                setPhonePairingVisible(false);
                const message = error.message || 'No pude preparar el microfono del telefono.';
                updateVoiceStatus(message);
                voiceLog('phone_microphone_pairing_error', message);
                throw error;
            }
        }

        async function processVoiceComplaints(workflowDescription = '') {
            updateImprovementPanelStatus('Procesando quejas reales capturadas por voz...');
            return requireApiClient().processVoiceComplaints({
                ...getPageContext(),
                workflowDescription
            });
        }

        function restoreStoredPhoneSession() {
            if (voiceState.phoneSession?.id) {
                return;
            }
            const storedPhoneSessionId = getStoredPhoneSessionId();
            if (storedPhoneSessionId) {
                voiceState.phoneSession = { id: storedPhoneSessionId };
                voiceLog('restored_phone_session_id', storedPhoneSessionId);
            }
        }

        return {
            startVoiceConversation,
            stopVoiceConversation,
            openPhoneMicPairing,
            processVoiceComplaints,
            restoreStoredPhoneSession
        };
    }

    window.GraphPluginVoiceClient = {
        create
    };
})();
