// Verifies Supabase access tokens (JWT) locally against the project's JWKS.
// The project signs tokens with an asymmetric key (ES256), so we can verify
// offline with `jose` — no per-request call to Supabase and no service key.
const crypto = require('crypto');

let jwks = null;
let joseModulePromise = null;
const LOCAL_ANONYMOUS_TOKEN_PREFIX = 'miracle-local-v1';
const LOCAL_ANONYMOUS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const localAnonymousSecret = crypto.randomBytes(32);
const TEMPORARY_AUTH_BYPASS_HOSTS = new Set([
  'miracle-zeta.vercel.app',
  'miracle-git-codex-remove-0bdc53-jose-david-s-projects-22dd4300.vercel.app'
]);

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

function normalizeHost(value = '') {
  return `${value || ''}`.trim().toLowerCase().replace(/:\d+$/, '');
}

function isTemporaryBypassHost(host = '') {
  return TEMPORARY_AUTH_BYPASS_HOSTS.has(normalizeHost(host));
}

function runtimeCandidateHosts() {
  return [
    process.env.PUBLIC_BASE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL
  ].map((value) => {
    if (!value) return '';
    try {
      const normalized = `${value}`.includes('://') ? `${value}` : `https://${value}`;
      return new URL(normalized).host;
    } catch (error) {
      return `${value || ''}`;
    }
  });
}

function isAuthBypassEnabled(req = null) {
  if (isTruthyEnv('TEMPORARY_DISABLE_AUTH')) {
    return true;
  }

  if (req) {
    const requestHost = req.get ? req.get('host') : req.headers?.host;
    if (isTemporaryBypassHost(requestHost)) {
      return true;
    }
  }

  return runtimeCandidateHosts().some((host) => isTemporaryBypassHost(host));
}

function isLocalAnonymousAccessEnabled() {
  return isTruthyEnv('ALLOW_LOCAL_ANONYMOUS')
    && `${process.env.NODE_ENV || ''}`.trim().toLowerCase() !== 'production';
}

function signLocalAnonymousBody(encodedBody) {
  return crypto.createHmac('sha256', localAnonymousSecret).update(encodedBody).digest('base64url');
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
    email: payload.email || '',
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
  const canManageGlobalWorkflows = adminIds.has(ownerId)
    || adminEmails.has(normalizeEmail(req.user?.email || ''))
    || (isLocalDevUser && isTruthyEnv('ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN'));

  req.workflowAccess = {
    ownerId,
    includeGlobal: true,
    canManageGlobalWorkflows
  };
  next();
}

module.exports = {
  requireAuth,
  requireAccountAuth,
  attachWorkflowAccess,
  verifySupabaseToken,
  verifyAccessToken,
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
