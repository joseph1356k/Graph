// Ingesta de telemetría del cliente Windows (Ü / U.WindowsClient) — el lado
// escritura del core "Windows Live". El cliente habla SOLO con el backend Graph
// (/api/v1, X-API-Key); este servicio persiste en Supabase con service-role
// (SupabaseRestClient), igual patrón que AndroidPanelService pero al revés:
// aquí el backend ESCRIBE lo que el cliente reporta.
//
// Identidad canónica = EMAIL (nombre+correo capturados al instalar). register()
// hace upsert por email: mismo correo => mismo usuario (reinstalación / otra
// máquina no crean uno nuevo). Sin contraseña por ahora.
//
// El feed de eventos es genérico (kind + detail jsonb): alimenta los pulsos de
// la visualización y el panel de logs, y admite cualquier métrica futura sin
// cambiar el esquema.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EVENTS_PER_BATCH = 200;

// Kinds que el backend acepta hoy. Es una lista blanca laxa: si llega uno
// desconocido lo guardamos igual (el feed es extensible), pero normalizamos los
// conocidos para que el dashboard pueda razonar sobre ellos.
const KNOWN_KINDS = new Set([
  'conscious_run_start',
  'analyze',
  'action',
  'conscious_run_end',
  'workflow_start',
  'workflow_step',
  'workflow_end',
  'mcp',
  'log'
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normEmail(value) {
  const email = `${value == null ? '' : value}`.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    throw badRequest('Correo invalido.');
  }
  return email;
}

function str(value, fallback = '') {
  const out = `${value == null ? '' : value}`.trim();
  return out || fallback;
}

function toIso(value) {
  if (!value) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return null;
  return new Date(stamp).toISOString();
}

function toDetail(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  // Cualquier escalar se envuelve para no perderlo.
  return { value };
}

class WindowsTelemetryService {
  constructor(supabaseRestClient) {
    if (!supabaseRestClient) {
      throw new Error('WindowsTelemetryService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
  }

  // Upsert por email (select-then-update/insert, sin abrir RLS ni tocar el
  // cliente compartido). Devuelve un resumen mínimo para el cliente.
  async register(payload = {}) {
    const email = normEmail(payload.email);
    const now = new Date().toISOString();

    const patch = {
      email,
      display_name: str(payload.displayName || payload.display_name),
      owner_id: email, // el subconsciente (Neo4j) se scopea por este owner
      last_install_id: str(payload.installId || payload.install_id),
      app_id: str(payload.appId || payload.app_id, 'windows-u'),
      app_version: str(payload.appVersion || payload.app_version),
      machine_name: str(payload.machineName || payload.machine_name),
      os_version: str(payload.osVersion || payload.os_version),
      last_seen_at: now
    };

    const existing = await this.supabase.select(
      'graph_windows_users',
      `select=email&email=eq.${encodeURIComponent(email)}&limit=1`
    );

    if (Array.isArray(existing) && existing.length) {
      await this.supabase.update('graph_windows_users', `email=eq.${encodeURIComponent(email)}`, patch);
    } else {
      await this.supabase.insert('graph_windows_users', { ...patch, first_seen_at: now, created_at: now });
    }

    return { ok: true, email };
  }

  // Inserta un lote de eventos. Tolerante: filtra los que no tengan kind, capa
  // el tamaño del lote y normaliza campos. El email del usuario manda; cada
  // evento puede traer su propio install_id.
  async ingestEvents(payload = {}) {
    const email = normEmail(payload.email);
    const installId = str(payload.installId || payload.install_id);
    const rawEvents = Array.isArray(payload.events) ? payload.events : [];
    if (!rawEvents.length) {
      return { ok: true, inserted: 0 };
    }

    const rows = rawEvents
      .slice(0, MAX_EVENTS_PER_BATCH)
      .map((event) => {
        const kind = str(event && event.kind);
        if (!kind) return null;
        return {
          email,
          install_id: str(event.installId || event.install_id || installId),
          kind: KNOWN_KINDS.has(kind) ? kind : kind.slice(0, 64),
          phase: str(event.phase),
          app_id: str(event.appId || event.app_id),
          surface_url: str(event.surfaceUrl || event.surface_url),
          workflow_id: str(event.workflowId || event.workflow_id),
          run_id: str(event.runId || event.run_id),
          label: str(event.label).slice(0, 500),
          detail: toDetail(event.detail),
          client_at: toIso(event.at || event.clientAt || event.client_at)
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      return { ok: true, inserted: 0 };
    }

    // Refresca el heartbeat del usuario de forma best-effort (no rompe si falla).
    try {
      await this.supabase.update(
        'graph_windows_users',
        `email=eq.${encodeURIComponent(email)}`,
        { last_seen_at: new Date().toISOString() }
      );
    } catch (_) {
      /* el usuario podria no haberse registrado aun; los eventos igual se guardan */
    }

    await this.supabase.insert('graph_windows_events', rows);
    return { ok: true, inserted: rows.length };
  }
}

module.exports = WindowsTelemetryService;
