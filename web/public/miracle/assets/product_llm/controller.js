export function createProductLlmController({ state, dom, fetchJSON, setStatus, appendSystemMessage }) {
  function setMessage(message) {
    dom.productLlmStatus.textContent = message;
  }

  function renderProviders(providers = []) {
    dom.productLlmProvider.innerHTML = "";
    for (const provider of providers) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      if (provider.recommended) {
        option.selected = true;
      }
      dom.productLlmProvider.appendChild(option);
    }
  }

  function currentProvider() {
    return state.productLlmSetup?.providers?.find((provider) => provider.id === dom.productLlmProvider.value) || null;
  }

  function updateFieldVisibility() {
    const provider = currentProvider();
    dom.productLlmApiKeyField.classList.toggle("is-hidden", !provider?.requires_api_key);
    dom.productLlmBaseUrlField.classList.toggle("is-hidden", !provider?.requires_base_url);
    dom.productLlmModelField.classList.toggle("is-hidden", !provider?.requires_model);
  }

  function renderCurrentConfig(payload) {
    const current = payload.current_setup;
    if (!current) {
      dom.productLlmCurrentConfig.textContent = "Actual: fallback heurístico de Miracle.";
      return;
    }
    const parts = [current.label || current.provider];
    if (current.model) parts.push(`model ${current.model}`);
    if (current.base_url) parts.push(current.base_url);
    dom.productLlmCurrentConfig.textContent = `Actual: ${parts.join(" · ")}`;
  }

  function showOverlay() {
    dom.productLlmOverlay.classList.remove("is-hidden");
    dom.productLlmOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("setup-required");
  }

  function hideOverlay() {
    dom.productLlmOverlay.classList.add("is-hidden");
    dom.productLlmOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("setup-required");
  }

  async function loadStatus({ open = false } = {}) {
    const payload = await fetchJSON("/api/product-llm/status");
    state.productLlmSetup = payload;
    renderProviders(payload.providers || []);
    if (payload.current_setup?.provider) {
      dom.productLlmProvider.value = payload.current_setup.provider;
    }
    const provider = currentProvider();
    dom.productLlmBaseUrl.value = payload.current_setup?.base_url || provider?.default_base_url || "";
    dom.productLlmModel.value = payload.current_setup?.model || provider?.default_model || "";
    dom.productLlmApiKey.value = "";
    renderCurrentConfig(payload);
    updateFieldVisibility();
    const status = payload.status;
    setMessage(
      `Estado: ${status.provider}${status.configured ? " configurado" : " sin credenciales completas"}\n` +
        `Modelo: ${status.model || "sin modelo"}`
    );
    if (open) {
      showOverlay();
    }
    return payload;
  }

  function handleProviderChange() {
    const provider = currentProvider();
    if (provider && !dom.productLlmBaseUrl.value) {
      dom.productLlmBaseUrl.value = provider.default_base_url || "";
    }
    if (provider && !dom.productLlmModel.value) {
      dom.productLlmModel.value = provider.default_model || "";
    }
    updateFieldVisibility();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const provider = currentProvider();
    if (!provider) return;
    dom.productLlmSubmitButton.disabled = true;
    setMessage("Guardando configuración del product LLM...");
    try {
      const payload = await fetchJSON("/api/setup/product-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          api_key: dom.productLlmApiKey.value,
          base_url: dom.productLlmBaseUrl.value,
          model: dom.productLlmModel.value,
        }),
      });
      state.productLlmSetup = payload.setup;
      hideOverlay();
      setStatus("Product LLM actualizado");
      appendSystemMessage("La capa de product LLM de Miracle fue reconfigurada.");
    } catch (error) {
      setMessage(error.message);
      setStatus("Error al configurar Product LLM");
    } finally {
      dom.productLlmSubmitButton.disabled = false;
    }
  }

  function bindEvents() {
    dom.productLlmConfigButton.addEventListener("click", () => {
      loadStatus({ open: true }).catch((error) => {
        setMessage(error.message);
        setStatus(error.message);
      });
    });
    dom.productLlmCloseButton.addEventListener("click", hideOverlay);
    dom.productLlmProvider.addEventListener("change", handleProviderChange);
    dom.productLlmRefreshButton.addEventListener("click", () => {
      loadStatus({ open: true }).catch((error) => {
        setMessage(error.message);
        setStatus(error.message);
      });
    });
    dom.productLlmForm.addEventListener("submit", (event) => {
      void handleSubmit(event);
    });
  }

  return {
    bindEvents,
    loadStatus,
  };
}
