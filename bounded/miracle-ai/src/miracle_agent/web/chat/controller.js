export function createChatController({
  state,
  dom,
  fetchJSON,
  setStatus,
  getActiveTab,
  requestContextPacket,
  scheduleSessionPersist,
}) {
  function appendChatMessage(role, text) {
    const message = document.createElement("div");
    message.className = `chat-message ${role}`;
    message.textContent = text;
    dom.chatMessages.appendChild(message);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function syncLayout() {
    if (!dom.editorShell) return;
    dom.editorShell.classList.toggle("chat-open", dom.chatDrawer.classList.contains("is-open"));
  }

  function openDrawer({ pinned = false } = {}) {
    if (pinned) {
      state.chatPinned = true;
      dom.pinChatButton.textContent = "Soltar";
    }
    window.clearTimeout(state.chatCloseTimer);
    dom.chatDrawer.classList.add("is-open");
    syncLayout();
    updateHandlePosition(getActiveTab());
  }

  function closeDrawer() {
    if (state.chatPinned) return;
    dom.chatDrawer.classList.remove("is-open");
    syncLayout();
  }

  function scheduleClose() {
    window.clearTimeout(state.chatCloseTimer);
    state.chatCloseTimer = window.setTimeout(() => {
      closeDrawer();
    }, 180);
  }

  function updateHandlePosition(tab) {
    if (!tab?.contextPacket?.active_block) return;

    if (!dom.editor.classList.contains("is-hidden")) {
      const style = window.getComputedStyle(dom.editor);
      const lineHeight = Number.parseFloat(style.lineHeight) || 22;
      const textBefore = dom.editor.value.slice(0, tab.contextPacket.active_block.start || 0);
      const lineIndex = textBefore.split("\n").length - 1;
      const top = Math.max(12, 14 + lineIndex * lineHeight - dom.editor.scrollTop);
      dom.chatHandle.style.top = `${top}px`;
      return;
    }

    const blockEl = dom.editorPreview.querySelector(`[data-block-start="${tab.contextPacket.active_block.start}"]`);
    if (!blockEl) {
      dom.chatHandle.style.top = "1rem";
      return;
    }
    const previewRect = dom.editorPreview.getBoundingClientRect();
    const blockRect = blockEl.getBoundingClientRect();
    const top = Math.max(12, blockRect.top - previewRect.top + dom.editorPreview.scrollTop);
    dom.chatHandle.style.top = `${top}px`;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const message = dom.chatInput.value.trim();
    if (!message) return;

    const tab = getActiveTab();
    openDrawer({ pinned: true });
    appendChatMessage("user", message);
    dom.chatInput.value = "";
    setStatus("Consultando asistente");

    try {
      if (tab) {
        await requestContextPacket(tab, tab.content, true);
      }
      const payload = await fetchJSON("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          previous_response_id: state.previousResponseId,
          context_packet: tab
            ? {
                ...(tab.contextPacket || {}),
                session_history: tab.changeLog || [],
                session_checkpoints: tab.checkpoints || [],
              }
            : null,
        }),
      });
      state.previousResponseId = payload.previous_response_id || null;
      appendChatMessage("assistant", payload.reply);
      scheduleSessionPersist();
      setStatus("Respuesta recibida");
    } catch (error) {
      appendChatMessage("system", error.message);
      setStatus("Error en chat");
    }
  }

  function resetConversation() {
    state.previousResponseId = null;
    dom.chatMessages.innerHTML = "";
    appendChatMessage("system", "Chat reiniciado.");
    scheduleSessionPersist();
  }

  function bindEvents() {
    dom.chatHandle.addEventListener("mouseenter", () => {
      openDrawer();
      const tab = getActiveTab();
      if (tab) {
        void requestContextPacket(tab, tab.content, true);
      }
    });
    dom.chatHandle.addEventListener("mouseleave", scheduleClose);
    dom.chatHandle.addEventListener("click", () => {
      if (dom.chatDrawer.classList.contains("is-open") && !state.chatPinned) {
        openDrawer({ pinned: true });
      } else if (state.chatPinned) {
        state.chatPinned = false;
        dom.pinChatButton.textContent = "Fijar";
        dom.chatDrawer.classList.remove("is-open");
        syncLayout();
      } else {
        openDrawer();
      }
    });
    dom.chatDrawer.addEventListener("mouseenter", () => {
      window.clearTimeout(state.chatCloseTimer);
    });
    dom.chatDrawer.addEventListener("mouseleave", scheduleClose);
    dom.pinChatButton.addEventListener("click", () => {
      state.chatPinned = !state.chatPinned;
      dom.pinChatButton.textContent = state.chatPinned ? "Soltar" : "Fijar";
      if (state.chatPinned) {
        openDrawer({ pinned: true });
      } else {
        dom.chatDrawer.classList.remove("is-open");
        syncLayout();
      }
    });
    dom.newChatButton.addEventListener("click", resetConversation);
    dom.chatForm.addEventListener("submit", (event) => {
      void handleSubmit(event);
    });
  }

  return {
    appendSystemMessage(text) {
      appendChatMessage("system", text);
    },
    bindEvents,
    syncLayout,
    updateHandlePosition,
  };
}
