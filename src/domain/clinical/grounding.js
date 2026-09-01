// Nivel de soporte de un dato clínico en su fuente.
//
// Antes cada modelo devolvía un `confidence` como 0.87, que no era una
// probabilidad de nada: cambiaba entre proveedores y versiones, y el código
// cortaba duro sobre él (0.75 en el matcher, 0.7 en valores dinámicos, 0.5 en
// la revisión del portal). Ahora el modelo devuelve un NIVEL con semántica
// («aparece literal», «se deduce», «se interpreta», «no está») y el número se
// CALCULA aquí. El número se conserva porque hay consumidores del contrato
// (`note-review.ts`, `/api/v1/autofill/match`) que lo leen.
//
// El mapeo no es arbitrario: `inferred` = 0.4 queda por debajo del umbral 0.5
// del portal a propósito, para que una sección interpretada dispare el badge
// de «confianza baja» y el médico la mire.

const GROUNDING_LEVELS = Object.freeze(['explicit', 'entailed', 'inferred', 'absent']);

// Una edición humana es la fuente más fuerte que existe: el médico lo escribió.
const EDITED = 'edited';

const CONFIDENCE_BY_GROUNDING = Object.freeze({
  explicit: 1,
  entailed: 0.8,
  inferred: 0.4,
  absent: 0,
  [EDITED]: 1
});

// Centinela para contenido que el médico dictó explícitamente para la nota
// (ajuste en modo `dictation`): la fuente es el propio médico, así que no hay
// fragmento de transcripción que citar y el validador no debe descartarlo.
const DICTATION_EVIDENCE = '[dictado del médico]';

function normalizeGrounding(value) {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === EDITED) return EDITED;
  return GROUNDING_LEVELS.includes(normalized) ? normalized : null;
}

function confidenceFromGrounding(grounding) {
  const level = normalizeGrounding(grounding);
  return level ? CONFIDENCE_BY_GROUNDING[level] : 0;
}

// Compatibilidad con salidas que todavía traen sólo el número (modelos viejos,
// notas persistidas antes del cambio). Es una aproximación, y se usa sólo cuando
// no llegó `grounding`.
function groundingFromConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0.9) return 'explicit';
  if (number >= 0.6) return 'entailed';
  if (number > 0) return 'inferred';
  return 'absent';
}

// Lo que el field matcher y el resolvedor de valores dinámicos aceptan para
// escribir en un formulario real: explícito o deducido sin ambigüedad. Nunca
// una interpretación.
function isGroundedForAutofill(grounding) {
  const level = normalizeGrounding(grounding);
  return level === 'explicit' || level === 'entailed';
}

module.exports = {
  GROUNDING_LEVELS,
  EDITED,
  CONFIDENCE_BY_GROUNDING,
  DICTATION_EVIDENCE,
  normalizeGrounding,
  confidenceFromGrounding,
  groundingFromConfidence,
  isGroundedForAutofill
};
