const DEFAULT_BACKEND_URL = 'https://graph-1-hap6.onrender.com';
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

function injectExternalScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(path);
    script.async = false;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${path}`));
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

function injectInlineScript(code) {
  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function requestPageImprovementData() {
  return new Promise((resolve) => {
    const requestId = `graph-improvements-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handleMessage = (event) => {
      if (event.source !== window) {
        return;
      }
      const payload = event.data;
      if (!payload || payload.source !== 'graph-trainer-extension' || payload.type !== 'improvements-data' || payload.requestId !== requestId) {
        return;
      }
      window.removeEventListener('message', handleMessage);
      resolve(payload.payload || null);
    };

    window.addEventListener('message', handleMessage);
    injectInlineScript(`
      (() => {
        const payload = window.TrainerPlugin?.getImprovementPanelData?.() || null;
        window.TrainerPlugin?.showFeedbackOverlay?.();
        window.postMessage({
          source: 'graph-trainer-extension',
          type: 'improvements-data',
          requestId: ${JSON.stringify(requestId)},
          payload
        }, '*');
      })();
    `);

    window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      resolve(null);
    }, 1500);
  });
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
    injectInlineScript(`
      window.postMessage({
        source: 'graph-trainer-extension',
        type: 'improvements-overlay-toggled',
        value: window.TrainerPlugin?.toggleFeedbackOverlay?.()
      }, '*');
    `);
    sendResponse({ ok: true });
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

  if (document.documentElement.dataset.graphTrainerExtensionMounted === 'true') {
    return;
  }
  document.documentElement.dataset.graphTrainerExtensionMounted = 'true';

  const runtimeScripts = [
    'assets/page-state.js',
    'assets/recorder.js',
    'assets/assistant-runtime.js',
    'assets/plugin/plugin-events.js',
    'assets/plugin/plugin-host.js',
    'assets/plugin/plugin-adapters.js',
    'assets/plugin/plugin-context.js',
    'assets/plugin/plugin-api.js',
    'assets/plugin/plugin-learning-bridge.js',
    'assets/plugin/plugin-learning-client.js',
    'assets/plugin/plugin-voice-client.js',
    'assets/plugin/plugin-trainer-shell.js',
    'assets/plugin/plugin-surface-profile-client.js',
    'assets/plugin/plugin-execution-client.js',
    'assets/plugin/plugin-workflow-overlay-bridge.js',
    'assets/trainer-plugin.js',
    'bootstrap.js'
  ];

  document.documentElement.dataset.graphTrainerBackendUrl = `${settings.backendUrl || DEFAULT_BACKEND_URL}`.trim() || DEFAULT_BACKEND_URL;
  document.documentElement.dataset.graphTrainerAppId = `chrome-extension-${normalizeHostname(window.location.hostname)}`;
  document.documentElement.dataset.graphTrainerStorageKey = `graph-extension-state-${normalizeHostname(window.location.hostname)}`;
  document.documentElement.dataset.graphTrainerWorkflowDescription = `Workflow on ${window.location.hostname || 'current-page'}`;

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

  for (const path of runtimeScripts) {
    await injectExternalScript(path);
  }
}

bootstrap().catch((error) => {
  console.warn('[GraphTrainerExtension] bootstrap failed:', error);
  log('error', 'content', 'Extension bootstrap failed.', {
    message: error?.message || 'Unknown bootstrap error'
  });
});
