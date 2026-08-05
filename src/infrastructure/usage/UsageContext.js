// Contexto de atribución propagado con AsyncLocalStorage.
//
// POR QUÉ ASYNCLOCALSTORAGE Y NO UN PARÁMETRO MÁS.
// La llamada al proveedor ocurre en LLMProvider, a tres o cuatro saltos de la
// ruta HTTP que conoce al usuario: ruta → servicio clínico → constructor de
// prompt → LLMProvider. Pasar `{userId, orgId, app, feature}` a mano exigía
// tocar la firma de ~15 servicios y sus llamadores, y bastaba con que uno se
// olvidara para que ese consumo quedara sin atribuir en silencio — el modo de
// fallo más caro, porque no se nota. Con ALS el contexto viaja con la ejecución
// asíncrona: quien no lo propaga no puede «olvidarlo a medias».
//
// LO QUE ESTO NO ES: un canal de confianza. Aquí solo entra lo que el servidor
// ya verificó (ver AttributionResolver). El cliente puede pedir una app y un
// módulo, pero el usuario y la organización salen siempre de la sesión.

const { AsyncLocalStorage } = require('async_hooks');
const {
  APPS,
  FEATURES,
  ACTOR_TYPES,
  ATTRIBUTION_SOURCES,
  normalizeApp,
  normalizeFeature
} = require('../../domain/usage/vocabulary');

const storage = new AsyncLocalStorage();

const EMPTY_CONTEXT = Object.freeze({
  userId: null,
  organizationId: null,
  actorType: ACTOR_TYPES.UNATTRIBUTED,
  attributionSource: ATTRIBUTION_SOURCES.NONE,
  app: APPS.UNKNOWN,
  feature: FEATURES.UNKNOWN,
  sessionId: '',
  workflowId: '',
  requestId: ''
});

function currentContext() {
  return storage.getStore() || EMPTY_CONTEXT;
}

/**
 * Ejecuta `fn` con un contexto de atribución activo.
 * El contexto es inmutable: para acotar el módulo dentro de una petición se usa
 * `withFeature`, que crea uno derivado en vez de mutar el vigente.
 */
function runWithContext(context, fn) {
  return storage.run(Object.freeze({ ...EMPTY_CONTEXT, ...context }), fn);
}

/**
 * Deriva el contexto actual cambiando solo el módulo (y opcionalmente la app).
 * Es lo que usa cada servicio para decir «esto que voy a llamar es Biopsia»
 * sin tocar quién es el usuario.
 */
function withFeature(feature, fn, overrides = {}) {
  const base = currentContext();
  const derived = {
    ...base,
    feature: normalizeFeature(feature),
    ...(overrides.app ? { app: normalizeApp(overrides.app) } : {}),
    ...(overrides.workflowId ? { workflowId: `${overrides.workflowId}` } : {}),
    ...(overrides.sessionId ? { sessionId: `${overrides.sessionId}` } : {})
  };
  return storage.run(Object.freeze(derived), fn);
}

/**
 * Contexto para trabajo interno sin usuario: cron, mantenimiento, arranque.
 * Se marca explícitamente como `system` — no como «sin atribuir», que es el
 * cajón de los fallos de cableado.
 */
function runAsSystem(feature, fn) {
  return runWithContext({
    actorType: ACTOR_TYPES.SYSTEM,
    attributionSource: ATTRIBUTION_SOURCES.INTERNAL,
    app: APPS.SYSTEM,
    feature: normalizeFeature(feature)
  }, fn);
}

/**
 * Trabajo diferido que SÍ tuvo un usuario que lo originó. Conserva su identidad
 * y solo cambia el tipo de actor, para que el consumo siga atribuido a quien lo
 * provocó aunque se ejecute más tarde.
 */
function runAsBackgroundJob(feature, originContext, fn) {
  const origin = originContext || currentContext();
  return runWithContext({
    ...origin,
    actorType: ACTOR_TYPES.BACKGROUND_JOB,
    feature: normalizeFeature(feature)
  }, fn);
}

/** Captura el contexto vigente para reanudarlo después (colas, promesas sueltas). */
function captureContext() {
  return { ...currentContext() };
}

module.exports = {
  currentContext,
  runWithContext,
  withFeature,
  runAsSystem,
  runAsBackgroundJob,
  captureContext,
  EMPTY_CONTEXT
};
