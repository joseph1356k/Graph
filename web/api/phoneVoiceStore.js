const crypto = require('crypto');

const PHONE_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_EVENTS_PER_POLL = 50;

function normalizeBaseUrl(value) {
  return `${value || ''}`.replace(/\/+$/, '');
}

function getServiceRoleKey() {
  return `${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''}`.trim();
}

function getSupabaseUrl() {
  return normalizeBaseUrl(process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(`${token || ''}`).digest('base64url');
}

function randomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function normalizeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  return fallback;
}

function requireStoreConfig() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error('Supabase service role is required for phone microphone pairing.');
    error.statusCode = 503;
    throw error;
  }
  return { supabaseUrl, serviceRoleKey };
}

async function supabaseRestRequest(path, init = {}) {
  const { supabaseUrl, serviceRoleKey } = requireStoreConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text;
    }
  }
  if (!response.ok) {
    const message = body?.message || body?.error || text || `Supabase request failed (${response.status}).`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function publicSession(row = {}) {
  return {
    id: `${row.id || ''}`,
    ownerId: `${row.owner_id || ''}`,
    ownerEmail: `${row.owner_email || ''}`,
    context: normalizeJson(row.context, {}),
    history: Array.isArray(row.history) ? row.history : [],
    expiresAt: row.expires_at || ''
  };
}

async function createPhoneVoiceSession({ requestedId = '', ownerId = '', ownerEmail = '', context = {}, history = [] }) {
  if (!`${ownerId || ''}`.trim()) {
    const error = new Error('Authenticated user is required for phone microphone pairing.');
    error.statusCode = 401;
    throw error;
  }
  const id = /^[a-zA-Z0-9_-]{12,120}$/.test(`${requestedId || ''}`)
    ? `${requestedId}`.trim()
    : `phone_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const token = randomToken();
  const now = Date.now();
  const expiresAt = new Date(now + PHONE_SESSION_TTL_MS).toISOString();
  const row = {
    id,
    token_hash: hashToken(token),
    owner_id: ownerId,
    owner_email: ownerEmail || null,
    context: normalizeJson(context, {}),
    history: Array.isArray(history) ? history.slice(-10) : [],
    expires_at: expiresAt,
    last_seen_at: new Date(now).toISOString()
  };

  await supabaseRestRequest('/phone_voice_sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });

  await appendPhoneVoiceEvent({
    sessionId: id,
    source: 'system',
    type: 'phone_waiting',
    payload: { type: 'phone_waiting', status: 'Esperando que el telefono se conecte por QR.' }
  });

  return {
    id,
    token,
    expiresAt
  };
}

async function getSessionRow(sessionId) {
  const id = `${sessionId || ''}`.trim();
  if (!id) {
    const error = new Error('Missing phone session id.');
    error.statusCode = 400;
    throw error;
  }
  const query = `/phone_voice_sessions?id=eq.${encodeURIComponent(id)}&select=*`;
  const rows = await supabaseRestRequest(query, {
    headers: { Accept: 'application/json' }
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    const error = new Error('Phone microphone session not found.');
    error.statusCode = 404;
    throw error;
  }
  if (Date.parse(row.expires_at || '') <= Date.now()) {
    const error = new Error('Phone microphone session expired.');
    error.statusCode = 410;
    throw error;
  }
  return row;
}

async function getPhoneVoiceSessionForOwner(sessionId, ownerId) {
  const row = await getSessionRow(sessionId);
  if (`${row.owner_id || ''}` !== `${ownerId || ''}`) {
    const error = new Error('Phone microphone session is not owned by this account.');
    error.statusCode = 403;
    throw error;
  }
  return publicSession(row);
}

async function verifyPhoneVoiceToken(sessionId, token) {
  const row = await getSessionRow(sessionId);
  const expected = Buffer.from(`${row.token_hash || ''}`);
  const actual = Buffer.from(hashToken(token));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const error = new Error('Invalid phone microphone token.');
    error.statusCode = 401;
    throw error;
  }

  await supabaseRestRequest(`/phone_voice_sessions?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ last_seen_at: new Date().toISOString() })
  });

  return publicSession(row);
}

async function appendPhoneVoiceEvent({ sessionId, source = 'phone', type = '', payload = {} }) {
  const eventType = `${type || payload?.type || ''}`.trim();
  if (!eventType) {
    const error = new Error('Missing phone voice event type.');
    error.statusCode = 400;
    throw error;
  }
  const row = {
    session_id: `${sessionId || ''}`.trim(),
    source: `${source || 'phone'}`.trim(),
    type: eventType,
    payload: normalizeJson(payload, { type: eventType })
  };
  const body = await supabaseRestRequest('/phone_voice_events?select=id,source,type,payload,created_at', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  return Array.isArray(body) ? body[0] : body;
}

async function listPhoneVoiceEvents(sessionId, afterId = 0) {
  const normalizedAfterId = Math.max(0, Number(afterId) || 0);
  const query = [
    `/phone_voice_events?session_id=eq.${encodeURIComponent(`${sessionId || ''}`)}`,
    `id=gt.${normalizedAfterId}`,
    'select=id,source,type,payload,created_at',
    'order=id.asc',
    `limit=${MAX_EVENTS_PER_POLL}`
  ].join('&');
  const rows = await supabaseRestRequest(query, {
    headers: { Accept: 'application/json' }
  });
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  PHONE_SESSION_TTL_MS,
  createPhoneVoiceSession,
  getPhoneVoiceSessionForOwner,
  verifyPhoneVoiceToken,
  appendPhoneVoiceEvent,
  listPhoneVoiceEvents
};
