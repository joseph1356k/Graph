// Lado LECTURA del core "Windows Live": lo que consume el panel Windows del
// Provider Studio (dashboard). Solo-admin (requireProviderAdmin en las rutas).
//
//   listUsers()            -> selector de usuarios (arriba-derecha del dashboard)
//   listEvents(email, ...) -> feed de eventos: pulsos de la viz + panel de logs
//   getUserGraph(email)    -> "subconsciente": apps -> workflows -> nodos, real,
//                             desde Neo4j scopeado por el owner (= email).
//
// La telemetria vive en Supabase (graph_windows_users/_events); el subconsciente
// vive en Neo4j (via WorkflowCatalog). Este servicio une ambas mitades por email.

const USERS_EVENT_JOIN_LIMIT = 5000;
const DEFAULT_EVENTS_LIMIT = 200;
const MAX_EVENTS_LIMIT = 1000;

// Etiquetas amables para apps conocidas; el resto se muestra tal cual (con la
// primera letra en mayuscula). El pill del circulo usa esto.
const APP_LABELS = {
  'windows-u': 'Escritorio',
  sap: 'SAP',
  notepad: 'Bloc de notas',
  chrome: 'Chrome',
  edge: 'Edge',
  excel: 'Excel',
  word: 'Word',
  outlook: 'Outlook'
};

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requireEmail(value) {
  const email = `${value == null ? '' : value}`.trim().toLowerCase();
  if (!email) {
    throw badRequest('Falta el email del usuario.');
  }
  return email;
}

function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(`${value}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function appLabel(appId) {
  const id = `${appId || ''}`.trim();
  if (!id) return 'Sin app';
  if (APP_LABELS[id.toLowerCase()]) return APP_LABELS[id.toLowerCase()];
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Coordenada tipo-URL de la app (lo que se ve al hacer hover en el pill).
// Preferimos el origin de la superficie (uia://, web://, sapgui://...); si no
// hay, caemos al appId como esquema sintetico.
function appCoordinate(sourceOrigin, appId) {
  const origin = `${sourceOrigin || ''}`.trim();
  if (origin) return origin;
  const id = `${appId || 'app'}`.trim() || 'app';
  return `uia://${id}`;
}

class WindowsPanelService {
  // catalogService: WorkflowCatalog (Neo4j). supabaseRestClient: telemetria.
  constructor({ catalogService, supabaseRestClient }) {
    if (!catalogService || !supabaseRestClient) {
      throw new Error('WindowsPanelService requires catalogService and supabaseRestClient');
    }
    this.catalog = catalogService;
    this.supabase = supabaseRestClient;
  }

  // Usuarios + agregado de actividad (conteo de eventos + ultimo evento), unido
  // en memoria desde dos consultas REST (mismo patron que el panel Android).
  async listUsers() {
    const [users, events] = await Promise.all([
      this.supabase.select('graph_windows_users', 'select=*&order=last_seen_at.desc'),
      this.supabase.select(
        'graph_windows_events',
        `select=email,kind,created_at&order=id.desc&limit=${USERS_EVENT_JOIN_LIMIT}`
      )
    ]);

    const statsByEmail = new Map();
    (Array.isArray(events) ? events : []).forEach((event) => {
      const entry = statsByEmail.get(event.email) || { count: 0, last: null };
      entry.count += 1;
      if (!entry.last) entry.last = event; // llegan ordenados por id desc
      statsByEmail.set(event.email, entry);
    });

    return (Array.isArray(users) ? users : []).map((user) => {
      const stats = statsByEmail.get(user.email) || { count: 0, last: null };
      return {
        email: user.email,
        display_name: user.display_name || user.email,
        app_version: user.app_version || '',
        machine_name: user.machine_name || '',
        last_install_id: user.last_install_id || '',
        first_seen_at: user.first_seen_at,
        last_seen_at: user.last_seen_at,
        event_count: stats.count,
        last_event_at: stats.last ? stats.last.created_at : null,
        last_event_kind: stats.last ? stats.last.kind : null
      };
    });
  }

  // Eventos de un usuario. `since` (id) permite polling incremental barato:
  // el cliente manda el ultimo id que vio y solo recibe lo nuevo.
  async listEvents(email, { since = 0, limit } = {}) {
    const normalized = requireEmail(email);
    const cappedLimit = clampLimit(limit, DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT);
    const sinceId = Number.parseInt(`${since}`, 10);

    let query = `select=*&email=eq.${encodeURIComponent(normalized)}`;
    if (Number.isFinite(sinceId) && sinceId > 0) {
      // Incremental: lo nuevo, en orden ascendente (para anexar al feed).
      query += `&id=gt.${sinceId}&order=id.asc&limit=${cappedLimit}`;
    } else {
      // Primera carga: los mas recientes, luego se invierte a cronologico.
      query += `&order=id.desc&limit=${cappedLimit}`;
    }

    const rows = await this.supabase.select('graph_windows_events', query);
    const events = Array.isArray(rows) ? rows : [];
    const ordered = (Number.isFinite(sinceId) && sinceId > 0) ? events : events.slice().reverse();
    const lastId = ordered.length ? ordered[ordered.length - 1].id : sinceId || 0;
    return { events: ordered, lastId };
  }

  // El subconsciente real del usuario: sus workflows en Neo4j agrupados por app
  // (la "coordenada principal"). Cada app -> workflows -> nodos (steps), con los
  // conteos REALES. Scope por owner = email (+ globales, para no ocultar nada).
  async getUserGraph(email) {
    const normalized = requireEmail(email);
    const access = { ownerId: normalized, includeGlobal: true };
    const workflows = await this.catalog.getCatalog(access);

    const appsByKey = new Map();
    let totalSteps = 0;
    let totalWorkflows = 0;

    (Array.isArray(workflows) ? workflows : []).forEach((wf) => {
      const appId = `${wf.appId || ''}`.trim() || 'app';
      const key = appId.toLowerCase();
      if (!appsByKey.has(key)) {
        appsByKey.set(key, {
          appId,
          label: appLabel(appId),
          coordinate: appCoordinate(wf.sourceOrigin, appId),
          origins: new Set(),
          workflows: []
        });
      }
      const app = appsByKey.get(key);
      if (wf.sourceOrigin) app.origins.add(wf.sourceOrigin);

      const steps = Array.isArray(wf.steps) ? wf.steps : [];
      // Nodos = steps reales, en orden. Cadena secuencial 0->1->...->n-1.
      const nodes = steps.map((step, index) => ({
        order: Number.isFinite(step.stepOrder) ? step.stepOrder : index,
        label: `${step.label || step.semanticTarget || step.selectedLabel || step.actionType || 'paso'}`.slice(0, 80),
        actionType: step.actionType || '',
        valueMode: step.valueMode || 'fixed',
        surfaceSection: step.surfaceSection || ''
      }));
      const edges = [];
      for (let i = 0; i < nodes.length - 1; i += 1) {
        edges.push({ from: nodes[i].order, to: nodes[i + 1].order });
      }

      totalSteps += nodes.length;
      totalWorkflows += 1;
      app.workflows.push({
        id: wf.id,
        title: `${wf.description || wf.summary || wf.sourceTitle || wf.id}`.slice(0, 120),
        status: wf.status || 'done',
        scope: wf.scope || 'private',
        pathname: wf.sourcePathname || '',
        url: wf.sourceUrl || '',
        updatedAt: wf.updatedAt || wf.createdAt || 0,
        stepCount: nodes.length,
        branchCount: Array.isArray(wf.branches) ? wf.branches.length : 0,
        nodes,
        edges
      });
    });

    const apps = Array.from(appsByKey.values())
      .map((app) => ({
        appId: app.appId,
        label: app.label,
        coordinate: app.coordinate,
        origins: Array.from(app.origins),
        workflowCount: app.workflows.length,
        stepCount: app.workflows.reduce((sum, wf) => sum + wf.stepCount, 0),
        // Workflows mas recientes primero.
        workflows: app.workflows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      }))
      // Apps con mas workflows primero (las "principales").
      .sort((a, b) => b.workflowCount - a.workflowCount);

    return {
      email: normalized,
      totals: { apps: apps.length, workflows: totalWorkflows, steps: totalSteps },
      apps
    };
  }
}

module.exports = WindowsPanelService;
