// Catálogo central de tarifas y cálculo de costo.
//
// FUENTE ÚNICA. Los precios no viven repartidos por servicios ni por rutas:
// están aquí, versionados por fecha de vigencia. `public.ai_model_prices` en
// Supabase es un espejo consultable desde SQL, y scripts/verify-ai-usage-pricing.js
// exige que ambos coincidan — si alguien cambia uno y no el otro, el test falla.
//
// POR QUÉ EL CÁLCULO VIVE EN NODE Y NO EN SQL. El costo se congela en el evento
// al escribirlo, junto con la versión de tarifa aplicada. Así los totales del
// dashboard son la suma de lo almacenado (coinciden por construcción) y un
// cambio de precios no reescribe la historia. Consultar la tabla en el camino
// crítico añadiría un round-trip a cada llamada a un modelo.
//
// CERO NO ES GRATIS. Si no hay tarifa, el costo es null y el evento queda
// marcado `unpriced_no_rate`. El dashboard lo muestra como «tarifa no
// configurada» y lista qué proveedor/modelo la necesita. Un cero silencioso
// haría creer que el consumo salió gratis.

const { COST_STATUSES } = require('./vocabulary');

const PRICING_VERSION = '2026-08-04';

const SOURCES = Object.freeze({
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  deepgram: 'https://deepgram.com/pricing'
});

// Precios en USD por millón de tokens (per_minute_usd en USD por minuto de audio).
// `effectiveFrom` permite añadir una tarifa nueva sin borrar la vieja: los
// eventos históricos siguen reconstruyéndose con la que estaba vigente.
const RATE_CARDS = Object.freeze([
  // ---- OpenAI · texto ----
  rate('openai', 'gpt-4.1', 'chat_completions', { input: 2.00, cachedInput: 0.50, output: 8.00 }),
  rate('openai', 'gpt-4.1-mini', 'chat_completions', { input: 0.40, cachedInput: 0.10, output: 1.60 }),
  rate('openai', 'gpt-4.1-nano', 'chat_completions', { input: 0.10, cachedInput: 0.025, output: 0.40 }),
  rate('openai', 'gpt-4o', 'chat_completions', { input: 2.50, cachedInput: 1.25, output: 10.00 }),
  rate('openai', 'gpt-4o-mini', 'chat_completions', { input: 0.15, cachedInput: 0.075, output: 0.60 }),

  // ---- OpenAI · transcripción ----
  rate('openai', 'gpt-4o-transcribe', 'transcription', { input: 2.50, output: 10.00, perMinute: 0.006 }),
  rate('openai', 'gpt-4o-mini-transcribe', 'transcription', { input: 1.25, output: 5.00, perMinute: 0.003 }),

  // ---- Anthropic ----
  rate('anthropic', 'claude-opus-5', 'messages', { input: 5.00, output: 25.00 }),
  rate('anthropic', 'claude-sonnet-5', 'messages', { input: 3.00, output: 15.00 }),
  rate('anthropic', 'claude-sonnet-4-6', 'messages', { input: 3.00, output: 15.00 }),
  rate('anthropic', 'claude-haiku-4-5', 'messages', { input: 1.00, output: 5.00 }),

  // ---- Google Gemini ----
  rate('google', 'gemini-2.5-flash', 'chat_completions', { input: 0.30, cachedInput: 0.075, output: 2.50 }),
  rate('google', 'gemini-2.5-pro', 'chat_completions', { input: 1.25, cachedInput: 0.3125, output: 10.00 }),

  // ---- Deepgram · audio por minuto ----
  rate('deepgram', 'nova-3', 'transcription', { perMinute: 0.0043 }),
  rate('deepgram', 'nova-2', 'transcription', { perMinute: 0.0043 })
]);

function rate(provider, model, apiFamily, prices) {
  return Object.freeze({
    provider,
    model,
    apiFamily,
    version: PRICING_VERSION,
    currency: 'USD',
    inputPerMTok: prices.input ?? null,
    cachedInputPerMTok: prices.cachedInput ?? null,
    outputPerMTok: prices.output ?? null,
    reasoningPerMTok: prices.reasoning ?? null,
    perMinuteUsd: prices.perMinute ?? null,
    perRequestUsd: prices.perRequest ?? null,
    effectiveFrom: prices.effectiveFrom ?? '1970-01-01T00:00:00.000Z',
    effectiveTo: prices.effectiveTo ?? null,
    sourceUrl: SOURCES[provider] || '',
    sourceCapturedAt: PRICING_VERSION
  });
}

// Los proveedores devuelven variantes del mismo modelo (fechadas, con prefijo
// de vendor en OpenRouter, con sufijo de despliegue en Azure). Se normaliza
// para no fabricar una tarifa faltante por una diferencia cosmética.
function canonicalModelName(model = '') {
  let name = `${model || ''}`.trim().toLowerCase();
  if (!name) return '';
  // OpenRouter: "openai/gpt-4o" → "gpt-4o"
  const slash = name.lastIndexOf('/');
  if (slash >= 0) {
    name = name.slice(slash + 1);
  }
  // Snapshot fechado: "gpt-4o-2024-08-06" → "gpt-4o"
  name = name.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  // Anthropic con sufijo de fecha: "claude-sonnet-4-6-20251114" ya cae arriba.
  return name;
}

function normalizeKey(value = '') {
  return `${value || ''}`.trim().toLowerCase();
}

// Busca la tarifa vigente en `occurredAt`. Primero exige que coincida la
// familia de API (un mismo modelo puede tener precios distintos por endpoint);
// si no hay coincidencia exacta, cae a la del mismo proveedor/modelo.
function findRate(input = {}, catalog = RATE_CARDS) {
  const provider = normalizeKey(input.provider);
  const model = canonicalModelName(input.model);
  if (!provider || !model) {
    return null;
  }
  const apiFamily = normalizeKey(input.apiFamily);
  const at = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const atMs = Number.isFinite(at.getTime()) ? at.getTime() : Date.now();

  const vigentes = catalog.filter((entry) => {
    if (entry.provider !== provider) return false;
    if (canonicalModelName(entry.model) !== model) return false;
    const from = new Date(entry.effectiveFrom).getTime();
    const to = entry.effectiveTo ? new Date(entry.effectiveTo).getTime() : Infinity;
    return atMs >= from && atMs < to;
  });

  if (!vigentes.length) {
    return null;
  }
  const exacta = vigentes.find((entry) => entry.apiFamily === apiFamily);
  const elegida = exacta || vigentes[0];
  // Con varias vigencias solapadas gana la más reciente.
  return vigentes
    .filter((entry) => entry.apiFamily === elegida.apiFamily)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
}

/**
 * Tarifa a partir del modelo SOLO, para cuando quien pregunta no tiene el
 * proveedor a mano — el desglose por modelo del dashboard, por ejemplo.
 *
 * Devuelve `null` si el nombre está en más de un proveedor, en vez de elegir
 * uno. Adivinar aquí significaría atribuirle a un modelo el precio de otro, y
 * una cifra de ahorro con el precio equivocado es peor que no dar la cifra:
 * la primera se cree, la segunda se investiga.
 */
function findRateByModel(model, catalog = RATE_CARDS, at = new Date()) {
  const canonical = canonicalModelName(model);
  if (!canonical) return null;
  const atMs = at instanceof Date && Number.isFinite(at.getTime()) ? at.getTime() : Date.now();

  const vigentes = catalog.filter((entry) => {
    if (canonicalModelName(entry.model) !== canonical) return false;
    const from = new Date(entry.effectiveFrom).getTime();
    const to = entry.effectiveTo ? new Date(entry.effectiveTo).getTime() : Infinity;
    return atMs >= from && atMs < to;
  });
  if (!vigentes.length) return null;

  const proveedores = new Set(vigentes.map((entry) => entry.provider));
  if (proveedores.size > 1) return null;

  return vigentes.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

// Redondeo a 8 decimales: con precios de 0.10 USD/MTok, una llamada de 50
// tokens cuesta 5e-6 USD. Redondear a 6 la borraría del total.
function roundUsd(value) {
  return Math.round((Number(value) || 0) * 1e8) / 1e8;
}

/**
 * Calcula el costo de un evento.
 *
 * Devuelve siempre `{ costUsd, costStatus, pricingVersion, pricingSnapshot }`.
 * `costUsd` es null cuando no se pudo calcular — nunca 0 por omisión.
 */
function calculateCost(event = {}, catalog = RATE_CARDS) {
  const inputTokens = toNumber(event.inputTokens);
  const outputTokens = toNumber(event.outputTokens);
  const cachedInputTokens = toNumber(event.cachedInputTokens);
  const reasoningTokens = toNumber(event.reasoningTokens);
  const audioSeconds = toNumber(event.audioSeconds);
  const requestUnits = toNumber(event.requestUnits);

  const hayConsumo = inputTokens || outputTokens || cachedInputTokens
    || reasoningTokens || audioSeconds || requestUnits;

  const rateCard = findRate(
    { provider: event.provider, model: event.model, apiFamily: event.apiFamily, occurredAt: event.occurredAt },
    catalog
  );

  if (!rateCard) {
    return {
      costUsd: null,
      costStatus: COST_STATUSES.UNPRICED_NO_RATE,
      pricingVersion: '',
      pricingSnapshot: {}
    };
  }

  if (!hayConsumo) {
    // Hay tarifa pero el proveedor no dijo cuánto gastó. Se distingue de «no
    // hay tarifa» a propósito: son dos problemas distintos con dos arreglos
    // distintos (configurar precio vs. instrumentar la respuesta).
    return {
      costUsd: null,
      costStatus: COST_STATUSES.UNPRICED_NO_USAGE,
      pricingVersion: rateCard.version,
      pricingSnapshot: snapshotOf(rateCard)
    };
  }

  // Los tokens cacheados NO se suman a los de entrada: los proveedores que los
  // reportan ya los descuentan de input_tokens. Cobrarlos dos veces inflaría el
  // costo justo en los flujos que más se repiten.
  const inputCost = (inputTokens / 1e6) * (rateCard.inputPerMTok ?? 0);
  const cachedCost = (cachedInputTokens / 1e6)
    * (rateCard.cachedInputPerMTok ?? rateCard.inputPerMTok ?? 0);
  const outputCost = (outputTokens / 1e6) * (rateCard.outputPerMTok ?? 0);
  // Si el proveedor no cobra los tokens de razonamiento aparte, ya vienen
  // dentro de output_tokens; solo se cobran cuando hay tarifa específica.
  const reasoningCost = rateCard.reasoningPerMTok
    ? (reasoningTokens / 1e6) * rateCard.reasoningPerMTok
    : 0;
  const audioCost = rateCard.perMinuteUsd
    ? (audioSeconds / 60) * rateCard.perMinuteUsd
    : 0;
  const unitCost = rateCard.perRequestUsd ? requestUnits * rateCard.perRequestUsd : 0;

  const total = roundUsd(inputCost + cachedCost + outputCost + reasoningCost + audioCost + unitCost);

  return {
    costUsd: total,
    costStatus: total > 0 ? COST_STATUSES.PRICED : COST_STATUSES.FREE,
    pricingVersion: rateCard.version,
    pricingSnapshot: snapshotOf(rateCard)
  };
}

// Lo que se congela en el evento: suficiente para rehacer la cuenta a mano sin
// consultar el catálogo actual.
function snapshotOf(rateCard) {
  return {
    provider: rateCard.provider,
    model: rateCard.model,
    apiFamily: rateCard.apiFamily,
    version: rateCard.version,
    currency: rateCard.currency,
    inputPerMTok: rateCard.inputPerMTok,
    cachedInputPerMTok: rateCard.cachedInputPerMTok,
    outputPerMTok: rateCard.outputPerMTok,
    reasoningPerMTok: rateCard.reasoningPerMTok,
    perMinuteUsd: rateCard.perMinuteUsd,
    perRequestUsd: rateCard.perRequestUsd,
    sourceUrl: rateCard.sourceUrl,
    sourceCapturedAt: rateCard.sourceCapturedAt
  };
}

function listRates() {
  return RATE_CARDS.map((entry) => ({ ...entry }));
}

module.exports = {
  PRICING_VERSION,
  RATE_CARDS,
  calculateCost,
  findRate,
  findRateByModel,
  canonicalModelName,
  listRates,
  roundUsd
};
