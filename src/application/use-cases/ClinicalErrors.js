// Stable error codes for the clinical API. Routes translate these into
// { error: { code, message } } responses; messages are user-facing (no PHI,
// no stack traces).
const CLINICAL_ERROR_STATUS = {
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_INVALID: 400,
  ENCOUNTER_NOT_FOUND: 404,
  ENCOUNTER_INVALID: 400,
  CONSENT_REQUIRED: 400,
  TRANSCRIPT_REQUIRED: 400,
  TRANSCRIPT_TOO_LONG: 413,
  LLM_NOT_CONFIGURED: 503,
  NOTE_GENERATION_FAILED: 502,
  NOTE_JSON_INVALID: 400,
  ASSISTANT_INVALID: 400,
  ASSISTANT_FAILED: 502,
  UNAUTHORIZED: 401,
  SUPABASE_NOT_CONFIGURED: 503
};

function clinicalError(code, message, statusCode = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || CLINICAL_ERROR_STATUS[code] || 500;
  return error;
}

function isClinicalError(error) {
  return Boolean(error && Object.prototype.hasOwnProperty.call(CLINICAL_ERROR_STATUS, error.code));
}

module.exports = {
  CLINICAL_ERROR_STATUS,
  clinicalError,
  isClinicalError
};
