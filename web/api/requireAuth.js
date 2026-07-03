// Verifies Supabase access tokens (JWT) locally against the project's JWKS.
// The project signs tokens with an asymmetric key (ES256), so we can verify
// offline with `jose` — no per-request call to Supabase and no service key.
const crypto = require('crypto');

let jwks = null;
let joseModulePromise = null;
const LOCAL_ANONYMOUS_TOKEN_PREFIX = 'miracle-local-v1';
const LOCAL_ADMIN_TOKEN_PREFIX = 'miracle-local-admin-v1';
const LOCAL_ANONYMOUS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const LOCAL_ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const localAnonymousSecret = crypto
  .createHash('sha256')
  .update('miracle-local-anonymous-session-v1')
  .digest();
const localAdminSecret = crypto
  .createHash('sha256')
  .update(process.env.LOCAL_ADMIN_SECRET
    || 'miracle-local-admin-session-v1::Miracle.AI::FelipeMaldonado::Isaabelsofia::Jamesbondagent007-max::JoseDavid')
  .digest();
const LOCAL_ADMIN_USERS = parseEnvList('LOCAL_ADMIN_USERS').length
  ? parseEnvList('LOCAL_ADMIN_USERS')
  : [
      'Isaabelsofia',
      'Jamesbondagent007-max',
      'FelipeMaldonado',
      'JoseDavid'
    ];
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || 'Miracle.AI';

function supabaseBaseUrl() {
  return `${process.env.SUPABASE_URL || ''}`.replace(/\/+$/, '');
}

function getJoseModule() {
  if (!joseModulePromise) {
    joseModulePromise = import('jose');
  }
  return joseModulePromise;
}

function isSupabaseAuthConfigured() {
  return Boolean(supabaseBaseUrl());
}

function isProductionRuntime() {
  return Boolean(process.env.VERCEL)
    || `${process.env.NODE_ENV || ''}`.trim().toLowerCase() === 'production';
}

function parseEnvList(name) {
  return `${process.env[name] || ''}`
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeEmail(value = '') {
  return `${value || ''}`.trim().toLowerCase();
}

function isTruthyEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(`${process.env[name] || ''}`.trim().toLowerCase());
}

function parseCookieHeader(header = '') {
  return `${header || ''}`
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((accumulator, segment) => {
      const separatorIndex = segment.indexOf('=');
      if (separatorIndex <= 0) {
        return accumulator;
      }
      const key = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      if (key) {
        accumulator[key] = decodeURIComponent(value);
      }
      return accumulator;
    }, {});
}

function normalizeUsername(value = '') {
  return `${value || ''}`.trim().toLowerCase();
}

function isAuthBypassEnabled(req = null) {
  return isTruthyEnv('TEMPORARY_DISABLE_AUTH');
}

function isLocalAnonymousAccessEnabled() {
  return isTruthyEnv('ALLOW_LOCAL_ANONYMOUS')
    && `${process.env.NODE_ENV || ''}`.trim().toLowerCase() !== 'production';
}

function signLocalAnonymousBody(encodedBody) {
  return crypto.createHmac('sha256', localAnonymousSecret).update(encodedBody).digest('base64url');
}

function signLocalAdminBody(encodedBody) {
  return crypto.createHmac('sha256', localAdminSecret).update(encodedBody).digest('base64url');
}

function resolveLocalAdminUser(username = '') {
  const normalized = normalizeUsername(username);
  return LOCAL_ADMIN_USERS.find((candidate) => normalizeUsername(candidate) === normalized) || '';
}

function createLocalAdminPayload(username) {
  const canonicalUsername = resolveLocalAdminUser(username);
  if (!canonicalUsername) {
    const error = new Error('Usuario no autorizado.');
    error.code = 'LOCAL_ADMIN_UNKNOWN_USER';
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'miracle-local-admin',
    aud: 'authenticated',
    sub: `local-admin:${normalizeUsername(canonicalUsername)}`,
    username: canonicalUsername,
    email: canonicalUsername,
    role: 'local-admin',
    is_anonymous: false,
    iat: now,
    exp: now + LOCAL_ADMIN_TOKEN_TTL_SECONDS
  };
}

function createLocalAdminSession(username, password) {
  if (`${password || ''}` !== LOCAL_ADMIN_PASSWORD) {
    const error = new Error('Credenciales invalidas.');
    error.code = 'LOCAL_ADMIN_INVALID_PASSWORD';
    throw error;
  }

  const payload = createLocalAdminPayload(username);
  const encodedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    accessToken: `${LOCAL_ADMIN_TOKEN_PREFIX}.${encodedBody}.${signLocalAdminBody(encodedBody)}`,
    expiresAt: payload.exp * 1000,
    user: {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      is_anonymous: false
    }
  };
}

function createLocalAnonymousSession() {
  if (!isLocalAnonymousAccessEnabled()) {
    const error = new Error('local anonymous access is disabled');
    error.code = 'LOCAL_ANONYMOUS_DISABLED';
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'miracle-local',
    aud: 'authenticated',
    sub: `local-anonymous-${crypto.randomUUID()}`,
    role: 'local-anonymous',
    is_anonymous: true,
    iat: now,
    exp: now + LOCAL_ANONYMOUS_TOKEN_TTL_SECONDS
  };
  const encodedBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    accessToken: `${LOCAL_ANONYMOUS_TOKEN_PREFIX}.${encodedBody}.${signLocalAnonymousBody(encodedBody)}`,
    expiresAt: payload.exp * 1000,
    user: {
      id: payload.sub,
      email: '',
      role: payload.role,
      is_anonymous: true
    }
  };
}

function verifyLocalAnonymousToken(token) {
  if (!isLocalAnonymousAccessEnabled()) {
    throw new Error('local anonymous access is disabled');
  }

  const parts = `${token || ''}`.split('.');
  if (parts.length !== 3 || parts[0] !== LOCAL_ANONYMOUS_TOKEN_PREFIX) {
    throw new Error('invalid local anonymous token');
  }
  const expected = Buffer.from(signLocalAnonymousBody(parts[1]));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('invalid local anonymous signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('invalid local anonymous payload');
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'miracle-local'
    || payload.aud !== 'authenticated'
    || payload.role !== 'local-anonymous'
    || payload.is_anonymous !== true
    || !payload.sub
    || !Number.isFinite(payload.exp)
    || payload.exp <= now) {
    throw new Error('expired or invalid local anonymous token');
  }
  return payload;
}

function verifyLocalAdminToken(token) {
  const parts = `${token || ''}`.split('.');
  if (parts.length !== 3 || parts[0] !== LOCAL_ADMIN_TOKEN_PREFIX) {
    throw new Error('invalid local admin token');
  }
  const expected = Buffer.from(signLocalAdminBody(parts[1]));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('invalid local admin signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('invalid local admin payload');
  }
  const now = Math.floor(Date.now() / 1000);
  const canonicalUsername = resolveLocalAdminUser(payload.username);
  if (payload.iss !== 'miracle-local-admin'
    || payload.aud !== 'authenticated'
    || payload.role !== 'local-admin'
    || payload.is_anonymous !== false
    || !payload.sub
    || !canonicalUsername
    || !Number.isFinite(payload.exp)
    || payload.exp <= now) {
    throw new Error('expired or invalid local admin token');
  }
  payload.username = canonicalUsername;
  payload.email = canonicalUsername;
  return payload;
}

async function getJwks() {
  if (jwks) return jwks;
  const base = supabaseBaseUrl();
  if (!base) return null;
  const { createRemoteJWKSet } = await getJoseModule();
  jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

function getIssuer() {
  return `${supabaseBaseUrl()}/auth/v1`;
}

function extractToken(req) {
  const header = (req.get ? req.get('authorization') : req.headers?.authorization) || '';
  const match = /^Bearer\s+(.+)$/i.exec(`${header}`.trim());
  if (match) return match[1].trim();
  const cookies = parseCookieHeader(req.get ? req.get('cookie') : req.headers?.cookie);
  if (cookies.miracle_admin_session) {
    return cookies.miracle_admin_session.trim();
  }
  // Fallback for WebSocket upgrades, which cannot set headers from the browser.
  try {
    const url = new URL(req.url, 'http://localhost');
    return (url.searchParams.get('access_token') || '').trim();
  } catch (error) {
    return '';
  }
}

function isSupabasePayloadAnonymous(payload = {}) {
  if (payload.is_anonymous === true) {
    return true;
  }
  const provider = `${payload.app_metadata?.provider || payload.user_metadata?.provider || ''}`.trim().toLowerCase();
  if (provider === 'anonymous') {
    return true;
  }
  const providers = payload.app_metadata?.providers;
  return Array.isArray(providers) && providers.map((value) => `${value || ''}`.trim().toLowerCase()).includes('anonymous');
}

function setRequestUser(req, payload, token) {
  req.user = {
    id: payload.sub,
    email: payload.email || payload.username || '',
    username: payload.username || '',
    role: payload.role || '',
    token,
    isAnonymous: isSupabasePayloadAnonymous(payload)
  };
}

// Verifies a raw token string. Returns the JWT payload (sub = user id, email, role...).
async function verifySupabaseToken(token) {
  if (!token) {
    throw new Error('missing token');
  }
  const [keySet, { jwtVerify }] = await Promise.all([
    getJwks(),
    getJoseModule()
  ]);
  if (!keySet) {
    const error = new Error('auth not configured (missing SUPABASE_URL)');
    error.code = 'AUTH_NOT_CONFIGURED';
    throw error;
  }
  const { payload } = await jwtVerify(token, keySet, {
    issuer: getIssuer(),
    audience: 'authenticated'
  });
  return payload;
}

async function verifyAccessToken(token) {
  if (`${token || ''}`.startsWith(`${LOCAL_ANONYMOUS_TOKEN_PREFIX}.`)) {
    return verifyLocalAnonymousToken(token);
  }
  if (`${token || ''}`.startsWith(`${LOCAL_ADMIN_TOKEN_PREFIX}.`)) {
    return verifyLocalAdminToken(token);
  }
  return verifySupabaseToken(token);
}

function requireSupabaseAuth(req, res, next, options = {}) {
  if (isAuthBypassEnabled(req)) {
    req.user = { id: 'local-dev-user', email: '', role: 'local-dev', token: '', isAnonymous: false };
    return next();
  }

  if (!isSupabaseAuthConfigured()) {
    if (isProductionRuntime()) {
      return res.status(503).json({ error: 'Autenticacion no configurada en el servidor.' });
    }
    req.user = { id: 'local-dev-user', email: '', role: 'local-dev', token: '', isAnonymous: false };
    return next();
  }

  const token = extractToken(req);
  verifyAccessToken(token)
    .then((payload) => {
      if (!options.allowAnonymous && isSupabasePayloadAnonymous(payload)) {
        return res.status(401).json({ error: 'Se requiere iniciar sesion con Google.' });
      }
      setRequestUser(req, payload, token);
      next();
    })
    .catch((error) => {
      if (error.code === 'AUTH_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Autenticación no configurada en el servidor.' });
      }
      res.status(401).json({ error: 'No autorizado.' });
    });
}

// Express middleware: requires a valid Supabase session when auth is configured.
// If Supabase is absent, degrade to a local anonymous user so the app remains usable.
function requireAuth(req, res, next) {
  return requireSupabaseAuth(req, res, next, { allowAnonymous: true });
}

function requireAccountAuth(req, res, next) {
  return requireSupabaseAuth(req, res, next, { allowAnonymous: false });
}

function attachWorkflowAccess(req, res, next) {
  const ownerId = `${req.user?.id || ''}`.trim();
  if (!ownerId) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const adminIds = new Set(parseEnvList('GLOBAL_WORKFLOW_ADMIN_IDS'));
  const adminEmails = new Set(parseEnvList('GLOBAL_WORKFLOW_ADMIN_EMAILS').map(normalizeEmail));
  const isLocalDevUser = ownerId === 'local-dev-user'
    && (!isSupabaseAuthConfigured() || isAuthBypassEnabled(req));
  const isLocalAdminUser = `${req.user?.role || ''}`.trim() === 'local-admin';
  const canManageGlobalWorkflows = adminIds.has(ownerId)
    || adminEmails.has(normalizeEmail(req.user?.email || ''))
    || isLocalAdminUser
    || (isLocalDevUser && isTruthyEnv('ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN'));

  req.workflowAccess = {
    ownerId,
    includeGlobal: true,
    canManageGlobalWorkflows
  };
  next();
}

// ---- API keys for external client apps (permanent, env-provided) ----
// MIRACLE_API_KEYS = "label1:key1,label2:key2"  (or just "key1,key2")
function getConfiguredApiKeys() {
  return parseEnvList('MIRACLE_API_KEYS')
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex > 0) {
        return { label: entry.slice(0, separatorIndex).trim() || 'client', key: entry.slice(separatorIndex + 1).trim() };
      }
      return { label: 'client', key: entry.trim() };
    })
    .filter((entry) => entry.key);
}

function extractApiKey(req) {
  const headerKey = (req.get ? req.get('x-api-key') : req.headers?.['x-api-key']) || '';
  if (`${headerKey}`.trim()) {
    return `${headerKey}`.trim();
  }
  return extractToken(req);
}

function verifyApiKey(candidate) {
  const provided = Buffer.from(`${candidate || ''}`);
  for (const entry of getConfiguredApiKeys()) {
    const expected = Buffer.from(entry.key);
    if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
      return entry;
    }
  }
  return null;
}

// Auth for the public /api/v1 surface: a permanent client API key
// (from MIRACLE_API_KEYS) OR a normal account session token.
function requireApiKeyOrAccount(req, res, next) {
  const candidate = extractApiKey(req);
  const match = candidate ? verifyApiKey(candidate) : null;
  if (match) {
    req.user = {
      id: `api-client:${match.label}`,
      email: '',
      username: match.label,
      role: 'api-client',
      token: '',
      isAnonymous: false
    };
    req.apiClient = { label: match.label };
    req.workflowAccess = { ownerId: req.user.id, includeGlobal: true, canManageGlobalWorkflows: false };
    return next();
  }
  return requireAccountAuth(req, res, () => attachWorkflowAccess(req, res, next));
}

module.exports = {
  requireAuth,
  requireAccountAuth,
  requireApiKeyOrAccount,
  attachWorkflowAccess,
  verifySupabaseToken,
  verifyAccessToken,
  createLocalAdminSession,
  verifyLocalAdminToken,
  createLocalAnonymousSession,
  verifyLocalAnonymousToken,
  extractToken,
  isSupabaseAuthConfigured,
  isProductionRuntime,
  isSupabasePayloadAnonymous,
  isLocalAnonymousAccessEnabled,
  isAuthBypassEnabled,
  parseEnvList,
  isTruthyEnv
};
