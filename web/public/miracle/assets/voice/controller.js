import { fetchJSON } from "/miracle/assets/lib/api.js";

// Thin UI wrapper over the shared Deepgram dictation engine
// (window.MiracleDeepgramDictation, loaded via /shared/deepgram-dictation.js).
// Owns only this surface's record-button + transcript-output UI; all the
// mic/WebSocket/MediaRecorder/Deepgram mechanics live in the shared engine.
export function createVoiceStreamingController({
  recordToggleButton,
  transcriptOutput,
  container = null,
  onError = defaultErrorHandler,
  onFinalTranscript = null,
  onRecordingStarted = null,
  onDebug = null,
}) {
  if (!recordToggleButton || !transcriptOutput) {
    throw new Error("Voice streaming controller requires a record button and transcript output.");
  }
  const engineFactory = window.MiracleDeepgramDictation;
  if (!engineFactory || typeof engineFactory.create !== "function") {
    throw new Error("El motor de dictado compartido (MiracleDeepgramDictation) no esta cargado.");
  }

  const ui = {
    committedTranscript: "",
    pendingDraft: "",
    isBusy: false,
  };

  function readTranscriptValue() {
    const committed = ui.committedTranscript.trim();
    const draft = ui.pendingDraft.trim();
    return committed && draft ? `${committed} ${draft}` : committed || draft;
  }

  function syncUi() {
    recordToggleButton.disabled = ui.isBusy;
    recordToggleButton.textContent = dictation.isRecording() ? "Terminar" : "Grabar";
    if (!container) {
      return;
    }
    container.classList.toggle("is-recording", dictation.isRecording());
    container.classList.toggle("has-transcript", Boolean(readTranscriptValue()));
  }

  function renderTranscript() {
    transcriptOutput.value = readTranscriptValue();
    transcriptOutput.scrollTop = transcriptOutput.scrollHeight;
    syncUi();
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

  const dictation = engineFactory.create({
    createStreamSession: () => fetchJSON("/api/voice/stream-session", { method: "POST" }),
    onDebug: (event, details) => {
      if (onDebug) onDebug(event, details);
    },
    onError: (message) => onError(message),
    onPartialTranscript: (transcript) => {
      ui.pendingDraft = transcript;
      renderTranscript();
    },
    onFinalTranscript: (segment) => {
      ui.committedTranscript = mergeTranscript(ui.committedTranscript, segment.transcript);
      ui.pendingDraft = "";
      renderTranscript();
      if (onFinalTranscript) onFinalTranscript(segment);
    },
    onUnexpectedClose: () => {
      ui.isBusy = false;
      syncUi();
    },
  });

  async function startRecording() {
    ui.isBusy = true;
    if (onDebug) onDebug("dictation.starting", {});
    syncUi();
    try {
      transcriptOutput.value = "";
      ui.committedTranscript = "";
      ui.pendingDraft = "";
      renderTranscript();
      await dictation.start();
      if (onDebug) onDebug("dictation.started", {});
      if (onRecordingStarted) onRecordingStarted();
    } finally {
      ui.isBusy = false;
      syncUi();
    }
  }

  async function stopRecording() {
    ui.isBusy = true;
    if (onDebug) onDebug("dictation.stop_requested", {});
    syncUi();
    try {
      await dictation.stop();
      ui.pendingDraft = "";
      renderTranscript();
    } finally {
      ui.isBusy = false;
      syncUi();
    }
  }

  async function toggleRecording() {
    try {
      if (dictation.isRecording()) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error(error);
      dictation.reset();
      ui.isBusy = false;
      syncUi();
      onError(error.message || "No fue posible procesar la transcripcion.");
    }
  }

  function bindEvents() {
    recordToggleButton.addEventListener("click", () => {
      void toggleRecording();
    });
    syncUi();
  }

  function dispose() {
    dictation.dispose();
  }

  return {
    bindEvents,
    dispose,
  };
}

function defaultErrorHandler(message) {
  window.alert(message);
}
