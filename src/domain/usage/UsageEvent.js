// Normalización del evento de consumo: el único sitio donde un payload suelto
// se convierte en la fila que va a Postgres.
//
// Dos responsabilidades que no se pueden delegar:
//   1. PRIVACIDAD. `metadata` pasa por una allowlist de claves técnicas. Lo que
//      no esté en la lista se descarta, no se «intenta limpiar». Una denylist
//      falla abierta: basta una clave nueva para filtrar contenido clínico.
//   2. IDEMPOTENCIA. La clave se deriva de lo que identifica una llamada
//      facturable concreta, incluido el número de intento. Un reintento real
//      genera clave distinta (es consumo real); un reenvío del mismo evento
//      genera la misma y choca contra el índice único.

const crypto = require('crypto');
const {
  normalizeApp,
  normalizeFeature,
  normalizeProvider,
  normalizeApiFamily,
  normalizeActorType,
  normalizeAttributionSource,
  normalizeStatus,
  resolveEnvironment,
  ACTOR_TYPES,
  ATTRIBUTION_SOURCES
} = require('./vocabulary');
const { calculateCost } = require('./pricing');

// Claves permitidas en `metadata`. Todas describen la MECÁNICA de la llamada,
// nunca su contenido. Al agregar una, la pregunta es: ¿puede este valor
// contener texto escrito por un médico o sobre un paciente? Si la respuesta no
// es un no rotundo, no entra.
const METADATA_ALLOWLIST = Object.freeze(new Set([
  'attempt',
  'retryOf',
  'fallbackFrom',
  'fieldCount',
  'matchCount',
  'sectionCount',
  'messageCount',
  'toolCallCount',
  'imageCount',
  'pageCount',
  'stepOrder',
  'stepCount',
  'templateId',
  'specialtyCode',
  'readyToSubmit',
  'truncated',
  'responseFormat',
  'temperature',
  'maxTokens',
  'streamChunks',
  'httpStatus',
  'providerErrorType',
  'durationMsProvider',
  'cacheHit',
  'clientVersion',
  'osVersion',
  'deviceModel'
]));

const MAX_METADATA_STRING = 120;
const MAX_METADATA_KEYS = 24;

function text(value, max = 256) {
  return `${value ?? ''}`.trim().slice(0, max);
}

function nonNegativeInt(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function nonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function optionalInt(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value) {
  const candidate = `${value ?? ''}`.trim();
  return UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function isoDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

/**
 * Saneado de metadata: allowlist de claves, tipos primitivos, sin anidamiento.
 * Sin anidamiento a propósito — un objeto libre dentro de un valor permitido
 * volvería a abrir la puerta que la allowlist cierra.
 */
function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const output = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_METADATA_KEYS) break;
    if (!METADATA_ALLOWLIST.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value;
      count += 1;
    } else if (typeof value === 'boolean') {
      output[key] = value;
      count += 1;
    } else if (typeof value === 'string') {
      const trimmed = value.trim().slice(0, MAX_METADATA_STRING);
      if (trimmed) {
        output[key] = trimmed;
        count += 1;
      }
    }
    // Objetos y arrays se descartan en silencio: no hay caso de uso técnico que
    // los necesite y son el vector más fácil para colar contenido.
  }
  return output;
}

/**
 * Clave de idempotencia.
 *
 * Incluye `attempt` porque un reintento contra el proveedor SÍ es consumo real
 * y debe contarse; lo que se deduplica es reescribir el mismo evento tras un
 * fallo de persistencia. Si quien llama trae su propia clave estable
 * (`idempotencyKey`), se respeta.
 */
function buildIdempotencyKey(event) {
  if (event.idempotencyKey) {
    return text(event.idempotencyKey, 200);
  }
  // El requestId del proveedor es el identificador más fuerte cuando existe:
  // dos llamadas distintas nunca lo comparten.
  if (event.providerRequestId) {
    return `prov:${text(event.providerRequestId, 160)}:${event.attempt || 1}`;
  }
  const material = [
    event.occurredAt,
    event.provider,
    event.requestedModel,
    event.app,
    event.feature,
    event.userId || event.actorType,
    event.organizationId || '',
    event.inputTokens,
    event.outputTokens,
    event.audioSeconds,
    event.status,
    event.attempt || 1,
    event.requestId || '',
    event.sessionId || ''
  ].join('|');
  return `sha:${crypto.createHash('sha256').update(material).digest('hex')}`;
}

/**
 * Convierte un payload suelto en el evento canónico listo para persistir.
 * Calcula el costo aquí para que quede congelado junto a su tarifa.
 */
function buildUsageEvent(input = {}, options = {}) {
  const occurredAt = isoDate(input.occurredAt);
  const attempt = Math.max(1, nonNegativeInt(input.attempt) || 1);

  const requestedModel = text(input.requestedModel || input.model, 120);
  const servedModel = text(input.servedModel || input.model, 120);
  const provider = normalizeProvider(input.provider);
  const apiFamily = normalizeApiFamily(input.apiFamily);

  const userId = uuidOrNull(input.userId);
  // Regla dura: `actor_type = 'user'` exige un uuid. Sin él, la llamada no está
  // atribuida y se dice así, en vez de inventar un usuario o tirar el evento.
  let actorType = normalizeActorType(input.actorType);
  if (actorType === ACTOR_TYPES.USER && !userId) {
    actorType = ACTOR_TYPES.UNATTRIBUTED;
  }
  let attributionSource = normalizeAttributionSource(input.attributionSource);
  if (!userId && attributionSource === ATTRIBUTION_SOURCES.SESSION) {
    attributionSource = ATTRIBUTION_SOURCES.NONE;
  }

  const inputTokens = nonNegativeInt(input.inputTokens);
  const outputTokens = nonNegativeInt(input.outputTokens);
  const cachedInputTokens = nonNegativeInt(input.cachedInputTokens);
  const reasoningTokens = nonNegativeInt(input.reasoningTokens);
  const audioSeconds = nonNegativeNumber(input.audioSeconds);
  const requestUnits = nonNegativeInt(input.requestUnits);
  // Si el proveedor da un total propio se respeta (puede incluir categorías que
  // no desglosamos); si no, se suma lo que sí conocemos.
  const totalTokens = nonNegativeInt(input.totalTokens)
    || (inputTokens + outputTokens + reasoningTokens);

  const cost = calculateCost({
    provider,
    model: requestedModel || servedModel,
    apiFamily,
    occurredAt,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    audioSeconds,
    requestUnits
  }, options.rateCatalog);

  const event = {
    occurredAt,
    organizationId: uuidOrNull(input.organizationId),
    userId,
    actorType,
    attributionSource,
    app: normalizeApp(input.app),
    feature: normalizeFeature(input.feature),
    provider,
    apiFamily,
    requestedModel,
    servedModel: servedModel || requestedModel,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
    audioSeconds: Math.round(audioSeconds * 1000) / 1000,
    requestUnits,
    costUsd: cost.costUsd,
    costStatus: cost.costStatus,
    currency: 'USD',
    pricingVersion: cost.pricingVersion,
    pricingSnapshot: cost.pricingSnapshot,
    status: normalizeStatus(input.status),
    errorCode: text(input.errorCode, 80),
    latencyMs: optionalInt(input.latencyMs),
    streamed: Boolean(input.streamed),
    attempt,
    rootEventId: uuidOrNull(input.rootEventId),
    fallbackFromModel: text(input.fallbackFromModel, 120),
    providerRequestId: text(input.providerRequestId, 160),
    environment: options.environment || resolveEnvironment(),
    sessionId: text(input.sessionId, 120),
    workflowId: text(input.workflowId, 120),
    requestId: text(input.requestId, 120),
    metadata: sanitizeMetadata(input.metadata)
  };

  event.idempotencyKey = buildIdempotencyKey(event);
  return event;
}

// Nombres de columna de Postgres. Se hace explícito para que un cambio de
// esquema falle aquí y no en un insert silenciosamente incompleto.
function toDatabaseRow(event) {
  return {
    idempotency_key: event.idempotencyKey,
    occurred_at: event.occurredAt,
    organization_id: event.organizationId,
    user_id: event.userId,
    actor_type: event.actorType,
    attribution_source: event.attributionSource,
    app: event.app,
    feature: event.feature,
    provider: event.provider,
    api_family: event.apiFamily,
    requested_model: event.requestedModel,
    served_model: event.servedModel,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cached_input_tokens: event.cachedInputTokens,
    reasoning_tokens: event.reasoningTokens,
    total_tokens: event.totalTokens,
    audio_seconds: event.audioSeconds,
    request_units: event.requestUnits,
    cost_usd: event.costUsd,
    cost_status: event.costStatus,
    currency: event.currency,
    pricing_version: event.pricingVersion,
    pricing_snapshot: event.pricingSnapshot,
    status: event.status,
    error_code: event.errorCode,
    latency_ms: event.latencyMs,
    streamed: event.streamed,
    attempt: event.attempt,
    root_event_id: event.rootEventId,
    fallback_from_model: event.fallbackFromModel,
    provider_request_id: event.providerRequestId,
    environment: event.environment,
    session_id: event.sessionId,
    workflow_id: event.workflowId,
    request_id: event.requestId,
    metadata: event.metadata
  };
}

module.exports = {
  buildUsageEvent,
  buildIdempotencyKey,
  sanitizeMetadata,
  toDatabaseRow,
  METADATA_ALLOWLIST
};
