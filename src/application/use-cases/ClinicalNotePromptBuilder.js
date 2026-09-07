// Builds the strict clinical prompt used to turn a transcript + template
// snapshot into a structured note. The template is the mold, the transcript is
// the raw material; the model must never invent clinical data.
//
// Fidelity: report-style specialties (pathology, radiology, nuclear medicine,
// lab, genetics, forensics) dictate the note word for word. There the model may
// only route dictation into sections and apply dictated punctuation; rewording,
// reordering, trimming or "normalizing" is forbidden.

// Specialties whose notes are dictated verbatim. Normalized with snake_case and
// without diacritics, same shape as ClinicalTemplateService.normalizeSpecialty.
const DEFAULT_VERBATIM_SPECIALTIES = [
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
];

// Extensión de la nota pedida por el médico (web: Configuración > General;
// viaja en el cuerpo de generate-note como { doctor: { note_detail } }).
// Enum cerrado: el valor termina dentro del system prompt, así que un string
// libre aquí sería una superficie de prompt-injection entregada al modelo.
// 'estandar' es válido pero no emite nada: es exactamente el prompt de hoy, y
// un prompt que crece cuando el médico no pidió nada distinto se degrada solo.
const NOTE_DETAIL_VALUES = new Set(['concisa', 'estandar', 'detallada']);

// El encabezado acota el alcance a la FORMA. Que una casilla de Configuración
// pudiera relajar una regla clínica la convertiría en una puerta trasera.
const NOTE_DETAIL_HEADER = 'PREFERENCIA DE EXTENSIÓN DEL MÉDICO (afecta SOLO a la forma de redactar: nunca a las reglas de no invención, de fidelidad al dictado ni de puntuación dictada, ni al formato JSON exigido):';

// Cada directiva repite en positivo las reglas de fidelidad que más peligran
// con ella: "concisa" tienta a recortar datos o a volver el texto "más
// técnico"; "detallada" tienta a rellenar con examen físico normal que nadie
// exploró. Sin esas frases el modelo resuelve la tensión por su cuenta.
const NOTE_DETAIL_DIRECTIVES = {
  concisa: [
    'Este médico prefiere notas CONCISAS.',
    '- Redacta en el estilo telegráfico propio de la historia clínica: frases cortas o sintagmas nominales, sin la narrativa de la conversación ("el paciente me cuenta que...", "bueno, entonces...") ni fórmulas de cortesía.',
    '- Lo que se acorta es la forma, nunca la información: cada dato clínico dictado o escrito por el médico —cifras, dosis, medidas, nombres, hallazgos y los negativos que sí mencionó— va completo y por separado, sin fundirlo en generalidades.',
    '- Concisa no es sinónimo de "más técnica": los términos siguen siendo los del médico, sin sustituirlos por sinónimos ni por siglas que él no usó.',
    '- Si dudas entre quitar palabras o quitar un dato, quita palabras. Nunca dejes una sección en frase prudente por ahorrar espacio cuando sí hay contenido para ella.',
    '- "summary": una o dos frases con motivo, hallazgo principal y conducta.'
  ],
  detallada: [
    'Este médico prefiere notas DETALLADAS.',
    '- Redacta en oraciones completas y ordenadas, conservando las palabras del médico, y recoge TODO el contexto que sí se expresó en la consulta: cronología, características de cada síntoma, factores que agravan o alivian, y cada negativo o hallazgo normal mencionado, escrito uno por uno en vez de agrupado.',
    '- Detallada significa más completa, no más adornada: sin conectores ni frases de relleno que el médico no dijo, sin plantillas de "examen físico normal" y sin "sin alteraciones" en aparatos que no se exploraron. La extensión sale de lo mencionado, nunca de completar lo que falta.',
    '- Un dato que no fue mencionado sigue fuera de la nota (o en la frase prudente): no se completa para que la nota se vea completa.',
    '- "summary": un párrafo breve que recorra motivo, evolución, hallazgos relevantes, impresión diagnóstica y plan, siempre a partir de lo mencionado.'
  ]
};

function normalizeSpecialty(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toSpecialtySet(value) {
  const list = Array.isArray(value)
    ? value
    : `${value || ''}`.split(',');
  return list.map(normalizeSpecialty).filter(Boolean);
}

// "Enfermedad actual" (key="enfermedad_actual"), ... — así se nombran las
// secciones dentro del prompt, para que el modelo las ubique por label y key.
function listSections(keys = [], sections = []) {
  return keys
    .map((key) => {
      const section = sections.find((item) => item.key === key);
      return section ? `"${section.label}" (key="${key}")` : `key="${key}"`;
    })
    .join(', ');
}

class ClinicalNotePromptBuilder {
  // extraVerbatimSpecialties (option or CLINICAL_VERBATIM_SPECIALTIES env, comma
  // separated) adds specialties to the literal list without touching this file.
  constructor({ verbatimSpecialties = null, extraVerbatimSpecialties = null } = {}) {
    const base = verbatimSpecialties
      ? toSpecialtySet(verbatimSpecialties)
      : DEFAULT_VERBATIM_SPECIALTIES;
    const extra = toSpecialtySet(
      extraVerbatimSpecialties || process.env.CLINICAL_VERBATIM_SPECIALTIES || ''
    );
    this.verbatimSpecialties = new Set([...base, ...extra]);
  }

  static expectedSchema(sections = []) {
    return {
      summary: 'string — resumen breve y fiel de la consulta',
      sections: sections.map((section) => ({
        key: section.key,
        label: section.label,
        content: 'string — contenido clínico de la sección',
        confidence: 'number entre 0 y 1',
        evidence: 'string — cita breve de la transcripción que soporta el contenido (puede ser vacía)'
      })),
      warnings: ['string — problemas detectados (transcripción insuficiente, datos contradictorios, etc.)'],
      missing_required_sections: ['string — keys de secciones obligatorias sin información']
    };
  }

  isVerbatimSpecialty(specialty = '') {
    const normalized = normalizeSpecialty(specialty);
    if (!normalized) {
      return false;
    }
    const set = this.verbatimSpecialties instanceof Set
      ? this.verbatimSpecialties
      : new Set(DEFAULT_VERBATIM_SPECIALTIES);
    return set.has(normalized);
  }

  // Decides which sections are copied word for word: the whole template when the
  // specialty is report-style or the template opts in (verbatim: true), plus any
  // individual section flagged with verbatim: true.
  resolveFidelity(templateSnapshot = {}, sections = []) {
    const wholeTemplate = templateSnapshot.verbatim === true
      || this.isVerbatimSpecialty(templateSnapshot.specialty);
    const verbatimKeys = sections
      .filter((section) => wholeTemplate || section.verbatim === true)
      .map((section) => section.key);
    return {
      mode: verbatimKeys.length > 0 ? 'verbatim' : 'standard',
      wholeTemplate,
      verbatimKeys,
      reason: wholeTemplate
        ? (templateSnapshot.verbatim === true
          ? 'plantilla marcada como literal'
          : `especialidad de reporte literal (${normalizeSpecialty(templateSnapshot.specialty) || 'sin especialidad'})`)
        : 'secciones marcadas como literales en la plantilla'
    };
  }

  buildVerbatimRules(fidelity, sections = []) {
    if (fidelity.mode !== 'verbatim') {
      return [];
    }

    const scope = fidelity.wholeTemplate
      ? 'TODAS las secciones de esta plantilla son LITERALES.'
      : `Son LITERALES únicamente estas secciones: ${listSections(fidelity.verbatimKeys, sections)}. El resto sigue las reglas generales.`;

    return [
      '',
      `MODO LITERAL — ${fidelity.reason.toUpperCase()}:`,
      scope,
      'En una sección LITERAL el dictado del médico ES la nota. Tu único trabajo es decidir a qué sección pertenece cada parte del dictado y aplicar la puntuación dictada. Nada más.',
      '- Copia el dictado palabra por palabra y en el mismo orden en que fue enunciado. Cero paráfrasis, cero reescritura, cero "mejoras" de estilo.',
      '- Conserva exactamente cifras, decimales, unidades, medidas, porcentajes, rótulos, códigos de muestra, números de bloque/lámina/estudio y toda nomenclatura técnica (CIE, TNM, Bethesda, Gleason, BI-RADS, HGVS, inmunohistoquímica, etc.) tal como se dictaron.',
      '- No normalices formatos ya dictados: no cambies "3,5" por "3.5", no expandas ni abrevies unidades, no reformatees rótulos tipo "26-3456", no conviertas mayúsculas/minúsculas de siglas ni de marcadores.',
      '- No sustituyas términos por sinónimos ni por su forma "correcta"; respeta abreviaturas, epónimos y siglas dictadas.',
      '- No reordenes enumeraciones ni listas: mismo número de elementos, mismo orden, misma redacción.',
      '- No resumas, no recortes, no fusiones ni dividas oraciones (salvo por la puntuación que el médico dictó explícitamente).',
      '- No completes frases que quedaron incompletas, no corrijas concordancia ni ortografía de términos técnicos, no agregues conectores, encabezados, adjetivos ni frases de relleno.',
      '- No muevas datos entre secciones para "acomodarlos": si el médico dictó un dato dentro de una casilla, ese dato se queda en esa casilla.',
      '- La ÚNICA transformación permitida es la descrita en REGLAS DE PUNTUACIÓN DICTADA (signos dictados como palabras y el signo "x" entre medidas).',
      '- La instrucción de cada sección sirve solo para saber QUÉ parte del dictado va ahí; nunca para reescribir el contenido.',
      '- "evidence" debe ser el fragmento textual de la transcripción del que salió el contenido de la sección.',
      '- Si dudas entre respetar el dictado y "mejorar" la nota, respeta el dictado y agrega un warning explicando la duda.',
      '- Si una sección literal no fue dictada, usa la frase prudente ("No mencionado en la consulta.") en lugar de rellenarla con datos de otra sección.'
    ];
  }

  // Whitelist de un solo campo + enum cerrado, igual que sanitizeDoctor en
  // ClinicalAssistantContextBuilder. Devuelve null cuando no hay nada válido:
  // basura, strings sueltos o un valor con salto de línea nunca llegan al prompt.
  static sanitizeDoctor(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const sanitized = {};
    if (typeof raw.note_detail === 'string' && NOTE_DETAIL_VALUES.has(raw.note_detail)) {
      sanitized.note_detail = raw.note_detail;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  // requested = lo que pidió el médico (ya saneado); effective = lo que se
  // aplica. En una plantilla literal completa el dictado ES la nota: no hay
  // nada que acortar ni ampliar, así que la preferencia se apaga entera,
  // summary incluido. Se devuelven las dos para que esa decisión sea visible
  // en pruebas y en el log, no un return escondido.
  resolveNoteDetail(doctor, fidelity = {}) {
    const requested = ClinicalNotePromptBuilder.sanitizeDoctor(doctor)?.note_detail || 'estandar';
    const effective = fidelity.wholeTemplate ? 'estandar' : requested;
    return { requested, effective };
  }

  // Atajo para quien solo quiere saber qué se aplicó (el generador, para su
  // log) sin rearmar el prompt.
  noteDetailFor({ templateSnapshot = {}, doctor = null } = {}) {
    const sections = Array.isArray(templateSnapshot.sections) ? templateSnapshot.sections : [];
    return this.resolveNoteDetail(doctor, this.resolveFidelity(templateSnapshot, sections));
  }

  buildNoteDetailRules(noteDetail, fidelity = {}, sections = []) {
    const directive = NOTE_DETAIL_DIRECTIVES[noteDetail?.effective];
    if (!directive) {
      return [];
    }
    // Literal parcial: la preferencia vale para el resto, pero en las casillas
    // literales el dictado se copia tal cual; hay que decirlo para que "concisa"
    // no las recorte ni "detallada" las infle.
    const literalScope = fidelity.mode === 'verbatim' && !fidelity.wholeTemplate
      ? [`- Esta preferencia NO aplica a las secciones LITERALES (${listSections(fidelity.verbatimKeys, sections)}): ahí el dictado se copia tal cual, sin acortar ni ampliar.`]
      : [];
    return ['', NOTE_DETAIL_HEADER, ...directive, ...literalScope];
  }

  build({ transcript = '', templateSnapshot = {}, doctor = null } = {}) {
    const sections = Array.isArray(templateSnapshot.sections) ? templateSnapshot.sections : [];
    const fidelity = this.resolveFidelity(templateSnapshot, sections);
    const noteDetail = this.resolveNoteDetail(doctor, fidelity);
    const verbatimKeys = new Set(fidelity.verbatimKeys);
    const sectionRules = sections
      .map((section) => `${section.order}. key="${section.key}" · label="${section.label}"${section.required ? ' · OBLIGATORIA' : ''}${verbatimKeys.has(section.key) ? ' · LITERAL (copiar el dictado tal cual)' : ''}\n   Instrucción: ${section.instruction}`)
      .join('\n');

    const system = [
      'Eres Miracle Clinical Note Generator, un motor que convierte transcripciones de consultas médicas en notas clínicas estructuradas en español.',
      'La plantilla NO es la nota: la plantilla es el molde y la transcripción es la única materia prima.',
      '',
      'REGLAS ESTRICTAS DE NO INVENCIÓN:',
      '- Usa únicamente información mencionada de forma explícita en la transcripción.',
      '- No inventes signos vitales, examen físico, antecedentes, medicamentos, dosis, resultados de laboratorio ni diagnósticos confirmados.',
      '- La impresión diagnóstica debe ser prudente, en términos de probabilidad y pendiente de criterio médico.',
      '- Si algo no fue mencionado, usa una frase prudente como "No referido.", "No mencionado en la consulta." o "No documentado en la transcripción."',
      '- Si la evidencia es débil, baja el valor de confidence.',
      '',
      'REGLAS DE FIDELIDAD AL DICTADO (aplican siempre):',
      '- La nota se escribe con las palabras del médico: no reformules ni cambies el registro de lo que dictó.',
      '- No sustituyas los datos dictados por sinónimos ni por una versión "más técnica" o "más redonda".',
      '- Conserva el orden en que el médico enunció los datos dentro de cada sección.',
      '- No resumas ni recortes datos clínicos dictados: cifras, medidas, nombres, dosis y hallazgos van completos.',
      '- No agregues conectores, encabezados ni frases de relleno que el médico no dijo.',
      '- Redactar aquí significa repartir el dictado en las secciones correctas y aplicar la puntuación dictada, no reescribirlo.',
      '',
      'REGLAS DE PUNTUACIÓN DICTADA:',
      '- El médico puede dictar signos de puntuación como palabras (ej: "coma", "punto", "punto y seguido", "punto y aparte", "punto final", "dos puntos", "punto y coma", "abre paréntesis" / "entre paréntesis" ... "cierra paréntesis", "abre comillas" ... "cierra comillas", "guion", "signo de interrogación", "signo de pregunta").',
      '- Cuando identifiques estas palabras usadas como comando de puntuación (no como término clínico), NO las transcribas literalmente: aplica el signo correspondiente en el texto de la sección ((), coma, punto, saltos de párrafo para "punto y aparte", etc.).',
      '- "punto y aparte" implica cierre de oración y salto de párrafo dentro del contenido de la sección; "punto y seguido" o "punto" solo cierra la oración.',
      '- Usa el contexto clínico para diferenciar un comando de puntuación de una palabra con significado médico real (ej. "coma" como estado de conciencia, "punto" en "punto de sutura"); en ese caso consérvala como texto normal.',
      '- Si tras aplicar la puntuación una frase queda ambigua o dudas si era comando o contenido clínico, prioriza la interpretación clínica y agrega un warning.',
      '- Signo de multiplicación dictado como "por" entre medidas o dimensiones (ej. "una masa de tres por cuatro centímetros", "lesión de dos por dos por uno"): reemplaza ese "por" por el signo "x" entre los números (ej. "3 x 4 cm", "2 x 2 x 1 cm").',
      '- No reemplaces "por" cuando funciona como preposición normal del español (causa, motivo, duración, vía: "consulta por dolor abdominal", "tratado por 5 días", "por vía oral", "por antecedente de..."); ahí se transcribe tal cual.',
      '- Usa el contexto numérico para decidir: "por" entre dos cantidades/medidas (cifras, unidades de longitud/superficie) es signo "x"; "por" seguido de una causa, motivo o duración en texto es preposición.',
      ...this.buildVerbatimRules(fidelity, sections),
      // Va después del modo literal (al que puede referirse) y antes de la
      // estructura: es una regla de redacción, subordinada a la fidelidad.
      ...this.buildNoteDetailRules(noteDetail, fidelity, sections),
      '',
      'REGLAS DE ESTRUCTURA:',
      '- Devuelve ÚNICAMENTE un objeto JSON válido, sin markdown ni texto fuera del JSON.',
      '- "sections" debe contener EXACTAMENTE las secciones de la plantilla: mismas keys, mismos labels, mismo orden.',
      '- No agregues secciones extra ni omitas ninguna.',
      '- Cada sección: {"key","label","content","confidence","evidence"}.',
      '- "evidence" es una cita breve y textual de la transcripción; usa "" cuando la sección quede en "No mencionado".',
      '- "warnings": lista problemas reales (transcripción insuficiente, datos contradictorios, secciones obligatorias sin información).',
      '- "missing_required_sections": keys de secciones OBLIGATORIAS que quedaron sin información.',
      '',
      'SECCIONES DE LA PLANTILLA (en orden):',
      sectionRules
    ].join('\n');

    const user = JSON.stringify({
      task: fidelity.mode === 'verbatim'
        ? 'Genera la nota clínica estructurada de esta consulta respetando el dictado palabra por palabra en las secciones literales.'
        : 'Genera la nota clínica estructurada de esta consulta.',
      fidelity: {
        mode: fidelity.mode,
        reason: fidelity.reason,
        verbatim_sections: fidelity.verbatimKeys
      },
      // Solo cuando el bloque se emitió: así el prompt por defecto sigue siendo
      // byte a byte el de siempre.
      ...(NOTE_DETAIL_DIRECTIVES[noteDetail.effective] ? { note_detail: noteDetail.effective } : {}),
      template: {
        name: templateSnapshot.name || '',
        specialty: templateSnapshot.specialty || '',
        sections: sections.map((section) => ({
          key: section.key,
          label: section.label,
          order: section.order,
          required: Boolean(section.required),
          verbatim: verbatimKeys.has(section.key),
          instruction: section.instruction
        }))
      },
      transcript: `${transcript || ''}`,
      expected_schema: ClinicalNotePromptBuilder.expectedSchema(sections)
    });

    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }
}

ClinicalNotePromptBuilder.DEFAULT_VERBATIM_SPECIALTIES = DEFAULT_VERBATIM_SPECIALTIES;
ClinicalNotePromptBuilder.normalizeSpecialty = normalizeSpecialty;
ClinicalNotePromptBuilder.NOTE_DETAIL_VALUES = NOTE_DETAIL_VALUES;
ClinicalNotePromptBuilder.NOTE_DETAIL_HEADER = NOTE_DETAIL_HEADER;

module.exports = ClinicalNotePromptBuilder;
