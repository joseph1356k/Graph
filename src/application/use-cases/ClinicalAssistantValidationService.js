// Valida las salidas del asistente. Las sugerencias diagnósticas se normalizan
// contra la evidencia real del caso (transcripción/nota/texto), y el lenguaje
// definitivo se DETECTA, no se reescribe.
//
// Antes aquí había un regex que cambiaba "confirmado" por "a considerar" en el
// título y la justificación. Eso alteraba HECHOS del paciente: «contacto
// confirmado de tuberculosis» salía como «contacto a considerar de
// tuberculosis». La capa de seguridad no puede corromper datos clínicos. Ahora
// una sugerencia con redacción definitiva conserva su texto, baja a
// `inferred`, recibe una nota de incertidumbre y se cuenta.
const text = require('../../domain/clinical/textNormalize');
const grounding = require('../../domain/clinical/grounding');

const SAFETY_NOTICE_CHAT = 'Apoyo clínico para revisión médica. No reemplaza el criterio profesional.';
const SAFETY_NOTICE_DIAGNOSTIC = 'Sugerencias generadas por IA para revisión médica. No constituyen diagnóstico confirmado.';
// Texto del endpoint de texto plano (plugin), sin cambios de contrato.
const LEGACY_REVIEW_NOTICE = 'Sugerencias de IA para revisión médica. No constituyen diagnósticos confirmados.';
const DEFINITIVE_LANGUAGE_NOTE = 'Redacción definitiva detectada: tratar como hipótesis pendiente de confirmación.';

const MAX_SUGGESTIONS = 5;
const MAX_TITLE_LENGTH = 160;
const MAX_RATIONALE_LENGTH = 600;
const MAX_LIST_ITEM_LENGTH = 240;
const MAX_LIST_ITEMS = 8;
const MAX_ANSWER_LENGTH = 8000;
const SUGGESTION_TYPE = 'differential_or_working_impression';

const DEFINITIVE_PATTERNS = [
  /diagn[oó]stico\s+(confirmado|definitivo)/i,
  /se\s+confirma\b/i,
  /\b(confirmado|confirmada|confirmamos)\b/i,
  /\b(definitivo|definitiva)\b/i,
  /\bes\s+(un|una)\s+[a-záéíóú]+\b(?!\s+(posible|probable))/i
];

// La nota se compara como texto plano (summary + contenidos). Nunca
// JSON.stringify: los escapes romperían la comparación literal.
function noteJsonToPlainText(noteJson) {
  if (!noteJson || typeof noteJson !== 'object') {
    return '';
  }
  const sections = Array.isArray(noteJson.sections) ? noteJson.sections : [];
  return [`${noteJson.summary || ''}`, ...sections.map((section) => `${section?.content || ''}`)].join('\n');
}

/** true si el texto afirma un diagnóstico como hecho en vez de como hipótesis. */
function detectDefinitiveLanguage(value = '') {
  const candidate = `${value || ''}`;
  if (!candidate.trim()) return false;
  return DEFINITIVE_PATTERNS.slice(0, 4).some((pattern) => pattern.test(candidate));
}

function coerceStringArray(value, { maxItems = MAX_LIST_ITEMS, maxLength = MAX_LIST_ITEM_LENGTH } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => `${item || ''}`.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

class ClinicalAssistantValidationService {
  /**
   * Normaliza las sugerencias del modelo. Cada `supporting_evidence` tiene que
   * aparecer literal en la transcripción, en la nota o en `noteText`; la
   * sugerencia que se queda sin evidencia se descarta entera (el modelo no
   * puede inventar examen físico, constantes ni antecedentes).
   */
  normalizeSuggestions(parsed, { transcript = '', noteJson = null, noteText = '' } = {}) {
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const corpus = text.normalizeComparable(`${transcript}\n${noteJsonToPlainText(noteJson)}\n${noteText}`);
    let definitiveHits = 0;

    const suggestions = (Array.isArray(source.suggestions) ? source.suggestions : [])
      .slice(0, MAX_SUGGESTIONS)
      .map((raw) => {
        const supportingEvidence = coerceStringArray(raw?.supporting_evidence)
          .filter((evidence) => corpus.includes(text.normalizeComparable(evidence)));
        const title = `${raw?.title || ''}`.trim().slice(0, MAX_TITLE_LENGTH);
        const rationale = `${raw?.rationale || ''}`.trim().slice(0, MAX_RATIONALE_LENGTH);
        const against = coerceStringArray(raw?.against_or_uncertain);

        let level = grounding.normalizeGrounding(raw?.grounding)
          || grounding.groundingFromConfidence(raw?.confidence)
          || (supportingEvidence.length > 0 ? 'entailed' : 'inferred');
        if (level === 'edited') level = 'entailed';

        if (detectDefinitiveLanguage(title) || detectDefinitiveLanguage(rationale)) {
          definitiveHits += 1;
          level = 'inferred';
          if (!against.includes(DEFINITIVE_LANGUAGE_NOTE)) {
            against.unshift(DEFINITIVE_LANGUAGE_NOTE);
          }
        }

        return {
          title,
          type: SUGGESTION_TYPE,
          grounding: level,
          confidence: grounding.confidenceFromGrounding(level),
          rationale,
          supporting_evidence: supportingEvidence,
          against_or_uncertain: against.slice(0, MAX_LIST_ITEMS),
          red_flags_to_check: coerceStringArray(raw?.red_flags_to_check),
          suggested_next_questions: coerceStringArray(raw?.suggested_next_questions)
        };
      })
      .filter((suggestion) => suggestion.title && suggestion.rationale && suggestion.supporting_evidence.length > 0);

    return {
      suggestions,
      safety_notice: SAFETY_NOTICE_DIAGNOSTIC,
      definitive_language_hits: definitiveHits
    };
  }

  /**
   * Proyección al contrato del endpoint de texto plano
   * (POST /api/clinical/diagnosis-suggestions), que el plugin consume tal cual.
   */
  toLegacyProjection(result = {}) {
    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    return {
      suggestions: suggestions.map((suggestion) => ({
        title: suggestion.title,
        rationale: suggestion.rationale,
        supportingEvidence: suggestion.supporting_evidence[0] || ''
      })),
      reviewNotice: LEGACY_REVIEW_NOTICE
    };
  }

  sanitizeAnswer(value) {
    const answer = `${value || ''}`.trim().slice(0, MAX_ANSWER_LENGTH);
    return answer || 'No fue posible generar una respuesta útil con la información disponible. Reformula la pregunta o agrega más contexto clínico.';
  }
}

ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT = SAFETY_NOTICE_CHAT;
ClinicalAssistantValidationService.SAFETY_NOTICE_DIAGNOSTIC = SAFETY_NOTICE_DIAGNOSTIC;
ClinicalAssistantValidationService.LEGACY_REVIEW_NOTICE = LEGACY_REVIEW_NOTICE;
ClinicalAssistantValidationService.DEFINITIVE_LANGUAGE_NOTE = DEFINITIVE_LANGUAGE_NOTE;
ClinicalAssistantValidationService.detectDefinitiveLanguage = detectDefinitiveLanguage;
ClinicalAssistantValidationService.MAX_SUGGESTIONS = MAX_SUGGESTIONS;

module.exports = ClinicalAssistantValidationService;
