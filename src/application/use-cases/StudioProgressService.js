// La BITÁCORA DE AVANCES: lo que un desarrollador probó y cómo le fue.
//
// Es la mitad humana del banco de pruebas. La otra mitad (el marcador por motor)
// se deriva sola de la telemetría, pero solo sabe contar ok/error — no sabe QUÉ
// se intentó ni POR QUÉ falló. Eso solo lo sabe quien lo hizo, y hoy se pierde.
//
// El caso que justifica esta tabla es real y está en el repo del cliente Windows:
// SetWinEventHook se implementó, se midió (quedó 4x peor que el sondeo), se
// revirtió, se encontró la causa verdadera (`if (_computing) return;` descartaba
// cambios en silencio) y se revirtió otra vez. Todo ese conocimiento vive HOY
// únicamente en el cuerpo de tres commits que nadie va a leer. Un desarrollador
// nuevo reintentará exactamente lo mismo dentro de un mes.
//
// Por eso `body` es prosa libre: el valor está en el relato. `outcome` existe
// solo para poder filtrar, y `app_version` para que un "funcionó" sea
// reproducible en vez de una anécdota.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TITLE = 200;
const MAX_BODY = 20000;

const OUTCOMES = new Set(['funciono', 'no_funciono', 'parcial', 'en_curso']);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function str(value, fallback = '') {
  const out = `${value == null ? '' : value}`.trim();
  return out || fallback;
}

function clampLimit(value) {
  const parsed = Number.parseInt(`${value}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

class StudioProgressService {
  constructor(supabaseRestClient) {
    if (!supabaseRestClient) {
      throw new Error('StudioProgressService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
  }

  // Lista de avances. Filtrable por motor (la tab) o por doc (el lector), que es
  // como se consume: cada motor muestra su propia historia.
  async list({ engine, docId, limit } = {}) {
    let query = `select=*&order=id.desc&limit=${clampLimit(limit)}`;
    const engineKey = str(engine);
    const doc = str(docId);
    if (engineKey) query += `&engine=eq.${encodeURIComponent(engineKey)}`;
    if (doc) query += `&doc_id=eq.${encodeURIComponent(doc)}`;

    const rows = await this.supabase.select('graph_studio_progress', query);
    return { entries: Array.isArray(rows) ? rows : [] };
  }

  // Registra un avance. `title` es lo único obligatorio: la fricción de escribir
  // debe ser mínima o la bitácora se queda vacía y no sirve de nada.
  async create(payload = {}, author = {}) {
    const title = str(payload.title);
    if (!title) throw badRequest('El avance necesita un título.');

    const outcome = str(payload.outcome, 'en_curso');
    if (!OUTCOMES.has(outcome)) {
      throw badRequest(`Veredicto inválido: ${outcome}. Usa funciono | no_funciono | parcial | en_curso.`);
    }

    const tags = Array.isArray(payload.tags)
      ? payload.tags.map((tag) => str(tag)).filter(Boolean).slice(0, 12)
      : [];

    const row = {
      engine: str(payload.engine),
      doc_id: str(payload.docId || payload.doc_id),
      author_email: str(author.email || payload.authorEmail),
      author_name: str(author.name || payload.authorName),
      title: title.slice(0, MAX_TITLE),
      body: str(payload.body).slice(0, MAX_BODY),
      outcome,
      app_version: str(payload.appVersion || payload.app_version),
      tags,
      created_at: new Date().toISOString()
    };

    await this.supabase.insert('graph_studio_progress', row);
    return { ok: true, entry: row };
  }
}

module.exports = StudioProgressService;
