// Entrenamiento de la cabeza léxica (src/application/knowledge/GuidelineHead.js).
//
// Solo corre en el build (scripts/build-guideline-head.js), nunca en Vercel.
// Node puro, sin dependencias: TF-IDF como el TfidfVectorizer de scikit-learn
// (sublinear_tf, idf suavizado, norma 2) y regresión logística multinomial con
// regularización L2 (C = 10, como el LogisticRegression del torneo), resuelta
// con L-BFGS. El problema es convexo: converge a la misma solución que
// scikit-learn, y scripts/build-guideline-head.js lo comprueba contra la
// referencia del torneo cuando se le pide (--paridad).
const { stripAccents, wordGrams, charGrams } = require('../../src/application/knowledge/GuidelineHead');

const C_REGULARIZATION = 10;

/** Textos de entrenamiento: solo lo público de cada guía. */
function trainingPairs(corpus) {
  const pairs = [];
  for (const guideline of corpus.guidelines) {
    pairs.push([guideline.titulo, guideline.id]);
    for (const keyword of guideline.palabras_clave || []) pairs.push([keyword, guideline.id]);
    for (const section of guideline.secciones || []) pairs.push([`${guideline.titulo}. ${section.titulo}`, guideline.id]);
  }
  for (const guideline of corpus.guidelines) {
    for (const query of guideline.consultas || []) pairs.push([query, guideline.id]);
  }
  return pairs;
}

function fitVectorizer(documents) {
  const df = new Map();
  for (const grams of documents) for (const gram of new Set(grams)) df.set(gram, (df.get(gram) || 0) + 1);
  const terms = [...df.keys()].sort();
  const n = documents.length;
  return {
    terms,
    idf: terms.map((term) => Math.log((1 + n) / (1 + df.get(term))) + 1),
    index: new Map(terms.map((term, position) => [term, position]))
  };
}

function sparseRow(grams, vectorizer, offset) {
  const counts = new Map();
  for (const gram of grams) {
    const position = vectorizer.index.get(gram);
    if (position !== undefined) counts.set(position, (counts.get(position) || 0) + 1);
  }
  let squared = 0;
  const row = [];
  for (const [position, count] of counts) {
    const value = (1 + Math.log(count)) * vectorizer.idf[position];
    row.push([position + offset, value]);
    squared += value * value;
  }
  const norm = Math.sqrt(squared) || 1;
  return row.map(([position, value]) => [position, value / norm]);
}

/**
 * Pérdida logística media + L2/(2·C·n) y su gradiente. Parámetros: W por
 * rasgo (F × G, fila por rasgo) y luego los G interceptos (sin regularizar).
 */
function lossAndGradient(params, rows, labels, features, classes, gradient) {
  const n = rows.length;
  const interceptBase = features * classes;
  gradient.fill(0);
  let loss = 0;
  const logits = new Float64Array(classes);
  for (let i = 0; i < n; i += 1) {
    for (let g = 0; g < classes; g += 1) logits[g] = params[interceptBase + g];
    for (const [feature, value] of rows[i]) {
      const base = feature * classes;
      for (let g = 0; g < classes; g += 1) logits[g] += value * params[base + g];
    }
    let max = -Infinity;
    for (let g = 0; g < classes; g += 1) if (logits[g] > max) max = logits[g];
    let sum = 0;
    for (let g = 0; g < classes; g += 1) {
      logits[g] = Math.exp(logits[g] - max);
      sum += logits[g];
    }
    loss += Math.log(sum) - Math.log(logits[labels[i]]);
    for (let g = 0; g < classes; g += 1) logits[g] = logits[g] / sum - (g === labels[i] ? 1 : 0);
    for (let g = 0; g < classes; g += 1) gradient[interceptBase + g] += logits[g];
    for (const [feature, value] of rows[i]) {
      const base = feature * classes;
      for (let g = 0; g < classes; g += 1) gradient[base + g] += value * logits[g];
    }
  }
  const l2 = 1 / (C_REGULARIZATION * n);
  let squared = 0;
  for (let p = 0; p < interceptBase; p += 1) {
    squared += params[p] * params[p];
    gradient[p] = gradient[p] / n + l2 * params[p];
  }
  for (let p = interceptBase; p < params.length; p += 1) gradient[p] /= n;
  return loss / n + (l2 / 2) * squared;
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** L-BFGS con búsqueda de línea de Armijo por retroceso. Determinista. */
function lbfgs(evaluate, size, { memory = 7, maxIterations = 3000, gradientTolerance = 1e-6, relativeTolerance = 1e-12, log = () => {} } = {}) {
  let x = new Float64Array(size);
  let gradient = new Float64Array(size);
  let value = evaluate(x, gradient);
  const history = [];
  const direction = new Float64Array(size);
  const alpha = new Float64Array(memory);
  let candidate = new Float64Array(size);
  let candidateGradient = new Float64Array(size);
  let iteration = 0;
  let stalled = 0;
  for (; iteration < maxIterations; iteration += 1) {
    let maxGradient = 0;
    for (let i = 0; i < size; i += 1) maxGradient = Math.max(maxGradient, Math.abs(gradient[i]));
    if (maxGradient < gradientTolerance) break;
    // Recursión de dos bucles: dirección = −H·g.
    for (let i = 0; i < size; i += 1) direction[i] = -gradient[i];
    for (let k = history.length - 1; k >= 0; k -= 1) {
      const { s, y, rho } = history[k];
      alpha[k] = rho * dot(s, direction);
      for (let i = 0; i < size; i += 1) direction[i] -= alpha[k] * y[i];
    }
    if (history.length) {
      const { s, y } = history[history.length - 1];
      const gamma = dot(s, y) / dot(y, y);
      for (let i = 0; i < size; i += 1) direction[i] *= gamma;
    }
    for (let k = 0; k < history.length; k += 1) {
      const { s, y, rho } = history[k];
      const beta = rho * dot(y, direction);
      for (let i = 0; i < size; i += 1) direction[i] += (alpha[k] - beta) * s[i];
    }
    let slope = dot(gradient, direction);
    if (slope >= 0) {
      // Dirección inválida: se reinicia con descenso por gradiente.
      history.length = 0;
      for (let i = 0; i < size; i += 1) direction[i] = -gradient[i];
      slope = dot(gradient, direction);
    }
    let step = history.length ? 1 : 1 / Math.max(1, Math.sqrt(-slope));
    let next = value;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      for (let i = 0; i < size; i += 1) candidate[i] = x[i] + step * direction[i];
      next = evaluate(candidate, candidateGradient);
      if (next <= value + 1e-4 * step * slope) break;
      step /= 2;
    }
    const s = new Float64Array(size);
    const y = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      s[i] = candidate[i] - x[i];
      y[i] = candidateGradient[i] - gradient[i];
    }
    const curvature = dot(s, y);
    if (curvature > 1e-12) {
      history.push({ s, y, rho: 1 / curvature });
      if (history.length > memory) history.shift();
    }
    const improvement = value - next;
    [x, candidate] = [candidate, x];
    [gradient, candidateGradient] = [candidateGradient, gradient];
    value = next;
    if (iteration % 100 === 0) log(`iteración ${iteration}: pérdida ${value.toFixed(6)} · |g|∞ ${maxGradient.toExponential(2)}`);
    // Parada por estancamiento: varias iteraciones seguidas sin mejora medible.
    stalled = improvement < relativeTolerance * Math.max(1, Math.abs(value)) ? stalled + 1 : 0;
    if (stalled >= 5) break;
  }
  return { x, value, iterations: iteration };
}

/**
 * Entrena y devuelve el modelo listo para serializar (sin veto_k ni cupo_p,
 * que se calibran después con el índice).
 */
function trainHead(pairs, { log = () => {}, ...options } = {}) {
  const gids = [...new Set(pairs.map(([, id]) => id))].sort();
  const classOf = new Map(gids.map((id, position) => [id, position]));
  const plain = pairs.map(([text]) => stripAccents(text));
  const wordDocs = plain.map(wordGrams);
  const charDocs = plain.map((text) => charGrams(text));
  const word = fitVectorizer(wordDocs);
  const char = fitVectorizer(charDocs);
  const features = word.terms.length + char.terms.length;
  const classes = gids.length;
  const rows = plain.map((_, i) => [...sparseRow(wordDocs[i], word, 0), ...sparseRow(charDocs[i], char, word.terms.length)]);
  const labels = pairs.map(([, id]) => classOf.get(id));
  log(`${pairs.length} textos · ${features} rasgos (${word.terms.length} de palabras, ${char.terms.length} de caracteres) · ${classes} guías`);
  const { x, value, iterations } = lbfgs(
    (params, gradient) => lossAndGradient(params, rows, labels, features, classes, gradient),
    features * classes + classes,
    { log, ...options }
  );
  log(`convergió en ${iterations} iteraciones · pérdida ${value.toFixed(6)}`);
  // Cuantización int8 con una escala por guía.
  const scale = new Float64Array(classes);
  for (let f = 0; f < features; f += 1) {
    for (let g = 0; g < classes; g += 1) scale[g] = Math.max(scale[g], Math.abs(x[f * classes + g]));
  }
  for (let g = 0; g < classes; g += 1) scale[g] = scale[g] / 127 || 1;
  const quantized = new Int8Array(features * classes);
  for (let f = 0; f < features; f += 1) {
    for (let g = 0; g < classes; g += 1) {
      quantized[f * classes + g] = Math.max(-127, Math.min(127, Math.round(x[f * classes + g] / scale[g])));
    }
  }
  const round = (value) => Number(value.toPrecision(7));
  return {
    gids,
    word: { terms: word.terms, idf: word.idf.map(round) },
    char: { terms: char.terms, idf: char.idf.map(round) },
    scale: [...scale].map(round),
    intercept: [...x.subarray(features * classes)].map(round),
    W: Buffer.from(quantized.buffer).toString('base64'),
    training: { texts: pairs.length, features, iterations, loss: round(value), c: C_REGULARIZATION }
  };
}

module.exports = { trainHead, trainingPairs, lbfgs, C_REGULARIZATION };
