// Traduce el bloque `usage` de cada proveedor al vocabulario normalizado.
//
// POR QUÉ HACE FALTA UNA CAPA. Cada proveedor nombra lo mismo distinto y
// reporta categorías distintas:
//   OpenAI / compatible : prompt_tokens, completion_tokens,
//                         prompt_tokens_details.cached_tokens,
//                         completion_tokens_details.reasoning_tokens
//   Responses API       : input_tokens, output_tokens, input_tokens_details
//   Anthropic           : input_tokens, output_tokens,
//                         cache_read_input_tokens, cache_creation_input_tokens
//   Gemini nativo       : promptTokenCount, candidatesTokenCount, totalTokenCount
//   Deepgram            : nada de tokens; duración del audio
// Sin normalizar, comparar proveedores en el dashboard sería imposible. Se
// conserva el bloque crudo del proveedor donde hace falta, pero lo que se
// agrega es esta forma común.
//
// UNA RESPUESTA SIN `usage` NO ES CERO. Devolvemos `hasUsage: false` para que
// el evento quede `unpriced_no_usage` en vez de sumar un cero que parecería una
// llamada gratis.

function intOf(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function firstNumber(...candidates) {
  for (const candidate of candidates) {
    const numeric = Math.trunc(Number(candidate));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

/** OpenAI Chat Completions, Azure Foundry, OpenRouter y Gemini vía capa OpenAI. */
function fromOpenAiCompatible(payload = {}) {
  const usage = payload?.usage || payload || {};
  const inputTokens = firstNumber(usage.prompt_tokens, usage.input_tokens);
  const outputTokens = firstNumber(usage.completion_tokens, usage.output_tokens);
  const cachedInputTokens = firstNumber(
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens,
    usage.cached_tokens
  );
  const reasoningTokens = firstNumber(
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.reasoning_tokens
  );
  const totalTokens = firstNumber(usage.total_tokens) || (inputTokens + outputTokens);

  return {
    hasUsage: Boolean(inputTokens || outputTokens || totalTokens),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
    servedModel: `${payload?.model || ''}`.trim(),
    providerRequestId: `${payload?.id || ''}`.trim()
  };
}

/** Anthropic Messages API. */
function fromAnthropic(payload = {}) {
  const usage = payload?.usage || {};
  const inputTokens = intOf(usage.input_tokens);
  const outputTokens = intOf(usage.output_tokens);
  // Los tokens leídos de caché se cobran aparte y NO están incluidos en
  // input_tokens en la API de Anthropic; los de creación sí se cobran como
  // entrada con recargo. Se registran por separado para no mezclarlos.
  const cachedInputTokens = intOf(usage.cache_read_input_tokens);
  const cacheCreationTokens = intOf(usage.cache_creation_input_tokens);

  return {
    hasUsage: Boolean(inputTokens || outputTokens),
    inputTokens: inputTokens + cacheCreationTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens: 0,
    totalTokens: inputTokens + cacheCreationTokens + outputTokens + cachedInputTokens,
    servedModel: `${payload?.model || ''}`.trim(),
    providerRequestId: `${payload?.id || ''}`.trim()
  };
}

/** Gemini nativo (generateContent), que no pasa por la capa compatible. */
function fromGemini(payload = {}) {
  const usage = payload?.usageMetadata || {};
  const inputTokens = intOf(usage.promptTokenCount);
  const outputTokens = intOf(usage.candidatesTokenCount);
  const cachedInputTokens = intOf(usage.cachedContentTokenCount);
  const reasoningTokens = intOf(usage.thoughtsTokenCount);
  const totalTokens = intOf(usage.totalTokenCount) || (inputTokens + outputTokens);

  return {
    hasUsage: Boolean(inputTokens || outputTokens || totalTokens),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
    servedModel: `${payload?.modelVersion || ''}`.trim(),
    providerRequestId: `${payload?.responseId || ''}`.trim()
  };
}

/** Deepgram: se factura por duración de audio, no por tokens. */
function fromDeepgram(payload = {}) {
  const seconds = Number(payload?.metadata?.duration);
  const hasUsage = Number.isFinite(seconds) && seconds > 0;
  return {
    hasUsage,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    audioSeconds: hasUsage ? Math.round(seconds * 1000) / 1000 : 0,
    servedModel: `${payload?.metadata?.models?.[0] || ''}`.trim(),
    providerRequestId: `${payload?.metadata?.request_id || ''}`.trim()
  };
}

/**
 * Acumula el uso de una respuesta en streaming. Los chunks SSE traen el bloque
 * `usage` solo al final (y solo si se pidió), así que se conserva el último no
 * vacío en vez de sumar chunk a chunk, que contaría de más.
 */
function createStreamUsageAccumulator(extractor = fromOpenAiCompatible) {
  let latest = null;
  let chunks = 0;
  return {
    push(chunk) {
      chunks += 1;
      const parsed = extractor(chunk);
      if (parsed?.hasUsage) {
        latest = parsed;
      }
    },
    result() {
      if (!latest) {
        return { hasUsage: false, streamChunks: chunks };
      }
      return { ...latest, streamChunks: chunks };
    }
  };
}

/** Convierte la forma normalizada en el payload que espera el grabador. */
function toRecorderUsage(parsed = {}) {
  if (!parsed || parsed.hasUsage === false) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const payload = {
    inputTokens: intOf(parsed.inputTokens),
    outputTokens: intOf(parsed.outputTokens),
    cachedInputTokens: intOf(parsed.cachedInputTokens),
    reasoningTokens: intOf(parsed.reasoningTokens),
    totalTokens: intOf(parsed.totalTokens)
  };
  if (parsed.audioSeconds) payload.audioSeconds = parsed.audioSeconds;
  if (parsed.servedModel) payload.servedModel = parsed.servedModel;
  if (parsed.providerRequestId) payload.providerRequestId = parsed.providerRequestId;
  return payload;
}

module.exports = {
  fromOpenAiCompatible,
  fromAnthropic,
  fromGemini,
  fromDeepgram,
  createStreamUsageAccumulator,
  toRecorderUsage
};
