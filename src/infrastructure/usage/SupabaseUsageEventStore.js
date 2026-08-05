// Persistencia del ledger de consumo.
//
// PRIMARIO: Postgres vía PostgREST con service-role. Es el único almacenamiento
// compartido entre invocaciones de Vercel; el JSONL anterior vivía en /tmp, que
// es por-lambda y efímero — de ahí que el dashboard leyera siempre cero.
//
// RESPALDO: el JSONL se conserva para desarrollo local sin Supabase y como red
// de seguridad si la escritura remota falla. No se borró el UsageLedgerStore:
// sigue siendo útil y quitarlo no aporta nada.
//
// IDEMPOTENCIA: el insert usa `on_conflict=idempotency_key` con
// `resolution=ignore-duplicates`. Reescribir el mismo evento es entonces un
// no-op silencioso en vez de un duplicado o un 409 que haya que interpretar.

const { toDatabaseRow } = require('../../domain/usage/UsageEvent');

class SupabaseUsageEventStore {
  constructor(options = {}) {
    this.supabase = options.supabaseClient || null;
    this.fallbackStore = options.fallbackStore || null;
    this.logger = options.logger || console;
    // Métricas de la propia telemetría. Sin esto, un fallo de escritura sería
    // invisible: el dashboard mostraría menos consumo y nadie sabría por qué.
    this.stats = {
      written: 0,
      duplicates: 0,
      failed: 0,
      fallbackWrites: 0,
      lastError: ''
    };
  }

  isRemoteReady() {
    return Boolean(this.supabase?.isConfigured?.());
  }

  /**
   * Escribe un evento. Nunca lanza: perder un evento es malo, pero tumbar la
   * llamada al modelo del usuario por un fallo de telemetría es peor.
   * Devuelve `{ ok, duplicate, storage }` para que las pruebas puedan afirmar
   * sobre el resultado en vez de deducirlo.
   */
  async append(event) {
    const row = toDatabaseRow(event);

    if (this.isRemoteReady()) {
      try {
        const inserted = await this.supabase.request(
          '/ai_usage_events?on_conflict=idempotency_key',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // ignore-duplicates: el segundo intento del mismo evento no
              // duplica ni falla. return=representation para saber si entró.
              Prefer: 'resolution=ignore-duplicates,return=representation'
            },
            body: JSON.stringify([row])
          }
        );
        const duplicate = !Array.isArray(inserted) || inserted.length === 0;
        if (duplicate) {
          this.stats.duplicates += 1;
        } else {
          this.stats.written += 1;
        }
        return {
          ok: true,
          duplicate,
          storage: 'supabase',
          id: Array.isArray(inserted) && inserted[0] ? inserted[0].id : null
        };
      } catch (error) {
        this.stats.failed += 1;
        this.stats.lastError = `${error.message || error}`.slice(0, 300);
        this.logger.warn?.(`[Usage] Fallo al persistir en Supabase: ${this.stats.lastError}`);
        // Cae al respaldo en vez de perder el evento.
      }
    }

    if (this.fallbackStore) {
      try {
        this.fallbackStore.append({ ...event, _storage: 'fallback-jsonl' });
        this.stats.fallbackWrites += 1;
        return { ok: true, duplicate: false, storage: 'jsonl' };
      } catch (error) {
        this.stats.failed += 1;
        this.stats.lastError = `${error.message || error}`.slice(0, 300);
      }
    }

    return { ok: false, duplicate: false, storage: 'none' };
  }

  /** Llamada a una RPC de agregación con service-role (operador interno). */
  async callRpc(name, params = {}) {
    if (!this.isRemoteReady()) {
      const error = new Error('Supabase no está configurado en el servidor.');
      error.code = 'SUPABASE_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    return this.supabase.request(`/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  }

  /**
   * Igual que `callRpc` pero ejecutando como el usuario final: se envía su JWT
   * en vez de la service-role, para que las políticas y el alcance de la base
   * decidan qué puede ver. Es el camino seguro para el portal.
   */
  async callRpcAsUser(name, params = {}, accessToken = '') {
    if (!this.isRemoteReady()) {
      const error = new Error('Supabase no está configurado en el servidor.');
      error.code = 'SUPABASE_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    if (!accessToken) {
      const error = new Error('Falta el token de acceso del usuario.');
      error.statusCode = 401;
      throw error;
    }
    return this.supabase.request(`/rpc/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Sobrescribe el Bearer de service-role: PostgREST evalúa RLS con este
        // token, así que el aislamiento lo aplica Postgres y no este proceso.
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(params)
    });
  }

  getStats() {
    return { ...this.stats, remoteReady: this.isRemoteReady() };
  }
}

module.exports = SupabaseUsageEventStore;
