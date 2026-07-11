// Validates assistant outputs: diagnostic suggestions are normalized against
// the real case evidence (transcript/note), definitive-diagnosis language is
// degraded to tentative wording, and chat answers are sanitized.
const SAFETY_NOTICE_CHAT = 'Apoyo clínico para revisión médica. No reemplaza el criterio profesional.';
const SAFETY_NOTICE_DIAGNOSTIC = 'Sugerencias generadas por IA para revisión médica. No constituyen diagnóstico confirmado.';

const MAX_SUGGESTIONS = 5;
const MAX_TITLE_LENGTH = 160;
const MAX_RATIONALE_LENGTH = 600;
const MAX_LIST_ITEM_LENGTH = 240;
const MAX_LIST_ITEMS = 8;
const MAX_ANSWER_LENGTH = 8000;
const SUGGESTION_TYPE = 'differential_or_working_impression';

// NFD accent-stripped + whitespace-collapsed comparison (same approach as the
// legacy ClinicalDiagnosisSuggestionService.normalizeComparableText) so literal
// evidence matching survives accents and line breaks.
function normalizeComparable(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// The note is compared as plain concatenated text (summary + section contents).
// Never JSON.stringify here: escapes would break literal includes matching.
function noteJsonToPlainText(noteJson) {
  if (!noteJson || typeof noteJson !== 'object') {
    return '';
  }
  const sections = Array.isArray(noteJson.sections) ? noteJson.sections : [];
  return [`${noteJson.summary || ''}`, ...sections.map((section) => `${section?.content || ''}`)].join('\n');
}

// Rewrites definitive-diagnosis wording into tentative clinical language.
function degradeDefinitiveLanguage(text = '') {
  return `${text || ''}`
    .replace(/diagn[oó]stico\s+(confirmado|definitivo)\s*(de|:)?\s*/gi, 'posibilidad clínica de ')
    .replace(/se\s+confirma\s+(el\s+diagn[oó]stico\s+de\s+)?/gi, 'es compatible con ')
    .replace(/\b(confirmado|confirmada)\b/gi, 'a considerar')
    .replace(/\b(definitivo|definitiva)\b/gi, 'tentativo')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, number));
}

class ClinicalAssistantValidationService {
  // Normalizes the diagnostic-suggestions LLM output. Every surviving
  // supporting_evidence item must literally appear in the transcript or the
  // note text; suggestions left without evidence are dropped entirely (the
  // model may not invent physical exams, vitals or history).
  normalizeSuggestions(parsed, { transcript = '', noteJson = null } = {}) {
    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const corpus = normalizeComparable(`${transcript}\n${noteJsonToPlainText(noteJson)}`);

    const suggestions = (Array.isArray(source.suggestions) ? source.suggestions : [])
      .slice(0, MAX_SUGGESTIONS)
      .map((raw) => {
        const supportingEvidence = coerceStringArray(raw?.supporting_evidence)
          .filter((evidence) => corpus.includes(normalizeComparable(evidence)));
        return {
          title: degradeDefinitiveLanguage(`${raw?.title || ''}`.trim().slice(0, MAX_TITLE_LENGTH)),
          type: SUGGESTION_TYPE,
          confidence: clampConfidence(raw?.confidence),
          rationale: degradeDefinitiveLanguage(`${raw?.rationale || ''}`.trim().slice(0, MAX_RATIONALE_LENGTH)),
          supporting_evidence: supportingEvidence,
          against_or_uncertain: coerceStringArray(raw?.against_or_uncertain),
          red_flags_to_check: coerceStringArray(raw?.red_flags_to_check),
          suggested_next_questions: coerceStringArray(raw?.suggested_next_questions)
        };
      })
      .filter((suggestion) => suggestion.title && suggestion.rationale && suggestion.supporting_evidence.length > 0);

    return {
      suggestions,
      safety_notice: SAFETY_NOTICE_DIAGNOSTIC
    };
  }

  sanitizeAnswer(text) {
    const answer = `${text || ''}`.trim().slice(0, MAX_ANSWER_LENGTH);
    return answer || 'No fue posible generar una respuesta útil con la información disponible. Reformula la pregunta o agrega más contexto clínico.';
  }
}

ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT = SAFETY_NOTICE_CHAT;
ClinicalAssistantValidationService.SAFETY_NOTICE_DIAGNOSTIC = SAFETY_NOTICE_DIAGNOSTIC;
ClinicalAssistantValidationService.degradeDefinitiveLanguage = degradeDefinitiveLanguage;
ClinicalAssistantValidationService.MAX_SUGGESTIONS = MAX_SUGGESTIONS;

module.exports = ClinicalAssistantValidationService;
