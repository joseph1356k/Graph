// Índice de guías clínicas para el asistente (retrieval léxico, en memoria).
//
// POR QUÉ LÉXICO Y NO EMBEDDINGS: el corpus es pequeño y controlado (decenas
// de guías, cada una con sus palabras clave y sinónimos), y un cliente HTTP
// nuevo hacia un proveedor de embeddings tendría que pasar por el gateway de
// salida (verify-egress-gateway.js) y llevaría texto de la consulta fuera del
// escudo. BM25 con normalización en español, sinónimos y boosts resuelve el
// caso real —«dosis de amoxicilina en otitis», «metas de presión en
// diabético»— sin sacar nada de Miracle.
//
// PURO: no lee disco ni red. Recibe el corpus compilado (JSON) y el mapa de
// sinónimos; `loadDefaultIndex()` es el único sitio que hace `require` de los
// archivos commiteados (ruta estática, que es lo que Vercel empaqueta).
//
// CUÁNDO DEVUELVE VACÍO: a propósito. Un corpus de treinta documentos tiene
// un IDF inestable, así que además del umbral de puntuación se exige que la
// pregunta del médico aporte términos propios al match. «Hola» o «¿cómo
// cambio la contraseña?» no recuperan nada, y el prompt se lo dice al modelo
// para que no invente una cita.

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const DEFAULT_TOP_K = 6;
const DEFAULT_PER_GUIDE_CAP = 3;
const DEFAULT_CHAR_BUDGET = 9000;
// Presupuesto de guías dentro del prompt del chat (ver selectForPrompt).
const PROMPT_CHAR_BUDGET = 5000;
const PROMPT_ALWAYS_KEEP = 2;
const RELATIVE_THRESHOLD = 0.35;
const MIN_ABSOLUTE_SCORE = 1.5;
const HEAD_WEIGHT = 2;
const CONTEXT_TERM_WEIGHT = 0.5;
const GENERIC_TERM_WEIGHT = 0.3;
const SPECIALTY_BOOST = 1.15;
const CIE10_BOOST = 1.3;
const HEAD_MATCH_BOOST = 1.1;
// La pregunta (con sinónimos) contiene una frase clave completa de la guía
// («lesion renal aguda»): señal más fuerte que los términos sueltos.
const KEY_PHRASE_BOOST = 1.1;
// Población: la guía de la población del paciente (o la que nombra la
// pregunta) sube; la de otra población baja sin desaparecer (la pregunta
// puede ser sobre otra población aunque el paciente sea adulto).
const POPULATION_MATCH_BOOST = 1.15;
const POPULATION_MISMATCH_FACTOR = 0.8;
// Una guía solo para gestantes o recién nacidos no debe ganarle a la general
// cuando la pregunta no dice nada de la población («glucemia en ayunas»).
const SPECIAL_POPULATIONS = new Set(['gestantes', 'neonatos']);
const UNSTATED_SPECIAL_POPULATION_FACTOR = 0.85;
// Dentro de una guía mixta, la sección cuyo título nombra la población
// («…en niños de 6 a 11 años», «…y embarazo») recibe un empujón adicional.
const SECTION_POPULATION_BOOST = 1.1;
const SECTION_POPULATION_MISMATCH_FACTOR = 0.9;
// Tolerancia a errores de digitación («amoxisilina»): un término de la
// pregunta que no existe en el corpus se corrige al más parecido por
// trigramas, con peso menor que un acierto exacto.
const FUZZY_MIN_LENGTH = 6;
const FUZZY_MIN_SIMILARITY = 0.7;
const FUZZY_TERM_WEIGHT = 0.8;
// Contexto conversacional: la pregunta anterior del médico sostiene las de
// seguimiento («¿y en niños?», «¿y la dosis?»).
const PREVIOUS_QUESTION_MAX_CHARS = 300;
// Una pregunta corta («¿por cuánto tiempo anticoagulo?») hereda casi todo su
// tema de la anterior; una larga trae el suyo y la anterior apenas orienta.
const FOLLOW_UP_SHORT_MAX_TERMS = 3;
const FOLLOW_UP_WEIGHT_SHORT = 0.8;
const FOLLOW_UP_WEIGHT_LONG = 0.4;
// Una pregunta de seguimiento corta casi siempre sigue en el mismo tema: la
// guía cuyo título o palabras clave nombran el tema anterior sube.
const FOLLOW_TOPIC_BOOST = 1.25;
const FOLLOW_TOPIC_IDF_RATIO = 0.75;

// Valores de laboratorio escritos en la pregunta («sodio de 127», «K 6,8»,
// «azúcar a 50»): se traducen al trastorno que definen, con los cortes de las
// guías del corpus (hiponatremia < 135, hiperpotasemia ≥ 5,5, hipoglucemia < 70).
const LAB_SIGNALS = [
  { pattern: /\b(?:sodio|na)\s*(?:de|en|a|:|=)?\s*(\d{2,3}(?:[.,]\d+)?)\b/g, terms: (v) => (v < 135 ? ['hiponatremia'] : v > 145 ? ['hipernatremia'] : []), range: [90, 200] },
  { pattern: /\b(?:potasio|k)\s*(?:de|en|a|:|=)?\s*(\d{1,2}(?:[.,]\d+)?)\b/g, terms: (v) => (v >= 5.5 ? ['hiperpotasemia'] : v < 3.5 ? ['hipopotasemia'] : []), range: [1, 12] },
  { pattern: /\bimc\s*(?:de|en|:|=)?\s*(\d{2}(?:[.,]\d+)?)\b/g, terms: (v) => (v >= 30 ? ['obesidad'] : v >= 25 ? ['sobrepeso'] : []), range: [12, 80] },
  { pattern: /\b(?:glucosa|glucemia|glicemia|azucar|glucometria)\s*(?:de|en|a|:|=)?\s*(\d{2,4})\b/g, terms: (v) => (v < 70 ? ['hipoglucemia'] : v >= 250 ? ['hiperglucemia'] : []), range: [10, 2000] }
];

function labSignals(message) {
  const plain = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const found = new Set();
  for (const { pattern, terms, range } of LAB_SIGNALS) {
    for (const match of plain.matchAll(pattern)) {
      const value = Number(match[1].replace(',', '.'));
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) continue;
      for (const term of terms(value)) found.add(term);
    }
  }
  return [...found];
}

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'aqui', 'asi', 'aun', 'cada',
  'como', 'con', 'contra', 'cual', 'cuales', 'cuando', 'cuanto', 'de', 'debe', 'deben', 'debo', 'del', 'desde',
  'donde', 'dos', 'e', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'era', 'eres', 'es', 'esa', 'esas', 'ese',
  'esos', 'esta', 'estan', 'estas', 'este', 'esto', 'estos', 'estoy', 'fue', 'fueron', 'ha', 'hace', 'hacer',
  'han', 'hasta', 'hay', 'he', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'mucho', 'muy',
  'nada', 'ni', 'no', 'nos', 'o', 'otra', 'otras', 'otro', 'otros', 'para', 'pero', 'poco', 'por', 'porque',
  'puede', 'pueden', 'puedo', 'que', 'quien', 'se', 'sea', 'ser', 'si', 'sin', 'sobre', 'solo', 'son', 'soy', 'su',
  'sus', 'tal', 'tambien', 'tan', 'te', 'tener', 'tengo', 'tiene', 'tienen', 'todo', 'todos', 'tu', 'tus', 'un',
  'una', 'unas', 'uno', 'unos', 'usted', 'ustedes', 'va', 'van', 'vez', 'y', 'ya', 'yo', 'les', 'hola', 'gracias',
  'dime', 'dame', 'quiero', 'podrias', 'puedes', 'favor', 'cuales', 'cuantos', 'cuanta', 'bueno', 'buena',
  'buenos', 'buenas', 'tarde', 'tardes', 'noche', 'noches', 'doctor', 'doctora', 'dr', 'dra', 'ok', 'listo', 'vale',
  'perfecto', 'entonces', 'oye', 'mira'
]);

// Palabras de cualquier pregunta clínica: no identifican una guía. Pesan
// poco en el ranking y no cuentan como «término propio» de la pregunta.
const GENERIC_TERMS = new Set([
  'paciente', 'pacientes', 'caso', 'consulta', 'nota', 'guia', 'guias', 'dice', 'dicen', 'recomienda',
  'recomiendan', 'recomendacion', 'recomendaciones', 'manejo', 'tratamiento', 'tratar', 'conducta', 'hacer',
  'medico', 'clinico', 'clinica', 'segun', 'actual', 'actuales', 'evidencia', 'indicado', 'indica', 'adulto',
  'adultos', 'mujer', 'hombre', 'anos', 'edad', 'inicial', 'primera', 'linea', 'opcion', 'opciones', 'mejor',
  'usar', 'uso', 'usa', 'dar', 'doy', 'mando', 'formular', 'formulo', 'revisar', 'revisa', 'resumen', 'resume',
  'propon', 'propones', 'sugiere', 'sugerir', 'ajuste', 'ajustes', 'redaccion', 'secciones', 'seccion',
  'documentar', 'documentados', 'dejar', 'registrado', 'registrar', 'preguntar', 'falta', 'faltan', 'dia', 'dias',
  'senor', 'senora', 'caballero', 'hago', 'hacemos', 'haria', 'mando', 'mandar', 'tengo', 'vida', 'peor', 'bien', 'mal',
  // La población no es el tema: la decide inferPopulations y pesa por boost.
  'nino', 'nina', 'pediatrico', 'pediatrica', 'infantil', 'hombre', 'paciente',
  // Palabras de cualquier pregunta médica que no identifican el cuadro.
  'diagnostico', 'diagnosticar', 'enfermedad', 'sindrome', 'sintoma', 'signo', 'cuadro', 'tipo', 'causa', 'causas',
  'aparente', 'aparentemente',
  // Calificativos y «pecho» (tórax o seno): el sentido lo dan los sinónimos de frase
  // («azúcar baja», «presión alta», «dar pecho», «dolor en el pecho»).
  'bajo', 'baja', 'alto', 'alta', 'pecho',
  // Palabras de la app y de la conversación.
  'carga', 'cargar', 'grabacion', 'grabar', 'pantalla', 'blanco', 'soporte', 'tecnico', 'hora', 'horario', 'momento',
  'descargo', 'descargar', 'historia', 'boton', 'guardar', 'enlace', 'correo', 'sesion', 'cuenta', 'plantilla',
  'app', 'aplicacion', 'celular', 'foto', 'pdf', 'nota', 'notas'
]);

// Un número suelto en la pregunta («165/100», «38.2») casi nunca identifica la
// guía: pesa como término genérico y no cuenta como término propio.
function isGenericTerm(term) {
  return GENERIC_TERMS.has(term) || /^\d+$/.test(term);
}

function normalizeText(value) {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Raíz ligera y determinista: lo importante no es la morfología correcta sino
// que pregunta y guía lleguen a la misma forma («cefaleas» y «cefalea»).
function stem(token) {
  if (/^\d+$/.test(token)) return token;
  let word = token;
  if (word.length > 7 && word.endsWith('mente')) word = word.slice(0, -5);
  if (word.length > 4 && word.endsWith('es') && !/[aeiou]es$/.test(word)) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith('s')) word = word.slice(0, -1);
  return word;
}

// Sinónimos compilados una vez por mapa: claves de una palabra en un Map (una
// búsqueda por palabra del texto) y claves de varias palabras en una lista.
// Antes se normalizaba cada clave en cada texto: era el 70 % del tiempo de
// construir el índice.
const compiledSynonyms = new WeakMap();

function compileSynonyms(synonyms) {
  if (compiledSynonyms.has(synonyms)) return compiledSynonyms.get(synonyms);
  const single = new Map();
  const multi = [];
  // Frases indexadas por su primera palabra: solo se prueban las que pueden
  // estar en el texto (antes se probaban todas en cada fragmento).
  const multiByFirst = new Map();
  for (const [rawKey, values] of Object.entries(synonyms)) {
    const key = normalizeText(rawKey);
    if (!key) continue;
    const expansions = (Array.isArray(values) ? values : [values]).map((value) => normalizeText(value)).filter(Boolean);
    if (!expansions.length) continue;
    if (key.includes(' ')) {
      const first = key.slice(0, key.indexOf(' '));
      if (!multiByFirst.has(first)) multiByFirst.set(first, []);
      multiByFirst.get(first).push(multi.length);
      multi.push([` ${key} `, expansions]);
    } else {
      single.set(key, [...(single.get(key) || []), ...expansions]);
    }
  }
  const compiled = { single, multi, multiByFirst };
  compiledSynonyms.set(synonyms, compiled);
  return compiled;
}

/** Expande sinónimos sobre el texto normalizado (las claves pueden tener varias palabras). */
function expandSynonyms(normalized, synonyms) {
  if (!synonyms || typeof synonyms !== 'object' || !normalized) return normalized;
  const { single, multi, multiByFirst } = compileSynonyms(synonyms);
  const extras = [];
  const candidates = [];
  for (const word of new Set(normalized.split(' '))) {
    const expansions = single.get(word);
    if (expansions) extras.push(...expansions);
    const phrases = multiByFirst.get(word);
    if (phrases) candidates.push(...phrases);
  }
  if (candidates.length) {
    const padded = ` ${normalized} `;
    // Mismo orden que el mapa de sinónimos, para que el resultado no dependa del texto.
    for (const position of candidates.sort((a, b) => a - b)) {
      const [key, expansions] = multi[position];
      if (padded.includes(key)) extras.push(...expansions);
    }
  }
  return extras.length ? `${normalized} ${extras.join(' ')}` : normalized;
}

function tokenize(text, synonyms = null) {
  const normalized = expandSynonyms(normalizeText(text), synonyms);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem)
    .filter((token) => token.length > 1);
}

function termFrequencies(tokens) {
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  return tf;
}

const CIE10_IN_TEXT = /\b([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?)\b/g;

/** Códigos CIE-10 escritos en un texto («I10», «E11.9»). */
function extractCie10Codes(text) {
  const codes = new Set();
  for (const match of `${text || ''}`.toUpperCase().matchAll(CIE10_IN_TEXT)) {
    codes.add(match[1]);
  }
  return [...codes];
}

function normalizeCie10(code) {
  return `${code || ''}`.trim().toUpperCase();
}

function cie10Family(code) {
  return normalizeCie10(code).split('.')[0];
}

/**
 * Texto de contexto para la búsqueda: lo que la nota dice del diagnóstico y
 * los códigos. Pesa menos que la pregunta, pero rescata preguntas genéricas
 * («¿qué dice la guía para este caso?») cuando la nota sí nombra el cuadro.
 * La pregunta anterior del médico va aparte (`followUp` en search).
 */
function buildRetrievalContext({ noteJson = null, codes = [] } = {}) {
  const parts = [];
  const sections = Array.isArray(noteJson?.sections) ? noteJson.sections : [];
  const diagnosisLike = sections.filter((section) => (
    /(analisis|impresion|diagnos|plan|motivo)/i.test(normalizeText(`${section?.key || ''} ${section?.label || ''}`))
  ));
  for (const section of diagnosisLike.slice(0, 3)) {
    const content = `${section?.content || ''}`.trim();
    if (content) parts.push(content.slice(0, 600));
  }
  if (!diagnosisLike.length && typeof noteJson?.summary === 'string') {
    parts.push(noteJson.summary.slice(0, 600));
  }
  for (const code of Array.isArray(codes) ? codes : []) {
    const description = `${code?.descripcion || ''}`.trim();
    if (description) parts.push(description.slice(0, 160));
  }
  return parts.join('\n');
}

/** Última pregunta del médico en el historial (sin la actual, que no viaja en él). */
function lastUserQuestion(history) {
  if (!Array.isArray(history)) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item && item.role === 'user' && typeof item.content === 'string' && item.content.trim()) {
      return item.content.trim().slice(0, PREVIOUS_QUESTION_MAX_CHARS);
    }
  }
  return '';
}

const POPULATION_PATTERNS = [
  ['neonatos', /\b(recien nacid\w*|neonat\w*)\b/],
  ['pediatria', /\b(nin[oa]s?|pediatric\w*|lactantes?|bebes?|infantil\w*|escolar\w*|preescolar\w*|adolescentes?)\b/],
  ['gestantes', /\b(embaraz\w*|gestantes?|gestacion\w*|prenatal\w*|obstetric\w*|puerper\w*|posparto|postparto)\b/],
  ['adultos_mayores', /\b(adultos? mayor\w*|ancian[oa]s?|geriatric\w*)\b/],
  ['adultos', /\b(adult[oa]s?\b(?! mayor)|senor|senora|caballero)\b/]
];
const PREGNANCY_CODE = /\b(O[0-9]{2}|Z3[3-6])/;

/** Poblaciones que la pregunta nombra explícitamente («en niños», «en el embarazo»). */
function populationsInText(text) {
  const normalized = normalizeText(text);
  const found = new Set();
  for (const [population, pattern] of POPULATION_PATTERNS) {
    if (pattern.test(normalized)) found.add(population);
  }
  return found;
}

/**
 * Población a favorecer en el ranking. Si la pregunta nombra una, manda la
 * pregunta (el médico puede preguntar por niños con un adulto en consulta);
 * si no, se deduce del paciente (edad, sexo) y de señales de embarazo en la
 * nota o en los códigos.
 */
function inferPopulations({ message = '', patient = null, context = '', codes = [] } = {}) {
  const explicit = populationsInText(message);
  if (explicit.size) return [...explicit];
  const found = new Set();
  const age = Number(patient?.edad);
  if (Number.isFinite(age) && age >= 0) {
    if (age < 18) {
      found.add('pediatria');
      if (age < 1) found.add('neonatos');
    } else {
      found.add('adultos');
      if (age >= 65) found.add('adultos_mayores');
    }
  }
  const sex = `${patient?.sexo || ''}`.toUpperCase();
  const codeList = (Array.isArray(codes) ? codes : []).map((code) => `${code?.codigo || code || ''}`.toUpperCase());
  const pregnantByCode = codeList.some((code) => PREGNANCY_CODE.test(code));
  const pregnantByText = populationsInText(context).has('gestantes');
  if (sex !== 'M' && (!Number.isFinite(age) || (age >= 10 && age <= 55)) && (pregnantByCode || pregnantByText)) {
    found.add('gestantes');
  }
  return [...found];
}

/** Trigramas con relleno para comparar palabras con errores de digitación. */
function trigrams(word) {
  const padded = `  ${word} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function diceSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Qué tan directamente responde el fragmento: «alta» si cubre la mayoría de
 * los términos propios de la pregunta y la guía trata del tema (título o
 * palabras clave); «baja» si apenas pasó el umbral. El prompt lo muestra para
 * que el modelo no se apoye en un vecino cercano como si fuera la respuesta.
 */
function relevanceLabel({ score, top, coverage, headHit }) {
  const relative = top > 0 ? score / top : 0;
  if (coverage >= 0.6 && headHit && relative >= 0.6) return 'alta';
  if (coverage >= 0.34 && relative >= 0.45) return 'media';
  return 'baja';
}

class ClinicalGuidelineIndex {
  constructor({ corpus, synonyms = {}, topK = DEFAULT_TOP_K, perGuideCap = DEFAULT_PER_GUIDE_CAP, charBudget = DEFAULT_CHAR_BUDGET } = {}) {
    this.synonyms = synonyms || {};
    this.topK = topK;
    this.perGuideCap = perGuideCap;
    this.charBudget = charBudget;
    this.chunks = [];
    this.df = new Map();
    this.avgLength = 0;
    this.guidelineCount = 0;
    this.build(corpus);
  }

  build(corpus) {
    const guidelines = Array.isArray(corpus?.guidelines) ? corpus.guidelines : [];
    this.guidelineCount = guidelines.length;
    let totalLength = 0;
    for (const guideline of guidelines) {
      const headText = [guideline.titulo, ...(guideline.palabras_clave || [])].join(' ');
      const headTokens = tokenize(headText, this.synonyms);
      const specialties = new Set((guideline.especialidades || []).map((value) => normalizeText(value).replace(/ /g, '_')));
      const cie10 = new Set((guideline.cie10 || []).map(normalizeCie10));
      const populations = new Set(guideline.poblacion || []);
      const keyPhrases = [guideline.titulo, ...(guideline.palabras_clave || [])]
        .map((value) => normalizeText(value))
        .filter((value) => value.includes(' '))
        .map((value) => ` ${value} `);
      for (const section of guideline.secciones || []) {
        const sectionTokens = tokenize(section.titulo, this.synonyms);
        const bodyTokens = tokenize(section.texto, this.synonyms);
        const head = [...headTokens, ...sectionTokens];
        const tokens = [...bodyTokens];
        for (let i = 0; i < HEAD_WEIGHT; i += 1) tokens.push(...head);
        const tf = termFrequencies(tokens);
        for (const term of tf.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
        totalLength += tokens.length;
        this.chunks.push({
          id: `${guideline.id}#${section.titulo}`,
          guideline_id: guideline.id,
          title: guideline.titulo,
          organism: guideline.organismo,
          year: guideline.anio,
          source: guideline.fuente,
          reviewed_by: guideline.revisado_por || '',
          section: section.titulo,
          text: section.texto,
          specialties,
          cie10,
          populations,
          specialOnly: populations.size > 0 && [...populations].every((population) => SPECIAL_POPULATIONS.has(population)),
          sectionPopulations: populationsInText(section.titulo),
          headTerms: new Set(head),
          keyPhrases,
          tf,
          length: tokens.length
        });
      }
    }
    this.avgLength = this.chunks.length ? totalLength / this.chunks.length : 1;
    this.buildFuzzyVocabulary();
  }

  /** Índice de trigramas del vocabulario (solo palabras, no números) para corregir digitación. */
  buildFuzzyVocabulary() {
    this.gramIndex = new Map();
    this.termGrams = new Map();
    for (const term of this.df.keys()) {
      if (term.length < FUZZY_MIN_LENGTH - 1 || /\d/.test(term)) continue;
      const grams = trigrams(term);
      this.termGrams.set(term, grams);
      for (const gram of grams) {
        if (!this.gramIndex.has(gram)) this.gramIndex.set(gram, []);
        this.gramIndex.get(gram).push(term);
      }
    }
  }

  /** Término del corpus más parecido a uno que no existe en él, o null. */
  closestTerm(token) {
    if (token.length < FUZZY_MIN_LENGTH || /\d/.test(token) || this.df.has(token)) return null;
    const grams = trigrams(token);
    const candidates = new Set();
    for (const gram of grams) for (const term of this.gramIndex.get(gram) || []) candidates.add(term);
    let best = null;
    let bestScore = FUZZY_MIN_SIMILARITY;
    for (const term of candidates) {
      if (Math.abs(term.length - token.length) > 3) continue;
      const similarity = diceSimilarity(grams, this.termGrams.get(term));
      if (similarity > bestScore || (similarity === bestScore && best && (this.df.get(term) || 0) > (this.df.get(best) || 0))) {
        best = term;
        bestScore = similarity;
      }
    }
    return best;
  }

  idf(term) {
    const n = this.chunks.length;
    const df = this.df.get(term) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  stats() {
    return { guidelines: this.guidelineCount, chunks: this.chunks.length };
  }

  /**
   * @param {object} query
   * @param {string} query.message   pregunta del médico (manda en el ranking)
   * @param {string} [query.context] diagnóstico de la nota + códigos (pesa la mitad)
   * @param {string} [query.specialty]
   * @param {string[]} [query.cie10]
   * @param {string[]} [query.populations] adultos, adultos_mayores, gestantes, pediatria, neonatos
   * @param {number} [query.k]
   * @returns {Array<{ref, guideline_id, title, organism, year, source, section, text, score, relevance}>}
   */
  search({ message = '', context = '', followUp = '', specialty = '', cie10 = [], populations = [], k = this.topK } = {}) {
    if (!this.chunks.length) return [];
    const labTerms = labSignals(message);
    const messageText = labTerms.length ? `${message} ${labTerms.join(' ')}` : message;
    const rawMessageTokens = new Set(tokenize(messageText, this.synonyms));
    const expandedMessage = ` ${expandSynonyms(normalizeText(messageText), this.synonyms)} `;
    const messageTokens = new Set();
    const fuzzyTerms = new Set();
    const weights = new Map();
    for (const term of tokenize(context, this.synonyms)) weights.set(term, CONTEXT_TERM_WEIGHT);
    const contextTokens = new Set(weights.keys());
    for (const term of rawMessageTokens) {
      // Un término mal digitado se reemplaza por el del corpus más parecido.
      const corrected = this.closestTerm(term);
      const effective = corrected || term;
      messageTokens.add(effective);
      if (corrected && !rawMessageTokens.has(corrected)) fuzzyTerms.add(corrected);
      const weight = isGenericTerm(effective) ? GENERIC_TERM_WEIGHT : (corrected ? FUZZY_TERM_WEIGHT : 1);
      weights.set(effective, Math.max(weight, weights.get(effective) || 0));
    }
    let specificMessage = new Set([...messageTokens].filter((term) => !isGenericTerm(term)));
    // Seguimiento: la pregunta anterior aporta el tema. Si la actual es corta,
    // sus términos cuentan casi como propios (también para la regla de
    // «al menos un término propio»).
    const followTokens = new Set(tokenize(followUp, this.synonyms));
    let followTopic = null;
    if (followTokens.size && messageTokens.size) {
      const short = specificMessage.size <= FOLLOW_UP_SHORT_MAX_TERMS;
      const followWeight = short ? FOLLOW_UP_WEIGHT_SHORT : FOLLOW_UP_WEIGHT_LONG;
      for (const term of followTokens) {
        if (isGenericTerm(term)) continue;
        if ((weights.get(term) || 0) < followWeight) weights.set(term, followWeight);
      }
      if (short) {
        const topic = [...followTokens].filter((term) => !isGenericTerm(term));
        specificMessage = new Set([...specificMessage, ...topic]);
        // El tema son los términos más raros de la pregunta anterior
        // («hepatitis» y no «crónica», que nombra media biblioteca).
        const maxIdf = Math.max(0, ...topic.map((term) => this.idf(term)));
        followTopic = new Set(topic.filter((term) => this.idf(term) >= maxIdf * FOLLOW_TOPIC_IDF_RATIO));
      }
    }
    if (!weights.size) return [];
    const wantedPopulations = new Set(Array.isArray(populations) ? populations : []);

    const wantedCodes = new Set([
      ...(Array.isArray(cie10) ? cie10 : []).map(normalizeCie10),
      ...extractCie10Codes(message)
    ].filter(Boolean));
    const wantedFamilies = new Set([...wantedCodes].map(cie10Family));
    const wantedSpecialty = normalizeText(specialty).replace(/ /g, '_');

    const scored = [];
    for (const chunk of this.chunks) {
      let score = 0;
      let matchedSpecific = 0;
      let matchedTotal = 0;
      let headHit = false;
      for (const [term, weight] of weights) {
        const tf = chunk.tf.get(term) || 0;
        if (!tf) continue;
        matchedTotal += 1;
        if (specificMessage.has(term)) matchedSpecific += 1;
        // Un término corregido por digitación no basta para decir que la guía
        // trata del tema («factura» no puede convertirse en «fractura» y traer
        // una guía por sí solo).
        if (chunk.headTerms.has(term) && !fuzzyTerms.has(term)
          && (specificMessage.has(term) || contextTokens.has(term) || followTokens.has(term))) headHit = true;
        const norm = tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / this.avgLength)));
        score += this.idf(term) * norm * weight;
      }
      if (!matchedTotal) continue;

      // La pregunta tiene que aportar al match. Si no trae ningún término
      // propio (pregunta genérica), el contexto de la nota puede sostenerlo,
      // pero entonces exige al menos un acierto en título/palabras clave.
      if (specificMessage.size > 0) {
        if (matchedSpecific === 0) continue;
        // Un solo término en común basta si la guía TRATA de eso (título,
        // palabras clave o sección); si no, hacen falta dos.
        if (matchedTotal < 2 && !headHit) continue;
      } else {
        if (matchedTotal < 2 || !headHit) continue;
      }

      if (wantedSpecialty && chunk.specialties.has(wantedSpecialty)) score *= SPECIALTY_BOOST;
      if (wantedCodes.size && [...chunk.cie10].some((code) => wantedCodes.has(code) || wantedFamilies.has(cie10Family(code)))) {
        score *= CIE10_BOOST;
      }
      if (headHit) score *= HEAD_MATCH_BOOST;
      if (followTopic && [...followTopic].some((term) => chunk.headTerms.has(term))) score *= FOLLOW_TOPIC_BOOST;
      if (chunk.keyPhrases.some((phrase) => expandedMessage.includes(phrase))) score *= KEY_PHRASE_BOOST;
      if (!wantedPopulations.size && chunk.specialOnly) score *= UNSTATED_SPECIAL_POPULATION_FACTOR;
      if (wantedPopulations.size && chunk.populations.size) {
        const matches = [...chunk.populations].some((population) => wantedPopulations.has(population));
        score *= matches ? POPULATION_MATCH_BOOST : POPULATION_MISMATCH_FACTOR;
      }
      if (wantedPopulations.size && chunk.sectionPopulations.size) {
        const matches = [...chunk.sectionPopulations].some((population) => wantedPopulations.has(population));
        score *= matches ? SECTION_POPULATION_BOOST : SECTION_POPULATION_MISMATCH_FACTOR;
      }
      const coverage = specificMessage.size ? matchedSpecific / specificMessage.size : (headHit ? 0.5 : 0);
      scored.push({ chunk, score, coverage, headHit });
    }
    if (!scored.length) return [];

    scored.sort((a, b) => b.score - a.score);
    const threshold = Math.max(scored[0].score * RELATIVE_THRESHOLD, MIN_ABSOLUTE_SCORE);
    const perGuide = new Map();
    const results = [];
    let budget = this.charBudget;
    const top = scored[0].score;
    for (const { chunk, score, coverage, headHit } of scored) {
      if (score < threshold || results.length >= k) break;
      const used = perGuide.get(chunk.guideline_id) || 0;
      if (used >= this.perGuideCap) continue;
      if (chunk.text.length > budget) continue;
      perGuide.set(chunk.guideline_id, used + 1);
      budget -= chunk.text.length;
      results.push({
        ref: `G${results.length + 1}`,
        guideline_id: chunk.guideline_id,
        title: chunk.title,
        organism: chunk.organism,
        year: chunk.year,
        source: chunk.source,
        reviewed_by: chunk.reviewed_by,
        section: chunk.section,
        text: chunk.text,
        score: Number(score.toFixed(3)),
        relevance: relevanceLabel({ score, top, coverage, headHit })
      });
    }
    return results;
  }
}

/**
 * Lo que entra al prompt del chat: los dos mejores extractos siempre (si caben)
 * y, después, solo los de relevancia alta o media, hasta el presupuesto. Los de
 * relevancia baja más allá de los dos primeros eran vecinos lejanos que costaban
 * tokens sin aportar («revisa la redacción de la nota» traía 8 000 caracteres de
 * guías). Las referencias se renumeran G1..Gn.
 */
function selectForPrompt(results, { charBudget = PROMPT_CHAR_BUDGET, alwaysKeep = PROMPT_ALWAYS_KEEP } = {}) {
  const selected = [];
  let used = 0;
  for (const result of Array.isArray(results) ? results : []) {
    const size = `${result.text || ''}`.length;
    const lowRelevance = result.relevance === 'baja';
    if (selected.length >= alwaysKeep && lowRelevance) continue;
    if (selected.length > 0 && used + size > charBudget) continue;
    selected.push(result);
    used += size;
  }
  return selected.map((result, index) => ({ ...result, ref: `G${index + 1}` }));
}

let defaultIndex = null;

/**
 * Índice sobre el corpus commiteado. Rutas estáticas a propósito: son las que
 * el empaquetado de Vercel sigue. Perezoso y cacheado: se construye una vez
 * por proceso.
 */
function loadDefaultIndex(options = {}) {
  if (defaultIndex && !options.force) return defaultIndex;
  // eslint-disable-next-line global-require
  const corpus = require('../../../knowledge/guias-clinicas/guidelines.corpus.json');
  // eslint-disable-next-line global-require
  const synonyms = require('../../../knowledge/guias-clinicas/sinonimos.json');
  const topK = Number(process.env.MIRACLE_ASSISTANT_RAG_TOP_K) || DEFAULT_TOP_K;
  defaultIndex = new ClinicalGuidelineIndex({ corpus, synonyms, topK, ...options });
  return defaultIndex;
}

function isRagDisabled(env = process.env) {
  return `${env.MIRACLE_ASSISTANT_RAG_DISABLED || ''}`.trim() === '1';
}

module.exports = {
  ClinicalGuidelineIndex,
  loadDefaultIndex,
  isRagDisabled,
  tokenize,
  normalizeText,
  stem,
  expandSynonyms,
  extractCie10Codes,
  buildRetrievalContext,
  lastUserQuestion,
  inferPopulations,
  populationsInText,
  labSignals,
  selectForPrompt,
  PROMPT_CHAR_BUDGET,
  trigrams,
  diceSimilarity,
  relevanceLabel,
  STOPWORDS,
  GENERIC_TERMS,
  isGenericTerm,
  DEFAULT_TOP_K,
  DEFAULT_PER_GUIDE_CAP,
  DEFAULT_CHAR_BUDGET,
  MIN_ABSOLUTE_SCORE,
  RELATIVE_THRESHOLD
};
