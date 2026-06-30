const CHANGE_GROUP_IDLE_MS = 1500;

export function createEditorController({
  state,
  dom,
  fetchJSON,
  setStatus,
  previewRenderer,
  getActiveTab,
  renderTabs,
  renderActiveTab,
  scheduleSessionPersist,
  saveActiveFile,
  addEntryToCheckpoint,
  updateChatHandlePosition,
  showEditMode,
  showPreviewMode,
}) {
  function mergeContextIntoTab(tab, packet, { preserveRecentChange = false } = {}) {
    if (!tab) return;
    if (packet.recent_change?.kind !== "none") {
      tab.recentChange = packet.recent_change;
    } else if (preserveRecentChange && tab.recentChange) {
      packet.recent_change = tab.recentChange;
    }
    tab.contextPacket = packet;
    tab.sessionDiff = packet.session_diff || null;
    renderActiveTab(tab);
    scheduleSessionPersist();
  }

  async function requestContextPacket(tab, previousContent, preserveRecentChange) {
    const token = ++state.contextRequestToken;
    const payload = await fetchJSON("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: tab.path,
        title: tab.title,
        content: tab.content,
        previous_content: previousContent,
        baseline_content: tab.baselineContent ?? "",
        cursor_start: tab.cursorStart || 0,
        cursor_end: tab.cursorEnd || tab.cursorStart || 0,
      }),
    });
    if (token !== state.contextRequestToken) return;
    mergeContextIntoTab(tab, payload, { preserveRecentChange });
  }

  function updateContextFromEditor({ previousContent, preserveRecentChange = false } = {}) {
    const tab = getActiveTab();
    if (!tab) return;
    tab.cursorStart = dom.editor.selectionStart || 0;
    tab.cursorEnd = dom.editor.selectionEnd || tab.cursorStart;
    window.clearTimeout(state.contextTimer);
    state.contextTimer = window.setTimeout(() => {
      requestContextPacket(tab, previousContent ?? tab.content, preserveRecentChange).catch((error) =>
        setStatus(error.message)
      );
    }, 120);
  }

  async function requestHistoryEntry(tab, previousContent) {
    return fetchJSON("/api/history-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: tab.path,
        title: tab.title,
        content: tab.content,
        previous_content: previousContent,
        cursor_start: tab.cursorStart || 0,
        cursor_end: tab.cursorEnd || tab.cursorStart || 0,
      }),
    });
  }

  async function flushPendingChangeCapture() {
    const tab = getActiveTab();
    if (!tab || !tab.pendingChangeBase || tab.pendingChangeBase === tab.content) {
      if (tab) {
        tab.pendingChangeBase = null;
      }
      return;
    }

    const entry = await requestHistoryEntry(tab, tab.pendingChangeBase);
    if (entry.kind && entry.kind !== "none") {
      tab.changeLog = [...(tab.changeLog || []), entry].slice(-50);
      addEntryToCheckpoint(tab, entry);
    }
    tab.pendingChangeBase = null;
    await requestContextPacket(tab, tab.content, true);
    scheduleSessionPersist();
  }

  function scheduleChangeCapture() {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.pendingChangeBase == null) {
      tab.pendingChangeBase = tab.content;
    }
    window.clearTimeout(state.changeCaptureTimer);
    state.changeCaptureTimer = window.setTimeout(() => {
      flushPendingChangeCapture().catch((error) => setStatus(error.message));
    }, CHANGE_GROUP_IDLE_MS);
  }

  function scheduleAutosave() {
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(() => {
      saveActiveFile({ allowCreate: false, reason: "auto" }).catch((error) => setStatus(error.message));
    }, CHANGE_GROUP_IDLE_MS);
  }

  function syncActiveEditorToTab(previousContent) {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.pendingChangeBase == null) {
      tab.pendingChangeBase = previousContent;
    }
    tab.content = dom.editor.value;
    tab.isDirty = true;
    previewRenderer.render(tab.content);
    renderTabs();
    scheduleAutosave();
    scheduleChangeCapture();
    scheduleSessionPersist();
    updateContextFromEditor({ previousContent, preserveRecentChange: true });
  }

  function bindEvents() {
    dom.editor.addEventListener("input", () => {
      const tab = getActiveTab();
      const previousContent = tab?.content || "";
      syncActiveEditorToTab(previousContent);
      setStatus("Editando");
    });

    dom.editor.addEventListener("blur", () => {
      flushPendingChangeCapture().catch((error) => setStatus(error.message));
      saveActiveFile({ allowCreate: false, reason: "auto" }).catch((error) => setStatus(error.message));
      previewRenderer.render(dom.editor.value);
      showPreviewMode();
    });

    dom.editor.addEventListener("click", () => updateContextFromEditor({ preserveRecentChange: true }));
    dom.editor.addEventListener("keyup", () => updateContextFromEditor({ preserveRecentChange: true }));
    dom.editor.addEventListener("select", () => updateContextFromEditor({ preserveRecentChange: true }));
    dom.editor.addEventListener("scroll", () => updateChatHandlePosition(getActiveTab()));
    dom.editorPreview.addEventListener("scroll", () => updateChatHandlePosition(getActiveTab()));
    window.addEventListener("resize", () => updateChatHandlePosition(getActiveTab()));

    dom.editorPreview.addEventListener("click", () => {
      showEditMode();
      updateContextFromEditor({ preserveRecentChange: true });
    });

    dom.editorPreview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showEditMode();
        updateContextFromEditor({ preserveRecentChange: true });
      }
    });
  }

  function applyExternalContentChange({ tabId, nextContent, statusMessage = "Contenido actualizado" } = {}) {
    const tab = state.openTabs.find((item) => item.id === tabId);
    if (!tab || typeof nextContent !== "string" || tab.content === nextContent) {
      return false;
    }

    const previousContent = tab.content;
    tab.content = nextContent;
    tab.isDirty = true;

    if (tab.id === state.activeTabId) {
      dom.editor.value = nextContent;
      previewRenderer.render(nextContent);
      renderActiveTab(tab);
    }

    renderTabs();
    scheduleSessionPersist();
    requestContextPacket(tab, previousContent, true).catch((error) => setStatus(error.message));
    setStatus(statusMessage);
    return true;
  }

  return {
    applyExternalContentChange,
    bindEvents,
    flushPendingChangeCapture,
    requestContextPacket,
    updateContextFromEditor,
  };
}
