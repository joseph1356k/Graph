// Validates assistant outputs: diagnostic suggestions are normalized against
// the real case evidence (transcript/note), definitive-diagnosis language is
// degraded to tentative wording, chat answers are sanitized, and note
// adjustments are grounded (scope + literal evidence per added fact).
const SAFETY_NOTICE_CHAT = 'Apoyo clínico para revisión médica. No reemplaza el criterio profesional.';
const SAFETY_NOTICE_DIAGNOSTIC = 'Sugerencias generadas por IA para revisión médica. No constituyen diagnóstico confirmado.';

const MAX_SUGGESTIONS = 5;
const MAX_TITLE_LENGTH = 160;
const MAX_RATIONALE_LENGTH = 600;
const MAX_LIST_ITEM_LENGTH = 240;
const MAX_LIST_ITEMS = 8;
const MAX_ANSWER_LENGTH = 8000;
const SUGGESTION_TYPE = 'differential_or_working_impression';

// Ajuste de nota.
const MAX_ADDED_FACTS = 20;
const MAX_UNRESOLVED_ITEMS = 8;
const MAX_UNRESOLVED_LENGTH = 300;
const MAX_FACT_TEXT_LENGTH = 300;
// Una sección que crece más que esto sin que el modelo declare ningún hecho
// nuevo se marca igual: algo entró y nadie dijo de dónde.
const UNDECLARED_GROWTH_CHARS = 120;
const FACT_SOURCES = new Set(['transcripcion', 'anotaciones', 'nota', 'medico']);

// NFD accent-stripped + whitespace-collapsed comparison (same approach as the
// legacy ClinicalDiagnosisSuggestionService.normalizeComparableText) so literal
// evidence matching survives accents and line breaks.
function normalizeComparable(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

  // Ajuste de nota: acota y verifica lo que devolvió el modelo.
  //
  // Alcance: con `section_key` explícito solo esa sección puede cambiar; lo
  // demás que el modelo haya tocado se descarta (y el resumen también).
  //
  // Evidencia: cada hecho declarado en `added_facts` trae una cita literal y
  // la fuente de la que salió. La cita se busca, sin acentos ni espacios
  // dobles, en el corpus de ESA fuente (transcripción, anotaciones del médico,
  // nota original o instrucción). El cambio se aplica igual — decisión de
  // producto: "aceptar pero marcar" — y lo que no se encuentra sale en
  // `unverified` para que el médico lo mire antes de firmar. No se degrada el
  // lenguaje definitivo: aquí el médico sí puede afirmar un diagnóstico.
  groundAdjustedSections(modelSections, {
    originalNote = null,
    transcript = '',
    annotationsText = '',
    instruction = '',
    sectionKey = ''
  } = {}) {
    const originalSections = Array.isArray(originalNote?.sections) ? originalNote.sections : [];
    const originalByKey = new Map(originalSections.map((section) => [section.key, section]));
    const corpora = {
      transcripcion: normalizeComparable(transcript),
      anotaciones: normalizeComparable(annotationsText),
      nota: normalizeComparable(noteJsonToPlainText(originalNote)),
      medico: normalizeComparable(instruction)
    };
    const anyCorpus = Object.values(corpora).join('\n');
    const explicitKey = `${sectionKey || ''}`.trim();

    const unverified = [];
    const warnings = [];
    const sourcesUsed = { transcript: false, annotations: false, note: false, instruction: false };
    const sections = [];

    for (const raw of Array.isArray(modelSections) ? modelSections : []) {
      const key = `${raw?.key || ''}`.trim();
      const original = originalByKey.get(key);
      if (!key || !original) {
        continue;
      }
      if (explicitKey && key !== explicitKey) {
        warnings.push(`El modelo intentó cambiar "${original.label || key}" fuera de la sección pedida; se descartó.`);
        continue;
      }
      const content = typeof raw.content === 'string' ? raw.content.trim() : '';
      if (!content || content === `${original.content || ''}`.trim()) {
        continue;
      }

      const facts = (Array.isArray(raw.added_facts) ? raw.added_facts : [])
        .slice(0, MAX_ADDED_FACTS)
        .map((fact) => ({
          text: `${fact?.text || ''}`.trim().slice(0, MAX_FACT_TEXT_LENGTH),
          source: FACT_SOURCES.has(fact?.source) ? fact.source : '',
          quote: `${fact?.quote || ''}`.trim()
        }))
        .filter((fact) => fact.text);

      for (const fact of facts) {
        const quote = normalizeComparable(fact.quote);
        const corpus = fact.source ? corpora[fact.source] : anyCorpus;
        const found = Boolean(quote) && corpus.includes(quote);
        if (found) {
          if (fact.source === 'transcripcion') sourcesUsed.transcript = true;
          if (fact.source === 'anotaciones') sourcesUsed.annotations = true;
          if (fact.source === 'nota') sourcesUsed.note = true;
          if (fact.source === 'medico') sourcesUsed.instruction = true;
          if (!fact.source) sourcesUsed.transcript = true;
        } else {
          unverified.push({ section_key: key, text: fact.text });
        }
      }

      const growth = content.length - `${original.content || ''}`.length;
      if (!facts.length && growth > UNDECLARED_GROWTH_CHARS) {
        unverified.push({
          section_key: key,
          text: 'Contenido ampliado sin cita verificable en la consulta.'
        });
      }

      sections.push({
        ...original,
        content,
        confidence: Number.isFinite(Number(raw.confidence)) ? raw.confidence : original.confidence,
        evidence: typeof raw.evidence === 'string' && raw.evidence.trim() ? raw.evidence : original.evidence
      });
    }

    return { sections, unverified, warnings, sources_used: sourcesUsed };
  }

  sanitizeUnresolved(value) {
    return coerceStringArray(value, { maxItems: MAX_UNRESOLVED_ITEMS, maxLength: MAX_UNRESOLVED_LENGTH });
  }
}

ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT = SAFETY_NOTICE_CHAT;
ClinicalAssistantValidationService.SAFETY_NOTICE_DIAGNOSTIC = SAFETY_NOTICE_DIAGNOSTIC;
ClinicalAssistantValidationService.degradeDefinitiveLanguage = degradeDefinitiveLanguage;
ClinicalAssistantValidationService.MAX_SUGGESTIONS = MAX_SUGGESTIONS;

module.exports = ClinicalAssistantValidationService;
