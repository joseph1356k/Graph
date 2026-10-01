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
const RELATIVE_THRESHOLD = 0.35;
const MIN_ABSOLUTE_SCORE = 1.5;
const HEAD_WEIGHT = 2;
const CONTEXT_TERM_WEIGHT = 0.5;
const GENERIC_TERM_WEIGHT = 0.3;
const SPECIALTY_BOOST = 1.15;
const CIE10_BOOST = 1.3;
const HEAD_MATCH_BOOST = 1.1;

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
  'dime', 'dame', 'quiero', 'podrias', 'puedes', 'favor', 'cuales', 'cuantos', 'cuanta'
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
  'documentar', 'documentados', 'dejar', 'registrado', 'registrar', 'preguntar', 'falta', 'faltan'
]);

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

/** Expande sinónimos sobre el texto normalizado (las claves pueden tener varias palabras). */
function expandSynonyms(normalized, synonyms) {
  if (!synonyms || typeof synonyms !== 'object') return normalized;
  const extras = [];
  const padded = ` ${normalized} `;
  for (const [rawKey, values] of Object.entries(synonyms)) {
    const key = normalizeText(rawKey);
    if (!key || !padded.includes(` ${key} `)) continue;
    for (const value of Array.isArray(values) ? values : [values]) {
      extras.push(normalizeText(value));
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
          headTerms: new Set(head),
          tf,
          length: tokens.length
        });
      }
    }
    this.avgLength = this.chunks.length ? totalLength / this.chunks.length : 1;
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
   * @param {number} [query.k]
   * @returns {Array<{ref, guideline_id, title, organism, year, source, section, text, score}>}
   */
  search({ message = '', context = '', specialty = '', cie10 = [], k = this.topK } = {}) {
    if (!this.chunks.length) return [];
    const messageTokens = new Set(tokenize(message, this.synonyms));
    const contextTokens = new Set(tokenize(context, this.synonyms));
    const specificMessage = new Set([...messageTokens].filter((term) => !GENERIC_TERMS.has(term)));
    const weights = new Map();
    for (const term of contextTokens) weights.set(term, CONTEXT_TERM_WEIGHT);
    for (const term of messageTokens) weights.set(term, GENERIC_TERMS.has(term) ? GENERIC_TERM_WEIGHT : 1);
    if (!weights.size) return [];

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
        if (chunk.headTerms.has(term) && (specificMessage.has(term) || contextTokens.has(term))) headHit = true;
        const norm = tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / this.avgLength)));
        score += this.idf(term) * norm * weight;
      }
      if (!matchedTotal) continue;

      // La pregunta tiene que aportar al match. Si no trae ningún término
      // propio (pregunta genérica), el contexto de la nota puede sostenerlo,
      // pero entonces exige al menos un acierto en título/palabras clave.
      if (specificMessage.size > 0) {
        if (matchedSpecific === 0) continue;
        if (matchedTotal < 2 && !(specificMessage.size === 1 && headHit)) continue;
      } else {
        if (matchedTotal < 2 || !headHit) continue;
      }

      if (wantedSpecialty && chunk.specialties.has(wantedSpecialty)) score *= SPECIALTY_BOOST;
      if (wantedCodes.size && [...chunk.cie10].some((code) => wantedCodes.has(code) || wantedFamilies.has(cie10Family(code)))) {
        score *= CIE10_BOOST;
      }
      if (headHit) score *= HEAD_MATCH_BOOST;
      scored.push({ chunk, score });
    }
    if (!scored.length) return [];

    scored.sort((a, b) => b.score - a.score);
    const threshold = Math.max(scored[0].score * RELATIVE_THRESHOLD, MIN_ABSOLUTE_SCORE);
    const perGuide = new Map();
    const results = [];
    let budget = this.charBudget;
    for (const { chunk, score } of scored) {
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
        score: Number(score.toFixed(3))
      });
    }
    return results;
  }
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
  STOPWORDS,
  GENERIC_TERMS,
  DEFAULT_TOP_K,
  DEFAULT_PER_GUIDE_CAP,
  DEFAULT_CHAR_BUDGET,
  MIN_ABSOLUTE_SCORE,
  RELATIVE_THRESHOLD
};
