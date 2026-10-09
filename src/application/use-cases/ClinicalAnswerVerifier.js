// Verificación de cifras de la respuesta del asistente. Puro: sin IO.
//
// El prompt exige que cada dosis, umbral, meta o duración salga de una fuente
// recuperada (guía [G#], ficha técnica [F#]) o de la consulta. Eso no se puede
// confiar al modelo, así que aquí se COMPRUEBA: se extraen las cifras con
// unidad de la respuesta («500 mg cada 8 h», «≥140/90 mmHg», «7 días») y se
// buscan, con la misma unidad (o una equivalente: 1 g = 1000 mg), en el texto
// de las fuentes y del contexto clínico. Lo que no aparece se devuelve como
// «cifra sin respaldo» para que la pantalla le pida al médico verificarla.
//
// Es una comprobación necesaria, no suficiente: que el número exista en la
// fuente no prueba que se haya usado bien. Por eso es una advertencia y no un
// filtro, y por eso el médico siempre ve las fuentes.

const MAX_UNVERIFIED = 8;

// Número con miles separados por espacio («10 000») o decimal con coma/punto.
const NUMBER = String.raw`\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
// Unidades: de la más larga a la más corta para que «mg/kg/día» no quede en «mg».
const UNITS = [
  'mg/kg/d[ií]a', 'mg/kg/d', 'mg/kg/h', 'mg/kg/min', '(?:mcg|µg|ug)/kg/min', '(?:mcg|µg|ug)/kg/h', '(?:mcg|µg|ug)/kg',
  'mg/kg', 'mg/m2', 'mg/m²', 'ml/kg/h', 'ml/kg/d[ií]a', 'ml/kg', 'ml/h', 'ml/min', 'l/min',
  'ui/kg', 'u/kg/h', 'u/kg', 'u/h', 'ui/l', 'mui/l', 'meq/l', 'meq/kg', 'meq', 'mmol/l', 'mmol', 'mosm/l',
  'mg/dl', 'g/dl', 'ng/ml', '(?:mcg|µg|ug)/l', 'mg/l', 'g/l', 'mmhg', 'cmh2o', 'kg/m2', 'kg/m²',
  'mg', 'mcg', 'µg', 'ug', 'g', 'kg', 'ml', 'cc', 'l', 'ui', 'u',
  '%', '°c', 'ºc', 'lpm', 'rpm', 'latidos', 'respiraciones',
  'horas', 'hora', 'h', 'minutos', 'minuto', 'min', 'segundos', 's',
  'd[ií]as', 'd[ií]a', 'semanas', 'semana', 'meses', 'mes', 'a[nñ]os', 'a[nñ]o',
  'puntos', 'punto', 'gotas', 'puffs', 'puff', 'inhalaciones', 'dosis', 'veces', 'tabletas', 'sobres'
];
const UNIT = `(?:${UNITS.join('|')})`;
// cifra [rango «-», «–», «a», «hasta», «/»] unidad; con comparador opcional.
const FIGURE_PATTERN = new RegExp(
  String.raw`(?:(?:≥|≤|>=|<=|>|<)\s*)?(${NUMBER})(?:\s*(?:-|–|—|−|a|hasta|/|y)\s*(${NUMBER}))?\s*(${UNIT})(?![a-záéíóúñ0-9])`,
  'giu'
);

// Familia y factor a una unidad base, para comparar «1 g» con «1000 mg».
function unitFamily(rawUnit) {
  const unit = `${rawUnit || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/µg|ug/g, 'mcg')
    .replace(/²/g, '2')
    .replace(/º/g, '°');
  const table = {
    mg: ['masa', 1], g: ['masa', 1000], mcg: ['masa', 0.001],
    'mg/kg': ['masa/kg', 1], 'mcg/kg': ['masa/kg', 0.001],
    'mg/kg/dia': ['masa/kg/dia', 1], 'mg/kg/d': ['masa/kg/dia', 1],
    ml: ['volumen', 1], cc: ['volumen', 1], l: ['volumen', 1000],
    horas: ['horas', 1], hora: ['horas', 1], h: ['horas', 1],
    minutos: ['minutos', 1], minuto: ['minutos', 1], min: ['minutos', 1],
    segundos: ['segundos', 1], s: ['segundos', 1],
    dias: ['dias', 1], dia: ['dias', 1], semanas: ['semanas', 1], semana: ['semanas', 1],
    meses: ['meses', 1], mes: ['meses', 1], anos: ['anos', 1], ano: ['anos', 1],
    puntos: ['puntos', 1], punto: ['puntos', 1], puffs: ['puffs', 1], puff: ['puffs', 1],
    lpm: ['por-minuto', 1], rpm: ['por-minuto', 1], latidos: ['por-minuto', 1], respiraciones: ['por-minuto', 1],
    '°c': ['temperatura', 1], 'kg/m2': ['imc', 1], 'mg/m2': ['masa/m2', 1]
  };
  return table[unit] || [unit, 1];
}

function parseNumber(raw) {
  if (raw === undefined || raw === null || `${raw}`.trim() === '') return null;
  const clean = `${raw || ''}`.replace(/[   ](?=\d{3}\b)/g, '').replace(',', '.');
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Cifras con unidad de un texto.
 * @returns {Array<{raw: string, numbers: number[], family: string, factor: number}>}
 */
function extractFigures(text) {
  const figures = [];
  for (const match of `${text || ''}`.matchAll(FIGURE_PATTERN)) {
    const [raw, first, second, unit] = match;
    const numbers = [parseNumber(first), parseNumber(second)].filter((value) => value !== null);
    if (!numbers.length) continue;
    const [family, factor] = unitFamily(unit);
    figures.push({ raw: raw.trim(), numbers, family, factor });
  }
  return figures;
}

/** Claves «familia:valor-en-unidad-base» presentes en las fuentes y el contexto. */
function evidenceKeys(texts) {
  const keys = new Set();
  for (const text of texts) {
    for (const figure of extractFigures(text)) {
      for (const number of figure.numbers) keys.add(`${figure.family}:${round(number * figure.factor)}`);
    }
  }
  return keys;
}

/**
 * Compara las cifras de la respuesta con la evidencia disponible.
 * @param {string} answer
 * @param {string[]} evidenceTexts  fragmentos de guías, fichas técnicas, nota, transcripción, mensaje e historial
 * @returns {{checked: number, unverified: string[]}}
 */
function verifyFigures(answer, evidenceTexts = []) {
  const figures = extractFigures(answer);
  if (!figures.length) return { checked: 0, unverified: [] };
  const keys = evidenceKeys((Array.isArray(evidenceTexts) ? evidenceTexts : []).filter(Boolean).map(String));
  const unverified = [];
  const seen = new Set();
  for (const figure of figures) {
    const supported = figure.numbers.every((number) => keys.has(`${figure.family}:${round(number * figure.factor)}`));
    if (supported) continue;
    const label = figure.raw.replace(/\s+/g, ' ');
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unverified.push(label);
    if (unverified.length >= MAX_UNVERIFIED) break;
  }
  return { checked: figures.length, unverified };
}

module.exports = {
  extractFigures,
  verifyFigures,
  unitFamily,
  parseNumber,
  MAX_UNVERIFIED
};
