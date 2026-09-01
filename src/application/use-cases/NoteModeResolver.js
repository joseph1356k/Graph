// Decide, sección por sección, si la nota se INTERPRETA o se copia LITERAL.
//
// Antes esta decisión vivía repartida: una lista de especialidades en el prompt
// builder, un flag de plantilla que nunca llegaba (el snapshot no lo emitía) y
// un flag de sección que ningún UI seteaba y que se borraba al re-guardar. El
// único routing real era «¿la especialidad está en la lista?». Aquí hay una sola
// regla, con precedencia explícita y verificable:
//
//   1. la sección tiene `mode` explícito           → ese
//   2. la plantilla tiene `note_mode` explícito    → ese para todas
//   3. la especialidad está en el set literal      → verbatim para todas
//   4. si no                                       → interpretive
//
// `verbatim: true` legado (sección o plantilla) se lee como `mode: 'verbatim'`.

const TEMPLATE_NOTE_MODES = Object.freeze(['auto', 'interpretive', 'verbatim']);
const SECTION_MODES = Object.freeze(['inherit', 'interpretive', 'verbatim']);

// Especialidades cuyas notas se dictan tal cual: informes donde el orden y el
// wording tienen valor clínico. Normalizadas en snake_case sin diacríticos.
const DEFAULT_VERBATIM_SPECIALTIES = Object.freeze([
  'patologia',
  'anatomia_patologica',
  'patologia_clinica',
  'histopatologia',
  'dermatopatologia',
  'citologia',
  'citopatologia',
  'radiologia',
  'imagenes_diagnosticas',
  'radiologia_e_imagenes_diagnosticas',
  'medicina_nuclear',
  'laboratorio_clinico',
  'genetica',
  'genetica_medica',
  'medicina_legal'
]);

function normalizeSpecialty(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toSpecialtySet(value) {
  const list = Array.isArray(value) ? value : `${value || ''}`.split(',');
  return list.map(normalizeSpecialty).filter(Boolean);
}

// `extraVerbatimSpecialties` (o CLINICAL_VERBATIM_SPECIALTIES, separado por
// comas) amplía la lista sin tocar código. `verbatimSpecialties` la reemplaza.
function resolveVerbatimSpecialties({ verbatimSpecialties = null, extraVerbatimSpecialties = null } = {}) {
  const base = verbatimSpecialties ? toSpecialtySet(verbatimSpecialties) : DEFAULT_VERBATIM_SPECIALTIES;
  const extra = toSpecialtySet(extraVerbatimSpecialties || process.env.CLINICAL_VERBATIM_SPECIALTIES || '');
  return new Set([...base, ...extra]);
}

function isVerbatimSpecialty(specialty, options = {}) {
  const normalized = normalizeSpecialty(specialty);
  return Boolean(normalized) && resolveVerbatimSpecialties(options).has(normalized);
}

function normalizeTemplateNoteMode(value) {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  return TEMPLATE_NOTE_MODES.includes(normalized) ? normalized : 'auto';
}

function normalizeSectionMode(section) {
  const explicit = `${section?.mode ?? ''}`.trim().toLowerCase();
  if (SECTION_MODES.includes(explicit)) {
    return explicit;
  }
  return section?.verbatim === true ? 'verbatim' : 'inherit';
}

function describeReason(templateSource, specialty) {
  switch (templateSource) {
    case 'template':
      return 'plantilla marcada explícitamente';
    case 'legacy_verbatim_flag':
      return 'plantilla marcada como literal';
    case 'specialty':
      return `especialidad de reporte literal (${specialty || 'sin especialidad'})`;
    default:
      return 'consulta interpretativa por defecto';
  }
}

/**
 * @returns {{
 *   templateMode: 'interpretive'|'verbatim', templateSource: string, specialty: string,
 *   sections: Array<{key: string, mode: 'interpretive'|'verbatim', source: string}>,
 *   verbatimKeys: string[], interpretiveKeys: string[],
 *   allVerbatim: boolean, allInterpretive: boolean, mixed: boolean,
 *   noteMode: 'interpretive'|'verbatim'|'mixed', reason: string
 * }}
 */
function resolve(snapshot = {}, options = {}) {
  const specialty = normalizeSpecialty(snapshot?.specialty);
  const explicit = normalizeTemplateNoteMode(snapshot?.note_mode);
  let templateMode;
  let templateSource;
  if (explicit !== 'auto') {
    templateMode = explicit;
    templateSource = 'template';
  } else if (snapshot?.verbatim === true) {
    templateMode = 'verbatim';
    templateSource = 'legacy_verbatim_flag';
  } else if (specialty && resolveVerbatimSpecialties(options).has(specialty)) {
    templateMode = 'verbatim';
    templateSource = 'specialty';
  } else {
    templateMode = 'interpretive';
    templateSource = 'default';
  }

  const rawSections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];
  const sections = rawSections.map((section) => {
    const own = normalizeSectionMode(section);
    const inherits = own === 'inherit';
    return {
      key: `${section?.key || ''}`,
      mode: inherits ? templateMode : own,
      source: inherits ? templateSource : 'section'
    };
  });

  const verbatimKeys = sections.filter((section) => section.mode === 'verbatim').map((section) => section.key);
  const interpretiveKeys = sections.filter((section) => section.mode === 'interpretive').map((section) => section.key);
  const allVerbatim = sections.length > 0 && verbatimKeys.length === sections.length;
  const allInterpretive = sections.length > 0 && interpretiveKeys.length === sections.length;
  const mixed = sections.length > 0 && !allVerbatim && !allInterpretive;

  return {
    templateMode,
    templateSource,
    specialty,
    sections,
    verbatimKeys,
    interpretiveKeys,
    allVerbatim,
    allInterpretive,
    mixed,
    noteMode: allVerbatim ? 'verbatim' : (allInterpretive ? 'interpretive' : 'mixed'),
    reason: mixed
      ? 'secciones marcadas como literales en la plantilla'
      : describeReason(allVerbatim && templateSource === 'default' ? 'section' : templateSource, specialty)
  };
}

module.exports = {
  TEMPLATE_NOTE_MODES,
  SECTION_MODES,
  DEFAULT_VERBATIM_SPECIALTIES,
  normalizeSpecialty,
  toSpecialtySet,
  resolveVerbatimSpecialties,
  isVerbatimSpecialty,
  normalizeTemplateNoteMode,
  normalizeSectionMode,
  resolve
};
