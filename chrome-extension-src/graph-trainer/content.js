const DEFAULT_BACKEND_URL = 'https://miracle-zeta.vercel.app';
const LOG_STORAGE_KEY = 'graphTrainerExtensionLogs';
const LOG_LIMIT = 200;
const EXECUTION_LOG_SCOPES = new Set(['execution']);
const VOICE_LOG_SCOPES = new Set(['voice']);
const LEARNING_LOG_SCOPES = new Set(['learning']);
const SELECTED_ELEMENT_STORAGE_KEY = 'graphTrainerSelectedElement';

let inspectModeActive = false;
let inspectAbortController = null;

function getStorage() {
  return chrome.storage?.sync || chrome.storage?.local;
}

function getLocalStorage() {
  return chrome.storage?.local || chrome.storage?.sync;
}

function readSettings() {
  const storage = getStorage();
  return new Promise((resolve) => {
    storage.get({
      enabled: true,
      backendUrl: DEFAULT_BACKEND_URL
    }, resolve);
  });
}

function requestPageImprovementData() {
  const payload = window.TrainerPlugin?.getImprovementPanelData?.() || null;
  window.TrainerPlugin?.showFeedbackOverlay?.();
  return Promise.resolve(payload);
}

function buildElementSelector(element) {
  if (!element) {
    return '';
  }
  if (element.dataset?.testid) {
    return `[data-testid="${element.dataset.testid}"]`;
  }
  if (element.id) {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(element.id)
      ? `#${element.id}`
      : `[id="${element.id.replace(/"/g, '\\"')}"]`;
  }
  if (element.getAttribute?.('name')) {
    return `[name="${element.getAttribute('name').replace(/"/g, '\\"')}"]`;
  }
  if (element.tagName === 'A' && element.getAttribute('href')) {
    return `a[href="${element.getAttribute('href').replace(/"/g, '\\"')}"]`;
  }
  return element.tagName ? element.tagName.toLowerCase() : '';
}

function describeElementText(element) {
  return `${element?.textContent || element?.value || element?.getAttribute?.('aria-label') || ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function collectElementContextTrail(element) {
  const trail = [];
  let current = element;
  let depth = 0;
  while (current && depth < 4) {
    trail.push({
      tagName: `${current.tagName || ''}`.toLowerCase(),
      id: current.id || '',
      className: typeof current.className === 'string' ? current.className.trim().slice(0, 180) : '',
      selector: buildElementSelector(current),
      text: describeElementText(current)
    });
    current = current.parentElement;
    depth += 1;
  }
  return trail;
}

function buildSelectedElementPayload(element) {
  const rect = element.getBoundingClientRect();
  return {
    capturedAt: new Date().toISOString(),
    pageTitle: document.title || '',
    pageUrl: window.location.href,
    selector: buildElementSelector(element),
    tagName: `${element.tagName || ''}`.toLowerCase(),
    id: element.id || '',
    name: element.getAttribute?.('name') || '',
    href: element.getAttribute?.('href') || '',
    type: element.getAttribute?.('type') || '',
    role: element.getAttribute?.('role') || '',
    ariaLabel: element.getAttribute?.('aria-label') || '',
    text: describeElementText(element),
    isVisible: !!(rect.width > 0 && rect.height > 0),
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    contextTrail: collectElementContextTrail(element),
    outerHtmlSnippet: (element.outerHTML || '').slice(0, 1600)
  };
}

function persistSelectedElement(payload) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.set({ [SELECTED_ELEMENT_STORAGE_KEY]: payload || null }, resolve);
  });
}

async function startInspectMode() {
  if (inspectModeActive) {
    return;
  }

  inspectModeActive = true;
  inspectAbortController = new AbortController();
  const { signal } = inspectAbortController;

  const completeSelection = async (target) => {
    inspectModeActive = false;
    inspectAbortController = null;
    const element = target instanceof Element ? target : null;
    if (!element) {
      await persistSelectedElement(null);
      return;
    }

    const payload = buildSelectedElementPayload(element);
    await persistSelectedElement(payload);
    await log('info', 'content', 'Captured element for diagnostics inspection.', {
      selector: payload.selector,
      tagName: payload.tagName,
      text: payload.text,
      pageUrl: payload.pageUrl
    });
  };

  document.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target?.closest?.('*') || event.target;
    await completeSelection(target);
  }, {
    capture: true,
    once: true,
    signal
  });

  document.addEventListener('keydown', async (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    inspectAbortController?.abort();
    inspectModeActive = false;
    inspectAbortController = null;
    await log('info', 'content', 'Diagnostics element inspection cancelled.');
  }, {
    capture: true,
    once: true,
    signal
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'graph:open-improvements') {
    requestPageImprovementData()
      .then((payload) => {
        sendResponse({ ok: Boolean(payload), payload });
      })
      .catch(() => {
        sendResponse({ ok: false, payload: null });
      });
    return true;
  }

  if (message?.type === 'graph:toggle-improvements-overlay') {
    const value = window.TrainerPlugin?.toggleFeedbackOverlay?.();
    sendResponse({ ok: true, value });
    return false;
  }

  if (message?.type === 'graph:start-element-inspection') {
    startInspectMode()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'inspection failed' }));
    return true;
  }

  return false;
});

function writeLog(entry) {
  const storage = getLocalStorage();
  return new Promise((resolve) => {
    storage.get({ [LOG_STORAGE_KEY]: [] }, (result) => {
      const current = Array.isArray(result?.[LOG_STORAGE_KEY]) ? result[LOG_STORAGE_KEY] : [];
      const next = [
        ...current,
        {
          timestamp: new Date().toISOString(),
          level: entry.level || 'info',
          scope: entry.scope || 'content',
          message: entry.message || '',
          details: entry.details || null
        }
      ].slice(-LOG_LIMIT);
      storage.set({ [LOG_STORAGE_KEY]: next }, resolve);
    });
  });
}

function shouldPersistLogEntry(entry = {}) {
  const level = `${entry.level || 'info'}`.trim().toLowerCase();
  const scope = `${entry.scope || ''}`.trim().toLowerCase();

  if (level === 'error' || level === 'warn') {
    return true;
  }

  if (EXECUTION_LOG_SCOPES.has(scope)) {
    return true;
  }

  if (VOICE_LOG_SCOPES.has(scope)) {
    return true;
  }

  if (LEARNING_LOG_SCOPES.has(scope)) {
    return true;
  }

  return false;
}

function log(level, scope, message, details = null) {
  if (!shouldPersistLogEntry({ level, scope, message, details })) {
    return Promise.resolve();
  }
  return writeLog({ level, scope, message, details }).catch(() => {});
}

function normalizeHostname(value) {
  return `${value || 'page'}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}

async function bootstrap() {
  if (window.top !== window) {
    return;
  }

  const settings = await readSettings();
  if (!settings.enabled) {
    return;
  }

  if (globalThis.__graphTrainerExtensionMounted === true) {
    return;
  }
  globalThis.__graphTrainerExtensionMounted = true;
  document.documentElement.dataset.graphTrainerExtensionMounted = 'true';
  const backendUrl = `${settings.backendUrl || DEFAULT_BACKEND_URL}`.trim() || DEFAULT_BACKEND_URL;
  const appId = `chrome-extension-${normalizeHostname(window.location.hostname)}`;
  const storageKey = `graph-extension-state-${normalizeHostname(window.location.hostname)}`;
  const workflowDescription = `Workflow on ${window.location.hostname || 'current-page'}`;

  document.addEventListener('graph-trainer-extension-log', (event) => {
    const detail = event?.detail || {};
    log(detail.level || 'info', detail.scope || 'page', detail.message || 'Page event received.', detail.details || null);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }
    const payload = event.data;
    if (!payload || payload.source !== 'graph-trainer-extension' || payload.type !== 'log') {
      return;
    }
    const detail = payload.detail || {};
    log(detail.level || 'info', detail.scope || 'page', detail.message || 'Page message received.', detail.details || null);
  });

  if (!window.PageState || !window.TrainerPlugin || !window.GraphPluginHost) {
    throw new Error('Miracle runtime scripts did not load in the extension context.');
  }

  window.PageState.init({ storageKey });
  window.TrainerPlugin.mount({
    title: 'Miracle',
    workflowDescription,
    appId,
    apiBaseUrl: backendUrl,
    assistantRuntime: {
      name: 'Miracle',
      accentColor: '#0f5f8c',
      idleMessage: 'Puedo aprender y ejecutar tareas en esta pagina cuando quieras.'
    }
  });

  await log('info', 'content', 'Miracle mounted in the isolated extension context.', {
    backendUrl,
    appId
  });
}

bootstrap().catch((error) => {
  console.warn('[GraphTrainerExtension] bootstrap failed:', error);
  log('error', 'content', 'Extension bootstrap failed.', {
    message: error?.message || 'Unknown bootstrap error'
  });
});
