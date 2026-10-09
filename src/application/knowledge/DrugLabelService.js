// Fichas técnicas oficiales de medicamentos para las preguntas de dosis del
// asistente (CIMA, Agencia Española de Medicamentos y Productos Sanitarios).
//
// POR QUÉ: la pregunta clínica más peligrosa de responder «de memoria» es la
// dosis. Las guías del corpus traen las dosis de su tema, pero no de todos
// los medicamentos; la ficha técnica (sección 4.2 Posología, 4.3
// Contraindicaciones, 4.5 Interacciones, 4.6 Embarazo y lactancia, 4.8
// Reacciones adversas) es la fuente oficial y está en español.
//
// PRIVACIDAD: a la fuente externa SOLO sale el principio activo de una
// entrada del diccionario cerrado (knowledge/fichas-tecnicas/medicamentos.json).
// Nunca texto del médico, nunca datos del paciente. Por eso no pasa por el
// escudo: no hay nada que tapar.
//
// RESILIENCIA: primero la instantánea precargada (npm run build:drug-labels);
// si el medicamento no está, consulta en vivo con un plazo corto, caché en
// memoria y un cortacircuitos: si CIMA falla varias veces seguidas, se deja de
// consultar un rato. Nunca lanza: ante cualquier problema devuelve [] y el chat
// sigue con las guías.
//
// Es una ficha española: las presentaciones registradas en el INVIMA pueden
// diferir. El prompt y la pantalla lo dicen.

const { normalizeText } = require('./ClinicalGuidelineIndex');

const DEFAULT_BASE_URL = 'https://cima.aemps.es/cima/rest';
const PUBLIC_FT_URL = 'https://cima.aemps.es/cima/dochtml/ft';
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_MAX_DRUGS = 2;
const DEFAULT_MAX_CHARS = 1800;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 400;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const ORGANISM = 'AEMPS (España) · CIMA';
const SOURCE = 'Ficha técnica autorizada, CIMA – Agencia Española de Medicamentos y Productos Sanitarios. Verificar presentación registrada en el INVIMA.';

const SECTION_TITLES = Object.freeze({
  '4.2': '4.2 Posología y forma de administración',
  '4.3': '4.3 Contraindicaciones',
  '4.5': '4.5 Interacción con otros medicamentos',
  '4.6': '4.6 Fertilidad, embarazo y lactancia',
  '4.8': '4.8 Reacciones adversas'
});

// Preguntas en las que una ficha técnica aporta: dosis y su ajuste, cómo se
// administra, contraindicaciones, interacciones, embarazo y efectos adversos.
const DRUG_QUESTION = /\b(dosis|dosific\w*|posolog\w*|mg|mcg|gramos?|cada cuant\w*|cuantas veces|intervalo|frecuencia|maxim[ao]|ajust\w*|renal|hepatic\w*|embaraz\w*|gestante|lactancia|contraindic\w*|interacc\w*|interactua\w*|combinar|efectos? (adversos?|secundarios?)|reacciones adversas|como se (da|toma|administra|formula|usa)|formul\w*|prescrib\w*|presentacion\w*|via de administracion|dilu\w*|infusion|bolo|carga|pediatric\w*|nin[oa]s?|lactantes?|mg kg)\b/;

function sectionForQuestion(normalized) {
  if (/\b(contraindic\w*|no se puede dar|no dar)\b/.test(normalized)) return '4.3';
  if (/\b(interacc\w*|interactua\w*|combinar|junto con|mezclar)\b/.test(normalized)) return '4.5';
  if (/\b(embaraz\w*|gestante|lactancia|amamant\w*)\b/.test(normalized)) return '4.6';
  if (/\b(efectos? (adversos?|secundarios?)|reacciones adversas)\b/.test(normalized)) return '4.8';
  return '4.2';
}

function decodeEntities(text) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', deg: '°', micro: 'µ', ge: '≥', le: '≤', middot: '·', ndash: '–', mdash: '—', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü' };
  return `${text || ''}`
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => (name in named ? named[name] : match));
}

/** HTML de la ficha (estilos de Word, tablas) a texto plano con párrafos. */
function htmlToText(html) {
  return decodeEntities(`${html || ''}`
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' · ')
    // Etiquetas de formato en línea (negrita, cursiva, spans de Word): sin espacio.
    .replace(/<\/?(b|i|u|em|strong|span|font|sup|sub|a|o:p)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *· *\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Extracto de la sección dentro del presupuesto: el primer párrafo (suele ser
 * la posología general) y luego los que más se parecen a la pregunta (niños,
 * insuficiencia renal, ancianos…), en el orden original de la ficha.
 */
function excerpt(text, question, maxChars = DEFAULT_MAX_CHARS) {
  const paragraphs = `${text || ''}`.split('\n').map((p) => p.trim()).filter((p) => p.length > 1);
  if (!paragraphs.length) return '';
  const full = paragraphs.join('\n');
  if (full.length <= maxChars) return full;
  const wanted = new Set(normalizeText(question).split(' ').filter((word) => word.length > 3));
  const focus = [
    [/\b(nin[oa]s?|pediatric\w*|lactantes?|adolescentes?|kg de peso|mg kg)\b/, /\b(nin[oa]s?|pediatric\w*|lactante\w*|menores?)\b/],
    [/\b(renal|rinon|creatinina|aclaramiento|dialisis)\b/, /\b(renal|aclaramiento|creatinina|dialisis)\b/],
    [/\b(hepatic\w*|higado|cirrosis)\b/, /\b(hepatic\w*|cirrosis)\b/],
    [/\b(ancian\w*|adulto mayor|mayores de 65|edad avanzada)\b/, /\b(ancian\w*|edad avanzada|pacientes de edad)\b/],
    [/\b(embaraz\w*|lactancia)\b/, /\b(embaraz\w*|lactancia)\b/]
  ];
  const normalizedQuestion = normalizeText(question);
  const scored = paragraphs.map((paragraph, position) => {
    const normalized = normalizeText(paragraph);
    let score = position === 0 ? 100 : 0;
    for (const word of wanted) if (normalized.includes(word)) score += 2;
    for (const [inQuestion, inParagraph] of focus) {
      if (inQuestion.test(normalizedQuestion) && inParagraph.test(normalized)) score += 10;
    }
    if (/\b(adultos?|dosis (habitual|recomendada|maxima))\b/.test(normalized)) score += 3;
    return { paragraph, position, score };
  });
  const chosen = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.position - b.position)) {
    const cost = item.paragraph.length + 1;
    if (used + cost > maxChars) continue;
    chosen.push(item);
    used += cost;
  }
  return chosen.sort((a, b) => a.position - b.position).map((item) => item.paragraph).join('\n');
}

function loadDictionary() {
  // eslint-disable-next-line global-require
  return require('../../../knowledge/fichas-tecnicas/medicamentos.json');
}

function loadSnapshot() {
  try {
    // eslint-disable-next-line global-require
    return require('../../../knowledge/fichas-tecnicas/fichas.snapshot.json');
  } catch (error) {
    return { labels: [] };
  }
}

function isDrugLabelsDisabled(env = process.env) {
  const mode = `${env.MIRACLE_ASSISTANT_DRUG_LABELS || ''}`.trim().toLowerCase();
  return mode === 'off' || mode === '0' || mode === 'false';
}

class DrugLabelService {
  constructor({
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxDrugs = DEFAULT_MAX_DRUGS,
    maxChars = DEFAULT_MAX_CHARS,
    live = true,
    dictionary = loadDictionary(),
    snapshot = loadSnapshot(),
    now = () => Date.now(),
    logger = console
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxDrugs = maxDrugs;
    this.maxChars = maxChars;
    this.live = Boolean(live && fetchImpl);
    this.now = now;
    this.logger = logger;
    this.cache = new Map();
    this.consecutiveFailures = 0;
    this.breakerOpenUntil = 0;
    this.entries = this.compileDictionary(dictionary);
    this.snapshot = new Map();
    for (const label of Array.isArray(snapshot?.labels) ? snapshot.labels : []) {
      if (label && label.practiv && label.section && label.text) {
        this.snapshot.set(`${label.practiv}|${label.vtm || ''}|${label.section}`, label);
      }
    }
  }

  compileDictionary(dictionary) {
    const entries = [];
    for (const item of Array.isArray(dictionary?.medicamentos) ? dictionary.medicamentos : []) {
      const names = [item.practiv, item.nombre, ...(item.alias || [])]
        .map((name) => normalizeText(name))
        .filter((name) => name.length >= 3);
      entries.push({
        nombre: item.nombre,
        practiv: item.practiv,
        vtm: item.vtm,
        vtmPattern: new RegExp(item.vtm),
        names: [...new Set(names)].sort((a, b) => b.length - a.length)
      });
    }
    return entries;
  }

  stats() {
    return { medicamentos: this.entries.length, precargadas: this.snapshot.size, live: this.live };
  }

  /** ¿La pregunta es de las que una ficha técnica responde? */
  isDrugQuestion(text) {
    return DRUG_QUESTION.test(normalizeText(text));
  }

  /**
   * Medicamentos del diccionario nombrados en el texto. Gana la mención más
   * larga («amoxicilina clavulanato» antes que «amoxicilina») y no se cuentan
   * dos veces las mismas palabras.
   */
  detectDrugs(text) {
    const padded = ` ${normalizeText(text)} `;
    const mentions = [];
    for (const entry of this.entries) {
      for (const name of entry.names) {
        const index = padded.indexOf(` ${name} `);
        if (index >= 0) {
          mentions.push({ entry, start: index, end: index + name.length + 1, length: name.length });
          break;
        }
      }
    }
    mentions.sort((a, b) => b.length - a.length || a.start - b.start);
    const taken = [];
    const found = [];
    for (const mention of mentions) {
      if (taken.some(([start, end]) => mention.start < end && start < mention.end)) continue;
      taken.push([mention.start, mention.end]);
      found.push(mention);
    }
    return found.sort((a, b) => a.start - b.start).map((mention) => mention.entry).slice(0, this.maxDrugs);
  }

  /**
   * @param {object} query
   * @param {string} query.message           pregunta actual del médico
   * @param {string} [query.previousQuestion] pregunta anterior (para «¿y en falla renal?»)
   * @returns {Promise<Array<object>>} extractos numerados F1, F2…
   */
  async lookup({ message = '', previousQuestion = '' } = {}) {
    if (!this.entries.length || !this.isDrugQuestion(message)) return [];
    let drugs = this.detectDrugs(message);
    if (!drugs.length && previousQuestion) drugs = this.detectDrugs(previousQuestion);
    if (!drugs.length) return [];
    const section = sectionForQuestion(normalizeText(message));
    const deadline = this.now() + this.timeoutMs;
    const settled = await Promise.all(drugs.map((entry) => this.labelFor(entry, section, deadline).catch(() => null)));
    const labels = [];
    for (const label of settled) {
      if (!label) continue;
      const text = excerpt(label.text, `${message} ${previousQuestion}`, this.maxChars);
      if (!text) continue;
      labels.push({
        ref: `F${labels.length + 1}`,
        kind: 'ficha_tecnica',
        guideline_id: `cima-${label.nregistro}`,
        title: `Ficha técnica: ${label.product}`,
        organism: ORGANISM,
        year: label.year || '',
        section: SECTION_TITLES[label.section] || label.section,
        source: SOURCE,
        url: `${PUBLIC_FT_URL}/${encodeURIComponent(label.nregistro)}/FT_${encodeURIComponent(label.nregistro)}.html`,
        text
      });
    }
    return labels;
  }

  async labelFor(entry, section, deadline) {
    const key = `${entry.practiv}|${entry.vtm}|${section}`;
    const fromSnapshot = this.snapshot.get(key);
    if (fromSnapshot) return fromSnapshot;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.value;
    if (!this.live || this.breakerOpenUntil > this.now()) return null;
    try {
      const value = await this.fetchLabel(entry, section, deadline);
      this.consecutiveFailures = 0;
      this.remember(key, value, value ? CACHE_TTL_MS : FAILURE_TTL_MS);
      return value;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= BREAKER_THRESHOLD) {
        this.breakerOpenUntil = this.now() + BREAKER_COOLDOWN_MS;
        this.logger.warn?.(`[DrugLabels] CIMA falló ${this.consecutiveFailures} veces seguidas; pausa de ${BREAKER_COOLDOWN_MS / 60000} min`);
      }
      this.remember(key, null, FAILURE_TTL_MS);
      return null;
    }
  }

  remember(key, value, ttl) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { value, expires: this.now() + ttl });
  }

  async getJson(path, deadline) {
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new Error('timeout');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), remaining) : null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {})
      });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Busca el producto comercializado con ficha segmentada y trae la sección. */
  async fetchLabel(entry, section, deadline) {
    const search = await this.getJson(
      `/medicamentos?practiv1=${encodeURIComponent(entry.practiv)}&comerc=1`,
      deadline
    );
    const product = pickProduct(search?.resultados, entry);
    if (!product) return null;
    const content = await this.getJson(
      `/docSegmentado/contenido/1?nregistro=${encodeURIComponent(product.nregistro)}&seccion=${encodeURIComponent(section)}`,
      deadline
    );
    const parts = (Array.isArray(content) ? content : [])
      .filter((item) => `${item?.seccion || ''}`.startsWith(section))
      .sort((a, b) => (Number(a?.orden) || 0) - (Number(b?.orden) || 0));
    const text = htmlToText(parts.map((item) => item.contenido || '').join('\n'));
    if (!text) return null;
    const doc = (product.docs || []).find((item) => Number(item?.tipo) === 1) || {};
    const year = doc.fecha ? new Date(Number(doc.fecha)).getUTCFullYear() : '';
    return {
      practiv: entry.practiv,
      vtm: entry.vtm,
      section,
      nregistro: `${product.nregistro}`,
      product: productLabel(product, entry),
      year: Number.isFinite(year) ? year : '',
      text
    };
  }
}

/**
 * Para la instantánea: todas las secciones pedidas de un medicamento con dos
 * llamadas (búsqueda + ficha completa). Lanza si CIMA falla.
 */
DrugLabelService.prototype.fetchSections = async function fetchSections(entry, sections, deadline) {
  const search = await this.getJson(`/medicamentos?practiv1=${encodeURIComponent(entry.practiv)}&comerc=1`, deadline);
  const product = pickProduct(search?.resultados, entry);
  if (!product) return [];
  const content = await this.getJson(`/docSegmentado/contenido/1?nregistro=${encodeURIComponent(product.nregistro)}`, deadline);
  const doc = (product.docs || []).find((item) => Number(item?.tipo) === 1) || {};
  const year = doc.fecha ? new Date(Number(doc.fecha)).getUTCFullYear() : '';
  const out = [];
  for (const section of sections) {
    const parts = (Array.isArray(content) ? content : [])
      .filter((item) => `${item?.seccion || ''}`.startsWith(section))
      .sort((a, b) => (Number(a?.orden) || 0) - (Number(b?.orden) || 0));
    const text = htmlToText(parts.map((item) => item.contenido || '').join('\n'));
    if (!text) continue;
    out.push({
      practiv: entry.practiv,
      vtm: entry.vtm,
      section,
      nregistro: `${product.nregistro}`,
      product: productLabel(product, entry),
      year: Number.isFinite(year) ? year : '',
      text: text.slice(0, 12000)
    });
  }
  return out;
};

/** Producto comercializado cuyo principio activo coincide, con ficha técnica segmentada; la más reciente. */
function pickProduct(results, entry) {
  const list = Array.isArray(results) ? results : [];
  const matches = list.filter((item) => {
    const vtm = normalizeText(item?.vtm?.nombre || '');
    const name = normalizeText(item?.nombre || '');
    const target = vtm || name;
    if (!entry.vtmPattern.test(target) && !(vtm === '' && name.includes(normalizeText(entry.practiv)))) return false;
    const ficha = (item.docs || []).find((doc) => Number(doc?.tipo) === 1);
    return Boolean(item.nregistro && ficha && ficha.secc !== false);
  });
  matches.sort((a, b) => {
    const fa = Number(((a.docs || []).find((doc) => Number(doc?.tipo) === 1) || {}).fecha) || 0;
    const fb = Number(((b.docs || []).find((doc) => Number(doc?.tipo) === 1) || {}).fecha) || 0;
    return fb - fa;
  });
  return matches[0] || null;
}

/** Nombre sin marca ni laboratorio: principio activo, dosis y forma. */
function productLabel(product, entry) {
  const parts = [
    product?.vtm?.nombre || entry.nombre,
    product?.dosis || '',
    product?.formaFarmaceuticaSimplificada?.nombre || ''
  ].map((part) => `${part}`.trim()).filter(Boolean);
  const label = parts.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

module.exports = {
  DrugLabelService,
  isDrugLabelsDisabled,
  htmlToText,
  excerpt,
  sectionForQuestion,
  pickProduct,
  productLabel,
  SECTION_TITLES,
  DEFAULT_TIMEOUT_MS,
  BREAKER_THRESHOLD
};
