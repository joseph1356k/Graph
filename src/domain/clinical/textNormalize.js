// Normalización de texto clínico para comparar lo que dijo el modelo con lo que
// dice la transcripción.
//
// Hasta ahora había DOS copias divergentes de `normalizeComparable`: la del
// validador de nota quitaba puntos finales pero no colapsaba espacios; la del
// validador del asistente colapsaba espacios pero conservaba puntos. Una cita
// que pasaba en una fallaba en la otra. Aquí vive la única versión.

const COMBINING_MARKS = /[̀-ͯ]/g;

function stripDiacritics(value = '') {
  return `${value ?? ''}`.normalize('NFD').replace(COMBINING_MARKS, '');
}

/** Sin tildes, espacios colapsados, minúsculas. Para comparar citas. */
function normalizeComparable(value = '') {
  return stripDiacritics(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Palabras de puntuación que el médico dicta y el modelo convierte en signos, y
// números que el STT puede transcribir como palabra o como cifra. Se normalizan
// SIMÉTRICAMENTE en ambos lados de la comparación literal, así que quitar «coma»
// de los dos textos no rompe nada aunque «coma» fuera un término clínico.
const PUNCTUATION_WORDS = [
  'punto y aparte', 'punto y seguido', 'punto final', 'punto y coma', 'dos puntos',
  'abre parentesis', 'cierra parentesis', 'entre parentesis', 'abre comillas', 'cierra comillas',
  'signo de interrogacion', 'signo de pregunta', 'guion', 'coma', 'punto'
];

const NUMBER_WORDS = Object.freeze({
  cero: '0', un: '1', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12',
  trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17',
  dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40',
  cincuenta: '50', sesenta: '60', setenta: '70', ochenta: '80', noventa: '90',
  cien: '100', mil: '1000'
});

/**
 * Normalización más agresiva para comprobar que una sección LITERAL sale del
 * dictado: sin signos de puntuación, sin las palabras de puntuación dictadas,
 * «por» y «x» entre cifras equivalentes, números en palabra pasados a cifra.
 */
function normalizeForVerbatim(value = '') {
  let text = normalizeComparable(value);
  for (const word of PUNCTUATION_WORDS) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
  }
  text = text.replace(/[.,;:()"“”«»¿?¡!\-–—…/]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  const tokens = text.split(' ').filter(Boolean).map((token) => {
    if (NUMBER_WORDS[token]) return NUMBER_WORDS[token];
    if (token === 'x' || token === 'por') return 'x';
    return token;
  });
  return tokens.join(' ');
}

/**
 * Fracción de tokens de `content` que aparecen, en orden, dentro de `source`
 * (subsecuencia, no substring: tolera pequeñas inserciones del STT).
 * 1 = todo el contenido sale del dictado; 0 = nada.
 */
function verbatimCoverage(content = '', source = '') {
  const needle = normalizeForVerbatim(content).split(' ').filter(Boolean);
  const haystack = normalizeForVerbatim(source).split(' ').filter(Boolean);
  if (!needle.length) return 1;
  if (!haystack.length) return 0;
  let cursor = 0;
  let hits = 0;
  for (const token of needle) {
    const found = haystack.indexOf(token, cursor);
    if (found >= 0) {
      hits += 1;
      cursor = found + 1;
    }
  }
  return hits / needle.length;
}

// Signos que el reconocimiento de voz pone o quita a su criterio. Para ubicar
// una cita cuentan como espacio: «¿Y 60 cigarrillos al día?» y «60 cigarrillos
// al día» son la misma cita. Antes una coma de diferencia bastaba para
// descartarla, y la sección caía a "inferred" con el contenido correcto (piloto
// de cardiología: 22 citas descartadas, 5 secciones marcadas "revisar"). «/» y
// «-» no están en la lista porque cambian el dato (140/70, rótulo 26-3456). La
// coma decimal sí: «3,5» se compara como «3 5» en los dos lados, así que una
// cita sigue sin poder cambiar una cifra por otra; sólo deja de fallar por un signo.
const CITATION_PUNCTUATION = /[.,;:¿?¡!"“”«»()…]/;

/** normalizeComparable + la puntuación del STT tratada como espacio. Para ubicar citas. */
function normalizeCitation(value = '') {
  return stripDiacritics(value)
    .split('')
    .map((char) => (CITATION_PUNCTUATION.test(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Índice del texto normalizado hacia el original: `normalized[i]` proviene de
 * `original[map[i]]`. Necesario para devolver offsets reales cuando la
 * comparación se hizo sin tildes, sin espacios repetidos y sin la puntuación
 * del STT (misma normalización que normalizeCitation).
 */
function buildNormalizedIndex(text = '') {
  const original = `${text ?? ''}`;
  let normalized = '';
  const map = [];
  let lastWasSpace = true; // así se descartan los espacios iniciales
  for (let index = 0; index < original.length; index += 1) {
    const char = original[index];
    if (/\s/.test(char) || CITATION_PUNCTUATION.test(char)) {
      if (!lastWasSpace) {
        normalized += ' ';
        map.push(index);
        lastWasSpace = true;
      }
      continue;
    }
    const folded = stripDiacritics(char).toLowerCase();
    for (const piece of folded) {
      normalized += piece;
      map.push(index);
    }
    lastWasSpace = false;
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

/**
 * Localiza `fragment` dentro de `haystack` comparando normalizado, y devuelve
 * los offsets en el ORIGINAL más la cita tal como está escrita allí.
 * `index` puede pasarse precalculado (buildNormalizedIndex) para no rehacerlo
 * por cada fragmento de una misma transcripción.
 */
function locateFragment(haystack = '', fragment = '', index = null) {
  const needle = normalizeCitation(fragment);
  if (!needle) return null;
  const { normalized, map } = index || buildNormalizedIndex(haystack);
  const at = normalized.indexOf(needle);
  if (at < 0) return null;
  const charStart = map[at];
  const charEnd = map[at + needle.length - 1] + 1;
  return {
    quote: `${haystack}`.slice(charStart, charEnd),
    char_start: charStart,
    char_end: charEnd
  };
}

module.exports = {
  stripDiacritics,
  normalizeComparable,
  normalizeCitation,
  normalizeForVerbatim,
  verbatimCoverage,
  buildNormalizedIndex,
  locateFragment
};
