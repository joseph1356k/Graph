const DEFAULT_BACKEND_URL = 'https://miracle-zeta.vercel.app';
const LOG_STORAGE_KEY = 'graphTrainerExtensionLogs';
const LOG_LIMIT = 200;
const EXECUTION_LOG_SCOPES = new Set(['execution']);
const VOICE_LOG_SCOPES = new Set(['voice']);
const LEARNING_LOG_SCOPES = new Set(['learning']);
const SELECTED_ELEMENT_STORAGE_KEY = 'graphTrainerSelectedElement';
const AUTH_WIDGET_ID = 'graph-trainer-auth-widget';

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

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'No fue posible contactar la extension.'));
        return;
      }
      if (!result?.ok) {
        reject(new Error(result?.error || 'La extension no pudo completar la operacion.'));
        return;
      }
      resolve(result.payload || null);
    });
  });
}

function createExtensionAuthBridge() {
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const state = {
    initialized: false,
    session: null,
    widget: null,
    busy: false
  };

  function normalizeSession(session) {
    if (!session?.authenticated) {
      return null;
    }
    return {
      authenticated: true,
      user: session.user || null,
      expiresAt: Number(session.expiresAt || 0),
      accessToken: `${session.accessToken || ''}`.trim()
    };
  }

  function getUser() {
    if (!state.session?.user) {
      return null;
    }
    return {
      ...state.session.user,
      is_anonymous: Boolean(state.session.user.isAnonymous)
    };
  }

  function getMode() {
    if (!state.session?.authenticated) {
      return '';
    }
    return state.session.user?.isAnonymous ? 'supabase-anonymous' : 'supabase';
  }

  function dispatchAuthChanged() {
    window.dispatchEvent(new CustomEvent('miracle-auth-changed', {
      detail: {
        user: getUser(),
        authenticated: Boolean(state.session?.authenticated),
        mode: getMode()
      }
    }));
  }

  function ensureWidget() {
    if (state.widget?.isConnected) {
      return state.widget;
    }

    const widget = document.createElement('div');
    widget.id = AUTH_WIDGET_ID;
    widget.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:2147483200',
      'display:grid',
      'gap:8px',
      'width:min(320px,calc(100vw - 32px))',
      'padding:12px',
      'border-radius:16px',
      'background:rgba(15,23,42,0.94)',
      'color:#f8fafc',
      'box-shadow:0 18px 40px rgba(15,23,42,0.28)',
      'font:13px/1.4 Inter,system-ui,-apple-system,\"Segoe UI\",sans-serif'
    ].join(';');

    const status = document.createElement('div');
    status.id = `${AUTH_WIDGET_ID}-status`;
    status.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

    const dot = document.createElement('span');
    dot.id = `${AUTH_WIDGET_ID}-dot`;
    dot.style.cssText = 'width:10px;height:10px;border-radius:999px;flex:none;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,0.18);';

    const copy = document.createElement('div');
    copy.style.cssText = 'display:grid;gap:2px;min-width:0;';

    const title = document.createElement('strong');
    title.id = `${AUTH_WIDGET_ID}-title`;
    title.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const subtitle = document.createElement('div');
    subtitle.id = `${AUTH_WIDGET_ID}-subtitle`;
    subtitle.style.cssText = 'color:rgba(226,232,240,0.82);font-size:12px;';

    copy.append(title, subtitle);
    status.append(dot, copy);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    const loginButton = document.createElement('button');
    loginButton.type = 'button';
    loginButton.id = `${AUTH_WIDGET_ID}-login`;
    loginButton.textContent = 'Iniciar sesion con Google';
    loginButton.style.cssText = [
      'border:0',
      'border-radius:999px',
      'padding:10px 14px',
      'font:inherit',
      'font-weight:700',
      'background:#2f8cff',
      'color:#fff',
      'cursor:pointer'
    ].join(';');

    const logoutButton = document.createElement('button');
    logoutButton.type = 'button';
    logoutButton.id = `${AUTH_WIDGET_ID}-logout`;
    logoutButton.textContent = 'Cerrar sesion';
    logoutButton.style.cssText = [
      'border:1px solid rgba(148,163,184,0.35)',
      'border-radius:999px',
      'padding:10px 14px',
      'font:inherit',
      'font-weight:700',
      'background:transparent',
      'color:#e2e8f0',
      'cursor:pointer'
    ].join(';');

    actions.append(loginButton, logoutButton);
    widget.append(status, actions);

    loginButton.addEventListener('click', async () => {
      setBusy(true, 'Abriendo Google...');
      try {
        await updateSession(await sendRuntimeMessage({ type: 'graph:auth-login' }));
        await log('info', 'content', 'Extension auth session connected from floating widget.');
      } catch (error) {
        await log('warn', 'content', 'Extension auth login failed.', {
          message: error.message || 'No fue posible iniciar sesion.'
        });
        render(error.message || 'No fue posible iniciar sesion con Google.');
      } finally {
        setBusy(false);
      }
    });

    logoutButton.addEventListener('click', async () => {
      setBusy(true, 'Cerrando sesion...');
      try {
        await updateSession(await sendRuntimeMessage({ type: 'graph:auth-logout' }));
      } catch (error) {
        await log('warn', 'content', 'Extension auth logout failed.', {
          message: error.message || 'No fue posible cerrar sesion.'
        });
        render(error.message || 'No fue posible cerrar sesion.');
      } finally {
        setBusy(false);
      }
    });

    state.widget = widget;
    (document.body || document.documentElement).appendChild(widget);
    return widget;
  }

  function render(transientMessage = '') {
    const widget = ensureWidget();
    const dot = widget.querySelector(`#${AUTH_WIDGET_ID}-dot`);
    const title = widget.querySelector(`#${AUTH_WIDGET_ID}-title`);
    const subtitle = widget.querySelector(`#${AUTH_WIDGET_ID}-subtitle`);
    const loginButton = widget.querySelector(`#${AUTH_WIDGET_ID}-login`);
    const logoutButton = widget.querySelector(`#${AUTH_WIDGET_ID}-logout`);
    const authenticated = Boolean(state.session?.authenticated);

    if (dot) {
      dot.style.background = authenticated ? '#22c55e' : '#f59e0b';
      dot.style.boxShadow = authenticated
        ? '0 0 0 3px rgba(34,197,94,0.18)'
        : '0 0 0 3px rgba(245,158,11,0.18)';
    }
    if (title) {
      title.textContent = authenticated ? 'Graph conectado' : 'Graph sin conexion';
    }
    if (subtitle) {
      subtitle.textContent = transientMessage
        || (authenticated
          ? (state.session.user?.email || 'Sesion de Google lista para workflows.')
          : 'Inicia sesion con Google para usar workflows y Neo4j desde cualquier pagina.');
    }
    if (loginButton) {
      loginButton.style.display = authenticated ? 'none' : '';
      loginButton.disabled = state.busy;
    }
    if (logoutButton) {
      logoutButton.style.display = authenticated ? '' : 'none';
      logoutButton.disabled = state.busy;
    }
  }

  function setBusy(busy, message = '') {
    state.busy = busy;
    render(message);
  }

  async function updateSession(nextSession) {
    state.session = normalizeSession(nextSession);
    render();
    if (!state.initialized) {
      state.initialized = true;
      resolveReady(getUser());
    }
    dispatchAuthChanged();
    return state.session;
  }

  async function refreshSession() {
    try {
      await updateSession(await sendRuntimeMessage({ type: 'graph:auth-status' }));
    } catch (error) {
      render(error.message || 'No fue posible comprobar la sesion.');
      if (!state.initialized) {
        state.initialized = true;
        resolveReady(null);
      }
    }
  }

  window.addEventListener('focus', () => {
    refreshSession().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshSession().catch(() => {});
    }
  });

  window.MiracleAuth = {
    whenAuthenticated() {
      return ready;
    },
    getUser() {
      return getUser();
    },
    getAccessToken() {
      return state.session?.accessToken || '';
    },
    getMode() {
      return getMode();
    },
    async signIn() {
      setBusy(true, 'Abriendo Google...');
      try {
        await updateSession(await sendRuntimeMessage({ type: 'graph:auth-login' }));
        return getUser();
      } finally {
        setBusy(false);
      }
    },
    async signOut() {
      setBusy(true, 'Cerrando sesion...');
      try {
        await updateSession(await sendRuntimeMessage({ type: 'graph:auth-logout' }));
      } finally {
        setBusy(false);
      }
    }
  };

  render('Comprobando sesion...');
  refreshSession().catch(() => {});
}

function normalizeHostname(value) {
  return `${value || 'page'}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}

async function fetchPublicConfig(backendUrl) {
  try {
    const response = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/public-config`, {
      cache: 'no-store'
    });
    if (!response.ok) {
      return null;
    }
    return await response.json().catch(() => null);
  } catch (error) {
    return null;
  }
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
  const publicConfig = await fetchPublicConfig(backendUrl);
  const miracleBaseUrl = `${publicConfig?.miracleBaseUrl || backendUrl}`.trim() || backendUrl;
  const voiceGatewayUrl = `${publicConfig?.voiceGatewayUrl || ''}`.trim();

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

  createExtensionAuthBridge();
  window.PageState.init({ storageKey });
  window.TrainerPlugin.mount({
    title: 'Miracle',
    workflowDescription,
    appId,
    apiBaseUrl: backendUrl,
    miracleBaseUrl,
    voiceGatewayUrl,
    assistantRuntime: {
      name: 'Miracle',
      accentColor: '#0f5f8c',
      idleMessage: 'Puedo aprender y ejecutar tareas en esta pagina cuando quieras.'
    }
  });

  await log('info', 'content', 'Miracle mounted in the isolated extension context.', {
    backendUrl,
    appId,
    miracleBaseUrl,
    voiceGatewayUrl
  });
}

bootstrap().catch((error) => {
  console.warn('[GraphTrainerExtension] bootstrap failed:', error);
  log('error', 'content', 'Extension bootstrap failed.', {
    message: error?.message || 'Unknown bootstrap error'
  });
});
