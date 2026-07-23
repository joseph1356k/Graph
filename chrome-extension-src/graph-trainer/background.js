// Runner de Computer Use visual (una sola tarea activa). Expone self.VisualAgent.
importScripts('visual-agent-core.js', 'visual-agent.js');

const DEFAULT_BACKEND_URL = 'https://miracle-zeta.vercel.app';
const AUTH_SESSION_KEY = 'graphTrainerAuthSession';

function storageGet(area, defaults) {
  return new Promise((resolve) => area.get(defaults, resolve));
}

function storageSet(area, values) {
  return new Promise((resolve) => area.set(values, resolve));
}

function storageRemove(area, keys) {
  return new Promise((resolve) => area.remove(keys, resolve));
}

async function getSettings() {
  const settings = await storageGet(chrome.storage.sync || chrome.storage.local, {
    backendUrl: DEFAULT_BACKEND_URL
  });
  return {
    backendUrl: `${settings.backendUrl || DEFAULT_BACKEND_URL}`.trim().replace(/\/+$/, '') || DEFAULT_BACKEND_URL
  };
}

async function signInWithLocalAdmin(username, password) {
  const { backendUrl } = await getSettings();
  const response = await fetch(`${backendUrl}/api/auth/local-admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username || '', password: password || '' })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'No fue posible iniciar sesion.');
  }
  const stored = {
    accessToken: payload.accessToken || '',
    expiresAt: Number(payload.expiresAt || 0),
    user: {
      id: payload.user?.id || '',
      email: payload.user?.email || payload.user?.username || '',
      isAnonymous: false
    }
  };
  await storageSet(chrome.storage.local, { [AUTH_SESSION_KEY]: stored });
  return stored;
}

async function readStoredSession() {
  const result = await storageGet(chrome.storage.local, { [AUTH_SESSION_KEY]: null });
  return result[AUTH_SESSION_KEY] || null;
}

async function getValidSession() {
  const session = await readStoredSession();
  if (!session?.accessToken) return null;
  if (Number(session.expiresAt || 0) > Date.now() + 60_000) return session;
  await storageRemove(chrome.storage.local, AUTH_SESSION_KEY);
  return null;
}

async function signOut() {
  await storageRemove(chrome.storage.local, AUTH_SESSION_KEY);
}

function publicSession(session) {
  return session ? {
    authenticated: true,
    user: session.user || null,
    expiresAt: Number(session.expiresAt || 0),
    accessToken: session.accessToken || ''
  } : {
    authenticated: false,
    user: null,
    expiresAt: 0,
    accessToken: ''
  };
}

function responsePayload(status, body, headers = {}) {
  return {
    transportOk: true,
    status,
    statusText: '',
    headers,
    body
  };
}

async function proxyApiFetch(request = {}) {
  const { backendUrl } = await getSettings();
  let target;
  try {
    target = new URL(`${request.url || ''}`);
  } catch (error) {
    return responsePayload(400, JSON.stringify({ error: 'La extension recibio una URL de API invalida.' }), {
      'content-type': 'application/json'
    });
  }

  const allowed = new URL(backendUrl);
  if (target.origin !== allowed.origin || !target.pathname.startsWith('/api/')) {
    return responsePayload(403, JSON.stringify({ error: 'Miracle bloqueo una solicitud fuera de su backend configurado.' }), {
      'content-type': 'application/json'
    });
  }

  const session = await getValidSession();
  const headers = new Headers(request.headers || {});
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  try {
    const response = await fetch(target.toString(), {
      method: request.method || 'GET',
      headers,
      body: request.body === undefined || request.body === null ? undefined : request.body
    });
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return responsePayload(response.status, await response.text(), responseHeaders);
  } catch (error) {
    return responsePayload(502, JSON.stringify({
      error: 'No fue posible contactar el backend de Miracle. Revisa la URL y tu conexion.'
    }), {
      'content-type': 'application/json'
    });
  }
}

// Mensajes del agente visual (Side Panel ↔ runner del service worker).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || !message.type.startsWith('mira:agent')) {
    return false;
  }
  const run = async () => {
    switch (message.type) {
      case 'mira:agent-start':
        return self.VisualAgent.startTask({ goal: message.goal, tabId: message.tabId });
      case 'mira:agent-stop':
        return self.VisualAgent.stopTask();
      case 'mira:agent-get-state':
        return self.VisualAgent.getState();
      default:
        return null;
    }
  };
  run()
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || `${error}` }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (typeof message?.type === 'string' && message.type.startsWith('mira:')) {
    return false; // lo maneja el listener del agente visual
  }
  const run = async () => {
    switch (message?.type) {
      case 'graph:auth-status':
        return publicSession(await getValidSession());
      case 'graph:auth-login':
        return publicSession(await signInWithLocalAdmin(message.username, message.password));
      case 'graph:auth-logout':
        await signOut();
        return publicSession(null);
      case 'graph:api-fetch':
        return proxyApiFetch(message.request || {});
      default:
        return null;
    }
  };

  run()
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Extension request failed.' }));
  return true;
});

globalThis.GraphTrainerBackgroundInternals = {
  publicSession,
  responsePayload
};
