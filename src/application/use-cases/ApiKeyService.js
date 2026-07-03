const crypto = require('crypto');
const VercelProjectEnvService = require('./VercelProjectEnvService');

// Manages the permanent client API keys for /api/v1. Keys live in the
// MIRACLE_API_KEYS env var (`label:key,label2:key2`), written to Vercel and
// activated on the next deploy — the same storage the provider cards use.
const ENV_KEY = 'MIRACLE_API_KEYS';

function parseKeys() {
  return `${process.env[ENV_KEY] || ''}`
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex > 0) {
        return { label: entry.slice(0, separatorIndex).trim() || 'client', key: entry.slice(separatorIndex + 1).trim() };
      }
      return { label: 'client', key: entry.trim() };
    })
    .filter((entry) => entry.key);
}

function serializeKeys(keys) {
  return keys.map((entry) => `${entry.label}:${entry.key}`).join(',');
}

function keyId(key) {
  return crypto.createHash('sha256').update(`${key}`).digest('hex').slice(0, 10);
}

function maskKey(key) {
  const value = `${key}`;
  if (value.length <= 12) {
    return `${value.slice(0, 4)}…`;
  }
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

function sanitizeLabel(value) {
  return `${value || ''}`.trim().replace(/[,:]/g, '').slice(0, 40);
}

class ApiKeyService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  status() {
    const keys = parseKeys();
    return {
      keys: keys.map((entry) => ({ id: keyId(entry.key), label: entry.label, preview: maskKey(entry.key) })),
      count: keys.length,
      storage: 'vercel-env',
      vercel: this.vercelEnvService.status()
    };
  }

  async generate(payload = {}) {
    this.vercelEnvService.assertWritable();
    const existing = parseKeys();
    const base = sanitizeLabel(payload.label) || `client-${existing.length + 1}`;
    let label = base;
    let suffix = 2;
    while (existing.some((entry) => entry.label === label)) {
      label = `${base}-${suffix}`;
      suffix += 1;
    }

    const key = `miracle_${crypto.randomBytes(24).toString('base64url')}`;
    const next = [...existing, { label, key }];
    await this.vercelEnvService.upsertProjectEnv(ENV_KEY, serializeKeys(next), { secret: true });
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return { ok: true, id: keyId(key), label, api_key: key, deployment };
  }

  async revoke(payload = {}) {
    this.vercelEnvService.assertWritable();
    const id = `${payload.id || ''}`.trim();
    const label = `${payload.label || ''}`.trim();
    if (!id && !label) {
      const error = new Error('Falta el id o el label de la API key a revocar.');
      error.statusCode = 400;
      throw error;
    }

    const existing = parseKeys();
    const next = existing.filter((entry) => {
      if (id && keyId(entry.key) === id) return false;
      if (label && entry.label === label) return false;
      return true;
    });
    if (next.length === existing.length) {
      const error = new Error('No se encontro esa API key.');
      error.statusCode = 404;
      throw error;
    }

    await this.vercelEnvService.upsertProjectEnv(ENV_KEY, serializeKeys(next), { secret: true });
    const deployment = await this.vercelEnvService.triggerRedeploy();
    return { ok: true, remaining: next.length, deployment };
  }
}

module.exports = ApiKeyService;
