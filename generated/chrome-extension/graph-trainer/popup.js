const DEFAULT_BACKEND_URL = 'https://graph-1-hap6.onrender.com';
const LOG_STORAGE_KEY = 'graphTrainerExtensionLogs';
const LOG_PANEL_STATE_KEY = 'graphTrainerPopupShowLogs';
const VOICE_LOG_PANEL_STATE_KEY = 'graphTrainerPopupShowVoiceLogs';
const TRACE_LOG_PANEL_STATE_KEY = 'graphTrainerPopupShowTraceLogs';
const EXECUTION_LOG_SCOPES = new Set(['execution']);
const VOICE_LOG_SCOPES = new Set(['voice']);
const LEARNING_LOG_SCOPES = new Set(['learning']);
const RECORDER_LOG_SCOPE = 'recorder';
const SELECTED_ELEMENT_STORAGE_KEY = 'graphTrainerSelectedElement';
const AUTO_CAPTURE_ANALYSIS_STORAGE_KEY = 'graphTrainerAutoCaptureAnalysis';
const diagnosticsChatHistory = [];

function getStorage() {
  return chrome.storage?.sync || chrome.storage?.local;
}

function getLocalStorage() {
  return chrome.storage?.local || chrome.storage?.sync;
}

async function loadSettings() {
  const storage = getStorage();
  return new Promise((resolve) => {
    storage.get({
      enabled: true,
      backendUrl: DEFAULT_BACKEND_URL
    }, resolve);
  });
}

async function saveSettings(settings) {
  const storage = getStorage();
  return new Promise((resolve) => {
    storage.set(settings, resolve);
  });
}

async function readLogs() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [LOG_STORAGE_KEY]: [] }, (result) => {
      resolve(Array.isArray(result?.[LOG_STORAGE_KEY]) ? result[LOG_STORAGE_KEY] : []);
    });
  });
}

function isExecutionDiagnostic(entry = {}) {
  const scope = `${entry.scope || ''}`.trim().toLowerCase();
  return EXECUTION_LOG_SCOPES.has(scope);
}

function isRecorderDiagnostic(entry = {}) {
  const scope = `${entry.scope || ''}`.trim().toLowerCase();
  const level = `${entry.level || ''}`.trim().toLowerCase();
  return scope === RECORDER_LOG_SCOPE && (level === 'warn' || level === 'error');
}

function isVoiceDiagnostic(entry = {}) {
  const scope = `${entry.scope || ''}`.trim().toLowerCase();
  return VOICE_LOG_SCOPES.has(scope);
}

function isLearningTrace(entry = {}) {
  const scope = `${entry.scope || ''}`.trim().toLowerCase();
  return LEARNING_LOG_SCOPES.has(scope);
}

function isSessionTrace(entry = {}) {
  return isExecutionDiagnostic(entry) || isLearningTrace(entry);
}

function isDiagnosticEntry(entry = {}) {
  return isExecutionDiagnostic(entry) || isRecorderDiagnostic(entry);
}

function isErrorDiagnostic(entry = {}) {
  return `${entry.level || ''}`.trim().toLowerCase() === 'error';
}

function isAlertDiagnostic(entry = {}) {
  const level = `${entry.level || ''}`.trim().toLowerCase();
  return level === 'warn' || level === 'error';
}

function buildExecutionDiagnosticSummary(logs = []) {
  const diagnostics = logs.filter(isDiagnosticEntry);
  const errors = diagnostics.filter((entry) => `${entry.level || ''}`.toLowerCase() === 'error').length;
  const warnings = diagnostics.filter((entry) => `${entry.level || ''}`.toLowerCase() === 'warn').length;
  const executionEvents = diagnostics.filter(isExecutionDiagnostic).length;
  const learningAlerts = diagnostics.filter(isRecorderDiagnostic).length;

  if (!diagnostics.length) {
    return 'Sin diagnosticos de ejecucion o aprendizaje todavia.';
  }

  if (!errors && !warnings) {
    return `${diagnostics.length} evento(s) recientes sin fallos reportados.`;
  }

  const segments = [
    `${errors} error(es)`,
    `${warnings} alerta(s)`,
    `${executionEvents} evento(s) de ejecucion`,
    `${learningAlerts} alerta(s) de aprendizaje`
  ];
  return `${segments.join(', ')} y ${diagnostics.length} diagnostico(s) recientes.`;
}

function collectErrorContextWindows(logs = [], radius = 3) {
  const executionLogs = logs.filter(isDiagnosticEntry);
  const errorIndexes = executionLogs
    .map((entry, index) => (isAlertDiagnostic(entry) ? index : -1))
    .filter((index) => index >= 0);

  if (!errorIndexes.length) {
    return {
      executionLogs,
      selectedEntries: [],
      omittedCount: executionLogs.length
    };
  }

  const selectedIndexes = new Set();
  errorIndexes.forEach((errorIndex) => {
    const start = Math.max(0, errorIndex - radius);
    const end = Math.min(executionLogs.length - 1, errorIndex + radius);
    for (let index = start; index <= end; index += 1) {
      selectedIndexes.add(index);
    }
  });

  const sortedIndexes = Array.from(selectedIndexes).sort((left, right) => left - right);
  const selectedEntries = [];
  let previousIndex = null;

  sortedIndexes.forEach((index) => {
    if (previousIndex != null && index - previousIndex > 1) {
      selectedEntries.push({
        type: 'gap',
        omittedCount: index - previousIndex - 1
      });
    }

    selectedEntries.push({
      type: 'entry',
      entry: executionLogs[index],
      index
    });
    previousIndex = index;
  });

  return {
    executionLogs,
    selectedEntries,
    omittedCount: Math.max(0, executionLogs.length - sortedIndexes.length)
  };
}

async function clearLogs() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [LOG_STORAGE_KEY]: [] }, resolve);
  });
}

async function readSelectedElement() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [SELECTED_ELEMENT_STORAGE_KEY]: null }, (result) => {
      resolve(result?.[SELECTED_ELEMENT_STORAGE_KEY] || null);
    });
  });
}

async function writeSelectedElement(value) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [SELECTED_ELEMENT_STORAGE_KEY]: value || null }, resolve);
  });
}

async function readAutoCaptureAnalysisCache() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [AUTO_CAPTURE_ANALYSIS_STORAGE_KEY]: null }, (result) => {
      resolve(result?.[AUTO_CAPTURE_ANALYSIS_STORAGE_KEY] || null);
    });
  });
}

async function writeAutoCaptureAnalysisCache(value) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [AUTO_CAPTURE_ANALYSIS_STORAGE_KEY]: value || null }, resolve);
  });
}

async function loadLogPanelState() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [LOG_PANEL_STATE_KEY]: false }, (result) => {
      resolve(Boolean(result?.[LOG_PANEL_STATE_KEY]));
    });
  });
}

async function loadVoiceLogPanelState() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [VOICE_LOG_PANEL_STATE_KEY]: false }, (result) => {
      resolve(Boolean(result?.[VOICE_LOG_PANEL_STATE_KEY]));
    });
  });
}

async function loadTraceLogPanelState() {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [TRACE_LOG_PANEL_STATE_KEY]: false }, (result) => {
      resolve(Boolean(result?.[TRACE_LOG_PANEL_STATE_KEY]));
    });
  });
}

async function saveLogPanelState(isOpen) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [LOG_PANEL_STATE_KEY]: Boolean(isOpen) }, resolve);
  });
}

async function saveVoiceLogPanelState(isOpen) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [VOICE_LOG_PANEL_STATE_KEY]: Boolean(isOpen) }, resolve);
  });
}

async function saveTraceLogPanelState(isOpen) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [TRACE_LOG_PANEL_STATE_KEY]: Boolean(isOpen) }, resolve);
  });
}

function formatLogEntry(entry = {}) {
  const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'unknown-time';
  const level = `${entry.level || 'info'}`.toUpperCase();
  const scope = `${entry.scope || 'unknown'}`.trim().toLowerCase();
  const details = entry.details && typeof entry.details === 'object' ? entry.details : {};
  const stepText = [
    scope && scope !== 'execution' ? `scope=${scope}` : '',
    details.workflowId ? `workflow=${details.workflowId}` : '',
    Number.isFinite(details.stepOrder) ? `step=${details.stepOrder}` : '',
    details.actionType ? `action=${details.actionType}` : '',
    details.selector ? `selector=${details.selector}` : '',
    details.label ? `label=${details.label}` : '',
    details.failureKind ? `failure=${details.failureKind}` : '',
    details.resolution ? `resolution=${details.resolution}` : ''
  ].filter(Boolean).join(' | ');
  const errorText = details.selectorError || details.errorMessage || '';
  const locationText = details.currentUrl ? `\nurl: ${details.currentUrl}` : '';
  const detailsBlock = entry.details ? `\n${JSON.stringify(entry.details, null, 2)}` : '';
  return [
    `${timestamp} ${level} ${entry.message || '(empty message)'}`.trim(),
    stepText,
    errorText ? `error: ${errorText}` : '',
    locationText ? locationText.trim() : '',
    detailsBlock.trim()
  ].filter(Boolean).join('\n');
}

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildBackendUrl(pathname) {
  const backendUrlEl = document.getElementById('backendUrl');
  const configured = `${backendUrlEl?.value || DEFAULT_BACKEND_URL}`.trim() || DEFAULT_BACKEND_URL;
  const normalizedBase = configured.replace(/\/+$/, '');
  return `${normalizedBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function renderDiagnosticsChat() {
  const logEl = document.getElementById('diagnosticsChatLog');
  const emptyEl = document.getElementById('diagnosticsChatEmpty');
  if (!logEl) {
    return;
  }

  logEl.innerHTML = '';
  if (!diagnosticsChatHistory.length) {
    if (emptyEl) {
      emptyEl.classList.remove('hidden');
      logEl.appendChild(emptyEl);
    }
    return;
  }

  diagnosticsChatHistory.forEach((message) => {
    const article = document.createElement('article');
    article.className = `diagnostics-chat-message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    article.textContent = `${message.content || ''}`.trim();
    logEl.appendChild(article);
  });

  if (emptyEl) {
    emptyEl.classList.add('hidden');
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function requestDiagnosticsAnalysis(userMessage) {
  const logs = await readLogs();
  const selectedElement = await readSelectedElement();
  const { executionLogs, selectedEntries } = collectErrorContextWindows(logs, 3);
  const relevantLogs = selectedEntries
    .filter((item) => item.type === 'entry')
    .map((item) => item.entry);

  const payload = {
    userMessage,
    history: diagnosticsChatHistory.slice(0, -1).slice(-6),
    logs: relevantLogs.length > 0 ? relevantLogs : executionLogs.slice(-12),
    selectedElement
  };

  const response = await fetch(buildBackendUrl('/api/diagnostics/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'No pude analizar el problema.');
  }
  return result;
}

function buildSelectedElementFingerprint(selectedElement) {
  if (!selectedElement) {
    return '';
  }

  return JSON.stringify({
    selector: `${selectedElement.selector || ''}`.trim(),
    href: `${selectedElement.href || ''}`.trim(),
    text: `${selectedElement.text || ''}`.trim(),
    pageUrl: `${selectedElement.pageUrl || ''}`.trim()
  });
}

async function requestCaptureGapAnalysis() {
  const logs = await readLogs();
  const selectedElement = await readSelectedElement();
  if (!selectedElement) {
    return null;
  }

  const relevantLogs = logs.filter((entry) => {
    const scope = `${entry.scope || ''}`.trim().toLowerCase();
    return scope === 'execution' || scope === 'recorder';
  }).slice(-24);

  const response = await fetch(buildBackendUrl('/api/diagnostics/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analysisMode: 'capture-gap',
      userMessage: 'Analiza automaticamente si este elemento marcado se puede capturar con el recorder actual o si falta un metodo especifico para persistirlo correctamente.',
      logs: relevantLogs,
      selectedElement,
      history: []
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'No pude analizar la capacidad de captura del elemento.');
  }

  return {
    fingerprint: buildSelectedElementFingerprint(selectedElement),
    selectedElement,
    reply: `${result.reply || ''}`.trim()
  };
}

async function renderSelectedElementSummary() {
  const summaryEl = document.getElementById('diagnosticsSelectedElementSummary');
  if (!summaryEl) {
    return;
  }

  const selectedElement = await readSelectedElement();
  if (!selectedElement) {
    summaryEl.textContent = 'No has señalado ningún elemento todavía.';
    return;
  }

  summaryEl.textContent = [
    selectedElement.selector ? `selector: ${selectedElement.selector}` : '',
    selectedElement.text ? `texto: ${selectedElement.text}` : '',
    selectedElement.pageUrl ? `url: ${selectedElement.pageUrl}` : ''
  ].filter(Boolean).join('\n');
}

async function runAutomaticCaptureGapAnalysis(diagnosticsChatStatus) {
  const selectedElement = await readSelectedElement();
  if (!selectedElement) {
    return;
  }

  const fingerprint = buildSelectedElementFingerprint(selectedElement);
  const cached = await readAutoCaptureAnalysisCache();

  if (cached?.fingerprint === fingerprint && `${cached.reply || ''}`.trim()) {
    diagnosticsChatHistory.splice(0, diagnosticsChatHistory.length, {
      role: 'assistant',
      content: `${cached.reply}`.trim()
    });
    renderDiagnosticsChat();
    diagnosticsChatStatus.textContent = 'Analisis automatico de captura cargado para el elemento marcado.';
    return;
  }

  diagnosticsChatStatus.textContent = 'Analizando automaticamente si el recorder sabe capturar este elemento...';
  try {
    const result = await requestCaptureGapAnalysis();
    if (!result?.reply) {
      diagnosticsChatStatus.textContent = 'No pude formular un analisis automatico util todavia.';
      return;
    }

    diagnosticsChatHistory.splice(0, diagnosticsChatHistory.length, {
      role: 'assistant',
      content: result.reply
    });
    renderDiagnosticsChat();
    await writeAutoCaptureAnalysisCache(result);
    diagnosticsChatStatus.textContent = 'Analisis automatico de captura listo.';
  } catch (error) {
    diagnosticsChatStatus.textContent = error.message || 'No pude analizar automaticamente la captura del elemento.';
  }
}

function renderImprovementsView(payload = {}) {
  const settingsViewEl = document.getElementById('settingsView');
  const improvementsViewEl = document.getElementById('improvementsView');
  const titleEl = document.getElementById('popupImprovementsTitle');
  const statusEl = document.getElementById('popupImprovementsStatus');
  const listEl = document.getElementById('popupImprovementsList');
  const emptyEl = document.getElementById('popupImprovementsEmpty');
  const footnoteEl = document.getElementById('popupImprovementsFootnote');
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];

  settingsViewEl.classList.add('hidden');
  improvementsViewEl.classList.add('open');
  titleEl.textContent = payload?.title || 'Feedback visible sobre la pagina';
  statusEl.textContent = payload?.status || '';
  footnoteEl.textContent = payload?.footnote || '';
  listEl.innerHTML = '';

  if (!suggestions.length) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  suggestions.forEach((suggestion) => {
    const item = document.createElement('article');
    const priority = `${suggestion.priority || 'media'}`.toLowerCase();
    item.className = 'improvement-item';
    item.innerHTML = `
      <div class="improvement-item-header">
        <div>
          <div class="improvement-item-eyebrow">${escapeHtml(suggestion.area || 'Momento de la experiencia')}</div>
          <h4 class="improvement-item-title">${escapeHtml(suggestion.title || 'Sugerencia de mejora')}</h4>
        </div>
        <div class="improvement-item-pill" data-priority="${escapeHtml(priority)}">Prioridad ${escapeHtml(suggestion.priority || 'media')}</div>
      </div>
      <div class="improvement-item-meta">
        <div>${escapeHtml(suggestion.summary || '')}</div>
        <div class="improvement-item-quote">
          <span class="improvement-item-quote-label">Lo que una persona podria decir</span>
          ${escapeHtml(suggestion.evidence || 'Sin evidencia disponible.')}
        </div>
        <div class="improvement-item-recommendation">
          <span class="improvement-item-recommendation-label">Que conviene mejorar</span>
          ${escapeHtml(suggestion.opportunity || 'Sin oportunidad descrita.')}
        </div>
        <div><strong>Origen:</strong> ${escapeHtml(suggestion.source || 'Plugin')}</div>
      </div>
      <div class="improvement-item-target">Anclado a: ${escapeHtml(suggestion.selector || 'pagina actual')}</div>
    `;
    listEl.appendChild(item);
  });
}

async function getActiveTabId() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id || null;
}

async function renderLogs(logOutputEl) {
  const logs = await readLogs();
  const { executionLogs, selectedEntries, omittedCount } = collectErrorContextWindows(logs, 3);
  const summaryEl = document.getElementById('logSummary');
  const hasErrors = executionLogs.some(isErrorDiagnostic);
  if (summaryEl) {
    const baseSummary = buildExecutionDiagnosticSummary(logs);
    summaryEl.textContent = hasErrors
      ? `${baseSummary} Mostrando 3 evento(s) antes y 3 despues de cada error.`
      : `${baseSummary} No hay errores recientes para filtrar.`;
  }
  if (!executionLogs.length) {
    logOutputEl.textContent = 'No hay diagnosticos de ejecucion todavia.';
    return;
  }

  if (!selectedEntries.length) {
    logOutputEl.textContent = 'No hay errores recientes. Cuando ocurra uno, aqui veras 3 eventos antes y 3 despues.';
    return;
  }

  const rendered = selectedEntries.map((item) => {
    if (item.type === 'gap') {
      return `... ${item.omittedCount} evento(s) omitido(s) sin errores en este tramo ...`;
    }
    return formatLogEntry(item.entry);
  });

  if (omittedCount > 0) {
    rendered.unshift(`Contexto filtrado por errores. ${omittedCount} evento(s) fuera de las ventanas fueron omitidos.`);
  }

  logOutputEl.textContent = rendered.join('\n\n');
}

function buildVoiceLogSummary(logs = []) {
  const voiceLogs = logs.filter(isVoiceDiagnostic);
  if (!voiceLogs.length) {
    return 'Sin logs de voz en tiempo real todavia.';
  }
  const errors = voiceLogs.filter((entry) => `${entry.level || ''}`.trim().toLowerCase() === 'error').length;
  const warnings = voiceLogs.filter((entry) => `${entry.level || ''}`.trim().toLowerCase() === 'warn').length;
  return `${voiceLogs.length} evento(s) de voz recientes, ${errors} error(es), ${warnings} alerta(s).`;
}

function buildSessionTraceSummary(logs = []) {
  const traceLogs = logs.filter(isSessionTrace);
  if (!traceLogs.length) {
    return 'Sin trazas recientes de aprendizaje o ejecucion todavia.';
  }

  const learningCount = traceLogs.filter(isLearningTrace).length;
  const executionCount = traceLogs.filter(isExecutionDiagnostic).length;
  const errorCount = traceLogs.filter(isErrorDiagnostic).length;
  const warningCount = traceLogs.filter((entry) => `${entry.level || ''}`.trim().toLowerCase() === 'warn').length;

  return `${traceLogs.length} evento(s) de la sesion: ${learningCount} de aprendizaje, ${executionCount} de ejecucion, ${errorCount} error(es), ${warningCount} alerta(s).`;
}

async function renderTraceLogs(logOutputEl) {
  const logs = await readLogs();
  const traceLogs = logs.filter(isSessionTrace);
  const summaryEl = document.getElementById('traceSummary');
  if (summaryEl) {
    summaryEl.textContent = buildSessionTraceSummary(logs);
  }

  if (!traceLogs.length) {
    logOutputEl.textContent = 'No hay trazas recientes de aprendizaje o ejecucion todavia.';
    return;
  }

  logOutputEl.textContent = traceLogs
    .slice(-60)
    .map((entry) => formatLogEntry(entry))
    .join('\n\n');
}

async function renderVoiceLogs(logOutputEl) {
  const logs = await readLogs();
  const voiceLogs = logs.filter(isVoiceDiagnostic);
  const summaryEl = document.getElementById('voiceLogSummary');
  if (summaryEl) {
    summaryEl.textContent = buildVoiceLogSummary(logs);
  }

  if (!voiceLogs.length) {
    logOutputEl.textContent = 'No hay logs de voz en tiempo real todavia.';
    return;
  }

  logOutputEl.textContent = voiceLogs
    .slice(-40)
    .map((entry) => formatLogEntry(entry))
    .join('\n\n');
}

async function setLogPanelOpen(panelEl, buttonEl, logOutputEl, isOpen) {
  panelEl.classList.toggle('open', isOpen);
  buttonEl.textContent = isOpen ? 'Ocultar diagnostico' : 'Ver diagnostico';
  await saveLogPanelState(isOpen);
  if (isOpen) {
    await renderLogs(logOutputEl);
  }
}

async function setVoiceLogPanelOpen(panelEl, buttonEl, logOutputEl, isOpen) {
  panelEl.classList.toggle('open', isOpen);
  buttonEl.textContent = isOpen ? 'Ocultar logs de voz' : 'Ver logs de voz';
  await saveVoiceLogPanelState(isOpen);
  if (isOpen) {
    await renderVoiceLogs(logOutputEl);
  }
}

async function setTraceLogPanelOpen(panelEl, buttonEl, logOutputEl, isOpen) {
  panelEl.classList.toggle('open', isOpen);
  buttonEl.textContent = isOpen ? 'Ocultar traza de sesion' : 'Ver traza de sesion';
  await saveTraceLogPanelState(isOpen);
  if (isOpen) {
    await renderTraceLogs(logOutputEl);
  }
}

async function init() {
  const enabledEl = document.getElementById('enabled');
  const backendUrlEl = document.getElementById('backendUrl');
  const saveButton = document.getElementById('save');
  const showImprovementsButton = document.getElementById('showImprovements');
  const toggleLogsButton = document.getElementById('toggleLogs');
  const toggleVoiceLogsButton = document.getElementById('toggleVoiceLogs');
  const toggleTraceButton = document.getElementById('toggleTrace');
  const clearLogsButton = document.getElementById('clearLogs');
  const statusEl = document.getElementById('status');
  const tracePanelEl = document.getElementById('tracePanel');
  const traceOutputEl = document.getElementById('traceOutput');
  const logPanelEl = document.getElementById('logPanel');
  const logOutputEl = document.getElementById('logOutput');
  const voiceLogPanelEl = document.getElementById('voiceLogPanel');
  const voiceLogOutputEl = document.getElementById('voiceLogOutput');
  const diagnosticsChatInput = document.getElementById('diagnosticsChatInput');
  const diagnosticsChatSend = document.getElementById('diagnosticsChatSend');
  const diagnosticsChatStatus = document.getElementById('diagnosticsChatStatus');
  const diagnosticsSelectElement = document.getElementById('diagnosticsSelectElement');
  const diagnosticsClearElement = document.getElementById('diagnosticsClearElement');
  const refreshImprovementsButton = document.getElementById('popupImprovementsRefresh');
  const overlayToggleButton = document.getElementById('popupOverlayToggle');

  const settings = await loadSettings();
  const showLogs = await loadLogPanelState();
  const showVoiceLogs = await loadVoiceLogPanelState();
  const showTraceLogs = await loadTraceLogPanelState();
  enabledEl.checked = Boolean(settings.enabled);
  backendUrlEl.value = `${settings.backendUrl || DEFAULT_BACKEND_URL}`.trim() || DEFAULT_BACKEND_URL;
  await setTraceLogPanelOpen(tracePanelEl, toggleTraceButton, traceOutputEl, showTraceLogs);
  await setLogPanelOpen(logPanelEl, toggleLogsButton, logOutputEl, showLogs);
  await setVoiceLogPanelOpen(voiceLogPanelEl, toggleVoiceLogsButton, voiceLogOutputEl, showVoiceLogs);
  renderDiagnosticsChat();
  await renderSelectedElementSummary();
  await runAutomaticCaptureGapAnalysis(diagnosticsChatStatus);

  saveButton.addEventListener('click', async () => {
    const nextSettings = {
      enabled: enabledEl.checked,
      backendUrl: `${backendUrlEl.value || DEFAULT_BACKEND_URL}`.trim() || DEFAULT_BACKEND_URL
    };

    await saveSettings(nextSettings);
    statusEl.textContent = 'Saved. Reload the target tab.';
    window.setTimeout(() => {
      statusEl.textContent = '';
    }, 1800);
  });

  showImprovementsButton.addEventListener('click', async () => {
    const activeTabId = await getActiveTabId();
    if (!activeTabId) {
      statusEl.textContent = 'No pude encontrar la pestaña activa.';
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: 'graph:open-improvements' });
      if (!response?.ok || !response?.payload) {
        throw new Error('No hubo datos de mejoras.');
      }
      renderImprovementsView(response.payload);
    } catch (error) {
      statusEl.textContent = 'No pude abrir mejoras en esta pestaña.';
      window.setTimeout(() => {
        statusEl.textContent = '';
      }, 1800);
    }
  });

  refreshImprovementsButton.addEventListener('click', async () => {
    const activeTabId = await getActiveTabId();
    if (!activeTabId) {
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: 'graph:open-improvements' });
      if (response?.ok && response?.payload) {
        renderImprovementsView(response.payload);
      }
    } catch (error) {
      // Ignore silent refresh errors in the popup panel.
    }
  });

  overlayToggleButton.addEventListener('click', async () => {
    const activeTabId = await getActiveTabId();
    if (!activeTabId) {
      return;
    }
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'graph:toggle-improvements-overlay' });
    } catch (error) {
      // Keep popup usable even if the page could not toggle the overlay.
    }
  });

  toggleLogsButton.addEventListener('click', async () => {
    const isOpen = !logPanelEl.classList.contains('open');
    await setLogPanelOpen(logPanelEl, toggleLogsButton, logOutputEl, isOpen);
  });

  toggleTraceButton.addEventListener('click', async () => {
    const isOpen = !tracePanelEl.classList.contains('open');
    await setTraceLogPanelOpen(tracePanelEl, toggleTraceButton, traceOutputEl, isOpen);
  });

  toggleVoiceLogsButton.addEventListener('click', async () => {
    const isOpen = !voiceLogPanelEl.classList.contains('open');
    await setVoiceLogPanelOpen(voiceLogPanelEl, toggleVoiceLogsButton, voiceLogOutputEl, isOpen);
  });

  clearLogsButton.addEventListener('click', async () => {
    await clearLogs();
    await renderTraceLogs(traceOutputEl);
    await renderLogs(logOutputEl);
    await renderVoiceLogs(voiceLogOutputEl);
    statusEl.textContent = 'Logs cleared.';
    window.setTimeout(() => {
      statusEl.textContent = '';
    }, 1600);
  });

  diagnosticsChatSend.addEventListener('click', async () => {
    const userMessage = `${diagnosticsChatInput?.value || ''}`.trim();
    if (!userMessage) {
      diagnosticsChatStatus.textContent = 'Cuéntame qué viste para que el agente pueda analizarlo.';
      return;
    }

    diagnosticsChatHistory.push({ role: 'user', content: userMessage });
    diagnosticsChatInput.value = '';
    diagnosticsChatStatus.textContent = 'Analizando logs y buscando la causa raíz...';
    diagnosticsChatSend.disabled = true;
    renderDiagnosticsChat();

    try {
      const result = await requestDiagnosticsAnalysis(userMessage);
      diagnosticsChatHistory.push({
        role: 'assistant',
        content: `${result.reply || 'No pude formular una respuesta útil todavía.'}`.trim()
      });
      diagnosticsChatStatus.textContent = '';
      renderDiagnosticsChat();
    } catch (error) {
      diagnosticsChatStatus.textContent = error.message || 'No pude analizar el problema.';
    } finally {
      diagnosticsChatSend.disabled = false;
    }
  });

  diagnosticsSelectElement.addEventListener('click', async () => {
    const activeTabId = await getActiveTabId();
    if (!activeTabId) {
      diagnosticsChatStatus.textContent = 'No pude encontrar la pestaña activa.';
      return;
    }

    diagnosticsChatStatus.textContent = 'Haz click en la página sobre el elemento que quieres enseñarle al agente y luego vuelve a abrir este popup.';
    try {
      await writeAutoCaptureAnalysisCache(null);
      await chrome.tabs.sendMessage(activeTabId, { type: 'graph:start-element-inspection' });
    } catch (error) {
      diagnosticsChatStatus.textContent = 'No pude activar el modo de selección de elemento.';
    }
  });

  diagnosticsClearElement.addEventListener('click', async () => {
    await writeSelectedElement(null);
    await writeAutoCaptureAnalysisCache(null);
    diagnosticsChatHistory.length = 0;
    renderDiagnosticsChat();
    await renderSelectedElementSummary();
    diagnosticsChatStatus.textContent = 'Elemento señalado eliminado.';
    window.setTimeout(() => {
      diagnosticsChatStatus.textContent = '';
    }, 1400);
  });
}

init().catch((error) => {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = error.message || 'Could not load extension settings.';
  }
});
