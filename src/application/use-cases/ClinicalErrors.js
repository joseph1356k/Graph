// @ts-check
// Stable error codes for the clinical API. Routes translate these into
// { error: { code, message } } responses; messages are user-facing (no PHI,
// no stack traces).
const CLINICAL_ERROR_STATUS = {
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_INVALID: 400,
  ENCOUNTER_NOT_FOUND: 404,
  ENCOUNTER_INVALID: 400,
  TRANSCRIPT_REQUIRED: 400,
  TRANSCRIPT_TOO_LONG: 413,
  LLM_NOT_CONFIGURED: 503,
  NOTE_GENERATION_FAILED: 502,
  NOTE_JSON_INVALID: 400,
  ASSISTANT_INVALID: 400,
  ASSISTANT_FAILED: 502,
  UNAUTHORIZED: 401,
  SUPABASE_NOT_CONFIGURED: 503,

  // Exportación de nota a historia clínica (graph_note_exports).
  EXPORT_INVALID: 400,
  EXPORT_FORBIDDEN: 403,
  EXPORT_NOT_FOUND: 404,
  CONSULTATION_NOT_FOUND: 404,
  // 409: el estado de la consulta o del trabajo no permite la operación. No es
  // un error del cliente que se arregle reintentando igual.
  CONSULTATION_NOT_APPROVED: 409,
  CONSULTATION_NOT_SIGNED: 409,
  CONSULTATION_ALREADY_EXPORTED: 409,
  CONSULTATION_IS_DEMO: 409,
  EXPORT_ALREADY_EXISTS: 409,
  EXPORT_NOT_RETRYABLE: 409,
  EXPORT_NOT_CANCELLABLE: 409,
  EXPORT_NOT_CLAIMED: 409,
  EXPORT_NOT_OWNED: 409,
  EXPORT_LEASE_EXPIRED: 409,
  // El contenido no coincide con lo que el médico firmó: nunca se exporta.
  SIGNATURE_HASH_MISMATCH: 422,
  WORKFLOW_NOT_CONFIGURED: 503
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
