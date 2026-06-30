export function createWorkspaceController({
  state,
  dom,
  fetchJSON,
  setStatus,
  finalizeCheckpoint,
  renderActiveTab,
  onTabActivated,
}) {
  function getActiveTab() {
    return state.openTabs.find((item) => item.id === state.activeTabId) || null;
  }

  function buildTab(sessionTab = {}) {
    const snapshotContent = sessionTab.session_snapshot_content ?? null;
    const initialContent = sessionTab.content || "";
    const checkpoints =
      sessionTab.checkpoints ||
      (sessionTab.session_snapshot_at
        ? [
            {
              id: crypto.randomUUID(),
              label: "Sesion restaurada",
              kind: "session_snapshot",
              createdAt: sessionTab.session_snapshot_at,
              closedAt: sessionTab.session_snapshot_at,
              isOpen: false,
              entries: [],
              summary: "Base restaurada desde la ultima sesion cerrada",
            },
          ]
        : []);
    return {
      id: sessionTab.id || crypto.randomUUID(),
      path: sessionTab.path || null,
      title: sessionTab.title || "Untitled",
      content: initialContent,
      baselineContent: snapshotContent ?? sessionTab.baseline_content ?? initialContent,
      sessionSnapshotContent: snapshotContent,
      sessionSnapshotAt: sessionTab.session_snapshot_at || null,
      isDirty: Boolean(sessionTab.is_dirty),
      cursorStart: sessionTab.cursor_start || 0,
      cursorEnd: sessionTab.cursor_end || 0,
      contextPacket: sessionTab.context_packet || null,
      recentChange: sessionTab.recent_change || null,
      changeLog: sessionTab.change_log || [],
      sessionDiff: sessionTab.session_diff || null,
      checkpoints,
      pendingChangeBase: null,
    };
  }

  function renderPicker() {
    dom.notePicker.innerHTML = "";
    if (state.files.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Sin notas guardadas";
      dom.notePicker.appendChild(option);
      return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona una nota guardada";
    dom.notePicker.appendChild(placeholder);

    for (const file of state.files) {
      const option = document.createElement("option");
      option.value = file.path;
      option.textContent = file.path;
      dom.notePicker.appendChild(option);
    }
  }

  async function loadTree() {
    const payload = await fetchJSON("/api/tree");
    state.files = payload.files;
    renderPicker();
  }

  function renderTabs() {
    dom.tabs.innerHTML = "";
    for (const tab of state.openTabs) {
      const tabEl = document.createElement("button");
      tabEl.type = "button";
      tabEl.className = `tab${tab.id === state.activeTabId ? " active" : ""}`;
      const dirtyMark = tab.isDirty ? "*" : "";
      tabEl.innerHTML = `<span>${tab.title}${dirtyMark}</span>`;
      tabEl.addEventListener("click", () => activateTab(tab.id));

      const close = document.createElement("button");
      close.type = "button";
      close.className = "tab-close";
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      tabEl.appendChild(close);
      dom.tabs.appendChild(tabEl);
    }
  }

  function persistSelectionIntoTab() {
    const tab = getActiveTab();
    if (!tab) return;
    tab.cursorStart = dom.editor.selectionStart || 0;
    tab.cursorEnd = dom.editor.selectionEnd || tab.cursorStart;
  }

  function restoreSelectionFromTab(tab) {
    const max = dom.editor.value.length;
    const start = Math.min(tab.cursorStart || 0, max);
    const end = Math.min(tab.cursorEnd || start, max);
    dom.editor.setSelectionRange(start, end);
  }

  function applyTabToEditor(tab) {
    dom.editor.value = tab.content;
    renderActiveTab(tab);
  }

  function activateTab(tabId) {
    persistSelectionIntoTab();
    const tab = state.openTabs.find((item) => item.id === tabId);
    if (!tab) return;
    state.activeTabId = tabId;
    applyTabToEditor(tab);
    dom.saveButton.disabled = false;
    renderTabs();
    scheduleSessionPersist();
    window.requestAnimationFrame(() => {
      restoreSelectionFromTab(tab);
      onTabActivated?.(tab);
    });
  }

  function createUntitledTab() {
    state.untitledCount += 1;
    const tab = buildTab({
      title: `Untitled ${state.untitledCount}`,
    });
    state.openTabs.push(tab);
    activateTab(tab.id);
    setStatus("Nueva nota");
  }

  function closeTab(tabId) {
    state.openTabs = state.openTabs.filter((item) => item.id !== tabId);
    if (state.activeTabId === tabId) {
      const next = state.openTabs.at(-1);
      if (next) {
        activateTab(next.id);
      } else {
        createUntitledTab();
      }
    } else {
      renderTabs();
    }
    scheduleSessionPersist();
  }

  async function openFile(path) {
    let tab = state.openTabs.find((item) => item.path === path);
    if (!tab) {
      const payload = await fetchJSON(`/api/file?path=${encodeURIComponent(path)}`);
      tab = buildTab({
        path,
        title: path.split("/").pop(),
        content: payload.content,
      });
      state.openTabs.push(tab);
    }
    activateTab(tab.id);
    setStatus("Archivo cargado");
  }

  function scheduleSessionPersist() {
    window.clearTimeout(state.sessionTimer);
    state.sessionTimer = window.setTimeout(() => {
      persistSession().catch((error) => setStatus(error.message));
    }, 180);
  }

  function buildSessionPayload({ promoteSnapshot = false } = {}) {
    persistSelectionIntoTab();
    const snapshotAt = new Date().toISOString();
    return {
      open_tabs: state.openTabs.map((tab) => {
        const snapshotContent = promoteSnapshot ? tab.content : tab.sessionSnapshotContent;
        return {
          id: tab.id,
          path: tab.path,
          title: tab.title,
          content: tab.content,
          baseline_content: promoteSnapshot ? tab.content : tab.baselineContent ?? "",
          session_snapshot_content: snapshotContent,
          session_snapshot_at: promoteSnapshot ? snapshotAt : tab.sessionSnapshotAt,
          is_dirty: tab.isDirty,
          cursor_start: tab.cursorStart || 0,
          cursor_end: tab.cursorEnd || tab.cursorStart || 0,
          recent_change: tab.recentChange,
          context_packet: tab.contextPacket,
          change_log: tab.changeLog || [],
          session_diff: tab.sessionDiff,
          checkpoints: tab.checkpoints || [],
        };
      }),
      active_tab_id: state.activeTabId,
      untitled_count: state.untitledCount,
      previous_response_id: state.previousResponseId,
    };
  }

  async function persistSession(options = {}) {
    const payload = buildSessionPayload(options);
    if (options.promoteSnapshot) {
      for (const tab of state.openTabs) {
        tab.baselineContent = tab.content;
        tab.sessionSnapshotContent = tab.content;
        tab.sessionSnapshotAt = new Date().toISOString();
      }
    }
    await fetchJSON("/api/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function persistSessionOnUnload() {
    try {
      persistSelectionIntoTab();
      const payload = JSON.stringify(buildSessionPayload({ promoteSnapshot: true }));
      navigator.sendBeacon("/api/session", new Blob([payload], { type: "application/json" }));
    } catch {
      // Best effort only.
    }
  }

  function suggestSavePath(tab) {
    const slug = tab.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `wiki/${slug || "note"}.md`;
  }

  async function saveTab(tab, { allowCreate = true, reason = "manual" } = {}) {
    if (!tab) return false;

    if (!tab.path) {
      if (!allowCreate) {
        scheduleSessionPersist();
        return false;
      }

      const requestedPath = window.prompt("Ruta dentro de workspaces/miracle/knowledge/", suggestSavePath(tab));
      if (!requestedPath) return false;
      await fetchJSON("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: requestedPath,
          template: tab.content || `# ${tab.title}\n`,
        }),
      });
      tab.path = requestedPath;
      tab.title = requestedPath.split("/").pop();
      await loadTree();
    } else {
      await fetchJSON("/api/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
    }

    tab.isDirty = false;
    if (reason === "manual") {
      finalizeCheckpoint(tab, { label: "Guardado manual", kind: "manual_save" });
      tab.baselineContent = tab.content;
      tab.sessionSnapshotContent = tab.content;
      tab.sessionSnapshotAt = new Date().toISOString();
    }
    renderTabs();
    renderActiveTab(tab);
    scheduleSessionPersist();
    setStatus(reason === "auto" ? "Auto guardado" : "Guardado");
    return true;
  }

  async function saveActiveFile(options) {
    return saveTab(getActiveTab(), options);
  }

  async function loadSession() {
    const payload = await fetchJSON("/api/session");
    state.untitledCount = payload.untitled_count || 0;
    state.previousResponseId = payload.previous_response_id || null;
    state.openTabs = (payload.open_tabs || []).map((tab) => buildTab(tab));

    if (state.openTabs.length === 0) {
      createUntitledTab();
      return;
    }

    const active = payload.active_tab_id && state.openTabs.find((tab) => tab.id === payload.active_tab_id);
    activateTab((active || state.openTabs[0]).id);
    setStatus("Sesion restaurada");
  }

  return {
    activateTab,
    closeTab,
    createUntitledTab,
    getActiveTab,
    loadSession,
    loadTree,
    openFile,
    persistSelectionIntoTab,
    persistSession,
    persistSessionOnUnload,
    renderTabs,
    saveActiveFile,
    scheduleSessionPersist,
  };
}
