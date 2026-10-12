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

// La nota tal como está EN PANTALLA (note_json_draft). Manda sobre la
// persistida: el médico pregunta por lo que está viendo, no por la foto que
// Graph guardó hace cinco minutos. Solo key/label/content: grounding y
// evidencia los recalcula el validador si el asistente propone un cambio.
const MAX_DRAFT_SECTIONS = 40;
const MAX_DRAFT_SECTION_CHARS = 8000;
const MAX_DRAFT_TOTAL_CHARS = 40000;
const MAX_DRAFT_SUMMARY_CHARS = 2000;
const MAX_DRAFT_KEY_LENGTH = 80;
const MAX_DRAFT_LABEL_LENGTH = 120;

// Códigos de la pestaña Codificación de la web. Graph no los persiste (viven
// en `consultations.codigos`); aquí solo son contexto para razonar y para
// que el retrieval de guías suba la que lista ese código.
const MAX_CODES = 20;
const MAX_CODE_LENGTH = 12;
const MAX_CODE_DESCRIPTION_LENGTH = 160;
const CODE_SYSTEMS = new Set(['CIE-10', 'CUPS']);
const CODE_STATES = new Set(['sugerido', 'aceptado']);

// Edad y sexo: lo que el razonamiento clínico necesita (dosis por edad,
// riesgo). Nunca nombre ni documento: eso lo tapa el escudo y no se pide.
const PATIENT_SEX_VALUES = new Set(['F', 'M']);
const MAX_PATIENT_AGE = 120;

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

/**
 * Borrador de nota del cliente. Con snapshot del encounter, solo sobreviven
 * las keys de la plantilla (una key inventada no puede colarse al prompt ni
 * a la propuesta). Sin snapshot (consulta anterior al puente, supervisor), el
 * borrador define por sí mismo las secciones.
 */
function sanitizeNoteDraft(raw, templateSnapshot = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const snapshotSections = Array.isArray(templateSnapshot?.sections) ? templateSnapshot.sections : [];
  const allowedKeys = snapshotSections.length > 0
    ? new Set(snapshotSections.map((section) => `${section?.key || ''}`.trim()).filter(Boolean))
    : null;
  const labelsByKey = new Map(
    snapshotSections.map((section) => [`${section?.key || ''}`.trim(), `${section?.label || ''}`.trim()])
  );
  const seen = new Set();
  const sections = [];
  let total = 0;
  for (const item of Array.isArray(raw.sections) ? raw.sections : []) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.key || ''}`.trim().slice(0, MAX_DRAFT_KEY_LENGTH);
    if (!key || seen.has(key)) continue;
    if (allowedKeys && !allowedKeys.has(key)) continue;
    const label = (`${item.label || ''}`.replace(/\s+/g, ' ').trim() || labelsByKey.get(key) || key).slice(0, MAX_DRAFT_LABEL_LENGTH);
    const content = `${item.content ?? ''}`.trim().slice(0, MAX_DRAFT_SECTION_CHARS);
    if (total + content.length > MAX_DRAFT_TOTAL_CHARS) break;
    total += content.length;
    seen.add(key);
    sections.push({ key, label, content });
    if (sections.length >= MAX_DRAFT_SECTIONS) break;
  }
  if (!sections.length) {
    return null;
  }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, MAX_DRAFT_SUMMARY_CHARS) : '';
  return { summary, sections };
}

function sanitizeCodes(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set();
  const codes = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const sistema = `${item.sistema || ''}`.trim();
    const codigo = `${item.codigo || ''}`.trim().toUpperCase().slice(0, MAX_CODE_LENGTH);
    if (!CODE_SYSTEMS.has(sistema) || !codigo) continue;
    const id = `${sistema}:${codigo}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const estado = CODE_STATES.has(`${item.estado || ''}`) ? `${item.estado}` : 'sugerido';
    codes.push({
      sistema,
      codigo,
      descripcion: `${item.descripcion || ''}`.replace(/\s+/g, ' ').trim().slice(0, MAX_CODE_DESCRIPTION_LENGTH),
      estado
    });
    if (codes.length >= MAX_CODES) break;
  }
  return codes;
}

function sanitizePatientContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const sanitized = {};
  const edad = Number(raw.edad);
  if (Number.isInteger(edad) && edad >= 0 && edad <= MAX_PATIENT_AGE) {
    sanitized.edad = edad;
  }
  if (typeof raw.sexo === 'string' && PATIENT_SEX_VALUES.has(raw.sexo)) {
    sanitized.sexo = raw.sexo;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/** Texto plano del borrador: semilla del escudo de privacidad (noteContent). */
function noteDraftPlainText(draft) {
  if (!draft) return '';
  return [draft.summary || '', ...draft.sections.map((section) => section.content)].filter(Boolean).join('\n');
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

function build({
  encounter = null,
  specialtyInput = '',
  screenContext = null,
  history = [],
  doctor = null,
  noteDraft = null,
  codes = [],
  patientContext = null,
  noteEditable = true,
  guidelines = []
} = {}) {
  const { specialty, source: specialtySource } = resolveSpecialty(encounter, specialtyInput);
  const sanitizedScreen = sanitizeScreenContext(screenContext);
  const sanitizedDoctor = sanitizeDoctor(doctor);
  const sanitizedHistory = sanitizeHistory(history);
  const snapshot = encounter?.template_snapshot && typeof encounter.template_snapshot === 'object'
    ? encounter.template_snapshot
    : null;
  const sanitizedDraft = sanitizeNoteDraft(noteDraft, snapshot);
  const sanitizedCodes = sanitizeCodes(codes);
  const sanitizedPatient = sanitizePatientContext(patientContext);
  const sanitizedGuidelines = Array.isArray(guidelines) ? guidelines : [];

  const fullTranscript = `${encounter?.transcript || ''}`.trim();
  const promptTranscript = fullTranscript.length > MAX_PROMPT_TRANSCRIPT_LENGTH
    ? `${fullTranscript.slice(0, MAX_PROMPT_TRANSCRIPT_LENGTH)}\n[transcripción truncada para el prompt]`
    : fullTranscript;

  const persistedNote = encounter?.note_json && typeof encounter.note_json === 'object'
    ? encounter.note_json
    : null;

  // La nota en pantalla manda sobre la persistida. Se expone con la misma
  // forma para que el prompt no distinga, y `note_source` dice cuál fue.
  let noteJson = null;
  let noteSource = null;
  if (sanitizedDraft) {
    noteJson = {
      summary: sanitizedDraft.summary || `${persistedNote?.summary || ''}`,
      sections: sanitizedDraft.sections,
      warnings: [],
      missing_required_sections: []
    };
    noteSource = 'draft';
  } else if (persistedNote) {
    noteJson = {
      summary: `${persistedNote.summary || ''}`,
      sections: Array.isArray(persistedNote.sections) ? persistedNote.sections : [],
      warnings: Array.isArray(persistedNote.warnings) ? persistedNote.warnings : [],
      missing_required_sections: Array.isArray(persistedNote.missing_required_sections)
        ? persistedNote.missing_required_sections
        : []
    };
    noteSource = 'persisted';
  }

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
    note_json: noteJson,
    note_source: noteSource,
    note_editable: noteEditable !== false,
    codes: sanitizedCodes,
    patient: sanitizedPatient,
    guidelines: sanitizedGuidelines,
    screen_context: sanitizedScreen,
    doctor: sanitizedDoctor,
    history: sanitizedHistory
  };

  const usedContext = {
    encounter: Boolean(encounter),
    transcript: Boolean(fullTranscript),
    note_json: Boolean(noteJson),
    note_draft: Boolean(sanitizedDraft),
    codes: sanitizedCodes.length > 0,
    patient: Boolean(sanitizedPatient),
    guidelines: sanitizedGuidelines.length,
    screen_context: Boolean(sanitizedScreen),
    doctor: Boolean(sanitizedDoctor)
  };

  return { clinicalContext, usedContext, fullTranscript, noteDraft: sanitizedDraft, persistedNote };
}

module.exports = {
  build,
  sanitizeScreenContext,
  sanitizeDoctor,
  sanitizeHistory,
  sanitizeNoteDraft,
  sanitizeCodes,
  sanitizePatientContext,
  noteDraftPlainText,
  resolveSpecialty,
  DEFAULT_SPECIALTY,
  MAX_PROMPT_TRANSCRIPT_LENGTH,
  MAX_HISTORY_ITEMS,
  MAX_DRAFT_SECTION_CHARS,
  MAX_DRAFT_TOTAL_CHARS,
  MAX_CODES
};
