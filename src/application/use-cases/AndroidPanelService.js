// Application service for the "Android App" panel in Provider Studio.
//
// Reads the telemetry uploaded by the Android app (graph_app_users,
// graph_prompts, graph_exec_logs) and manages the single-row distributed
// client config (graph_client_config) that every installation downloads on
// startup. All reads/writes go through the shared server-side
// SupabaseRestClient (service role) — clients can only INSERT/UPDATE via RLS,
// so this backend is the only reader of telemetry.

const MASK_PREFIX = '••••'; // "••••"
const KEY_FIELDS = ['openai_key', 'gemini_key', 'deepgram_key'];
const ALLOWED_PROVIDERS = ['OPENAI', 'GEMINI'];
// In-memory join cap for the users list: enough for the panel's aggregate
// (prompt count + last prompt) without unbounded payloads.
const USERS_PROMPT_JOIN_LIMIT = 5000;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function maskKey(value) {
  const key = `${value == null ? '' : value}`.trim();
  if (!key) {
    return '';
  }
  return `${MASK_PREFIX}${key.slice(-4)}`;
}

// A key coming back from the form is "untouched" when it is empty or still
// contains the mask bullets we sent down — in both cases the stored value wins.
function isEmptyOrMasked(value) {
  const key = `${value == null ? '' : value}`.trim();
  return !key || key.includes('•');
}

function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(`${value}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function requireId(value, label) {
  const id = `${value == null ? '' : value}`.trim();
  if (!id) {
    throw badRequest(`Falta ${label}.`);
  }
  return encodeURIComponent(id);
}

class AndroidPanelService {
  constructor(supabaseRestClient) {
    if (!supabaseRestClient) {
      throw new Error('AndroidPanelService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
  }

  // Users plus prompt aggregates (count + latest prompt), joined in memory
  // from two REST queries.
  async listUsers() {
    const [users, prompts] = await Promise.all([
      this.supabase.select('graph_app_users', 'select=*&order=last_seen_at.desc'),
      this.supabase.select(
        'graph_prompts',
        `select=device_id,prompt,status,started_at&order=started_at.desc&limit=${USERS_PROMPT_JOIN_LIMIT}`
      )
    ]);

    const statsByDevice = new Map();
    (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
      const entry = statsByDevice.get(prompt.device_id) || { count: 0, last: null };
      entry.count += 1;
      if (!entry.last) {
        entry.last = prompt; // prompts arrive sorted by started_at desc
      }
      statsByDevice.set(prompt.device_id, entry);
    });

    return (Array.isArray(users) ? users : []).map((user) => {
      const stats = statsByDevice.get(user.device_id) || { count: 0, last: null };
      return {
        ...user,
        prompt_count: stats.count,
        last_prompt: stats.last
      };
    });
  }

  async listPrompts(deviceId, limit = 100) {
    const id = requireId(deviceId, 'deviceId');
    const cappedLimit = clampLimit(limit, 100, 500);
    const rows = await this.supabase.select(
      'graph_prompts',
      `select=*&device_id=eq.${id}&order=started_at.desc&limit=${cappedLimit}`
    );
    return Array.isArray(rows) ? rows : [];
  }

  async getPromptLogs(promptId) {
    const id = requireId(promptId, 'promptId');
    const rows = await this.supabase.select(
      'graph_exec_logs',
      `select=*&prompt_id=eq.${id}&order=id.asc`
    );
    return Array.isArray(rows) ? rows : [];
  }

  // Latest device logs (including loose lines without prompt_id), returned in
  // chronological order for terminal-style rendering.
  async getDeviceLogs(deviceId, limit = 300) {
    const id = requireId(deviceId, 'deviceId');
    const cappedLimit = clampLimit(limit, 300, 1000);
    const rows = await this.supabase.select(
      'graph_exec_logs',
      `select=*&device_id=eq.${id}&order=id.desc&limit=${cappedLimit}`
    );
    return (Array.isArray(rows) ? rows : []).reverse();
  }

  async readConfigRow() {
    const rows = await this.supabase.select('graph_client_config', 'select=*&id=eq.1&limit=1');
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // Masked view for the Studio UI: keys show only their last 4 chars; the
  // defaults are returned as-is (they are not secrets).
  async getClientConfig() {
    const row = (await this.readConfigRow()) || {};
    return {
      openai_key: maskKey(row.openai_key),
      gemini_key: maskKey(row.gemini_key),
      deepgram_key: maskKey(row.deepgram_key),
      default_provider: row.default_provider || 'OPENAI',
      default_openai_model: row.default_openai_model || '',
      default_gemini_model: row.default_gemini_model || '',
      updated_at: row.updated_at || null
    };
  }

  // Upserts the single row (id=1). Keys arriving empty or still masked are
  // NOT overwritten: the stored value is preserved.
  async updateClientConfig(patch = {}) {
    const next = {};

    KEY_FIELDS.forEach((field) => {
      if (!isEmptyOrMasked(patch[field])) {
        next[field] = `${patch[field]}`.trim();
      }
    });

    const provider = `${patch.default_provider == null ? '' : patch.default_provider}`.trim().toUpperCase();
    if (provider) {
      if (!ALLOWED_PROVIDERS.includes(provider)) {
        throw badRequest(`default_provider invalido: usa ${ALLOWED_PROVIDERS.join(' o ')}.`);
      }
      next.default_provider = provider;
    }

    ['default_openai_model', 'default_gemini_model'].forEach((field) => {
      const value = `${patch[field] == null ? '' : patch[field]}`.trim();
      if (value) {
        next[field] = value;
      }
    });

    next.updated_at = new Date().toISOString();

    const current = await this.readConfigRow();
    if (current) {
      await this.supabase.update('graph_client_config', 'id=eq.1', next);
    } else {
      await this.supabase.insert('graph_client_config', { id: 1, ...next });
    }

    return this.getClientConfig();
  }
}

module.exports = AndroidPanelService;
