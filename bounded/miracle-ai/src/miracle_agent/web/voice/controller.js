import { fetchJSON } from "/assets/lib/api.js";

export function createVoiceStreamingController({
  recordToggleButton,
  transcriptOutput,
  container = null,
  onError = defaultErrorHandler,
  onFinalTranscript = null,
  onRecordingStarted = null,
}) {
  if (!recordToggleButton || !transcriptOutput) {
    throw new Error("Voice streaming controller requires a record button and transcript output.");
  }

  const state = {
    committedTranscript: "",
    finalSegmentCount: 0,
    finalizeQuietTimer: null,
    isBusy: false,
    isRecording: false,
    mediaRecorder: null,
    mediaRecorderStopped: null,
    mediaStream: null,
    pendingDraft: "",
    socket: null,
    streamSession: null,
    timesliceMs: 250,
  };

  function syncUi() {
    recordToggleButton.disabled = state.isBusy;
    recordToggleButton.textContent = state.isRecording ? "Terminar" : "Grabar";
    if (!container) {
      return;
    }
    const hasTranscript = Boolean(readTranscriptValue());
    container.classList.toggle("is-recording", state.isRecording);
    container.classList.toggle("has-transcript", hasTranscript);
  }

  function readTranscriptValue() {
    const committed = state.committedTranscript.trim();
    const draft = state.pendingDraft.trim();
    return committed && draft ? `${committed} ${draft}` : committed || draft;
  }

  function renderTranscript() {
    transcriptOutput.value = readTranscriptValue();
    transcriptOutput.scrollTop = transcriptOutput.scrollHeight;
    syncUi();
  }

  function resetFinalizeQuietTimer() {
    if (state.finalizeQuietTimer) {
      clearTimeout(state.finalizeQuietTimer);
      state.finalizeQuietTimer = null;
    }
  }

  function releaseMicrophone() {
    if (!state.mediaStream) {
      return;
    }
    for (const track of state.mediaStream.getTracks()) {
      track.stop();
    }
    state.mediaStream = null;
  }

  function closeSocket() {
    if (!state.socket) {
      return Promise.resolve();
    }
    const socket = state.socket;
    if (socket.readyState === WebSocket.CLOSED) {
      state.socket = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      socket.addEventListener(
        "close",
        () => {
          if (state.socket === socket) {
            state.socket = null;
          }
          resolve();
        },
        { once: true }
      );
      socket.close();
    });
  }

  function resetStreamingState() {
    resetFinalizeQuietTimer();
    state.mediaRecorder = null;
    state.mediaRecorderStopped = null;
    state.streamSession = null;
    state.pendingDraft = "";
    state.isRecording = false;
    state.isBusy = false;
    releaseMicrophone();
    void closeSocket();
    syncUi();
  }

  function chooseMimeType() {
    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const candidate of options) {
      if (window.MediaRecorder?.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  async function ensureMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no expone acceso a microfono.");
    }
    if (state.mediaStream && state.mediaStream.active) {
      return state.mediaStream;
    }
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return state.mediaStream;
  }

  function mergeTranscript(base, addition) {
    const next = addition.trim();
    if (!next) {
      return base.trim();
    }
    if (!base.trim()) {
      return next;
    }
    return `${base.trim()} ${next}`;
  }

  function readDeepgramTranscript(payload) {
    const channel = payload?.channel;
    const alternatives = Array.isArray(channel?.alternatives) ? channel.alternatives : [];
    const transcript = alternatives[0]?.transcript;
    return typeof transcript === "string" ? transcript.trim() : "";
  }

  function handleSocketMessage(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }

    const transcript = readDeepgramTranscript(payload);
    if (!transcript) {
      return;
    }

    if (payload.is_final) {
      state.committedTranscript = mergeTranscript(state.committedTranscript, transcript);
      state.pendingDraft = "";
      state.finalSegmentCount += 1;
      onFinalTranscript?.({
        segmentId: `seg_${state.finalSegmentCount}`,
        transcript,
        language: state.streamSession?.language || null,
      });
    } else {
      state.pendingDraft = transcript;
    }
    renderTranscript();
  }

  function attachFinalizeWatcher() {
    if (!state.socket) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let maxWaitTimer = null;
      const socket = state.socket;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        socket.removeEventListener("message", onMessage);
        if (maxWaitTimer) {
          clearTimeout(maxWaitTimer);
        }
        resetFinalizeQuietTimer();
        resolve();
      };
      const onMessage = () => {
        resetFinalizeQuietTimer();
        state.finalizeQuietTimer = setTimeout(settle, 900);
      };

      resetFinalizeQuietTimer();
      state.finalizeQuietTimer = setTimeout(settle, 900);
      socket.addEventListener("message", onMessage);
      maxWaitTimer = setTimeout(settle, 2200);
    });
  }

  async function openDeepgramSocket() {
    const session = await fetchJSON("/api/voice/stream-session", { method: "POST" });
    state.streamSession = session;
    state.timesliceMs = Number(session.timeslice_ms) || 250;

    return await new Promise((resolve, reject) => {
      const authScheme =
        typeof session.auth_scheme === "string" && session.auth_scheme.trim() ? session.auth_scheme : "bearer";
      const socket = new WebSocket(session.websocket_url, [authScheme, session.access_token]);
      state.socket = socket;

      socket.addEventListener("message", handleSocketMessage);
      socket.addEventListener(
        "open",
        () => {
          resolve(socket);
        },
        { once: true }
      );
      socket.addEventListener(
        "error",
        () => {
          reject(new Error("No fue posible abrir el stream en Deepgram."));
        },
        { once: true }
      );
      socket.addEventListener("close", (event) => {
        if (state.isRecording && !event.wasClean) {
          onError("El stream de Deepgram se cerro antes de tiempo.");
          resetStreamingState();
        }
      });
    });
  }

  async function startMediaRecorder() {
    await ensureMicrophone();
    const mimeType = chooseMimeType();
    const recorder = mimeType ? new MediaRecorder(state.mediaStream, { mimeType }) : new MediaRecorder(state.mediaStream);
    state.mediaRecorder = recorder;
    state.mediaRecorderStopped = new Promise((resolve, reject) => {
      recorder.addEventListener(
        "stop",
        () => resolve(),
        { once: true }
      );
      recorder.addEventListener(
        "error",
        () => reject(new Error("No fue posible capturar audio.")),
        { once: true }
      );
    });

    recorder.addEventListener("dataavailable", async (event) => {
      if (!event.data || event.data.size === 0 || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const audioBuffer = await event.data.arrayBuffer();
      state.socket.send(audioBuffer);
    });

    recorder.start(state.timesliceMs);
  }

  async function startRecording() {
    state.isBusy = true;
    syncUi();
    try {
      transcriptOutput.value = "";
      state.committedTranscript = "";
      state.finalSegmentCount = 0;
      state.pendingDraft = "";
      renderTranscript();
      await openDeepgramSocket();
      await startMediaRecorder();
      state.isRecording = true;
      onRecordingStarted?.();
    } finally {
      state.isBusy = false;
      syncUi();
    }
  }

  async function stopRecording() {
    state.isBusy = true;
    syncUi();
    try {
      if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
        state.mediaRecorder.stop();
      }
      if (state.mediaRecorderStopped) {
        await state.mediaRecorderStopped;
      }
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ type: "Finalize" }));
        await attachFinalizeWatcher();
      }
      await closeSocket();
      state.pendingDraft = "";
      renderTranscript();
    } finally {
      state.mediaRecorder = null;
      state.mediaRecorderStopped = null;
      state.streamSession = null;
      state.isRecording = false;
      state.isBusy = false;
      releaseMicrophone();
      syncUi();
    }
  }

  async function toggleRecording() {
    try {
      if (state.isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error(error);
      resetStreamingState();
      onError(error.message || "No fue posible procesar la transcripcion.");
    }
  }

  function bindEvents() {
    recordToggleButton.addEventListener("click", handleRecordButtonClick);
    syncUi();
  }

  function handleRecordButtonClick() {
    void toggleRecording();
  }

  function dispose() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      state.mediaRecorder.stop();
    }
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: "Finalize" }));
    }
    releaseMicrophone();
    void closeSocket();
  }

  return {
    bindEvents,
    dispose,
  };
}

function defaultErrorHandler(message) {
  window.alert(message);
}
