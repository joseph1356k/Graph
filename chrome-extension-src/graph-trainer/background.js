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

async function getPublicConfig(backendUrl) {
  const response = await fetch(`${backendUrl}/api/public-config`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.supabaseUrl || !payload.supabaseAnonKey) {
    throw new Error(payload.error || 'Supabase no esta configurado en el backend de Miracle.');
  }
  return payload;
}

function parseSessionFromUrl(finalUrl) {
  const url = new URL(finalUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = url.searchParams;
  const read = (name) => hash.get(name) || query.get(name) || '';
  const error = read('error_description') || read('error');
  if (error) {
    throw new Error(error);
  }
  const accessToken = read('access_token');
  const refreshToken = read('refresh_token');
  const expiresIn = Number(read('expires_in') || 3600);
  if (!accessToken || !refreshToken) {
    throw new Error('Google no devolvio una sesion valida para la extension.');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
  };
}

function launchWebAuthFlow(details) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(details, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'No fue posible abrir Google.'));
        return;
      }
      if (!redirectUrl) {
        reject(new Error('Google no devolvio una URL de autenticacion.'));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

async function fetchSupabaseUser(config, accessToken) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error(payload.message || payload.error_description || 'No fue posible validar la cuenta de Google.');
  }
  return payload;
}

async function signInWithGoogle() {
  const { backendUrl } = await getSettings();
  const config = await getPublicConfig(backendUrl);
  const extensionRedirectUrl = chrome.identity.getRedirectURL('supabase');
  const webCallbackUrl = new URL('/extension-auth.html', backendUrl);
  webCallbackUrl.searchParams.set('redirect_uri', extensionRedirectUrl);

  const authorizeUrl = new URL('/auth/v1/authorize', config.supabaseUrl);
  authorizeUrl.searchParams.set('provider', 'google');
  authorizeUrl.searchParams.set('redirect_to', webCallbackUrl.toString());

  const finalUrl = await launchWebAuthFlow({ url: authorizeUrl.toString(), interactive: true });
  const session = parseSessionFromUrl(finalUrl);
  const user = await fetchSupabaseUser(config, session.accessToken);
  const stored = {
    ...session,
    user: {
      id: user.id,
      email: user.email || '',
      isAnonymous: Boolean(user.is_anonymous)
    },
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey
  };
  await storageSet(chrome.storage.local, { [AUTH_SESSION_KEY]: stored });
  return stored;
}

async function readStoredSession() {
  const result = await storageGet(chrome.storage.local, { [AUTH_SESSION_KEY]: null });
  return result[AUTH_SESSION_KEY] || null;
}

async function refreshSession(session) {
  if (!session?.refreshToken || !session?.supabaseUrl || !session?.supabaseAnonKey) {
    return null;
  }
  const response = await fetch(`${session.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: session.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    await storageRemove(chrome.storage.local, AUTH_SESSION_KEY);
    return null;
  }
  const next = {
    ...session,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
    user: {
      id: payload.user?.id || session.user?.id || '',
      email: payload.user?.email || session.user?.email || '',
      isAnonymous: Boolean(payload.user?.is_anonymous)
    }
  };
  await storageSet(chrome.storage.local, { [AUTH_SESSION_KEY]: next });
  return next;
}

async function getValidSession() {
  const session = await readStoredSession();
  if (!session) return null;
  if (Number(session.expiresAt || 0) > Date.now() + 60_000) return session;
  return refreshSession(session);
}

async function signOut() {
  const session = await readStoredSession();
  if (session?.accessToken && session?.supabaseUrl && session?.supabaseAnonKey) {
    await fetch(`${session.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: session.supabaseAnonKey,
        Authorization: `Bearer ${session.accessToken}`
      }
    }).catch(() => {});
  }
  await storageRemove(chrome.storage.local, AUTH_SESSION_KEY);
}

function publicSession(session) {
  return session ? {
    authenticated: true,
    user: session.user || null,
    expiresAt: Number(session.expiresAt || 0)
  } : {
    authenticated: false,
    user: null,
    expiresAt: 0
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
  if (!session?.accessToken) {
    return responsePayload(401, JSON.stringify({ error: 'Inicia sesion con Google desde el popup de Miracle.' }), {
      'content-type': 'application/json'
    });
  }

  const headers = new Headers(request.headers || {});
  headers.set('Authorization', `Bearer ${session.accessToken}`);

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case 'graph:auth-status':
        return publicSession(await getValidSession());
      case 'graph:auth-login':
        return publicSession(await signInWithGoogle());
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
  parseSessionFromUrl,
  publicSession,
  responsePayload
};
