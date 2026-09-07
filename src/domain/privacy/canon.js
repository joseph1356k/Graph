// Reconocimiento de formas: cómo se escribe un nombre, un documento o un
// teléfono para poder ENCONTRARLOS en un texto. Nunca se usa para reescribir
// nada: el marcador restaura la forma exacta que tapó, y la canonización del
// documento sigue viviendo en el borde del portal (lib/clinical/patient-identity.ts).
//
// Portado de lib/privacy/redact.ts y lib/clinical/patient-identity.ts del
// portal (2026-09-07), con sus mismas decisiones: partículas que no se tapan
// sueltas, insensibilidad a tildes sin normalizar el texto de entrada, y
// distinción entre documento numérico y alfanumérico.

const NAME_PARTICLES = Object.freeze([
  'de', 'del', 'la', 'las', 'los', 'da', 'dos', 'san', 'santa', 'van', 'von', 'y', 'e'
]);
const PARTICLE_SET = new Set(NAME_PARTICLES);

// Nombres de pila que también son palabras corrientes o términos clínicos.
// «Dolores Luz Cruz» consulta por «dolores abdominales»: un token suelto de
// estos solo se tapa si va en mayúscula en el origen o pegado a un ancla.
const NOMBRES_QUE_SON_PALABRAS = new Set([
  'dolores', 'luz', 'rosa', 'cruz', 'sol', 'paz', 'mar', 'flor', 'alba', 'pilar', 'mercedes',
  'salud', 'victoria', 'angel', 'consuelo', 'socorro', 'remedios', 'amparo', 'concepcion',
  'blanca', 'esperanza', 'milagros', 'leon', 'rocio', 'nieves', 'gloria', 'aurora', 'estrella',
  'perla', 'rubi', 'america', 'reyes', 'santos', 'pastor', 'mora', 'campo', 'rio', 'prado',
  'roca', 'valle', 'sierra', 'castillo', 'iglesias', 'bueno', 'blanco', 'rubio', 'moreno',
  'calle', 'carrera', 'vega', 'pino', 'olmo', 'flores', 'nino', 'nina', 'grande', 'delgado',
  'hidalgo', 'noble', 'cano', 'pardo', 'bravo', 'guerra', 'fuentes', 'rios', 'montes', 'lago'
]);

const ACCENT_CLASSES = {
  a: '[aáàâäã]',
  e: '[eéèêë]',
  i: '[iíìîï]',
  o: '[oóòôöõ]',
  u: '[uúùûü]',
  n: '[nñ]',
  c: '[cç]'
};

// Límites de palabra Unicode. Nunca \b: en JS es ASCII y /José\b/ no matchea
// «José » porque la é no cuenta como \w.
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

function escapeRegExp(text) {
  return `${text}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sin tildes y en minúsculas («José» → «jose»), para comparar y para claves. */
function normalizeToken(token) {
  return `${token ?? ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es');
}

/** Texto comparable: sin tildes, minúsculas, espacios colapsados. */
function normalizeComparable(text) {
  return normalizeToken(text).replace(/\s+/g, ' ').trim();
}

/** Patrón insensible a tildes y mayúsculas para un token ya normalizado. */
function tokenToPattern(token) {
  return Array.from(token)
    .map((ch) => ACCENT_CLASSES[ch] ?? escapeRegExp(ch))
    .join('');
}

/** Tokens de un nombre que sirven para buscarlo sueltos: ≥3 letras y no partícula. */
function nameTokens(name) {
  return `${name ?? ''}`
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !PARTICLE_SET.has(token) && /^[\p{L}'-]+$/u.test(token));
}

function isCommonWordName(token) {
  return NOMBRES_QUE_SON_PALABRAS.has(normalizeToken(token));
}

function startsUpper(word) {
  const first = `${word ?? ''}`.charAt(0);
  return Boolean(first) && first !== first.toLocaleLowerCase('es') && first === first.toLocaleUpperCase('es');
}

/* ------------------------------------------------------------------ */
/* Cifras dictadas en palabras                                          */
/* ------------------------------------------------------------------ */

const PALABRA_A_NUMERO = {
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40,
  cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90
};
const DECENAS = new Set([30, 40, 50, 60, 70, 80, 90]);
const PALABRAS_NUMERO = Object.keys(PALABRA_A_NUMERO);

/**
 * «uno cero tres seis…» → «1036…». Cobertura corta a propósito (0–99, que es
 * como se dicta un documento). Ante «mil» o «millones» devuelve undefined: un
 * documento a medio traducir es peor que uno vacío.
 */
function digitosDePalabras(texto) {
  const palabras = normalizeToken(texto).split(/[\s.,-]+/).filter(Boolean);
  if (!palabras.length) return undefined;
  let salida = '';
  let pendiente = null;
  for (const palabra of palabras) {
    if (palabra === 'y') {
      if (pendiente === null || !DECENAS.has(pendiente)) return undefined;
      continue;
    }
    const valor = PALABRA_A_NUMERO[palabra];
    if (valor === undefined) return undefined;
    if (pendiente !== null && DECENAS.has(pendiente) && valor >= 1 && valor <= 9) {
      salida += String(pendiente + valor);
      pendiente = null;
      continue;
    }
    if (pendiente !== null) salida += String(pendiente);
    pendiente = valor;
  }
  if (pendiente !== null) salida += String(pendiente);
  return salida || undefined;
}

/* ------------------------------------------------------------------ */
/* Documento                                                            */
/* ------------------------------------------------------------------ */

const SIGLAS_DOCUMENTO = new Set([
  'CC', 'TI', 'RC', 'CE', 'PA', 'PP', 'PPT', 'PEP', 'NUIP', 'NIT', 'MS', 'AS', 'CN', 'SC'
]);
const TIPO_DICTADO = {
  cedula: 'CC', ciudadania: 'CC', tarjeta: 'TI', registro: 'RC', extranjeria: 'CE',
  pasaporte: 'PA', nuip: 'NUIP'
};
const MIN_DIGITOS = 5;
const MAX_DIGITOS = 12;
const MIN_ALFANUMERICO = 5;
const MAX_ALFANUMERICO = 20;

/**
 * Clave estable de un documento tal como se escribió: los dígitos (o el token
 * alfanumérico en mayúsculas) sin separadores ni sigla. `undefined` si lo que
 * hay no es un documento.
 */
function documentKey(bruto) {
  const texto = `${bruto ?? ''}`.trim();
  if (!texto) return undefined;
  let resto = texto;
  const sigla = /^([A-Za-z]{2,4})[\s.:-]+(.+)$/.exec(resto);
  if (sigla && SIGLAS_DOCUMENTO.has(sigla[1].toUpperCase())) {
    resto = sigla[2];
  } else {
    const palabras = /^((?:[\p{L}]+[\s.]+){1,4})(.*)$/u.exec(resto);
    if (palabras) {
      const sueltas = normalizeToken(palabras[1]).split(/[\s.]+/);
      for (const palabra of sueltas) {
        if (TIPO_DICTADO[palabra]) {
          resto = palabras[2];
          break;
        }
      }
    }
  }
  resto = resto.trimStart();

  const token = (/^[0-9A-Za-z]+(?:[.\-][0-9A-Za-z]+)*/.exec(resto)?.[0] ?? '').replace(/[.\-]/g, '');
  const esAlfanumerico = /[A-Za-z]/.test(token) && /[0-9]/.test(token);
  const crudo = esAlfanumerico
    ? (/^[0-9A-Za-z]+(?:[.\-][0-9A-Za-z]+)*/.exec(resto)?.[0] ?? '')
    : (/^[0-9][0-9 .\-]*/.exec(resto)?.[0] ?? '');

  if (!crudo) {
    if (/[0-9]/.test(resto)) return undefined;
    const enPalabras = digitosDePalabras(resto);
    if (!enPalabras) return undefined;
    if (enPalabras.length < MIN_DIGITOS || enPalabras.length > MAX_DIGITOS) return undefined;
    return enPalabras;
  }

  const numero = crudo.replace(/[\s.\-]/g, '').toUpperCase();
  if (esAlfanumerico) {
    if (numero.length < MIN_ALFANUMERICO || numero.length > MAX_ALFANUMERICO) return undefined;
  } else if (numero.length < MIN_DIGITOS || numero.length > MAX_DIGITOS) {
    return undefined;
  }
  return numero;
}

/** Solo los dígitos de una cadena («+57 300-123 45 67» → «573001234567»). */
function digitsOf(text) {
  return `${text ?? ''}`.replace(/\D/g, '');
}

/** Patrón que encuentra una corrida de dígitos con separadores opcionales. */
function digitRunPattern(digits) {
  const clean = digitsOf(digits);
  if (!clean) return null;
  return `(?<!\\d)${clean.split('').join('[.\\s-]?')}(?!\\d)`;
}

module.exports = {
  NAME_PARTICLES,
  PARTICLE_SET,
  PALABRAS_NUMERO,
  NOT_WORD_BEFORE,
  NOT_WORD_AFTER,
  escapeRegExp,
  normalizeToken,
  normalizeComparable,
  tokenToPattern,
  nameTokens,
  isCommonWordName,
  startsUpper,
  digitosDePalabras,
  documentKey,
  digitsOf,
  digitRunPattern
};
