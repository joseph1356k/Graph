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

// ---------------------------------------------------------------------------
// Ajuste de nota: presupuesto de transcripción y selección de tramos.
//
// El chat contextual recorta la transcripción a 16k caracteres (cabeza) porque
// responde preguntas sueltas. El ajuste de una sección es otra cosa: el dato
// que el médico pide recuperar ("agrega lo que dijo sobre la fiebre") puede
// estar al final de una consulta de cuarenta minutos, justo donde el recorte
// lo dejaba fuera. Aquí cabe la consulta entera hasta 60k; por encima, en vez
// de cortar por la cabeza, se conservan los tramos que más se parecen a la
// instrucción y a la sección objetivo, más el inicio y el cierre.
// ---------------------------------------------------------------------------
const MAX_ADJUSTMENT_TRANSCRIPT_LENGTH = 60000;
const TRANSCRIPT_WINDOW_LENGTH = 1500;

// El frontend es el dueño de esta cadena (lib/clinical/section-drafts.ts): lo
// que el médico ESCRIBE por sección mientras graba viaja al final de la
// transcripción bajo este rótulo, una línea "[Sección] texto" por sección. Si
// el rótulo cambia allá y no aquí, el bloque simplemente sigue viajando dentro
// de la transcripción, como hasta ahora: nada se rompe, solo se pierde la
// separación explícita.
const DOCTOR_ANNOTATIONS_MARKER = '--- ANOTACIONES ESCRITAS POR EL MÉDICO DURANTE LA CONSULTA ---';

// Palabras que no dicen nada sobre de qué trata un tramo. Solo las que de
// verdad ensucian el puntaje léxico en español clínico hablado, más los verbos
// de la propia instrucción ("agrega", "expande"), que aparecen en toda orden.
const STOPWORDS = new Set([
  'para', 'pero', 'como', 'este', 'esta', 'esto', 'esos', 'esas',
  'aqui', 'alli', 'ahora', 'entonces', 'tambien', 'porque', 'cuando', 'donde',
  'desde', 'hasta', 'sobre', 'entre', 'tiene', 'tienen', 'tengo', 'hace',
  'hacer', 'haga', 'dice', 'dijo', 'digo', 'decir', 'algo', 'nada', 'todo',
  'toda', 'todos', 'todas', 'mucho', 'mucha', 'poco', 'poca', 'bien',
  'menos', 'otro', 'otra', 'otros', 'otras', 'cada', 'unos', 'unas',
  'usted', 'ellos', 'ellas', 'nosotros', 'bueno', 'buena', 'listo', 'vamos',
  'agrega', 'agregar', 'incluye', 'incluir', 'ponle', 'quita', 'quitar',
  'cambia', 'cambiar', 'expande', 'expandir', 'amplia', 'ampliar', 'resume',
  'resumir', 'acorta', 'larga', 'largo', 'corto', 'corta', 'clara',
  'claro', 'seccion', 'nota', 'texto', 'parte', 'menciono', 'mencionado',
  'hablamos', 'consulta', 'paciente', 'medico', 'doctor', 'doctora'
]);

function normalizeText(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function significantTokens(value = '') {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

// "diagnostica" y "diagnostico" deben contar como la misma cosa; con seis
// letras de raíz alcanza para eso sin confundir palabras distintas de más.
function stem(token) {
  return token.length > 6 ? token.slice(0, 6) : token;
}

function splitDoctorAnnotations(transcript = '') {
  const text = `${transcript || ''}`;
  const index = text.indexOf(DOCTOR_ANNOTATIONS_MARKER);
  if (index === -1) {
    return { speech: text.trim(), annotations: [], annotationsText: '' };
  }
  const speech = text.slice(0, index).trim();
  const block = text.slice(index + DOCTOR_ANNOTATIONS_MARKER.length);
  const annotations = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      return match && match[2].trim()
        ? { section_label: match[1].trim(), text: match[2].trim() }
        : null;
    })
    .filter(Boolean);
  return {
    speech,
    annotations,
    annotationsText: annotations.map((item) => item.text).join('\n')
  };
}

function splitIntoWindows(text, windowLength = TRANSCRIPT_WINDOW_LENGTH) {
  const pieces = `${text || ''}`
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const windows = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > windowLength) {
      windows.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) {
    windows.push(current);
  }
  return windows;
}

// Devuelve la transcripción que entra al prompt de ajuste y si es completa.
// Con presupuesto de sobra va tal cual; si no, se eligen ventanas: siempre la
// primera y la última (motivo de consulta y cierre), y después las que más
// vocabulario comparten con la consulta del médico, en su orden original y
// con "[…]" donde se saltó algo.
function selectRelevantTranscript(speech, { query = '', budget = MAX_ADJUSTMENT_TRANSCRIPT_LENGTH } = {}) {
  const text = `${speech || ''}`.trim();
  if (text.length <= budget) {
    return { text, coverage: 'completa' };
  }
  const windows = splitIntoWindows(text);
  if (windows.length <= 2) {
    return { text: `${text.slice(0, budget)}\n[…]`, coverage: 'parcial' };
  }
  const queryStems = new Set(significantTokens(query).map(stem));
  const scored = windows.map((window, index) => {
    const stems = new Set(significantTokens(window).map(stem));
    let score = 0;
    for (const item of stems) {
      if (queryStems.has(item)) {
        score += 1;
      }
    }
    return { index, window, score };
  });

  const chosen = new Set([0, windows.length - 1]);
  let used = windows[0].length + windows[windows.length - 1].length;
  const candidates = scored
    .filter((item) => !chosen.has(item.index))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const candidate of candidates) {
    if (used + candidate.window.length > budget) {
      continue;
    }
    chosen.add(candidate.index);
    used += candidate.window.length;
  }

  const parts = [];
  let previous = -1;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    if (previous !== -1 && index !== previous + 1) {
      parts.push('[…]');
    }
    parts.push(windows[index]);
    previous = index;
  }
  return { text: parts.join('\n'), coverage: 'parcial' };
}

// La sección a la que se refiere la instrucción. Con `section_key` explícito
// no hay nada que adivinar. Sin él, se mira si la instrucción nombra una
// sección de la plantilla ("expande la impresión diagnóstica" → "Análisis e
// impresión diagnóstica"); ese objetivo es una SUGERENCIA para el prompt, no
// acota el alcance: la instrucción manda.
function resolveTargetSection({ sectionKey = '', instruction = '', templateSnapshot = null, noteJson = null } = {}) {
  const templateSections = Array.isArray(templateSnapshot?.sections) ? templateSnapshot.sections : [];
  const noteSections = Array.isArray(noteJson?.sections) ? noteJson.sections : [];
  const describe = (template, source) => {
    const inNote = noteSections.find((section) => section.key === template.key) || null;
    return {
      key: template.key,
      label: template.label || inNote?.label || template.key,
      instruction: `${template.instruction || ''}`,
      content: `${inNote?.content || ''}`,
      evidence: `${inNote?.evidence || ''}`,
      source
    };
  };

  const explicitKey = `${sectionKey || ''}`.trim();
  if (explicitKey) {
    const template = templateSections.find((section) => section.key === explicitKey);
    return template ? describe(template, 'explicit') : null;
  }

  const instructionStems = new Set(significantTokens(instruction).map(stem));
  if (!instructionStems.size) {
    return null;
  }
  const ranked = templateSections
    .map((template) => {
      const labelStems = [...new Set(significantTokens(template.label).map(stem))];
      if (!labelStems.length) {
        return null;
      }
      const hits = labelStems.filter((item) => instructionStems.has(item)).length;
      return { template, ratio: hits / labelStems.length, hits };
    })
    .filter((item) => item && item.hits > 0 && item.ratio >= 0.5)
    .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits);
  if (!ranked.length) {
    return null;
  }
  if (ranked.length > 1 && ranked[0].ratio === ranked[1].ratio && ranked[0].hits === ranked[1].hits) {
    return null;
  }
  return describe(ranked[0].template, 'inferred');
}

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

function normalizeNoteJson(noteJson) {
  return noteJson && typeof noteJson === 'object'
    ? {
      summary: `${noteJson.summary || ''}`,
      sections: Array.isArray(noteJson.sections) ? noteJson.sections : [],
      warnings: Array.isArray(noteJson.warnings) ? noteJson.warnings : [],
      missing_required_sections: Array.isArray(noteJson.missing_required_sections)
        ? noteJson.missing_required_sections
        : []
    }
    : null;
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

  const noteJson = normalizeNoteJson(encounter?.note_json);
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
    note_json: noteJson,
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

// Contexto del AJUSTE de nota. Distinto del chat en tres cosas: la nota
// actual puede venir del navegador (lo que el médico ve, con sus ediciones sin
// guardar) en vez de la persistida; la transcripción entra entera o por tramos
// relevantes, nunca cortada por la cabeza; y la sección objetivo va con su
// contenido, su evidencia y la instrucción de plantilla.
function buildForAdjustment({ encounter = null, doctor = null, sectionKey = '', instruction = '', currentNote = null } = {}) {
  const { specialty, source: specialtySource } = resolveSpecialty(encounter, '');
  const sanitizedDoctor = sanitizeDoctor(doctor);
  const snapshot = encounter?.template_snapshot && typeof encounter.template_snapshot === 'object'
    ? encounter.template_snapshot
    : null;
  const noteJson = normalizeNoteJson(currentNote || encounter?.note_json);

  const { speech, annotations, annotationsText } = splitDoctorAnnotations(encounter?.transcript || '');
  const targetSection = resolveTargetSection({
    sectionKey,
    instruction,
    templateSnapshot: snapshot,
    noteJson
  });
  const query = [
    instruction,
    targetSection?.label || '',
    targetSection?.content || '',
    targetSection?.evidence || ''
  ].join('\n');
  const { text: promptTranscript, coverage } = selectRelevantTranscript(speech, { query });

  const clinicalContext = {
    specialty,
    specialty_source: specialtySource,
    encounter: encounter
      ? {
        id: encounter.id,
        consultation_type: encounter.consultation_type || '',
        template_name: snapshot?.name || ''
      }
      : null,
    template_sections: Array.isArray(snapshot?.sections)
      ? snapshot.sections.map((section) => ({
        key: section.key,
        label: section.label,
        required: Boolean(section.required),
        instruction: `${section.instruction || ''}`
      }))
      : [],
    transcript: promptTranscript,
    transcript_coverage: coverage,
    doctor_annotations: annotations,
    note_json: noteJson,
    target_section: targetSection,
    // Con key explícita, el ajuste se queda en esa sección. Un objetivo
    // inferido solo orienta: la instrucción puede tocar lo que necesite.
    scope: targetSection?.source === 'explicit' ? 'seccion' : 'nota',
    doctor: sanitizedDoctor
  };

  return {
    clinicalContext,
    fullTranscript: speech,
    annotationsText,
    usedContext: {
      encounter: Boolean(encounter),
      transcript: Boolean(speech),
      annotations: annotations.length > 0,
      note_json: Boolean(noteJson),
      doctor: Boolean(sanitizedDoctor)
    }
  };
}

module.exports = {
  build,
  buildForAdjustment,
  sanitizeScreenContext,
  sanitizeDoctor,
  sanitizeHistory,
  resolveSpecialty,
  resolveTargetSection,
  selectRelevantTranscript,
  splitDoctorAnnotations,
  DEFAULT_SPECIALTY,
  DOCTOR_ANNOTATIONS_MARKER,
  MAX_PROMPT_TRANSCRIPT_LENGTH,
  MAX_ADJUSTMENT_TRANSCRIPT_LENGTH,
  MAX_HISTORY_ITEMS
};
