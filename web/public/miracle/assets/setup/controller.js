export function createSetupController({
  state,
  dom,
  fetchJSON,
  setStatus,
  scheduleSessionPersist,
  bootWorkspace,
  appendSystemMessage,
}) {
  function setSetupMessage(message) {
    dom.setupStatus.textContent = message;
  }

  function renderSetupProviders(providers = []) {
    dom.setupProvider.innerHTML = "";
    for (const provider of providers) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      if (provider.recommended) option.selected = true;
      dom.setupProvider.appendChild(option);
    }
  }

  function currentSetupProvider() {
    return state.setup?.providers?.find((provider) => provider.id === dom.setupProvider.value) || null;
  }

  function renderProviderModelOptions(provider) {
    dom.setupOpenrouterModel.innerHTML = "";
    for (const optionData of provider?.model_options || []) {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      dom.setupOpenrouterModel.appendChild(option);
    }
  }

  function usesProviderModelSelect(provider) {
    return Boolean(provider?.supports_model_override && (provider?.model_options?.length || 0) > 0);
  }

  function setupSummaryText(setup) {
    const current = setup.current_setup;
    const upstreamStatus = setup.upstream?.status || "not-configured";
    if (!current) {
      return `Sin provider configurado todavía. Upstream actual: ${upstreamStatus}.`;
    }

    const parts = [`Actual: ${current.label}`];
    if (current.model) {
      parts.push(`model ${current.model}`);
    }
    if (current.base_url) {
      parts.push(current.base_url);
    }
    parts.push(`upstream ${upstreamStatus}`);
    return parts.join(" · ");
  }

  function updateFieldVisibility() {
    const provider = currentSetupProvider();
    const showsProviderModelSelect = usesProviderModelSelect(provider);
    dom.setupApiKeyField.classList.toggle("is-hidden", !provider?.requires_api_key);
    dom.setupOpenrouterModelField.classList.toggle("is-hidden", !showsProviderModelSelect);
    dom.setupBaseUrlField.classList.toggle("is-hidden", !provider?.requires_base_url);
    dom.setupModelField.classList.toggle("is-hidden", !provider?.requires_model || showsProviderModelSelect);
  }

  function selectedProviderModel() {
    const provider = currentSetupProvider();
    if (usesProviderModelSelect(provider)) {
      return dom.setupOpenrouterModel.value || provider.default_model || "";
    }
    return dom.setupModel.value;
  }

  function showOverlay(setup, { mode = "required" } = {}) {
    state.setup = setup;
    state.setupOverlayMode = mode;
    renderSetupProviders(setup.providers || []);
    const configuredProvider = setup.current_setup?.provider;
    if (configuredProvider) {
      dom.setupProvider.value = configuredProvider;
    }
    renderProviderModelOptions(currentSetupProvider());
    dom.setupApiKey.value = "";
    dom.setupBaseUrl.value = setup.current_setup?.base_url || "";
    const provider = currentSetupProvider();
    const configuredModel = setup.current_setup?.model || provider?.default_model || "";
    if (usesProviderModelSelect(provider)) {
      dom.setupOpenrouterModel.value = configuredModel;
    }
    dom.setupModel.value = setup.current_setup?.model || "";
    updateFieldVisibility();
    dom.setupOverlay.classList.remove("is-hidden");
    dom.setupOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("setup-required");
    const manualMode = mode === "manual";
    dom.setupCloseButton.classList.toggle("is-hidden", !manualMode);
    dom.setupTitle.textContent = manualMode ? "Configurar provider" : "Configura Miracle";
    dom.setupIntro.textContent = manualMode
      ? "Puedes cambiar provider, API key y parametros del upstream sin tocar la UX del editor."
      : "La primera vez configuramos el runtime upstream por detras. La UX del editor no cambia.";
    dom.setupSubmitButton.textContent = manualMode ? "Guardar provider" : "Guardar y configurar";
    dom.setupCurrentConfig.textContent = setupSummaryText(setup);
    const upstreamStatus = setup.upstream?.status || "not-configured";
    const cliState = setup.cli_available ? "CLI disponible" : "CLI no detectado";
    setSetupMessage(
      `Estado upstream: ${upstreamStatus}\nProvisioning: ${setup.method}\n${cliState}\n\n` +
        (manualMode
          ? "La reconfiguracion vuelve a provisionar OpenClaw por detras desde Miracle."
          : "La clave se envia al backend de Miracle y el setup inicial configura OpenClaw por detras.")
    );
  }

  function hideOverlay() {
    dom.setupOverlay.classList.add("is-hidden");
    dom.setupOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("setup-required");
  }

  async function loadStatus({ mode = null } = {}) {
    const payload = await fetchJSON("/api/setup/status");
    state.setup = payload;
    if (mode === "manual") {
      showOverlay(payload, { mode: "manual" });
    } else {
      hideOverlay();
    }
    return payload;
  }

  async function openConfiguration() {
    await loadStatus({ mode: "manual" });
    setStatus("Configuracion de provider abierta");
  }

  function handleProviderChange() {
    const provider = currentSetupProvider();
    renderProviderModelOptions(provider);
    if (usesProviderModelSelect(provider)) {
      dom.setupOpenrouterModel.value = provider.default_model || "";
    } else {
      dom.setupModel.value = "";
    }
    updateFieldVisibility();
  }

  async function handleRefresh() {
    const mode = state.setupOverlayMode === "manual" ? "manual" : null;
    try {
      await loadStatus({ mode });
    } catch (error) {
      setSetupMessage(error.message);
      setStatus(error.message);
    }
  }

  function handleClose() {
    if (state.setupOverlayMode === "required") return;
    hideOverlay();
    setStatus("Configuracion de provider cerrada");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const provider = currentSetupProvider();
    if (!provider) return;

    dom.setupSubmitButton.disabled = true;
    setSetupMessage(
      state.setupOverlayMode === "manual"
        ? "Reconfigurando provider y runtime upstream por detras..."
        : "Configurando OpenClaw por detras. Esto puede tardar un poco la primera vez..."
    );

    try {
      const payload = await fetchJSON("/api/setup/openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          api_key: dom.setupApiKey.value,
          base_url: dom.setupBaseUrl.value,
          model: selectedProviderModel(),
        }),
      });
      state.setup = payload.setup;
      hideOverlay();
      state.previousResponseId = null;
      scheduleSessionPersist();
      setStatus(state.setupOverlayMode === "manual" ? "Provider actualizado" : "Setup inicial completo");
      await bootWorkspace();
      appendSystemMessage(
        state.setupOverlayMode === "manual"
          ? "Provider reconfigurado desde Miracle. El chat reinicio su continuidad."
          : "OpenClaw quedo configurado desde Miracle."
      );
    } catch (error) {
      setSetupMessage(error.message);
      setStatus(state.setupOverlayMode === "manual" ? "Error al reconfigurar provider" : "Error en setup inicial");
    } finally {
      dom.setupSubmitButton.disabled = false;
    }
  }

  function bindEvents() {
    dom.providerConfigButton.addEventListener("click", () => {
      openConfiguration().catch((error) => {
        setSetupMessage(error.message);
        setStatus(error.message);
      });
    });
    dom.setupProvider.addEventListener("change", handleProviderChange);
    dom.setupRefreshButton.addEventListener("click", () => {
      void handleRefresh();
    });
    dom.setupCloseButton.addEventListener("click", handleClose);
    dom.setupForm.addEventListener("submit", (event) => {
      void handleSubmit(event);
    });
  }

  return {
    bindEvents,
    loadStatus,
  };
}
