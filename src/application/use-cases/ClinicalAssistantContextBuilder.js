const ClinicalTemplateService = require('./ClinicalTemplateService');

// Builds the clinical context the assistant prompts consume. Pure module
// (WorkflowAssistantPolicy pattern): no state, no IO — it receives the
// encounter already loaded (ownership is enforced upstream by
// ClinicalEncounterService.getOwnedEncounter).
const DEFAULT_SPECIALTY = 'medicina_general';
const MAX_PROMPT_TRANSCRIPT_LENGTH = 16000;
const MAX_VISIBLE_TEXT_LENGTH = 2000;
const MAX_SCREEN_FIELD_LENGTH = 300;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const ALLOWED_HISTORY_ROLES = new Set(['user', 'assistant']);
// Whitelist of screen_context fields the frontend may send; anything else is dropped.
const SCREEN_CONTEXT_FIELDS = [
  'route',
  'page',
  'visible_panel',
  'selected_section_key',
  'selected_section_label',
  'visible_text',
  'user_intent_surface'
];

// Who the doctor is and how they asked to be spoken to (web app: Configuración
// > Asistente). Kept OUT of screen_context on purpose: that object describes
// what is on screen right now and the prompt tells the model it may be stale,
// while this is a stable preference the model should honour.
//
// Same whitelist discipline as screen_context, plus closed enums: the values
// end up inside the system prompt, so an unbounded string here would be a
// prompt-injection surface handed straight to the model. `display_name` is the
// only free text and it is capped and stripped of line breaks.
const MAX_DOCTOR_NAME_LENGTH = 80;
const DOCTOR_ADDRESS_VALUES = new Set(['tu', 'usted']);
const DOCTOR_DETAIL_VALUES = new Set(['breve', 'equilibrado', 'detallado']);

function sanitizeDoctor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const sanitized = {};

  const name = typeof raw.display_name === 'string' ? raw.display_name : '';
  // Newlines would let a crafted "name" open a new instruction line inside the
  // system prompt; they are collapsed, never forwarded.
  const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, MAX_DOCTOR_NAME_LENGTH);
  if (cleanName) {
    sanitized.display_name = cleanName;
  }

  if (typeof raw.address === 'string' && DOCTOR_ADDRESS_VALUES.has(raw.address)) {
    sanitized.address = raw.address;
  }
  if (typeof raw.detail === 'string' && DOCTOR_DETAIL_VALUES.has(raw.detail)) {
    sanitized.detail = raw.detail;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeScreenContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const sanitized = {};
  for (const field of SCREEN_CONTEXT_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    const cap = field === 'visible_text' ? MAX_VISIBLE_TEXT_LENGTH : MAX_SCREEN_FIELD_LENGTH;
    sanitized[field] = value.trim().slice(0, cap);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

// Anti prompt-injection: only user/assistant turns survive; content is coerced
// to bounded strings. Anything else (e.g. injected role:"system") is dropped.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === 'object' && ALLOWED_HISTORY_ROLES.has(item.role))
    .map((item) => ({
      role: item.role,
      content: `${item.content || ''}`.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH)
    }))
    .filter((item) => item.content)
    .slice(-MAX_HISTORY_ITEMS);
}

function resolveSpecialty(encounter, specialtyInput) {
  const fromSnapshot = `${encounter?.template_snapshot?.specialty || ''}`.trim();
  if (fromSnapshot) {
    return { specialty: fromSnapshot, source: 'template_snapshot' };
  }
  const normalizedInput = ClinicalTemplateService.normalizeSpecialty(specialtyInput);
  if (normalizedInput) {
    return { specialty: normalizedInput, source: 'request' };
  }
  return { specialty: DEFAULT_SPECIALTY, source: 'fallback' };
}

function build({ encounter = null, specialtyInput = '', screenContext = null, history = [], doctor = null } = {}) {
  const { specialty, source: specialtySource } = resolveSpecialty(encounter, specialtyInput);
  const sanitizedScreen = sanitizeScreenContext(screenContext);
  const sanitizedDoctor = sanitizeDoctor(doctor);
  const sanitizedHistory = sanitizeHistory(history);

  const fullTranscript = `${encounter?.transcript || ''}`.trim();
  const promptTranscript = fullTranscript.length > MAX_PROMPT_TRANSCRIPT_LENGTH
    ? `${fullTranscript.slice(0, MAX_PROMPT_TRANSCRIPT_LENGTH)}\n[transcripción truncada para el prompt]`
    : fullTranscript;

  const noteJson = encounter?.note_json && typeof encounter.note_json === 'object'
    ? encounter.note_json
    : null;
  const snapshot = encounter?.template_snapshot && typeof encounter.template_snapshot === 'object'
    ? encounter.template_snapshot
    : null;

  const clinicalContext = {
    specialty,
    specialty_source: specialtySource,
    encounter: encounter
      ? {
        id: encounter.id,
        consultation_type: encounter.consultation_type || '',
        status: encounter.status || '',
        template_name: snapshot?.name || '',
        template_sections: Array.isArray(snapshot?.sections)
          ? snapshot.sections.map((section) => ({
            key: section.key,
            label: section.label,
            required: Boolean(section.required)
          }))
          : []
      }
      : null,
    transcript: promptTranscript,
    note_json: noteJson
      ? {
        summary: `${noteJson.summary || ''}`,
        sections: Array.isArray(noteJson.sections) ? noteJson.sections : [],
        warnings: Array.isArray(noteJson.warnings) ? noteJson.warnings : [],
        missing_required_sections: Array.isArray(noteJson.missing_required_sections)
          ? noteJson.missing_required_sections
          : []
      }
      : null,
    screen_context: sanitizedScreen,
    doctor: sanitizedDoctor,
    history: sanitizedHistory
  };

  const usedContext = {
    encounter: Boolean(encounter),
    transcript: Boolean(fullTranscript),
    note_json: Boolean(noteJson),
    screen_context: Boolean(sanitizedScreen),
    doctor: Boolean(sanitizedDoctor)
  };

  return { clinicalContext, usedContext, fullTranscript };
}

module.exports = {
  build,
  sanitizeScreenContext,
  sanitizeDoctor,
  sanitizeHistory,
  resolveSpecialty,
  DEFAULT_SPECIALTY,
  MAX_PROMPT_TRANSCRIPT_LENGTH,
  MAX_HISTORY_ITEMS
};
