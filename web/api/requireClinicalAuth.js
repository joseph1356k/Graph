// Auth for the stateful clinical module (/api/clinical/templates,
// /api/clinical/encounters). ISOLATED from the local/API-key auth in
// requireAuth.js: it verifies a Supabase user access token (JWT) offline against
// the project's JWKS and exposes the doctor identity as `req.clinicalUser`.
//
// - Does NOT touch req.user or the /api/v1 surface.
// - Does NOT use SUPABASE_SERVICE_ROLE_KEY (that stays server-only, for the
//   SupabaseRestClient persistence layer). Here we only verify USER tokens.
// - Supabase signs with an asymmetric key (ES256): verified locally via JWKS,
//   no per-request call to Supabase.
const { clinicalError } = require('../../src/application/use-cases/ClinicalErrors');

let jwks = null;
let joseModulePromise = null;

function supabaseBaseUrl() {
  return `${process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || ''}`.replace(/\/+$/, '');
}

function getJoseModule() {
  if (!joseModulePromise) {
    joseModulePromise = import('jose');
  }
  return joseModulePromise;
}

async function getJwks() {
  if (jwks) return jwks;
  const base = supabaseBaseUrl();
  if (!base) return null;
  const { createRemoteJWKSet } = await getJoseModule();
  jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

function isTruthyEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(`${process.env[name] || ''}`.trim().toLowerCase());
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

function extractBearer(req) {
  const header = (req.get ? req.get('authorization') : req.headers?.authorization) || '';
  const match = /^Bearer\s+(.+)$/i.exec(`${header}`.trim());
  return match ? match[1].trim() : '';
}

function isAnonymousPayload(payload = {}) {
  if (payload.is_anonymous === true) return true;
  const provider = `${payload.app_metadata?.provider || ''}`.trim().toLowerCase();
  if (provider === 'anonymous') return true;
  const providers = payload.app_metadata?.providers;
  return Array.isArray(providers)
    && providers.map((v) => `${v || ''}`.trim().toLowerCase()).includes('anonymous');
}

function resolveCanManageInstitutional(payload = {}) {
  const adminIds = new Set(parseEnvList('CLINICAL_ADMIN_USER_IDS'));
  const adminEmails = new Set(parseEnvList('CLINICAL_ADMIN_EMAILS').map(normalizeEmail));
  const role = `${payload.app_metadata?.clinical_role || payload.user_metadata?.clinical_role || ''}`.trim().toLowerCase();
  return adminIds.has(`${payload.sub || ''}`)
    || adminEmails.has(normalizeEmail(payload.email || ''))
    || role === 'admin';
}

async function verifySupabaseToken(token) {
  const base = supabaseBaseUrl();
  if (!base) {
    throw clinicalError('SUPABASE_NOT_CONFIGURED', 'Supabase no está configurado en el servidor.');
  }
  const [keySet, { jwtVerify }] = await Promise.all([getJwks(), getJoseModule()]);
  const { payload } = await jwtVerify(token, keySet, {
    issuer: `${base}/auth/v1`,
    audience: 'authenticated'
  });
  return payload;
}

// Express middleware guarding the stateful clinical routes.
function requireClinicalAuth(req, res, next) {
  // Local-dev escape hatch (never in production): lets the clinical flow run
  // without a Supabase login while developing. Uses a stable dev doctor uuid.
  if (isTruthyEnv('TEMPORARY_DISABLE_AUTH') && !isProductionRuntime()) {
    req.clinicalUser = {
      id: '00000000-0000-4000-8000-000000000dev',
      email: 'local-dev@clinical',
      role: 'local-dev',
      canManageInstitutional: isTruthyEnv('ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN')
    };
    return next();
  }

  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Falta el token de acceso de Supabase.' }
    });
  }

  verifySupabaseToken(token)
    .then((payload) => {
      if (isAnonymousPayload(payload)) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Se requiere una cuenta de profesional para el módulo clínico.' }
        });
      }
      req.clinicalUser = {
        id: `${payload.sub || ''}`,
        email: payload.email || '',
        role: payload.role || '',
        canManageInstitutional: resolveCanManageInstitutional(payload)
      };
      return next();
    })
    .catch((error) => {
      if (error.code === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({
          error: { code: 'SUPABASE_NOT_CONFIGURED', message: 'El módulo clínico no está configurado en este entorno.' }
        });
      }
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Token de acceso inválido o expirado.' }
      });
    });
}

module.exports = requireClinicalAuth;
module.exports.verifySupabaseToken = verifySupabaseToken;
module.exports.supabaseBaseUrl = supabaseBaseUrl;
