// Vocabulario canónico de la telemetría de IA.
//
// APLICACIÓN y FUNCIONALIDAD son dos ejes distintos y no se mezclan en un solo
// campo. «windows_app» es dónde se originó; «biopsia» es qué se estaba
// haciendo. El mismo módulo puede correr desde varias apps y la misma app
// ejecuta varios módulos; colapsarlos haría imposible responder «¿cuánto gasta
// la app de Windows?» y «¿cuánto cuesta Biopsia?» a la vez.
//
// Para agregar un valor nuevo: añádelo aquí y ya. La base de datos usa TEXT con
// CHECK solo en los ejes cerrados (actor_type, status, environment), justamente
// para que sumar una app o un módulo no requiera migración.

// Dónde se originó la llamada.
const APPS = Object.freeze({
  WEB_APP: 'web_app',            // portal clínico (Next.js) — médicos y secretarias
  WINDOWS_APP: 'windows_app',    // cliente Ü de escritorio (U.exe)
  ANDROID_APP: 'android_app',    // app Android
  CHROME_EXTENSION: 'chrome_extension',
  BACKEND: 'backend',            // Graph atendiendo una petición HTTP propia
  SYSTEM: 'system',              // proceso interno sin petición HTTP (cron, mantenimiento)
  UNKNOWN: 'unknown'
});

// Qué se estaba haciendo. Los cuatro primeros son las tarjetas del Provider
// Studio; el resto salieron de recorrer los sitios donde se llama a un modelo.
const FEATURES = Object.freeze({
  HOJA_EN_BLANCO: 'hoja_en_blanco',
  ASISTENTE: 'asistente',
  BIOPSIA: 'biopsia',
  FIELD_MATCHING: 'field_matching',
  NOTE_GENERATION: 'note_generation',
  NOTE_RESCUE: 'note_rescue',
  CLINICAL_STRUCTURING: 'clinical_structuring',
  DIAGNOSIS_SUGGESTION: 'diagnosis_suggestion',
  TRANSCRIPTION: 'transcription',
  AUDIO_PROCESSING: 'audio_processing',
  SCHEDULE_PARSING: 'schedule_parsing',
  WORKFLOW_LEARNING: 'workflow_learning',
  WORKFLOW_EXECUTION: 'workflow_execution',
  EXECUTION_INTELLIGENCE: 'execution_intelligence',
  SURFACE_PROFILE: 'surface_profile',
  DYNAMIC_VALUES: 'dynamic_values',
  CONSCIOUS_BRIDGE: 'conscious_bridge',
  TEACH_VIDEO: 'teach_video',
  AGENT_CHAT: 'agent_chat',
  PROVIDER_TEST: 'provider_test',
  UNKNOWN: 'unknown'
});

// Quién consumió. `user` exige un uuid real; los otros tres son las tres formas
// legítimas de NO tener usuario, y son distintas entre sí a propósito:
//   system         → tarea interna del producto (mantenimiento, salud)
//   background_job → disparada por un usuario pero ejecutada después
//   unattributed   → hubo llamada y no se pudo atribuir. Es un fallo a mirar,
//                    no un cajón de sastre: si crece, hay un sitio sin cablear.
const ACTOR_TYPES = Object.freeze({
  USER: 'user',
  SYSTEM: 'system',
  BACKGROUND_JOB: 'background_job',
  UNATTRIBUTED: 'unattributed'
});

// De dónde salió la atribución. Permite auditar que no venimos creyéndole al
// cliente: solo 'session' y 'api_key' son verificadas en servidor.
const ATTRIBUTION_SOURCES = Object.freeze({
  SESSION: 'session',    // JWT de Supabase verificado contra el JWKS
  API_KEY: 'api_key',    // X-API-Key de MIRACLE_API_KEYS + identidad registrada
  DEVICE: 'device',      // instalación registrada (Android/Windows) resuelta en servidor
  INTERNAL: 'internal',  // proceso propio de Graph
  NONE: 'none'
});

const PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  DEEPGRAM: 'deepgram',
  AZURE_FOUNDRY: 'azure-foundry',
  OPENROUTER: 'openrouter',
  UNKNOWN: 'unknown'
});

const API_FAMILIES = Object.freeze({
  CHAT_COMPLETIONS: 'chat_completions',
  RESPONSES: 'responses',
  MESSAGES: 'messages',
  TRANSCRIPTION: 'transcription',
  VIDEO: 'video',
  COMPUTER_USE: 'computer_use',
  UNKNOWN: 'unknown'
});

const STATUSES = Object.freeze({
  OK: 'ok',
  ERROR: 'error',
  PARTIAL: 'partial',
  CANCELLED: 'cancelled'
});

const COST_STATUSES = Object.freeze({
  PRICED: 'priced',
  UNPRICED_NO_RATE: 'unpriced_no_rate',   // no hay tarifa para ese proveedor/modelo
  UNPRICED_NO_USAGE: 'unpriced_no_usage', // el proveedor no reportó consumo
  FREE: 'free'                            // tarifa configurada explícitamente en cero
});

const ENVIRONMENTS = Object.freeze({
  PRODUCTION: 'production',
  PREVIEW: 'preview',
  DEVELOPMENT: 'development',
  TEST: 'test'
});

function valuesOf(dictionary) {
  return Object.freeze(Object.values(dictionary));
}

const APP_VALUES = valuesOf(APPS);
const FEATURE_VALUES = valuesOf(FEATURES);
const ACTOR_TYPE_VALUES = valuesOf(ACTOR_TYPES);
const ATTRIBUTION_SOURCE_VALUES = valuesOf(ATTRIBUTION_SOURCES);
const STATUS_VALUES = valuesOf(STATUSES);
const ENVIRONMENT_VALUES = valuesOf(ENVIRONMENTS);

// Los ejes cerrados (los que la base valida con CHECK) se normalizan contra la
// lista; un valor desconocido cae al respaldo en vez de reventar el insert y
// perder el evento. Perder el evento es peor que clasificarlo mal.
function normalizeClosed(value, allowed, fallback) {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

// Los ejes abiertos (app, feature, provider) solo se sanean de forma: minúsculas,
// sin espacios, longitud acotada. No se validan contra la lista porque agregar
// un módulo no debe requerir tocar este archivo antes de poder medirlo.
function normalizeOpen(value, fallback = 'unknown') {
  const normalized = `${value ?? ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeApp(value) {
  return normalizeOpen(value, APPS.UNKNOWN);
}

function normalizeFeature(value) {
  return normalizeOpen(value, FEATURES.UNKNOWN);
}

function normalizeProvider(value) {
  return normalizeOpen(value, PROVIDERS.UNKNOWN);
}

function normalizeApiFamily(value) {
  return normalizeOpen(value, API_FAMILIES.UNKNOWN);
}

function normalizeActorType(value) {
  return normalizeClosed(value, ACTOR_TYPE_VALUES, ACTOR_TYPES.UNATTRIBUTED);
}

function normalizeAttributionSource(value) {
  return normalizeClosed(value, ATTRIBUTION_SOURCE_VALUES, ATTRIBUTION_SOURCES.NONE);
}

function normalizeStatus(value) {
  return normalizeClosed(value, STATUS_VALUES, STATUSES.OK);
}

// El entorno no se acepta del cliente: se deduce del proceso. VERCEL_ENV vale
// 'production' | 'preview' | 'development'.
function resolveEnvironment(env = process.env) {
  const explicit = `${env.MIRACLE_USAGE_ENVIRONMENT || ''}`.trim().toLowerCase();
  if (ENVIRONMENT_VALUES.includes(explicit)) {
    return explicit;
  }
  const vercelEnv = `${env.VERCEL_ENV || ''}`.trim().toLowerCase();
  if (ENVIRONMENT_VALUES.includes(vercelEnv)) {
    return vercelEnv;
  }
  const nodeEnv = `${env.NODE_ENV || ''}`.trim().toLowerCase();
  if (nodeEnv === 'production') return ENVIRONMENTS.PRODUCTION;
  if (nodeEnv === 'test') return ENVIRONMENTS.TEST;
  return ENVIRONMENTS.DEVELOPMENT;
}

module.exports = {
  APPS,
  FEATURES,
  ACTOR_TYPES,
  ATTRIBUTION_SOURCES,
  PROVIDERS,
  API_FAMILIES,
  STATUSES,
  COST_STATUSES,
  ENVIRONMENTS,
  APP_VALUES,
  FEATURE_VALUES,
  ACTOR_TYPE_VALUES,
  ATTRIBUTION_SOURCE_VALUES,
  STATUS_VALUES,
  ENVIRONMENT_VALUES,
  normalizeApp,
  normalizeFeature,
  normalizeProvider,
  normalizeApiFamily,
  normalizeActorType,
  normalizeAttributionSource,
  normalizeStatus,
  resolveEnvironment
};
