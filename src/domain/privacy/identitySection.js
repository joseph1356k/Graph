// Lectura de la casilla de identificación («Nombre: …» / «Documento: …») tal
// como la escribe el modelo. Espejo de parsePatientIdentitySection del portal
// (lib/clinical/patient-identity.ts), reducido a lo que necesita el chequeo
// post-hoc: saber si el modelo escribió un dato REAL donde debía haber un
// marcador. Si lo hizo, es que lo vio en el prompt — y eso es una fuga que el
// detector no atrapó.

const { findTokens } = require('./tokens');
const { PRUDENT_VALUE } = require('./detectors');
const { normalizeToken } = require('./canon');

const IDENTITY_SECTION_KEY = 'identificacion_del_paciente';
const LINEA_NOMBRE = /^[ \t]*nombre\b[^:\n]*:[ \t]*(.+)$/im;
const LINEA_DOCUMENTO = /^[ \t]*(?:documento|c[ée]dula|identificaci[óo]n|cc|ti|nuip)\b[^:\n]*:[ \t]*(.+)$/im;

function classify(raw) {
  const value = `${raw ?? ''}`.trim();
  if (!value) return { present: false };
  const token = findTokens(value).length > 0;
  const prudent = PRUDENT_VALUE.test(normalizeToken(value));
  return { present: true, token, prudent, real: !token && !prudent };
}

/** Lee las dos líneas de la casilla. */
function parseIdentityLines(text) {
  const content = `${text ?? ''}`;
  const nombre = LINEA_NOMBRE.exec(content)?.[1];
  const documento = LINEA_DOCUMENTO.exec(content)?.[1];
  return {
    nombre: classify(nombre),
    documento: classify(documento)
  };
}

function findIdentitySection(noteJson) {
  const sections = Array.isArray(noteJson?.sections) ? noteJson.sections : [];
  return sections.find((section) => `${section?.key || ''}`.includes(IDENTITY_SECTION_KEY)) || null;
}

/**
 * Chequeo post-hoc sobre la respuesta CRUDA (antes de restaurar): un nombre o
 * documento real en la casilla significa que el modelo lo vio.
 */
function posthocLeakCheck(rawContent) {
  let parsed = null;
  try {
    parsed = JSON.parse(`${rawContent ?? ''}`);
  } catch (error) {
    return { checked: false, leak: false, reason: 'no_json' };
  }
  const section = findIdentitySection(parsed);
  if (!section) return { checked: false, leak: false, reason: 'sin_casilla' };
  const lines = parseIdentityLines(section.content ?? section.texto ?? '');
  const leak = Boolean(lines.nombre.real || lines.documento.real);
  return { checked: true, leak, nombre: lines.nombre, documento: lines.documento };
}

module.exports = {
  IDENTITY_SECTION_KEY,
  parseIdentityLines,
  findIdentitySection,
  posthocLeakCheck
};
