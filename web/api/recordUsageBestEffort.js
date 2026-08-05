// Adaptador para consumo reportado por un servicio AGUAS ARRIBA.
//
// Cuándo se usa: solo cuando quien llamó al proveedor NO fue este proceso. Hoy
// eso es el runtime de Miracle (Python), que hace su propia llamada y nos
// devuelve un bloque `usage` en la respuesta. Sin esto, ese consumo no se vería.
//
// Cuándo NO se usa: para nada que pase por LLMProvider, los cerebros
// conscientes o Deepgram. Esos ya se instrumentan en su propia capa; anotarlos
// aquí además los contaría dos veces. La versión anterior de este archivo se
// llamaba a mano desde ocho rutas y esa es justo la trampa que se evita ahora.

const { API_FAMILIES, ACTOR_TYPES } = require('../../src/domain/usage/vocabulary');

function toInt(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/**
 * @param {object} recorder AiUsageRecorder
 * @returns {function} recordUpstreamUsage(usage, descriptor)
 */
function createUpstreamUsageRecorder(recorder) {
  return function recordUpstreamUsage(usage, descriptor = {}) {
    if (!recorder || !usage || typeof usage !== 'object') {
      return;
    }
    const inputTokens = toInt(usage.input_tokens ?? usage.inputTokens);
    const outputTokens = toInt(usage.output_tokens ?? usage.outputTokens);
    // Sin cifras no hay consumo que anotar: registrar un evento en cero haría
    // creer que la llamada salió gratis.
    if (!inputTokens && !outputTokens) {
      return;
    }
    try {
      recorder.record({
        provider: `${usage.provider || 'unknown'}`,
        apiFamily: `${usage.api_family || usage.apiFamily || API_FAMILIES.CHAT_COMPLETIONS}`,
        requestedModel: `${usage.model || ''}`,
        servedModel: `${usage.served_model || usage.model || ''}`,
        inputTokens,
        outputTokens,
        cachedInputTokens: toInt(usage.cached_tokens ?? usage.cachedInputTokens),
        totalTokens: toInt(usage.total_tokens ?? usage.totalTokens),
        status: descriptor.status || 'ok',
        latencyMs: descriptor.latencyMs ?? null,
        sessionId: descriptor.sessionId || '',
        workflowId: descriptor.workflowId || '',
        // El módulo lo sabe la ruta; el resto (usuario, organización, app) lo
        // aporta el contexto de atribución de la petición.
        ...(descriptor.feature ? { feature: descriptor.feature } : {}),
        ...(descriptor.actorType ? { actorType: descriptor.actorType } : {}),
        metadata: descriptor.metadata || {}
      });
    } catch (error) {
      console.warn(`[Usage] No se pudo registrar consumo aguas arriba: ${error.message}`);
    }
  };
}

module.exports = createUpstreamUsageRecorder;
module.exports.ACTOR_TYPES = ACTOR_TYPES;
