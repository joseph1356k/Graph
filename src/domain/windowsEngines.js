// @ts-check
// ============================================================================
// EL CATÁLOGO DE MOTORES — fuente única de verdad de las tabs del panel de logs,
// del marcador de pruebas y del anclaje de los avances.
//
// Por qué existe: varios desarrolladores trabajan a la vez sobre UNA máquina de
// pruebas. Para que "¿esto funciona hoy?" tenga respuesta sin preguntarle a
// nadie, cada evento que llega del cliente Windows tiene que saber DOS cosas:
//
//   engine   -> a qué motor pertenece   (= la tab, = el ancla del doc y del avance)
//   outcome  -> si salió bien o mal     (= el marcador de éxito/fallo)
//
// Ninguna de las dos existe como columna en graph_windows_events, y NO hace
// falta que exista: ambas se derivan aquí, en un solo sitio, del `kind`, del
// `phase` y del `detail`. Añadir un motor es tocar SOLO este archivo.
//
// ---------------------------------------------------------------------------
// De dónde salen los motores: el cliente Windows YA los tiene etiquetados.
// `LogBus.Log(tag, mensaje)` (windows-client/src/Diagnostics/LogBus.cs:22) marca
// cada línea con un tag —"inspector", "sap", "nav", "teach"…— que es exactamente
// la granularidad de motor que queremos. El problema es que hoy ese bus es
// EN MEMORIA y su único suscriptor es la ventana local de logs: nada de eso sale
// de la máquina. El puente LogBus -> telemetría (kind='log', detail.tag=<tag>)
// es lo que enciende estas tabs con datos reales.
//
// Por eso `tags` abajo son los tags REALES que existen hoy en el cliente
// (verificados por grep sobre windows-app), no una taxonomía inventada.
// ============================================================================

// El orden del array es el orden de las tabs en el panel.
const ENGINES = [
  {
    key: 'inspector',
    label: 'Inspector (rojo)',
    // La pregunta que responde esta tab, en una línea. Se muestra bajo las tabs.
    question: '¿El elemento que toca el usuario es el mismo que tocaría el asistente?',
    doc: 'motor-inspector-elementos',
    tags: ['inspector'],
    kinds: ['inspector_click', 'inspector_mismatch'],
    accent: '#E5534B'
  },
  {
    key: 'sapgui',
    label: 'Escaneo SAP GUI',
    question: '¿El escaneo de la pantalla SAP encuentra y resuelve los campos?',
    doc: 'motor-escaneo-sapgui',
    tags: ['sap'],
    kinds: ['sap_scan'],
    // Cualquier evento de la app SAP cae aquí si nada más lo reclama.
    appIds: ['sap', 'saplogon', 'saplgpad'],
    accent: '#25C8E0'
  },
  {
    key: 'locator',
    label: 'Localizador (URL)',
    question: '¿Sabemos dónde está parado el usuario, y cuántas pantallas distintas ve cada app?',
    doc: 'motor-localizador-superficie',
    tags: ['uia'],
    kinds: ['surface_change'],
    accent: '#7aa2ff'
  },
  {
    key: 'navigator',
    label: 'Navegación',
    question: '¿Llegamos al punto de arranque del workflow cuando la pantalla no coincide?',
    doc: 'motor-navegacion-superficie',
    tags: ['nav', 'align'],
    kinds: [],
    accent: '#b9a7ff'
  },
  {
    key: 'player',
    label: 'Ejecución',
    question: '¿El workflow se ejecuta entero sin fallar?',
    doc: 'motor-ejecucion-workflowplayer',
    tags: ['workflow', 'workflow-ui'],
    kinds: ['workflow_start', 'workflow_step', 'workflow_end'],
    accent: '#7fe0a1'
  },
  {
    key: 'teach',
    label: 'Enseñanza',
    question: '¿Lo que el usuario enseña queda guardado como pasos reproducibles?',
    doc: 'motor-ensenanza-workflow',
    tags: ['teach', 'workflow-teach'],
    kinds: [],
    accent: '#F2C200'
  },
  {
    key: 'agent',
    label: 'Consciente',
    question: '¿El asistente entiende la petición y actúa?',
    doc: '',
    tags: [],
    kinds: ['conscious_run_start', 'conscious_run_end', 'analyze', 'action', 'mcp'],
    accent: '#25C8E0'
  },
  {
    key: 'system',
    label: 'Sistema',
    question: '¿La app arranca, se actualiza y reporta sin romperse?',
    doc: '',
    tags: ['update', 'telemetry', 'fatal', 'onboarding', 'unobserved-task'],
    kinds: [],
    accent: '#9aa6bf'
  }
];

// Motor de descarte: nada se pierde de vista por no estar clasificado. Si esta
// tab se llena, es señal de que falta un motor o un tag en el catálogo.
const FALLBACK_ENGINE = 'otros';

// Índices invertidos, construidos una vez.
const BY_TAG = new Map();
const BY_KIND = new Map();
const BY_APP = new Map();
const KEYS = new Set([FALLBACK_ENGINE]);

ENGINES.forEach((engine) => {
  KEYS.add(engine.key);
  (engine.tags || []).forEach((tag) => BY_TAG.set(tag.toLowerCase(), engine.key));
  (engine.kinds || []).forEach((kind) => BY_KIND.set(kind.toLowerCase(), engine.key));
  (engine.appIds || []).forEach((appId) => BY_APP.set(appId.toLowerCase(), engine.key));
});

function lower(value) {
  return `${value == null ? '' : value}`.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Clasificación. El orden importa: lo explícito gana siempre sobre lo inferido,
// para que el cliente pueda corregir cualquier heurística sin tocar el backend.
//
//   1. detail.engine  -> el cliente lo dijo. Manda.
//   2. detail.tag     -> viene del puente LogBus (kind='log'). Manda sobre kind
//                        porque 'log' es genérico: el tag es lo informativo.
//   3. kind           -> los eventos de telemetría clásicos.
//   4. app_id         -> último recurso (hoy solo SAP).
//   5. otros          -> visible a propósito, no silencioso.
// ---------------------------------------------------------------------------
function engineForEvent(event = {}) {
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};

  const explicit = lower(detail.engine);
  if (explicit && KEYS.has(explicit)) return explicit;

  const byTag = BY_TAG.get(lower(detail.tag));
  if (byTag) return byTag;

  const byKind = BY_KIND.get(lower(event.kind));
  if (byKind) return byKind;

  const byApp = BY_APP.get(lower(event.app_id || event.appId));
  if (byApp) return byApp;

  return FALLBACK_ENGINE;
}

// ---------------------------------------------------------------------------
// Veredicto. `phase` ya es el campo previsto para esto en el esquema
// (start | end | ok | error | skipped), así que no inventamos nada nuevo.
//
// Devuelve 'ok' | 'error' | 'skipped' | null. NULL ES SIGNIFICATIVO: quiere
// decir "este evento no es un intento medible" (p.ej. un `start`, o una línea
// de log meramente informativa) y por tanto NO entra en el denominador del
// porcentaje de éxito. Contar los `start` como éxitos inflaría el marcador.
// ---------------------------------------------------------------------------
const OUTCOMES = new Set(['ok', 'error', 'skipped']);

function outcomeForEvent(event = {}) {
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};

  const phase = lower(event.phase);
  if (OUTCOMES.has(phase)) return phase;

  // El puente de logs no tiene `phase`; marca el veredicto en el detalle.
  const explicit = lower(detail.outcome);
  if (OUTCOMES.has(explicit)) return explicit;

  // Convención heredada: un log cuyo nivel es de error cuenta como fallo.
  const level = lower(detail.level);
  if (level === 'error' || level === 'fatal') return 'error';

  return null;
}

// La versión del build contra la que corrió el evento. Sin esto, comparar dos
// implementaciones es imposible: es la columna que convierte el marcador en
// "¿mejoró o empeoró?" en vez de un número suelto.
function versionForEvent(event = {}) {
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
  return `${detail.app_version || detail.appVersion || ''}`.trim();
}

// Enriquece un evento crudo de graph_windows_events con las dimensiones
// derivadas. No muta el original.
function decorateEvent(event = {}) {
  return {
    ...event,
    engine: engineForEvent(event),
    outcome: outcomeForEvent(event),
    app_version: versionForEvent(event)
  };
}

// ---------------------------------------------------------------------------
// El marcador. Agrega una lista de eventos ya decorados en:
//   por motor  -> intentos / ok / error / skipped / % éxito
//   y dentro,  -> el mismo desglose POR VERSIÓN de la app
//
// Ese desglose por versión es la respuesta literal a "¿qué implementación fue
// exitosa?": mismo motor, dos versiones, dos porcentajes.
// ---------------------------------------------------------------------------
function emptyTally() {
  return { attempts: 0, ok: 0, error: 0, skipped: 0, events: 0 };
}

function addToTally(tally, outcome) {
  tally.events += 1;
  if (!outcome) return;
  tally.attempts += 1;
  if (outcome === 'ok') tally.ok += 1;
  else if (outcome === 'error') tally.error += 1;
  else if (outcome === 'skipped') tally.skipped += 1;
}

function successRate(tally) {
  // null, no 0: "sin intentos medibles" no es "0% de éxito". Distinguirlos evita
  // que un motor todavía sin instrumentar se lea como un motor roto.
  if (!tally.attempts) return null;
  return Math.round((tally.ok / tally.attempts) * 100);
}

function summarizeEngines(events = []) {
  const byEngine = new Map();

  events.forEach((event) => {
    const engine = event.engine || engineForEvent(event);
    const outcome = event.outcome !== undefined ? event.outcome : outcomeForEvent(event);
    const version = event.app_version || versionForEvent(event) || 'sin-versión';

    if (!byEngine.has(engine)) {
      byEngine.set(engine, { engine, ...emptyTally(), versions: new Map(), lastError: null });
    }
    const bucket = byEngine.get(engine);
    addToTally(bucket, outcome);

    if (!bucket.versions.has(version)) bucket.versions.set(version, { version, ...emptyTally() });
    addToTally(bucket.versions.get(version), outcome);

    // El último fallo es lo primero que quiere ver quien abre la tab.
    if (outcome === 'error') {
      const stamp = event.created_at || event.client_at || '';
      if (!bucket.lastError || `${stamp}` > `${bucket.lastError.at}`) {
        bucket.lastError = { at: stamp, label: event.label || '', kind: event.kind || '' };
      }
    }
  });

  return Array.from(byEngine.values()).map((bucket) => ({
    engine: bucket.engine,
    events: bucket.events,
    attempts: bucket.attempts,
    ok: bucket.ok,
    error: bucket.error,
    skipped: bucket.skipped,
    successRate: successRate(bucket),
    lastError: bucket.lastError,
    versions: Array.from(bucket.versions.values())
      .map((v) => ({ ...v, successRate: successRate(v) }))
      .sort((a, b) => (a.version < b.version ? 1 : -1))
  }));
}

// Catálogo público para el navegador: las tabs se construyen desde aquí, así que
// añadir un motor NO requiere tocar el front.
function engineCatalog() {
  return ENGINES.map((engine) => ({
    key: engine.key,
    label: engine.label,
    question: engine.question,
    doc: engine.doc || '',
    accent: engine.accent
  })).concat([{
    key: FALLBACK_ENGINE,
    label: 'Otros',
    question: '¿Qué está llegando que todavía no sabemos clasificar?',
    doc: '',
    accent: '#9aa6bf'
  }]);
}

module.exports = {
  ENGINES,
  FALLBACK_ENGINE,
  engineCatalog,
  engineForEvent,
  outcomeForEvent,
  versionForEvent,
  decorateEvent,
  summarizeEngines
};
