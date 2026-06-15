function buildPhoneMicPage(sessionId) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Microfono Graph</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101820; color: #f7fbff; }
    main { width: min(420px, calc(100vw - 32px)); display: grid; gap: 18px; text-align: center; }
    button { border: 0; border-radius: 999px; padding: 18px 22px; font: inherit; font-weight: 800; background: #22c55e; color: #092013; }
    button[data-active="true"] { background: #ef4444; color: white; }
    button:disabled { opacity: .65; cursor: not-allowed; }
    .status { min-height: 56px; color: #cbd5e1; line-height: 1.45; }
    .badge { width: fit-content; margin: 0 auto; padding: 7px 11px; border-radius: 999px; background: rgba(255,255,255,.1); color: #dbeafe; font-size: 12px; }
    .hint { color: #93a4b8; font-size: 13px; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <div class="badge">Graph phone mic</div>
    <h1>Usar este telefono como microfono</h1>
    <button id="toggle" type="button" data-active="false">Activar microfono</button>
    <div class="status" id="status">Abre el QR desde el computador y toca activar.</div>
    <div class="hint">El audio sale desde este telefono por WebRTC. El computador recibe la transcripcion por Miracle.</div>
  </main>
  <script>
    const sessionId = ${JSON.stringify(sessionId || '')};
    const token = new URLSearchParams(location.search).get('token') || '';
    const statusEl = document.getElementById('status');
    const button = document.getElementById('toggle');
    const state = {
      active: false,
      stream: null,
      peerConnection: null,
      dataChannel: null,
      remoteAudio: null,
      heartbeatTimer: null
    };

    function setStatus(text) {
      statusEl.textContent = text || '';
    }

    function eventEndpoint() {
      return '/api/voice/phone-session/' + encodeURIComponent(sessionId) + '/events';
    }

    async function publishEvent(type, payload, options) {
      if (!sessionId || !token || !type) {
        return null;
      }
      const body = JSON.stringify({
        type,
        payload: {
          type,
          ...(payload || {})
        }
      });
      try {
        const response = await fetch(eventEndpoint(), {
          method: 'POST',
          keepalive: Boolean(options && options.keepalive),
          headers: {
            'Content-Type': 'application/json',
            'X-Graph-Phone-Token': token
          },
          body
        });
        return response.ok ? response.json().catch(() => null) : null;
      } catch (error) {
        return null;
      }
    }

    function startHeartbeat() {
      if (state.heartbeatTimer) return;
      state.heartbeatTimer = window.setInterval(() => {
        publishEvent('phone_status', {
          status: state.active ? 'Telefono transmitiendo audio.' : 'Telefono conectado.',
          visibilityState: document.visibilityState || 'visible',
          micActive: state.active
        });
      }, 4000);
    }

    function stopHeartbeat() {
      if (!state.heartbeatTimer) return;
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }

    function waitForIceGatheringComplete(peerConnection) {
      if (peerConnection.iceGatheringState === 'complete') {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const timeout = window.setTimeout(done, 1200);
        function done() {
          window.clearTimeout(timeout);
          peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
        function onStateChange() {
          if (peerConnection.iceGatheringState === 'complete') {
            done();
          }
        }
        peerConnection.addEventListener('icegatheringstatechange', onStateChange);
      });
    }

    async function createRealtimeSession(localSdp) {
      const response = await fetch('/api/voice/openai/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'X-Graph-Phone-Session-Id': sessionId,
          'X-Graph-Phone-Token': token
        },
        body: localSdp
      });
      const answerSdp = await response.text();
      if (!response.ok || !answerSdp) {
        let message = answerSdp || 'No pude iniciar la sesion de voz.';
        try {
          const payload = JSON.parse(answerSdp || '{}');
          message = payload.error || message;
        } catch (error) {}
        throw new Error(message);
      }
      return answerSdp;
    }

    async function handleRealtimeEvent(event) {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (payload.type === 'input_audio_buffer.speech_started') {
        setStatus('Te estoy escuchando...');
        await publishEvent('user_started_speaking', {});
        return;
      }

      if (payload.type === 'input_audio_buffer.speech_stopped') {
        setStatus('Procesando lo que dijiste...');
        await publishEvent('thinking', {});
        return;
      }

      if (payload.type === 'conversation.item.input_audio_transcription.completed') {
        const transcript = String(payload.transcript || '').trim();
        if (!transcript) return;
        setStatus('Enviado al computador.');
        await publishEvent('user_turn', { text: transcript });
        return;
      }

      if (payload.type === 'response.output_audio_transcript.done') {
        const transcript = String(payload.transcript || '').trim();
        if (transcript) {
          await publishEvent('assistant_turn', { text: transcript });
        }
        return;
      }

      if (payload.type === 'error') {
        const message = payload.error?.message || payload.error || 'Error en la voz del telefono.';
        setStatus(message);
        await publishEvent('error', { error: message });
      }
    }

    async function start() {
      if (state.active) return;
      if (!sessionId || !token) {
        setStatus('Este enlace de microfono no tiene token. Abre el QR generado desde el computador.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        setStatus('Este navegador no permite microfono WebRTC en esta pagina. Usa Chrome, Safari o Edge actualizado con HTTPS.');
        return;
      }

      button.disabled = true;
      setStatus('Conectando con el computador...');
      await publishEvent('phone_connected', {
        status: 'Telefono conectado. Pidiendo permiso de microfono.'
      });

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const peerConnection = new RTCPeerConnection();
        const remoteAudio = document.createElement('audio');
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.style.display = 'none';
        document.body.appendChild(remoteAudio);

        peerConnection.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0];
        };
        peerConnection.addEventListener('connectionstatechange', () => {
          const stateName = peerConnection.connectionState;
          if (stateName === 'connected') {
            setStatus('Transmitiendo microfono al computador.');
            publishEvent('phone_status', { status: 'Transmitiendo microfono desde el telefono.' });
          }
          if (stateName === 'failed' || stateName === 'disconnected' || stateName === 'closed') {
            stop(false);
          }
        });

        stream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, stream);
        });

        const dataChannel = peerConnection.createDataChannel('oai-events');
        dataChannel.addEventListener('open', () => {
          publishEvent('phone_audio_started', {
            status: 'Audio del telefono conectado con OpenAI Realtime.'
          });
          publishEvent('phone_status', {
            status: 'Transmitiendo microfono desde el telefono.'
          });
        });
        dataChannel.addEventListener('message', handleRealtimeEvent);
        dataChannel.addEventListener('error', () => {
          publishEvent('error', { error: 'Fallo el canal de eventos WebRTC del telefono.' });
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerConnection);
        const localSdp = String(peerConnection.localDescription?.sdp || offer.sdp || '').trim();
        if (!localSdp || !localSdp.includes('m=audio')) {
          throw new Error('No pude preparar audio WebRTC desde este telefono.');
        }

        const answerSdp = await createRealtimeSession(localSdp);
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        Object.assign(state, {
          active: true,
          stream,
          peerConnection,
          dataChannel,
          remoteAudio
        });
        button.dataset.active = 'true';
        button.textContent = 'Detener microfono';
        button.disabled = false;
        startHeartbeat();
        setStatus('Transmitiendo microfono al computador.');
      } catch (error) {
        await publishEvent('error', { error: error.message || 'No se pudo activar el microfono del telefono.' });
        setStatus(error.message || 'No se pudo activar el microfono del telefono.');
        stop(false);
      } finally {
        button.disabled = false;
      }
    }

    function stop(announce) {
      const shouldAnnounce = announce !== false && state.active;
      stopHeartbeat();
      if (state.dataChannel) {
        try { state.dataChannel.close(); } catch (error) {}
      }
      if (state.peerConnection) {
        try { state.peerConnection.close(); } catch (error) {}
      }
      if (state.stream) {
        state.stream.getTracks().forEach((track) => track.stop());
      }
      if (state.remoteAudio) {
        try {
          state.remoteAudio.pause();
          state.remoteAudio.srcObject = null;
          state.remoteAudio.remove();
        } catch (error) {}
      }
      Object.assign(state, {
        active: false,
        stream: null,
        peerConnection: null,
        dataChannel: null,
        remoteAudio: null
      });
      button.dataset.active = 'false';
      button.textContent = 'Activar microfono';
      if (shouldAnnounce) {
        publishEvent('phone_disconnected', {
          status: 'Telefono desconectado.'
        }, { keepalive: true });
        setStatus('Microfono detenido.');
      }
    }

    button.addEventListener('click', () => state.active ? stop(true) : start());
    document.addEventListener('visibilitychange', () => {
      publishEvent('phone_status', {
        status: state.active ? 'Telefono transmitiendo audio.' : 'Telefono conectado.',
        visibilityState: document.visibilityState || 'visible',
        micActive: state.active
      }, { keepalive: true });
    });
    window.addEventListener('pagehide', () => {
      if (state.active) {
        publishEvent('phone_disconnected', { status: 'Telefono desconectado.' }, { keepalive: true });
      }
      stop(false);
    });
  </script>
</body>
</html>`;
}

module.exports = buildPhoneMicPage;
