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
//
// SIN USUARIO NO HAY MEMORIA. Antes un cuerpo sin `userId` caía en la clave
// 'anon', que compartían todas las instalaciones que no mandaban usuario: lo
// que enseñaba una aparecía en el prompt de otra. Ahora '' y 'anon' no leen ni
// escriben (los clientes viejos que mandaban 'anon' a mano tampoco).
//
// CON TOPES. La memoria viaja en el prompt de CADA turno: se guardan como mucho
// MAX_STORED_PER_APP notas por app (las más recientes), sin repetir una que ya
// está; al prompt van las MAX_NOTES_PER_APP más recientes de cada app y el
// bloque se corta en MAX_PROMPT_CHARS.
const MAX_STORED_PER_APP = 50;
const MAX_NOTES_PER_APP = 20;
const MAX_PROMPT_CHARS = 4000;
// Una nota es una frase que le sirve a quien opere después; más larga que esto
// es un volcado (una lista de códigos), y al prompt no le cabría junto a las demás.
const MAX_NOTE_CHARS = 500;
const GENERAL_TITLE = 'General';

const NO_USER = new Set(['', 'anon']);
const userKeyOf = (userId) => {
  const key = `${userId ?? ''}`.trim();
  return NO_USER.has(key.toLowerCase()) ? '' : key;
};
const sameNote = (a, b) => `${a}`.trim().toLowerCase() === `${b}`.trim().toLowerCase();

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
   * app, «### <app>» y una nota por línea; las generales bajo «### General»).
   * "" si no hay o si no hay usuario. Dentro de cada app van las más recientes,
   * y el bloque entero se corta en MAX_PROMPT_CHARS sin partir una nota.
   */
  async forPrompt(userId) {
    const userKey = userKeyOf(userId);
    if (!userKey) return '';
    const memory = await this.loadMemory(userKey);
    let out = '';
    for (const app of Object.keys(memory)) {
      const notes = (Array.isArray(memory[app]) ? memory[app] : [])
        .map((note) => `${note ?? ''}`.trim())
        .filter(Boolean)
        .slice(-MAX_NOTES_PER_APP)
        .reverse();
      if (notes.length === 0) continue;
      const header = `### ${`${app}`.trim() || GENERAL_TITLE}\n`;
      if (out.length + header.length > MAX_PROMPT_CHARS) break;
      let section = header;
      for (const note of notes) {
        const line = `- ${note}\n`;
        // continue y no break: una nota que no cabe no esconde las más cortas
        // que vienen detrás (antes, una sola nota larga dejaba la app sin memoria).
        if (out.length + section.length + line.length > MAX_PROMPT_CHARS) continue;
        section += line;
      }
      if (section !== header) out += `${section}\n`;
    }
    return out.trim();
  }

  /**
   * Guarda una nota durable (p.ej. "el botón 'Nuevo ingreso' admite pacientes").
   * Sin usuario, vacía o repetida (sin mirar mayúsculas), no hace nada.
   */
  async remember(userId, app, note) {
    const userKey = userKeyOf(userId);
    const text = `${note ?? ''}`.trim().slice(0, MAX_NOTE_CHARS);
    if (!userKey || !text) return;
    const key = `${app || ''}`.trim(); // "" agrupa las notas generales
    const memory = await this.loadMemory(userKey);
    const notes = Array.isArray(memory[key]) ? memory[key] : [];
    if (notes.some((existing) => sameNote(existing, text))) return;
    notes.push(text);
    memory[key] = notes.slice(-MAX_STORED_PER_APP);

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
              user_key: userKey,
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
    this.fallback.set(userKey, memory);
  }
}

SupabaseAgentMemoryRepository.LIMITS = Object.freeze({ MAX_STORED_PER_APP, MAX_NOTES_PER_APP, MAX_PROMPT_CHARS });

module.exports = SupabaseAgentMemoryRepository;
