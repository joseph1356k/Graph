import { fetchJSON } from "/miracle/assets/lib/api.js";
import { createChatController } from "/miracle/assets/chat/controller.js";
import { addEntryToCheckpoint, finalizeCheckpoint } from "/miracle/assets/notes/checkpoints.js";
import { createEditorController } from "/miracle/assets/notes/editor.js";
import { createPreviewRenderer } from "/miracle/assets/notes/preview.js";
import { createProductLlmController } from "/miracle/assets/product_llm/controller.js";
import { createWorkspaceController } from "/miracle/assets/notes/workspace.js";
import { createVoiceStreamingController } from "/miracle/assets/voice/controller.js";

const state = {
  files: [],
  openTabs: [],
  activeTabId: null,
  untitledCount: 0,
  previousResponseId: null,
  autosaveTimer: null,
  sessionTimer: null,
  contextTimer: null,
  changeCaptureTimer: null,
  contextRequestToken: 0,
  chatPinned: false,
  chatCloseTimer: null,
  workspaceBooted: false,
  voiceOrchestrationQueue: Promise.resolve(),
  voiceOrchestrationSessionId: null,
  voiceOrchestrationSequence: 0,
  voiceOrchestrationStatus: null,
  productLlmSetup: null,
  voiceDebugEntries: [],
  voiceDebugOpen: false,
  voiceDebugFilter: "all",
};

const dom = {
  notePicker: document.getElementById("notePicker"),
  openNoteButton: document.getElementById("openNoteButton"),
  tabs: document.getElementById("tabs"),
  editor: document.getElementById("editor"),
  editorPreview: document.getElementById("editorPreview"),
  editorShell: document.querySelector(".editor-shell"),
  voiceDock: document.getElementById("voiceDock"),
  voiceDockRecordToggleButton: document.getElementById("voiceDockRecordToggleButton"),
  voiceDockTranscriptOutput: document.getElementById("voiceDockTranscriptOutput"),
  voiceDockMeta: document.getElementById("voiceDockMeta"),
  voiceDockBackendStatus: document.getElementById("voiceDockBackendStatus"),
  voiceDockTaskCount: document.getElementById("voiceDockTaskCount"),
  voiceDockTaskList: document.getElementById("voiceDockTaskList"),
  voiceDockDebugToggle: document.getElementById("voiceDockDebugToggle"),
  voiceDockDebugFilters: document.getElementById("voiceDockDebugFilters"),
  voiceDockDebugOutput: document.getElementById("voiceDockDebugOutput"),
  saveButton: document.getElementById("saveButton"),
  refreshButton: document.getElementById("refreshButton"),
  productLlmConfigButton: document.getElementById("productLlmConfigButton"),
  voiceLabButton: document.getElementById("voiceLabButton"),
  newNoteButton: document.getElementById("newNoteButton"),
  statusPath: document.getElementById("statusPath"),
  statusBlock: document.getElementById("statusBlock"),
  statusMessage: document.getElementById("statusMessage"),
  chatHandle: document.getElementById("chatHandle"),
  chatDrawer: document.getElementById("chatDrawer"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  newChatButton: document.getElementById("newChatButton"),
  pinChatButton: document.getElementById("pinChatButton"),
  productLlmOverlay: document.getElementById("productLlmOverlay"),
  productLlmCurrentConfig: document.getElementById("productLlmCurrentConfig"),
  productLlmForm: document.getElementById("productLlmForm"),
  productLlmProvider: document.getElementById("productLlmProvider"),
  productLlmApiKeyField: document.getElementById("productLlmApiKeyField"),
  productLlmApiKey: document.getElementById("productLlmApiKey"),
  productLlmBaseUrlField: document.getElementById("productLlmBaseUrlField"),
  productLlmBaseUrl: document.getElementById("productLlmBaseUrl"),
  productLlmModelField: document.getElementById("productLlmModelField"),
  productLlmModel: document.getElementById("productLlmModel"),
  productLlmStatus: document.getElementById("productLlmStatus"),
  productLlmRefreshButton: document.getElementById("productLlmRefreshButton"),
  productLlmSubmitButton: document.getElementById("productLlmSubmitButton"),
  productLlmCloseButton: document.getElementById("productLlmCloseButton"),
};

const previewRenderer = createPreviewRenderer(dom.editorPreview);
let chatController = null;
let editorController = null;
let voiceController = null;
let productLlmController = null;

function appendVoiceDebug(event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event: `${event || ""}`.trim() || "debug",
    details: details && typeof details === "object" ? details : { value: details },
  };
  state.voiceDebugEntries = [...state.voiceDebugEntries, entry].slice(-120);
  renderVoiceDebug();
}

function clearVoiceDebug() {
  state.voiceDebugEntries = [];
  renderVoiceDebug();
}

function classifyVoiceDebugEntry(entry) {
  const event = `${entry?.event || ""}`.toLowerCase();
  if (event.startsWith("deepgram.")) {
    return "deepgram";
  }
  if (
    event.startsWith("miracle.segment.") ||
    event.startsWith("product_llm.") ||
    event.startsWith("llm.") ||
    event.startsWith("openai.") ||
    event.startsWith("azure.") ||
    event.startsWith("deepseek.")
  ) {
    return "llm";
  }
  const detailsText = JSON.stringify(entry?.details || {}).toLowerCase();
  if (
    detailsText.includes("deepseek") ||
    detailsText.includes("gpt-4.1") ||
    detailsText.includes("product-llm") ||
    detailsText.includes("chat_completions") ||
    detailsText.includes("usageModel".toLowerCase())
  ) {
    return "llm";
  }
  return "other";
}

function getFilteredVoiceDebugEntries() {
  if (state.voiceDebugFilter === "all") {
    return state.voiceDebugEntries;
  }
  return state.voiceDebugEntries.filter((entry) => classifyVoiceDebugEntry(entry) === state.voiceDebugFilter);
}

function renderVoiceDebug() {
  if (!dom.voiceDockDebugOutput || !dom.voiceDockDebugToggle) {
    return;
  }
  dom.voiceDockDebugToggle.textContent = state.voiceDebugOpen ? "Cerrar diagnóstico" : "Abrir diagnóstico";
  dom.voiceDockDebugToggle.setAttribute("aria-expanded", state.voiceDebugOpen ? "true" : "false");
  if (dom.voiceDockDebugFilters) {
    dom.voiceDockDebugFilters.classList.toggle("is-hidden", !state.voiceDebugOpen);
    const filterButtons = Array.from(dom.voiceDockDebugFilters.querySelectorAll("[data-debug-filter]"));
    for (const button of filterButtons) {
      const isActive = button.dataset.debugFilter === state.voiceDebugFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }
  dom.voiceDockDebugOutput.classList.toggle("is-hidden", !state.voiceDebugOpen);
  const visibleEntries = getFilteredVoiceDebugEntries();
  const emptyLabel = state.voiceDebugEntries.length > 0
    ? "No hay eventos para este filtro."
    : "Sin eventos de diagnóstico todavía.";
  dom.voiceDockDebugOutput.textContent = visibleEntries.length > 0
    ? visibleEntries.map((entry) => `[${entry.timestamp}] ${entry.event} ${JSON.stringify(entry.details)}`).join("\n")
    : emptyLabel;
  dom.voiceDockDebugOutput.scrollTop = dom.voiceDockDebugOutput.scrollHeight;
}

function setStatus(message) {
  dom.statusMessage.textContent = message;
}

function showEditMode() {
  dom.editor.classList.remove("is-hidden");
  dom.editorPreview.classList.add("is-hidden");
  dom.editor.focus();
}

function showPreviewMode() {
  dom.editor.classList.add("is-hidden");
  dom.editorPreview.classList.remove("is-hidden");
}

function renderActiveTab(tab) {
  previewRenderer.render(tab?.content || "", {
    activeBlockStart: tab?.contextPacket?.active_block?.start ?? null,
    blocks: tab?.contextPacket?.note_blocks || [],
  });
  dom.statusPath.textContent = tab?.path ? `workspaces/miracle/knowledge/${tab.path}` : "Sin guardar";
  dom.statusBlock.textContent = tab?.contextPacket?.active_block?.preview || "Sin bloque activo";
  chatController?.updateHandlePosition(tab);
}

const workspaceController = createWorkspaceController({
  state,
  dom,
  fetchJSON,
  setStatus,
  finalizeCheckpoint,
  renderActiveTab,
  onTabActivated(tab) {
    showPreviewMode();
    editorController?.updateContextFromEditor({ previousContent: tab.content, preserveRecentChange: true });
  },
});

chatController = createChatController({
  state,
  dom,
  fetchJSON,
  setStatus,
  getActiveTab: workspaceController.getActiveTab,
  requestContextPacket: (...args) => editorController.requestContextPacket(...args),
  scheduleSessionPersist: workspaceController.scheduleSessionPersist,
});

editorController = createEditorController({
  state,
  dom,
  fetchJSON,
  setStatus,
  previewRenderer,
  getActiveTab: workspaceController.getActiveTab,
  renderTabs: workspaceController.renderTabs,
  renderActiveTab,
  scheduleSessionPersist: workspaceController.scheduleSessionPersist,
  saveActiveFile: workspaceController.saveActiveFile,
  addEntryToCheckpoint,
  updateChatHandlePosition: (tab) => chatController.updateHandlePosition(tab),
  showEditMode,
  showPreviewMode,
});

voiceController = createVoiceStreamingController({
  recordToggleButton: dom.voiceDockRecordToggleButton,
  transcriptOutput: dom.voiceDockTranscriptOutput,
  container: dom.voiceDock,
  onDebug: appendVoiceDebug,
  onRecordingStarted() {
    state.voiceOrchestrationSessionId = crypto.randomUUID();
    state.voiceOrchestrationSequence = 0;
    clearVoiceDebug();
    appendVoiceDebug("dictation.recording_started", {
      voiceSessionId: state.voiceOrchestrationSessionId,
      backendStatus: state.voiceOrchestrationStatus?.status || "",
    });
    renderVoiceOrchestrationMeta({
      backendStatus: state.voiceOrchestrationStatus?.status,
      tasks: [],
      visible: true,
    });
  },
  onFinalTranscript(segment) {
    state.voiceOrchestrationQueue = state.voiceOrchestrationQueue
      .then(() => processVoiceSegment(segment))
      .catch((error) => setStatus(error.message));
  },
});

async function bootWorkspace() {
  if (state.workspaceBooted) return;
  await workspaceController.loadTree();
  await workspaceController.loadSession();
  chatController.syncLayout();
  chatController.appendSystemMessage(
    "Escribe normalmente. El sistema conserva el contexto de cambios por debajo y el chat se mantiene simple."
  );
  state.workspaceBooted = true;
}

function renderVoiceOrchestrationMeta({ backendStatus, tasks, visible = true } = {}) {
  const resolvedBackend = backendStatus || state.voiceOrchestrationStatus?.status || "sin estado";
  const labelMap = {
    configured: "product LLM",
    heuristic: "heurístico",
    disabled: "deshabilitado",
    "product-llm": "product LLM",
    "duplicate-segment": "duplicado",
  };
  dom.voiceDockBackendStatus.textContent = `Motor: ${labelMap[resolvedBackend] || resolvedBackend}`;
  const taskItems = Array.isArray(tasks) ? tasks : [];
  dom.voiceDockTaskCount.textContent = `Tareas: ${taskItems.length}`;
  dom.voiceDockTaskList.innerHTML = "";
  for (const task of taskItems) {
    const item = document.createElement("div");
    item.className = "voice-dock-task";
    const summary = task?.result_summary || task?.payload?.summary || task?.intent || "Tarea planificada";
    const suffixParts = [];
    if (task?.status) {
      suffixParts.push(task.status);
    }
    if (task?.mode) {
      suffixParts.push(task.mode);
    }
    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
    item.textContent = `${summary}${suffix}`;
    dom.voiceDockTaskList.appendChild(item);
  }
  dom.voiceDockMeta.classList.toggle("is-hidden", !visible);
}

async function loadVoiceOrchestrationStatus() {
  state.voiceOrchestrationStatus = await fetchJSON("/api/voice/orchestrator/status");
  appendVoiceDebug("miracle.status.loaded", state.voiceOrchestrationStatus || {});
  renderVoiceOrchestrationMeta({
    backendStatus: state.voiceOrchestrationStatus.status,
    tasks: [],
    visible: true,
  });
}

async function processVoiceSegment(segment) {
  appendVoiceDebug("miracle.segment.received", {
    segmentId: segment?.segmentId || "",
    language: segment?.language || "",
    transcriptLength: `${segment?.transcript || ""}`.length,
    transcriptPreview: `${segment?.transcript || ""}`.slice(0, 240),
  });
  const tab = workspaceController.getActiveTab();
  if (!tab) {
    appendVoiceDebug("miracle.segment.skipped", { reason: "no_active_tab" });
    return;
  }
  if (!state.voiceOrchestrationSessionId) {
    state.voiceOrchestrationSessionId = crypto.randomUUID();
    state.voiceOrchestrationSequence = 0;
  }

  state.voiceOrchestrationSequence += 1;
  const requestStartedAt = Date.now();
  const requestBody = {
    voice_session_id: state.voiceOrchestrationSessionId,
    note_path: tab.path,
    note_title: tab.title,
    note_content: tab.content,
    tab_id: tab.id,
    event_id: crypto.randomUUID(),
    sequence: state.voiceOrchestrationSequence,
    segment: {
      segment_id: `${state.voiceOrchestrationSessionId}_${segment.segmentId}`,
      kind: "final",
      transcript: segment.transcript,
      language: segment.language,
    },
  };
  appendVoiceDebug("miracle.segment.submitting", {
    voiceSessionId: state.voiceOrchestrationSessionId,
    sequence: state.voiceOrchestrationSequence,
    noteTitle: tab.title,
    noteLengthBefore: `${tab.content || ""}`.length,
    requestBodyPreview: JSON.stringify(requestBody).slice(0, 400),
  });

  try {
    const payload = await fetchJSON("/api/voice/orchestrator/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    appendVoiceDebug("miracle.segment.resolved", {
      backendStatus: payload?.backend_status || "",
      taskCount: Array.isArray(payload?.agent_tasks) ? payload.agent_tasks.length : 0,
      noteUpdateCount: Array.isArray(payload?.note_updates) ? payload.note_updates.length : 0,
      noteLengthAfter: `${payload?.resolved_note_content || ""}`.length,
      notePreview: `${payload?.resolved_note_content || ""}`.slice(0, 320),
      usageModel: payload?.usage?.model || "",
      usageApiFamily: payload?.usage?.api_family || payload?.usage?.apiFamily || "",
      llmDebug: payload?.llm_debug || null,
      durationMs: Date.now() - requestStartedAt,
    });
    editorController.applyExternalContentChange({
      tabId: tab.id,
      nextContent: payload.resolved_note_content,
      statusMessage: resolveVoiceStatusMessage(payload),
    });
    renderVoiceOrchestrationMeta({
      backendStatus: payload.backend_status,
      tasks: payload.agent_tasks || [],
      visible: true,
    });
  } catch (error) {
    appendVoiceDebug("miracle.segment.error", {
      durationMs: Date.now() - requestStartedAt,
      message: error?.message || "unknown error",
      name: error?.name || "",
      stackPreview: `${error?.stack || ""}`.slice(0, 500),
    });
    setStatus(error?.message || "No fue posible resolver el segmento de voz.");
    throw error;
  }
}

function resolveVoiceStatusMessage(payload) {
  const tasks = Array.isArray(payload?.agent_tasks) ? payload.agent_tasks : [];
  if (tasks.some((task) => task?.status === "executed")) {
    return "Voz procesada y tarea ejecutada";
  }
  if (tasks.some((task) => task?.status === "execution_failed")) {
    return "Voz procesada pero la tarea falló";
  }
  if (tasks.length > 0) {
    return "Voz procesada y tareas planificadas";
  }
  return "Voz procesada";
}

productLlmController = createProductLlmController({
  state,
  dom,
  fetchJSON,
  setStatus,
  appendSystemMessage: (message) => chatController.appendSystemMessage(message),
});

productLlmController.bindEvents();
chatController.bindEvents();
editorController.bindEvents();
voiceController.bindEvents();
renderVoiceDebug();

if (dom.voiceDockDebugToggle) {
  dom.voiceDockDebugToggle.addEventListener("click", () => {
    state.voiceDebugOpen = !state.voiceDebugOpen;
    renderVoiceDebug();
  });
}

if (dom.voiceDockDebugFilters) {
  dom.voiceDockDebugFilters.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("[data-debug-filter]") : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const nextFilter = `${button.dataset.debugFilter || "all"}`;
    if (!["all", "llm", "deepgram"].includes(nextFilter)) {
      return;
    }
    state.voiceDebugFilter = nextFilter;
    renderVoiceDebug();
  });
}

dom.saveButton.addEventListener("click", () => {
  workspaceController.saveActiveFile({ allowCreate: true, reason: "manual" }).catch((error) => setStatus(error.message));
});

dom.refreshButton.addEventListener("click", async () => {
  await workspaceController.loadTree();
  setStatus("Lista actualizada");
});

dom.voiceLabButton.addEventListener("click", () => {
  window.open("/miracle/voice-lab", "_blank", "noopener");
});

dom.newNoteButton.addEventListener("click", workspaceController.createUntitledTab);

dom.openNoteButton.addEventListener("click", async () => {
  const path = dom.notePicker.value;
  if (!path) {
    setStatus("Selecciona una nota guardada");
    return;
  }
  await workspaceController.openFile(path);
});

window.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await workspaceController.saveActiveFile({ allowCreate: true, reason: "manual" });
  }
});

window.addEventListener("beforeunload", () => {
  const tab = workspaceController.getActiveTab();
  if (tab) {
    finalizeCheckpoint(tab, { label: "Cierre de sesion", kind: "session_close" });
  }
  workspaceController.persistSessionOnUnload();
  voiceController.dispose();
});

Promise.all([bootWorkspace(), loadVoiceOrchestrationStatus(), productLlmController.loadStatus()]).catch((error) =>
  setStatus(error.message)
);
