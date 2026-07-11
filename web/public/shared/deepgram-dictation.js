/**
 * Single source of truth for browser → Deepgram streaming dictation.
 *
 * The mic/WebSocket/MediaRecorder/Deepgram-parsing mechanics used to be
 * duplicated in the Miracle SPA and in the floating assistant (trainer-plugin),
 * which meant every fix (e.g. the fresh-mic settle that avoids duration:0 /
 * NET-0000) had to be applied twice. This module owns that logic once; each
 * surface injects how it creates a stream session and wires its own UI.
 *
 * Classic script (no imports) so it works both in the ES-module SPA and in the
 * plain-script floating assistant / Chrome extension. Exposes
 * `window.MiracleDeepgramDictation`.
 */
(function (global) {
  "use strict";

  function noop() {}

  function chooseMimeType() {
    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const candidate of options) {
      if (global.MediaRecorder && global.MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  async function waitForMicrophoneReady(stream) {
    const track = stream && typeof stream.getAudioTracks === "function" ? stream.getAudioTracks()[0] : null;
    // A freshly opened mic track starts "muted" until the device produces audio.
    if (track && track.muted) {
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          track.removeEventListener("unmute", finish);
          resolve();
        };
        const timer = setTimeout(finish, 1500);
        track.addEventListener("unmute", finish, { once: true });
      });
    }
    // Extra settle so MediaRecorder reads stable track settings and writes a valid
    // WebM header; otherwise Deepgram cannot decode the first stream (duration:0 / NET-0000).
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  function readDeepgramTranscript(payload) {
    const channel = payload && payload.channel;
    const alternatives = channel && Array.isArray(channel.alternatives) ? channel.alternatives : [];
    const transcript = alternatives[0] && alternatives[0].transcript;
    return typeof transcript === "string" ? transcript.trim() : "";
  }

  // Soniox authenticates + configures over the first JSON frame (auth_scheme
  // "message") instead of a WebSocket subprotocol like Deepgram, so the client
  // opens a plain socket and sends session.start_message on open.
  function isSonioxSession(session) {
    return Boolean(session && (session.provider === "soniox" || session.auth_scheme === "message"));
  }

  // Soniox marks segment boundaries with control tokens: "<end>" (automatic
  // endpoint detection) and "<fin>" (manual finalize completed). They are not
  // spoken text and must not be rendered.
  function isSonioxBoundaryToken(text) {
    return text === "<end>" || text === "<fin>";
  }

  function createDictation(options) {
    options = options || {};
    const createStreamSession = options.createStreamSession;
    if (typeof createStreamSession !== "function") {
      throw new Error("MiracleDeepgramDictation.create requires a createStreamSession() function.");
    }
    const onPartialTranscript = options.onPartialTranscript || noop;
    const onFinalTranscript = options.onFinalTranscript || noop;
    const onError = options.onError || noop;
    const onDebug = options.onDebug || noop;
    const onUnexpectedClose = options.onUnexpectedClose || noop;

    const state = {
      finalSegmentCount: 0,
      finalizeQuietTimer: null,
      isRecording: false,
      mediaRecorder: null,
      mediaRecorderStopped: null,
      mediaStream: null,
      socket: null,
      streamSession: null,
      timesliceMs: 250,
      provider: "deepgram",
      // Soniox streams token-by-token; we accumulate confirmed (is_final) text here
      // until an <end>/<fin> boundary token flushes it as one final segment.
      sonioxFinalBuffer: "",
    };

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

    function resetState() {
      resetFinalizeQuietTimer();
      state.mediaRecorder = null;
      state.mediaRecorderStopped = null;
      state.streamSession = null;
      state.provider = "deepgram";
      state.sonioxFinalBuffer = "";
      state.isRecording = false;
      releaseMicrophone();
      void closeSocket();
    }

    async function ensureMicrophone() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
      await waitForMicrophoneReady(state.mediaStream);
      return state.mediaStream;
    }

    function flushSonioxSegment() {
      const transcript = state.sonioxFinalBuffer.trim();
      state.sonioxFinalBuffer = "";
      if (!transcript) {
        return;
      }
      state.finalSegmentCount += 1;
      onFinalTranscript({
        segmentId: `seg_${state.finalSegmentCount}`,
        transcript,
        language: (state.streamSession && state.streamSession.language) || null,
      });
    }

    function handleSonioxMessage(payload) {
      if (payload.error_code || payload.error_message) {
        onDebug("soniox.socket.error_payload", {
          errorCode: Number(payload.error_code) || 0,
          errorMessage: `${payload.error_message || ""}`.slice(0, 180),
        });
        onError(`Soniox: ${payload.error_message || `error ${payload.error_code}`}`);
        return;
      }
      const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
      let nonFinalText = "";
      let sawBoundary = false;
      for (const token of tokens) {
        const text = token && typeof token.text === "string" ? token.text : "";
        if (!text) {
          continue;
        }
        if (token.is_final) {
          if (isSonioxBoundaryToken(text)) {
            sawBoundary = true;
            continue;
          }
          state.sonioxFinalBuffer += text;
        } else {
          nonFinalText += text;
        }
      }
      const provisional = `${state.sonioxFinalBuffer}${nonFinalText}`.trim();
      onDebug("soniox.socket.message", {
        tokenCount: tokens.length,
        boundary: sawBoundary,
        transcriptLength: provisional.length,
        transcriptPreview: provisional.slice(0, 180),
      });
      if (provisional) {
        onPartialTranscript(provisional);
      }
      if (sawBoundary) {
        flushSonioxSegment();
      }
    }

    function handleSocketMessage(event) {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        onDebug("deepgram.socket.non_json", { messagePreview: `${(event && event.data) || ""}`.slice(0, 120) });
        return;
      }
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (state.provider === "soniox") {
        handleSonioxMessage(payload);
        return;
      }
      const transcript = readDeepgramTranscript(payload);
      onDebug("deepgram.socket.message", {
        isFinal: Boolean(payload.is_final),
        type: payload.type || "",
        transcriptLength: transcript.length,
        transcriptPreview: transcript.slice(0, 180),
      });
      if (!transcript) {
        return;
      }
      if (payload.is_final) {
        state.finalSegmentCount += 1;
        onFinalTranscript({
          segmentId: `seg_${state.finalSegmentCount}`,
          transcript,
          language: (state.streamSession && state.streamSession.language) || null,
        });
      } else {
        onPartialTranscript(transcript);
      }
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
      const session = await createStreamSession();
      state.streamSession = session;
      state.provider = (session && session.provider) || "deepgram";
      state.sonioxFinalBuffer = "";
      state.timesliceMs = Number(session && session.timeslice_ms) || 250;
      const soniox = isSonioxSession(session);
      onDebug("deepgram.session.created", {
        provider: state.provider,
        model: (session && session.model) || "",
        language: (session && session.language) || "",
        endpointingMs: Number(session && session.endpointing_ms) || 0,
        timesliceMs: state.timesliceMs,
      });

      return await new Promise((resolve, reject) => {
        const authScheme =
          typeof session.auth_scheme === "string" && session.auth_scheme.trim() ? session.auth_scheme : "bearer";
        // Deepgram authenticates via the subprotocol tuple; Soniox opens a plain
        // socket and sends its config (with the temporary api_key) as the first frame.
        const socket = soniox
          ? new WebSocket(session.websocket_url)
          : new WebSocket(session.websocket_url, [authScheme, session.access_token]);
        state.socket = socket;
        socket.addEventListener("message", handleSocketMessage);
        socket.addEventListener(
          "open",
          () => {
            if (soniox) {
              const startMessage =
                session.start_message && typeof session.start_message === "object" ? session.start_message : null;
              if (!startMessage) {
                onDebug("soniox.socket.missing_start_message", {});
                reject(new Error("Soniox no devolvio la configuracion inicial del stream."));
                return;
              }
              socket.send(JSON.stringify(startMessage));
            }
            onDebug("deepgram.socket.open", { model: (state.streamSession && state.streamSession.model) || "" });
            resolve(socket);
          },
          { once: true }
        );
        socket.addEventListener(
          "error",
          () => {
            onDebug("deepgram.socket.error", {});
            reject(new Error("No fue posible abrir el stream en Deepgram."));
          },
          { once: true }
        );
        socket.addEventListener("close", (closeEvent) => {
          onDebug("deepgram.socket.close", {
            code: Number(closeEvent && closeEvent.code) || 0,
            reason: `${(closeEvent && closeEvent.reason) || ""}`,
            wasClean: Boolean(closeEvent && closeEvent.wasClean),
          });
          if (state.isRecording && closeEvent && !closeEvent.wasClean) {
            onError("El stream de Deepgram se cerro antes de tiempo.");
            resetState();
            onUnexpectedClose();
          }
        });
      });
    }

    async function startMediaRecorder() {
      await ensureMicrophone();
      const mimeType = chooseMimeType();
      const recorder = mimeType
        ? new MediaRecorder(state.mediaStream, { mimeType })
        : new MediaRecorder(state.mediaStream);
      state.mediaRecorder = recorder;
      state.mediaRecorderStopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.addEventListener("error", () => reject(new Error("No fue posible capturar audio.")), { once: true });
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

    // Deepgram uses the "Finalize" control message; Soniox uses lowercase
    // "finalize" and then expects an empty frame to end the stream.
    function sendFinalizeSignal() {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (state.provider === "soniox") {
        state.socket.send(JSON.stringify({ type: "finalize" }));
      } else {
        state.socket.send(JSON.stringify({ type: "Finalize" }));
      }
    }

    function endSonioxStream() {
      if (state.provider !== "soniox") {
        return;
      }
      // Emit whatever confirmed text is still buffered (no trailing <fin>/<end>),
      // then signal end-of-stream to Soniox with an empty frame.
      flushSonioxSegment();
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(new ArrayBuffer(0));
      }
    }

    async function start() {
      state.finalSegmentCount = 0;
      // Acquire (and settle) the mic before opening the socket so it is not idle
      // during warm-up and MediaRecorder reads stable track settings.
      await ensureMicrophone();
      await openDeepgramSocket();
      await startMediaRecorder();
      state.isRecording = true;
    }

    async function stop() {
      try {
        if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
          state.mediaRecorder.stop();
        }
        if (state.mediaRecorderStopped) {
          await state.mediaRecorderStopped;
        }
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
          onDebug("deepgram.socket.finalize_sent", { provider: state.provider });
          sendFinalizeSignal();
          await attachFinalizeWatcher();
          endSonioxStream();
        }
        await closeSocket();
      } finally {
        state.mediaRecorder = null;
        state.mediaRecorderStopped = null;
        state.streamSession = null;
        state.provider = "deepgram";
        state.sonioxFinalBuffer = "";
        state.isRecording = false;
        releaseMicrophone();
      }
    }

    function dispose() {
      if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
        state.mediaRecorder.stop();
      }
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        sendFinalizeSignal();
        endSonioxStream();
      }
      releaseMicrophone();
      void closeSocket();
    }

    return {
      start,
      stop,
      dispose,
      reset: resetState,
      ensureMicrophone,
      isRecording: function () {
        return state.isRecording;
      },
    };
  }

  /**
   * Shared note-organization call: send one final transcript segment to the
   * orchestrator and return the parsed response ({ resolved_note_content,
   * note_updates, backend_status, usage, ... }). `sendOrchestratorEvent` is
   * injected so each surface keeps its own base URL + auth plumbing.
   */
  async function organizeNoteSegment(options) {
    options = options || {};
    const sendOrchestratorEvent = options.sendOrchestratorEvent;
    if (typeof sendOrchestratorEvent !== "function") {
      throw new Error("organizeNoteSegment requires a sendOrchestratorEvent() function.");
    }
    const body = {
      voice_session_id: options.voiceSessionId,
      note_path: typeof options.notePath === "undefined" ? null : options.notePath,
      note_title: options.noteTitle || "",
      note_content: options.noteContent || "",
      tab_id: options.tabId || "",
      event_id: options.eventId,
      sequence: options.sequence,
      segment: {
        segment_id: options.segmentId,
        kind: "final",
        transcript: options.transcript,
        language: options.language || null,
      },
    };
    const payload = await sendOrchestratorEvent(body);
    return payload || {};
  }

  global.MiracleDeepgramDictation = {
    create: createDictation,
    organizeNoteSegment: organizeNoteSegment,
  };
})(typeof window !== "undefined" ? window : globalThis);
