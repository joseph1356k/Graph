import { fetchJSON } from "/assets/lib/api.js";
import { createChatController } from "/assets/chat/controller.js";
import { addEntryToCheckpoint, finalizeCheckpoint } from "/assets/notes/checkpoints.js";
import { createEditorController } from "/assets/notes/editor.js";
import { createPreviewRenderer } from "/assets/notes/preview.js";
import { createProductLlmController } from "/assets/product_llm/controller.js";
import { createWorkspaceController } from "/assets/notes/workspace.js";
import { createSetupController } from "/assets/setup/controller.js";
import { createVoiceStreamingController } from "/assets/voice/controller.js";

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
  setup: null,
  setupOverlayMode: "required",
  voiceOrchestrationQueue: Promise.resolve(),
  voiceOrchestrationSessionId: null,
  voiceOrchestrationSequence: 0,
  voiceOrchestrationStatus: null,
  productLlmSetup: null,
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
  saveButton: document.getElementById("saveButton"),
  refreshButton: document.getElementById("refreshButton"),
  providerConfigButton: document.getElementById("providerConfigButton"),
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
  setupOverlay: document.getElementById("setupOverlay"),
  setupTitle: document.getElementById("setupTitle"),
  setupIntro: document.getElementById("setupIntro"),
  setupCurrentConfig: document.getElementById("setupCurrentConfig"),
  setupForm: document.getElementById("setupForm"),
  setupProvider: document.getElementById("setupProvider"),
  setupApiKeyField: document.getElementById("setupApiKeyField"),
  setupApiKey: document.getElementById("setupApiKey"),
  setupBaseUrlField: document.getElementById("setupBaseUrlField"),
  setupBaseUrl: document.getElementById("setupBaseUrl"),
  setupOpenrouterModelField: document.getElementById("setupOpenrouterModelField"),
  setupOpenrouterModel: document.getElementById("setupOpenrouterModel"),
  setupModelField: document.getElementById("setupModelField"),
  setupModel: document.getElementById("setupModel"),
  setupStatus: document.getElementById("setupStatus"),
  setupRefreshButton: document.getElementById("setupRefreshButton"),
  setupSubmitButton: document.getElementById("setupSubmitButton"),
  setupCloseButton: document.getElementById("setupCloseButton"),
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
  onRecordingStarted() {
    state.voiceOrchestrationSessionId = crypto.randomUUID();
    state.voiceOrchestrationSequence = 0;
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
  renderVoiceOrchestrationMeta({
    backendStatus: state.voiceOrchestrationStatus.status,
    tasks: [],
    visible: true,
  });
}

async function processVoiceSegment(segment) {
  const tab = workspaceController.getActiveTab();
  if (!tab) {
    return;
  }
  if (!state.voiceOrchestrationSessionId) {
    state.voiceOrchestrationSessionId = crypto.randomUUID();
    state.voiceOrchestrationSequence = 0;
  }

  state.voiceOrchestrationSequence += 1;
  const payload = await fetchJSON("/api/voice/orchestrator/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
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

const setupController = createSetupController({
  state,
  dom,
  fetchJSON,
  setStatus,
  scheduleSessionPersist: workspaceController.scheduleSessionPersist,
  bootWorkspace,
  appendSystemMessage: (message) => chatController.appendSystemMessage(message),
});

productLlmController = createProductLlmController({
  state,
  dom,
  fetchJSON,
  setStatus,
  appendSystemMessage: (message) => chatController.appendSystemMessage(message),
});

setupController.bindEvents();
productLlmController.bindEvents();
chatController.bindEvents();
editorController.bindEvents();
voiceController.bindEvents();

dom.saveButton.addEventListener("click", () => {
  workspaceController.saveActiveFile({ allowCreate: true, reason: "manual" }).catch((error) => setStatus(error.message));
});

dom.refreshButton.addEventListener("click", async () => {
  await workspaceController.loadTree();
  setStatus("Lista actualizada");
});

dom.voiceLabButton.addEventListener("click", () => {
  window.open("/voice-lab", "_blank", "noopener");
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

setupController.loadStatus().then((setup) => {
  Promise.all([bootWorkspace(), loadVoiceOrchestrationStatus(), productLlmController.loadStatus()]).catch((error) =>
    setStatus(error.message)
  );
});
