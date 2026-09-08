// Ámbito de privacidad propagado con AsyncLocalStorage, espejo de UsageContext.
//
// LO FIJA EL SERVICIO QUE CONOCE EL ENCOUNTER, NO LA RUTA. El rescate
// oportunista (web/api/opportunisticRescue.js) llama a `generate()` de OTRO
// encounter dentro del contexto asíncrono de la petición de un médico
// cualquiera: un ámbito heredado de un middleware ataría la consulta
// equivocada. Así que `ClinicalNoteGeneratorService`, `ClinicalAssistantService`
// y el matcher envuelven su llamada con `withPrivacyScope({ encounter })`, igual
// que ya hacen con `withFeature(…, { sessionId })`.
//
// El ámbito también recoge los RESULTADOS de cada llamada tapada dentro de él,
// para que el servicio pueda devolverle al médico qué se protegió (conteos,
// nunca valores).

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function currentPrivacyScope() {
  return storage.getStore() || null;
}

/**
 * @param {object} scope
 * @param {object} [scope.encounter]      encounter cargado y verificado (transcript, note_json, patient_id, doctor_id)
 * @param {string} [scope.encounterId]
 * @param {string} [scope.consultationId] id de `consultations` (Operations)
 * @param {Array}  [scope.seeds]          semillas explícitas [{ type, value }]
 * @param {string} [scope.noteContent]    texto de la nota (matcher)
 */
function withPrivacyScope(scope, fn) {
  const store = {
    ...(scope || {}),
    results: [],
    seedCache: null
  };
  return storage.run(store, fn);
}

function recordPrivacyResult(result) {
  const scope = currentPrivacyScope();
  if (scope && Array.isArray(scope.results)) {
    scope.results.push(result);
  }
}

function lastPrivacyResult() {
  const scope = currentPrivacyScope();
  if (!scope || !Array.isArray(scope.results) || scope.results.length === 0) return null;
  return scope.results[scope.results.length - 1];
}

module.exports = {
  withPrivacyScope,
  currentPrivacyScope,
  recordPrivacyResult,
  lastPrivacyResult
};
