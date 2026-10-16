// Cabeza léxica: a qué guía se parece una pregunta, como segunda opinión del
// buscador BM25 (ClinicalGuidelineIndex).
//
// QUÉ ES: una regresión logística de 90 clases (una por guía) sobre TF-IDF de
// palabras (1 y 2) y de n-gramas de caracteres (3 a 5, dentro de cada palabra).
// Se entrena en el build (scripts/build-guideline-head.js) solo con texto
// público de las guías: títulos, palabras clave, «título. sección» y las
// consultas doc2query. Nunca con preguntas de la evaluación.
//
// PARA QUÉ: cuando el buscador duda (la G1 no es «alta» o hay empate), la
// cabeza decide dos cosas (retrieveForPrompt):
//   - VETO: si ninguna guía del prompt está entre las K que la cabeza cree
//     posibles, el tema no tiene guía y el prompt va vacío (el modelo se
//     abstiene en vez de apoyarse en un vecino lejano);
//   - CUPO: si la cabeza está segura (p ≥ π) de una guía que el buscador dejó
//     fuera, entra su mejor fragmento como segundo extracto.
// K y π se calculan en el build con reglas que solo miran la evaluación del
// repo (K: el menor sin perder ninguna pregunta; π: el menor que no agrega
// guías en las preguntas fuera del corpus) y viajan en el modelo.
//
// PURO Y LOCAL: sin red, sin dependencias. Los pesos van cuantizados a int8
// (base64) en knowledge/guias-clinicas/guideline-head.json, que se carga con
// `require` de ruta estática (lo que Vercel empaqueta). Responde en ~0,3 ms.

/** Minúsculas y sin tildes (como strip_accents='unicode' de scikit-learn). */
function stripAccents(text) {
  return `${text || ''}`.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Palabras de dos o más caracteres de palabra (token_pattern \b\w\w+\b). */
function wordTokens(text) {
  return text.match(/[\p{L}\p{N}_]{2,}/gu) || [];
}

/** Unigramas y bigramas de palabras. */
function wordGrams(text) {
  const tokens = wordTokens(text);
  const grams = [...tokens];
  for (let i = 0; i + 1 < tokens.length; i += 1) grams.push(`${tokens[i]} ${tokens[i + 1]}`);
  return grams;
}

/** N-gramas de caracteres dentro de cada palabra, con un espacio a cada lado (char_wb). */
function charGrams(text, min = 3, max = 5) {
  const out = [];
  for (const raw of text.replace(/\s\s+/g, ' ').split(/\s+/).filter(Boolean)) {
    const letters = [...` ${raw} `];
    for (let n = min; n <= max; n += 1) {
      let offset = 0;
      out.push(letters.slice(offset, offset + n).join(''));
      while (offset + n < letters.length) {
        offset += 1;
        out.push(letters.slice(offset, offset + n).join(''));
      }
      // Una palabra más corta que n se cuenta una sola vez.
      if (offset === 0) break;
    }
  }
  return out;
}

/** Conteos de los n-gramas que están en el vocabulario. */
function countGrams(grams, vocabulary) {
  const counts = new Map();
  for (const gram of grams) {
    const position = vocabulary.get(gram);
    if (position !== undefined) counts.set(position, (counts.get(position) || 0) + 1);
  }
  return counts;
}

/** TF sublineal × IDF, normalizado a norma 1 (cada bloque por separado). */
function tfidf(counts, idf, offset, into) {
  let squared = 0;
  const values = [];
  for (const [position, count] of counts) {
    const value = (1 + Math.log(count)) * idf[position];
    values.push([position + offset, value]);
    squared += value * value;
  }
  const norm = Math.sqrt(squared) || 1;
  for (const [position, value] of values) into.push([position, value / norm]);
}

/** Rasgos dispersos [posición, valor] de un texto para un modelo dado. */
function featuresFor(text, model) {
  const plain = stripAccents(text);
  const features = [];
  tfidf(countGrams(wordGrams(plain), model.wordIndex), model.word.idf, 0, features);
  tfidf(countGrams(charGrams(plain), model.charIndex), model.char.idf, model.word.terms.length, features);
  return features;
}

class GuidelineHead {
  /**
   * @param {object} model  lo que escribe scripts/build-guideline-head.js:
   *   { source_hash, gids, word: {terms, idf}, char: {terms, idf}, scale, intercept, W (int8 base64), veto_k, cupo_p }
   */
  constructor(model) {
    this.model = model;
    this.sourceHash = model.source_hash || '';
    this.gids = model.gids;
    this.vetoK = model.veto_k;
    this.cupoP = model.cupo_p;
    this.classes = model.gids.length;
    this.index = {
      word: model.word,
      char: model.char,
      wordIndex: new Map(model.word.terms.map((term, position) => [term, position])),
      charIndex: new Map(model.char.terms.map((term, position) => [term, position]))
    };
    const bytes = Buffer.from(model.W, 'base64');
    this.weights = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  }

  /** Las k guías más probables: [[guideline_id, probabilidad], …]. */
  rank(text, k = 20) {
    const classes = this.classes;
    const logits = new Float64Array(classes);
    for (const [feature, value] of featuresFor(text, this.index)) {
      const base = feature * classes;
      for (let g = 0; g < classes; g += 1) logits[g] += value * this.weights[base + g];
    }
    let max = -Infinity;
    for (let g = 0; g < classes; g += 1) {
      logits[g] = logits[g] * this.model.scale[g] + this.model.intercept[g];
      if (logits[g] > max) max = logits[g];
    }
    let sum = 0;
    for (let g = 0; g < classes; g += 1) {
      logits[g] = Math.exp(logits[g] - max);
      sum += logits[g];
    }
    return [...logits]
      .map((value, g) => [this.gids[g], value / sum])
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  }
}

module.exports = {
  GuidelineHead,
  stripAccents,
  wordGrams,
  charGrams,
  featuresFor
};
