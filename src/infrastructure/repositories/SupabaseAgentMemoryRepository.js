// Memoria durable por usuario del agente de escritorio (Ü): la knowledge-base
// personal que el cerebro inyecta en cada turno y que la enseñanza por video
// alimenta. Sustituye al InMemoryMemoryStore del backend viejo, que se perdía
// en cada cold start de Vercel.
//
// Persistencia: tabla `graph_agent_memory` en Supabase (una fila por usuario,
// memoria completa como JSONB { "app": ["nota", ...] }). Ver la migración
// supabase/migrations/20260720100000_agent_memory.sql. Si Supabase no está
// configurado (o falla), cae a un Map en memoria del proceso: mismo
// comportamiento degradado que tenía el backend original, para que el turno
// del agente nunca muera por la memoria.
class SupabaseAgentMemoryRepository {
  static TABLE = 'graph_agent_memory';

  constructor(supabaseRestClient) {
    this.client = supabaseRestClient || null;
    // Fallback en memoria: userKey -> { app: [notas] }. Se usa cuando Supabase
    // no está configurado o cuando una llamada concreta falla.
    this.fallback = new Map();
  }

  useSupabase() {
    return Boolean(this.client && this.client.isConfigured && this.client.isConfigured());
  }

  /** Lee la memoria completa de un usuario como { app: [notas] }. */
  async loadMemory(userKey) {
    if (this.useSupabase()) {
      try {
        const rows = await this.client.select(
          SupabaseAgentMemoryRepository.TABLE,
          `user_key=eq.${encodeURIComponent(userKey)}&select=memory&limit=1`
        );
        const memory = Array.isArray(rows) && rows[0] ? rows[0].memory : null;
        if (memory && typeof memory === 'object') return memory;
        return {};
      } catch (error) {
        console.error(`[AgentMemory] lectura Supabase falló (${error.message}); usando memoria del proceso.`);
      }
    }
    return this.fallback.get(userKey) || {};
  }

  /**
   * Notas durables del usuario, ya formateadas para el prompt (agrupadas por
   * app). "" si no hay. Mismo formato que InMemoryMemoryStore.forPrompt del
   * backend viejo — el prompt del cerebro depende de esta forma.
   */
  async forPrompt(userId) {
    const memory = await this.loadMemory(userId);
    const apps = Object.keys(memory);
    if (apps.length === 0) return '';
    let out = '';
    for (const app of apps) {
      const notes = Array.isArray(memory[app]) ? memory[app] : [];
      out += `\n### ${app}\n`;
      for (const note of notes) out += `- ${note}\n`;
    }
    return out.trim();
  }

  /** Guarda una nota durable (p.ej. "el botón 'Nuevo ingreso' admite pacientes"). */
  async remember(userId, app, note) {
    const key = `${app || ''}`; // "" agrupa las notas generales
    const memory = await this.loadMemory(userId);
    const notes = Array.isArray(memory[key]) ? memory[key] : [];
    notes.push(note);
    memory[key] = notes;

    if (this.useSupabase()) {
      try {
        // Upsert por user_key (PostgREST: on_conflict + resolution=merge-duplicates).
        await this.client.request(
          `/${SupabaseAgentMemoryRepository.TABLE}?on_conflict=user_key`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify({
              user_key: userId,
              memory,
              updated_at: new Date().toISOString()
            })
          }
        );
        return;
      } catch (error) {
        console.error(`[AgentMemory] escritura Supabase falló (${error.message}); guardando en memoria del proceso.`);
      }
    }
    this.fallback.set(userId, memory);
  }
}

module.exports = SupabaseAgentMemoryRepository;
