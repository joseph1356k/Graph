import { GoogleGenAI, Modality } from "/vendor/genai.bundle.js";

/* ================================================================== */
/* Estado                                                              */
/* ================================================================== */

const state = {
  config: null,
  defaults: null,
  declarations: [],
  session: null,          // sesión Live API
  testId: null,           // id de la prueba en el servidor
  usage: null,            // último total acumulado que reportó la Live API
  screenStream: null,
  micStream: null,
  frameTimer: null,
  clockTimer: null,
  startedAt: null,
  resumeHandle: null,
  micOn: false,
  running: false,
  // audio de salida
  outCtx: null,
  playHead: 0,
  playing: [],
  // audio de entrada
  inCtx: null,
  worklet: null,
  // acumuladores de transcripción
  modelLine: null,
  userLine: null,
};

const $ = (id) => document.getElementById(id);

const el = {
  statusDot: $("statusDot"), statusText: $("statusText"),
  startBtn: $("startBtn"), stopBtn: $("stopBtn"),
  micBtn: $("micBtn"), micLabel: $("micLabel"),
  preview: $("preview"), stage: document.querySelector(".stage"),
  canvas: $("frameCanvas"), captureInfo: $("captureInfo"),
  transcript: $("transcript"), autoscroll: $("autoscroll"),
  composer: $("composer"), textInput: $("textInput"),
  timeline: $("timeline"), calls: $("calls"),
  timerLabel: $("timerLabel"), verdictPill: $("verdictPill"),
  testLabel: $("testLabel"), testContext: $("testContext"),
  saveCfgBtn: $("saveCfgBtn"), resetCfgBtn: $("resetCfgBtn"), cfgStatus: $("cfgStatus"),
};

const CFG_FIELDS = [
  "model", "voice", "languageCode", "temperature", "fps", "jpegQuality",
  "maxFrameWidth", "mediaResolution", "enableAffectiveDialog", "proactive",
  "systemInstruction",
];

/* ================================================================== */
/* Utilidades                                                          */
/* ================================================================== */

function setStatus(text, kind = "") {
  el.statusText.textContent = text;
  el.statusDot.className = "dot" + (kind ? " " + kind : "");
}

function clockString(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function elapsed() {
  return state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function floatToPCM16Base64(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

/* ================================================================== */
/* Transcript / timeline UI                                            */
/* ================================================================== */

function clearEmpty(container) {
  const e = container.querySelector(".empty");
  if (e) e.remove();
}

function addLine(who, text, kind = "") {
  clearEmpty(el.transcript);
  const div = document.createElement("div");
  div.className = `line ${kind || who}`;
  div.innerHTML =
    `<span class="t">${clockString(elapsed())}</span>` +
    `<span class="who"></span><span class="txt"></span>`;
  div.querySelector(".who").textContent =
    who === "model" ? "IA" : who === "user" ? "TÚ" : "SYS";
  div.querySelector(".txt").textContent = text;
  el.transcript.appendChild(div);
  if (el.autoscroll.checked) el.transcript.scrollTop = el.transcript.scrollHeight;
  return div;
}

function appendTo(lineEl, text) {
  const txt = lineEl.querySelector(".txt");
  txt.textContent += text;
  if (el.autoscroll.checked) el.transcript.scrollTop = el.transcript.scrollHeight;
}

function addEvent(container, cls, title, detail) {
  clearEmpty(container);
  const div = document.createElement("div");
  div.className = `event ${cls}`;
  div.innerHTML =
    `<div class="top"><span class="ttl"></span><span class="ts">${clockString(elapsed())}</span></div>` +
    (detail ? `<div class="det"></div>` : "");
  div.querySelector(".ttl").textContent = title;
  if (detail) div.querySelector(".det").textContent = detail;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addCall(name, args) {
  clearEmpty(el.calls);
  const div = document.createElement("div");
  div.className = "event call";
  div.innerHTML =
    `<div class="top"><span class="fn"></span><span class="ts">${clockString(elapsed())}</span></div>` +
    `<div class="args"></div>`;
  div.querySelector(".fn").textContent = name + "()";
  div.querySelector(".args").textContent = JSON.stringify(args);
  el.calls.appendChild(div);
  el.calls.scrollTop = el.calls.scrollHeight;
}

function setVerdict(v) {
  el.verdictPill.textContent = v || "—";
  el.verdictPill.className = "pill" + (v ? " " + v : "");
}

/* ================================================================== */
/* Configuración                                                       */
/* ================================================================== */

async function loadConfig() {
  const r = await fetch("/api/config").then((x) => x.json());
  state.config = r.config;
  state.defaults = r.defaults;
  applyConfigToForm(r.config);
}

function applyConfigToForm(cfg) {
  for (const key of CFG_FIELDS) {
    const node = $("cfg" + key[0].toUpperCase() + key.slice(1));
    if (!node) continue;
    if (node.type === "checkbox") node.checked = !!cfg[key];
    else node.value = cfg[key];
  }
  syncRangeLabels();
}

function readConfigFromForm() {
  const out = {};
  for (const key of CFG_FIELDS) {
    const node = $("cfg" + key[0].toUpperCase() + key.slice(1));
    if (!node) continue;
    if (node.type === "checkbox") out[key] = node.checked;
    else if (node.type === "range") out[key] = parseFloat(node.value);
    else out[key] = node.value;
  }
  return out;
}

function syncRangeLabels() {
  $("tempVal").textContent = $("cfgTemperature").value;
  $("fpsVal").textContent = $("cfgFps").value;
  $("qVal").textContent = $("cfgJpegQuality").value;
  $("wVal").textContent = $("cfgMaxFrameWidth").value;
}

["cfgTemperature", "cfgFps", "cfgJpegQuality", "cfgMaxFrameWidth"].forEach((id) =>
  $(id).addEventListener("input", syncRangeLabels)
);

el.saveCfgBtn.addEventListener("click", async () => {
  const cfg = readConfigFromForm();
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cfg),
  }).then((x) => x.json());
  state.config = r.config;
  el.cfgStatus.textContent = "Guardado. Se aplica en la próxima prueba.";
  setTimeout(() => (el.cfgStatus.textContent = ""), 3000);
});

el.resetCfgBtn.addEventListener("click", () => {
  applyConfigToForm(state.defaults);
  el.cfgStatus.textContent = "Valores por defecto cargados (sin guardar).";
  setTimeout(() => (el.cfgStatus.textContent = ""), 3000);
});

/* ================================================================== */
/* Audio de salida (24 kHz desde el modelo)                            */
/* ================================================================== */

function ensureOutputAudio() {
  if (!state.outCtx) {
    state.outCtx = new AudioContext({ sampleRate: 24000 });
    state.playHead = 0;
  }
  if (state.outCtx.state === "suspended") state.outCtx.resume();
}

function playAudioChunk(b64) {
  ensureOutputAudio();
  const bytes = base64ToBytes(b64);
  const samples = bytes.length >> 1;
  if (!samples) return;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) f32[i] = view.getInt16(i * 2, true) / 32768;

  const buffer = state.outCtx.createBuffer(1, samples, 24000);
  buffer.getChannelData(0).set(f32);

  const src = state.outCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(state.outCtx.destination);

  const now = state.outCtx.currentTime;
  const at = Math.max(now + 0.02, state.playHead);
  src.start(at);
  state.playHead = at + buffer.duration;

  state.playing.push(src);
  src.onended = () => {
    const i = state.playing.indexOf(src);
    if (i >= 0) state.playing.splice(i, 1);
  };
}

/** El usuario interrumpió: cortar de inmediato lo que se está reproduciendo. */
function flushAudio() {
  for (const src of state.playing) {
    try { src.stop(); } catch { /* ya terminó */ }
  }
  state.playing = [];
  state.playHead = state.outCtx ? state.outCtx.currentTime : 0;
}

/* ================================================================== */
/* Audio de entrada (micrófono, 16 kHz)                                */
/* ================================================================== */

async function startMic() {
  if (state.micOn) return;
  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  state.inCtx = new AudioContext({ sampleRate: 16000 });
  await state.inCtx.audioWorklet.addModule("/pcm-processor.js");

  const source = state.inCtx.createMediaStreamSource(state.micStream);
  const node = new AudioWorkletNode(state.inCtx, "pcm-processor");

  node.port.onmessage = (e) => {
    if (!state.session || !state.micOn) return;
    try {
      state.session.sendRealtimeInput({
        audio: { data: floatToPCM16Base64(e.data), mimeType: "audio/pcm;rate=16000" },
      });
    } catch { /* sesión cerrándose */ }
  };

  // Se conecta a un nodo mudo para que el grafo procese sin devolver eco.
  const mute = state.inCtx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(state.inCtx.destination);

  state.worklet = node;
  state.micOn = true;
  el.micBtn.classList.add("on");
  el.micLabel.textContent = "Micrófono on";
  addLine("sys", "Micrófono activado — puedes hablar para interrumpir.");
}

function stopMic() {
  state.micOn = false;
  if (state.worklet) { state.worklet.port.onmessage = null; state.worklet.disconnect(); state.worklet = null; }
  if (state.micStream) { state.micStream.getTracks().forEach((t) => t.stop()); state.micStream = null; }
  if (state.inCtx) { state.inCtx.close(); state.inCtx = null; }
  el.micBtn.classList.remove("on");
  el.micLabel.textContent = "Micrófono off";
}

el.micBtn.addEventListener("click", async () => {
  try {
    if (state.micOn) { stopMic(); addLine("sys", "Micrófono desactivado."); }
    else await startMic();
  } catch (err) {
    addLine("sys", `No se pudo acceder al micrófono: ${err.message}`);
  }
});

/* ================================================================== */
/* Captura de pantalla                                                 */
/* ================================================================== */

async function startScreen() {
  state.screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5 },
    audio: false,
  });
  el.preview.srcObject = state.screenStream;
  el.stage.classList.add("active");

  // Si el usuario detiene el compartir desde el diálogo del navegador.
  state.screenStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (state.running) {
      addLine("sys", "La captura de pantalla se detuvo. Finalizando prueba.");
      stopTest();
    }
  });

  await new Promise((resolve) => {
    if (el.preview.videoWidth) return resolve();
    el.preview.addEventListener("loadedmetadata", resolve, { once: true });
  });

  const track = state.screenStream.getVideoTracks()[0];
  el.captureInfo.textContent =
    `${el.preview.videoWidth}×${el.preview.videoHeight} · ${track.label || "pantalla"}`;
}

function sendFrame() {
  if (!state.session || !state.screenStream) return;
  const vw = el.preview.videoWidth, vh = el.preview.videoHeight;
  if (!vw || !vh) return;

  const maxW = state.config.maxFrameWidth;
  const scale = Math.min(1, maxW / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);

  el.canvas.width = w;
  el.canvas.height = h;
  const ctx = el.canvas.getContext("2d");
  ctx.drawImage(el.preview, 0, 0, w, h);

  const dataUrl = el.canvas.toDataURL("image/jpeg", state.config.jpegQuality);
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

  try {
    state.session.sendRealtimeInput({ video: { data: b64, mimeType: "image/jpeg" } });
  } catch { /* sesión cerrándose */ }
}

function stopScreen() {
  if (state.frameTimer) { clearInterval(state.frameTimer); state.frameTimer = null; }
  if (state.screenStream) { state.screenStream.getTracks().forEach((t) => t.stop()); state.screenStream = null; }
  el.preview.srcObject = null;
  el.stage.classList.remove("active");
  el.captureInfo.textContent = "sin captura";
}

/* ================================================================== */
/* Function calling                                                    */
/* ================================================================== */

async function handleToolCall(toolCall) {
  const responses = [];

  for (const fc of toolCall.functionCalls || []) {
    const args = fc.args || {};
    addCall(fc.name, args);

    let result;
    try {
      const r = await fetch("/api/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: fc.name, args, sessionId: state.testId }),
      }).then((x) => x.json());
      result = r.ok ? r.result : { error: r.error };
    } catch (err) {
      result = { error: err.message };
    }

    // Reflejo en la UI de las funciones conocidas.
    if (fc.name === "mark_step") {
      addEvent(el.timeline, args.status || "ok", args.step || "(paso)", args.note);
    } else if (fc.name === "log_finding") {
      addEvent(el.timeline, args.severity || "info", args.title || "(hallazgo)", args.detail);
    } else if (fc.name === "end_test") {
      setVerdict(args.verdict);
      addEvent(el.timeline, args.verdict === "passed" ? "ok" : "failed",
        `Prueba finalizada: ${args.verdict}`, args.summary);
    }

    responses.push({ id: fc.id, name: fc.name, response: result });
  }

  if (responses.length && state.session) {
    state.session.sendToolResponse({ functionResponses: responses });
  }

  // end_test cierra la captura, pero después de devolver la respuesta al modelo.
  if ((toolCall.functionCalls || []).some((f) => f.name === "end_test")) {
    setTimeout(() => stopTest({ keepVerdict: true }), 1200);
  }
}

/* ================================================================== */
/* Mensajes de la Live API                                             */
/* ================================================================== */

function handleMessage(msg) {
  // Consumo de la sesión. La Live API lo manda como TOTAL ACUMULADO, así que se
  // reemplaza en vez de sumarse — sumar multiplicaría el gasto por el número de
  // mensajes. Se guarda en memoria y se envía una sola vez, al parar: es el
  // único sitio desde el que se ve, porque el WebSocket va directo a Google y el
  // servidor de vision-live no lo atraviesa.
  if (msg.usageMetadata) {
    const u = msg.usageMetadata;
    const total = Number(u.totalTokenCount) || 0;
    if (total > 0) {
      state.usage = {
        model: state.config?.model || "",
        inputTokens: Number(u.promptTokenCount) || 0,
        outputTokens: Number(u.responseTokenCount ?? u.candidatesTokenCount) || 0,
        totalTokens: total,
      };
    }
  }

  if (msg.setupComplete) {
    setStatus("en vivo", "live");
    return;
  }

  if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
    state.resumeHandle = msg.sessionResumptionUpdate.newHandle;
  }

  if (msg.goAway) {
    addLine("sys", `El servidor cerrará la conexión en ~${msg.goAway.timeLeft || "poco"}.`);
  }

  const sc = msg.serverContent;
  if (sc) {
    if (sc.interrupted) {
      flushAudio();
      if (state.modelLine) { state.modelLine.classList.remove("partial"); state.modelLine = null; }
      addLine("sys", "— interrumpido —");
    }

    // Lo que dice el modelo, en texto.
    if (sc.outputTranscription?.text) {
      if (!state.modelLine) state.modelLine = addLine("model", "", "model partial");
      appendTo(state.modelLine, sc.outputTranscription.text);
    }

    // Lo que dice el usuario, en texto.
    if (sc.inputTranscription?.text) {
      if (!state.userLine) state.userLine = addLine("user", "", "user partial");
      appendTo(state.userLine, sc.inputTranscription.text);
    }

    // Audio del modelo.
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data && (part.inlineData.mimeType || "").startsWith("audio/")) {
        playAudioChunk(part.inlineData.data);
      }
      if (part.text) {
        if (!state.modelLine) state.modelLine = addLine("model", "", "model partial");
        appendTo(state.modelLine, part.text);
      }
    }

    if (sc.turnComplete) {
      for (const key of ["modelLine", "userLine"]) {
        if (state[key]) {
          state[key].classList.remove("partial");
          const txt = state[key].querySelector(".txt").textContent.trim();
          if (txt) persistNarration(key === "modelLine" ? "model" : "user", txt);
          else state[key].remove();
          state[key] = null;
        }
      }
    }
  }

  if (msg.toolCall) handleToolCall(msg.toolCall);
}

function persistNarration(speaker, text) {
  if (!state.testId) return;
  fetch(`/api/session/${state.testId}/narration`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker, text }),
  }).catch(() => {});
}

/* ================================================================== */
/* Ciclo de vida de la prueba                                          */
/* ================================================================== */

async function startTest() {
  el.startBtn.disabled = true;
  setStatus("solicitando captura…", "warn");

  try {
    // 1. Captura de pantalla primero: si el usuario cancela, no gastamos token.
    await startScreen();

    // 2. Config vigente del formulario (sin exigir guardado previo).
    state.config = readConfigFromForm();

    // 3. Sesión de prueba en el servidor.
    setStatus("creando sesión…", "warn");
    const s = await fetch("/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: el.testLabel.value || "Prueba sin nombre",
        context: el.testContext.value || "",
      }),
    }).then((x) => x.json());
    state.testId = s.id;

    // 4. Declaraciones de funciones.
    const fns = await fetch("/api/functions").then((x) => x.json());
    state.declarations = fns.declarations;

    // 5. Token efímero.
    const tokenRes = await fetch("/api/token", { method: "POST" }).then((x) => x.json());
    if (tokenRes.error) throw new Error(tokenRes.error);

    // 6. Conectar a la Live API.
    setStatus("conectando…", "warn");
    const ai = new GoogleGenAI({ apiKey: tokenRes.token });

    const config = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: state.config.systemInstruction,
      temperature: state.config.temperature,
      mediaResolution: state.config.mediaResolution,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: state.config.voice } },
        languageCode: state.config.languageCode,
      },
      tools: [{ functionDeclarations: state.declarations }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Obligatorio para pasar de ~2 min en sesiones con audio + vídeo.
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
    };
    if (state.config.enableAffectiveDialog) config.enableAffectiveDialog = true;
    if (state.config.proactive) config.proactivity = { proactiveAudio: true };

    state.session = await ai.live.connect({
      model: state.config.model,
      config,
      callbacks: {
        onopen: () => setStatus("conectado", "live"),
        onmessage: handleMessage,
        onerror: (e) => {
          setStatus("error", "error");
          addLine("sys", `Error de conexión: ${e?.message || e}`);
        },
        onclose: (e) => {
          if (state.running) {
            setStatus("conexión cerrada", "warn");
            addLine("sys", `Conexión cerrada: ${e?.reason || "sin motivo"}`);
          }
        },
      },
    });

    // 7. Arrancar reloj, frames y estado de UI.
    state.running = true;
    state.startedAt = Date.now();
    ensureOutputAudio();
    setVerdict("running");
    el.stopBtn.disabled = false;
    el.transcript.innerHTML = "";
    el.timeline.innerHTML = '<div class="empty">Sin eventos.</div>';
    el.calls.innerHTML = '<div class="empty">Ninguna todavía.</div>';

    state.clockTimer = setInterval(() => {
      el.timerLabel.textContent = clockString(elapsed());
    }, 1000);

    const intervalMs = Math.round(1000 / Math.max(0.25, state.config.fps));
    sendFrame();
    state.frameTimer = setInterval(sendFrame, intervalMs);

    // 8. Briefing inicial: qué debería pasar en esta prueba.
    const brief = el.testContext.value.trim();
    const label = el.testLabel.value.trim();
    const opening = [
      label ? `Prueba: "${label}".` : "Prueba sin nombre.",
      brief ? `Lo que debería ocurrir:\n${brief}` : "No se dio descripción del flujo esperado.",
      "Estás viendo la pantalla en vivo desde este momento. Empieza a narrar lo que observas.",
    ].join("\n\n");

    state.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: opening }] }],
      turnComplete: true,
    });

    addLine("sys", "Prueba iniciada. El modelo está observando la pantalla.");
  } catch (err) {
    setStatus("error", "error");
    addLine("sys", `No se pudo iniciar: ${err.message}`);
    stopScreen();
    el.startBtn.disabled = false;
    el.stopBtn.disabled = true;
    setVerdict(null);
  }
}

async function stopTest({ keepVerdict = false } = {}) {
  if (!state.running) return;
  state.running = false;

  if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = null; }
  stopScreen();
  stopMic();
  flushAudio();

  if (state.session) {
    try { state.session.close(); } catch { /* ya cerrada */ }
    state.session = null;
  }

  if (state.testId) {
    // El consumo va ANTES del stop: `stop` es quien lo reenvía al ledger, así
    // que mandarlo después llegaría tarde y se perdería la sesión entera.
    if (state.usage) {
      try {
        await fetch(`/api/session/${state.testId}/usage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state.usage),
        });
      } catch { /* la telemetría nunca impide guardar el informe */ }
    }
    try {
      const r = await fetch(`/api/session/${state.testId}/stop`, { method: "POST" })
        .then((x) => x.json());
      if (!keepVerdict) setVerdict(r.session?.verdict || "aborted");
      addLine("sys", `Reporte guardado: ${r.report}`);
    } catch (err) {
      addLine("sys", `No se pudo guardar el reporte: ${err.message}`);
    }
  }

  state.testId = null;
  setStatus("desconectado");
  el.startBtn.disabled = false;
  el.stopBtn.disabled = true;
}

el.startBtn.addEventListener("click", startTest);
el.stopBtn.addEventListener("click", () => stopTest());

/* ================================================================== */
/* Entrada de texto                                                    */
/* ================================================================== */

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.textInput.value.trim();
  if (!text) return;
  if (!state.session) { addLine("sys", "No hay prueba en curso."); return; }

  addLine("user", text);
  persistNarration("user", text);
  flushAudio(); // el texto del usuario también interrumpe
  state.session.sendClientContent({
    turns: [{ role: "user", parts: [{ text }] }],
    turnComplete: true,
  });
  el.textInput.value = "";
});

/* ================================================================== */
/* Arranque                                                            */
/* ================================================================== */

window.addEventListener("beforeunload", () => {
  if (state.running) stopTest();
});

(async () => {
  try {
    const health = await fetch("/api/health").then((x) => x.json());
    if (!health.hasApiKey) {
      addLine("sys", "Falta la API key de Gemini. Revisa secrets.json o la variable GEMINI_API_KEY.");
      setStatus("sin API key", "error");
      el.startBtn.disabled = true;
    }
    await loadConfig();
  } catch (err) {
    addLine("sys", `No se pudo contactar al servidor: ${err.message}`);
    setStatus("servidor caído", "error");
  }
})();
