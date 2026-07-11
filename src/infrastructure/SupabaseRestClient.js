// Thin server-side client for the Supabase Data API (PostgREST).
// Uses the service role key: server-only, never expose it to the frontend.
class SupabaseRestClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.supabaseUrl = `${options.supabaseUrl
      || process.env.SUPABASE_URL
      || process.env.PUBLIC_SUPABASE_URL
      || ''}`.trim().replace(/\/+$/, '');
    this.serviceRoleKey = `${options.serviceRoleKey
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SECRET_KEY
      || ''}`.trim();
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.serviceRoleKey);
  }

  requireConfig() {
    if (!this.isConfigured()) {
      const error = new Error('Supabase no está configurado en el servidor.');
      error.code = 'SUPABASE_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
  }

  async request(path, init = {}) {
    this.requireConfig();
    const response = await this.fetchImpl(`${this.supabaseUrl}/rest/v1${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
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
      const message = body?.message || body?.error || (typeof body === 'string' ? body : '')
        || `Supabase request failed (${response.status}).`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.supabaseCode = body?.code || '';
      throw error;
    }

    return body;
  }

  select(table, query = '') {
    return this.request(`/${table}?${query}`, {
      headers: { Accept: 'application/json' }
    });
  }

  async insert(table, row, query = '') {
    const body = await this.request(`/${table}${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    });
    return Array.isArray(body) ? body[0] : body;
  }

  async update(table, query, patch) {
    const body = await this.request(`/${table}?${query}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(patch)
    });
    return Array.isArray(body) ? body[0] : body;
  }
}

module.exports = SupabaseRestClient;
