// Translates a provider failure (thrown by LLMProvider.postChatCompletions,
// which attaches `status` and the provider's own `error.code`/`error.type`)
// into a stable clinical error code.
//
// Why this exists: every LLM-backed clinical use case used to funnel ANY
// provider failure into a single "falló, intenta de nuevo" code. A spent quota
// and a revoked key then reached the doctor disguised as a transient blip, with
// a Retry button that could never succeed, and the real cause only survived in
// the server logs. These four cases are worth telling apart because each has a
// different owner and a different fix.
//
// Returns null when the failure is not one of the recognizable configuration or
// billing problems, so callers keep their own fallback code (a genuine engine
// failure: malformed response, timeout, 5xx).

// OpenAI answers a spent quota with HTTP 429 — the same status as a real rate
// limit — so the provider's error code has to be checked BEFORE the status.
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'quota_exceeded'
]);

const AUTH_CODES = new Set([
  'invalid_api_key',
  'invalid_authentication',
  'account_deactivated',
  'permission_denied'
]);

const MODEL_CODES = new Set([
  'model_not_found',
  'unknown_model',
  'deployment_not_found'
]);

function normalize(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function classifyLlmFailure(error) {
  const code = normalize(error?.providerErrorCode);
  const type = normalize(error?.providerErrorType);
  const status = Number(error?.status) || 0;

  if (QUOTA_CODES.has(code) || QUOTA_CODES.has(type)) {
    return 'LLM_QUOTA_EXCEEDED';
  }
  if (AUTH_CODES.has(code) || AUTH_CODES.has(type) || status === 401 || status === 403) {
    return 'LLM_AUTH_FAILED';
  }
  if (MODEL_CODES.has(code) || status === 404) {
    return 'LLM_MODEL_NOT_FOUND';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  return null;
}

module.exports = {
  classifyLlmFailure,
  QUOTA_CODES,
  AUTH_CODES,
  MODEL_CODES
};
