// Gramática de los marcadores que sustituyen a los identificadores directos.
//
// `[PACIENTE_NOMBRE_1]` es la forma principal de una entidad; `[PACIENTE_NOMBRE_1_2]`
// es un ALIAS distinto de la misma entidad («don José» frente a «José David
// Pérez»). Cada marcador restaura exactamente la forma que tapó: el modo
// literal de patología y los validadores de evidencia comparan texto exacto, y
// una forma canónica en su lugar rompía ambos (revisión del 2026-09-07).
//
// Dos formas de reconocerlos, a propósito distintas:
//   - CON corchetes: tolerante. Los modelos escriben `[paciente nombre 1]`,
//     `[PACIENTE_NOMBRE_01]`, `**[PATIENT_NAME_1]**`; todo eso se acepta.
//   - SIN corchetes: solo la forma exacta en mayúsculas con guion bajo. Si se
//     aceptara «documento 1» a secas, la prosa «el documento 1 dice» pasaría
//     por marcador y se reemplazaría por la cédula de alguien.

const TYPES = Object.freeze({
  PACIENTE_NOMBRE: 'PACIENTE_NOMBRE',
  DOCUMENTO: 'DOCUMENTO',
  TELEFONO: 'TELEFONO',
  CORREO: 'CORREO',
  DIRECCION: 'DIRECCION',
  NUMERO: 'NUMERO'
});

const TYPE_LIST = Object.freeze(Object.values(TYPES));

// Cómo se escribe cada tipo dentro de corchetes, incluidas las traducciones
// que producen los modelos al copiar. Se normaliza antes de comparar (sin
// tildes, sin separadores).
const TYPE_PATTERNS = [
  [TYPES.PACIENTE_NOMBRE, 'PACIENTE[ _-]?NOMBRE|NOMBRE[ _-]?PACIENTE|PATIENT[ _-]?NAME'],
  [TYPES.DOCUMENTO, 'DOCUMENTO|DOCUMENT(?:[ _-]?NUMBER)?|ID[ _-]?DOCUMENT'],
  [TYPES.TELEFONO, 'TEL[ÉE]FONO|PHONE(?:[ _-]?NUMBER)?|TELEPHONE'],
  [TYPES.CORREO, 'CORREO|E[ _-]?MAIL'],
  [TYPES.DIRECCION, 'DIRECCI[ÓO]N|ADDRESS'],
  [TYPES.NUMERO, 'N[ÚU]MERO|NUMBER']
];

const BRACKETED_RE = new RegExp(
  `\\[\\s*(${TYPE_PATTERNS.map(([, p]) => `(?:${p})`).join('|')})[ _-]?0*(\\d{1,4})(?:[ _.-]0*(\\d{1,3}))?\\s*\\]`,
  'giu'
);

const BARE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${TYPE_LIST.join('|')})_0*(\\d{1,4})(?:_0*(\\d{1,3}))?(?![\\p{L}\\p{N}_])`,
  'gu'
);

function normalizeTypeName(raw) {
  const flat = `${raw || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (flat.includes('PACIENTE') || flat.includes('PATIENT')) return TYPES.PACIENTE_NOMBRE;
  if (flat.startsWith('DOCUMENT') || flat.startsWith('IDDOCUMENT')) return TYPES.DOCUMENTO;
  if (flat.startsWith('TEL') || flat.startsWith('PHONE')) return TYPES.TELEFONO;
  if (flat.startsWith('CORREO') || flat.startsWith('EMAIL')) return TYPES.CORREO;
  if (flat.startsWith('DIRECCION') || flat.startsWith('ADDRESS')) return TYPES.DIRECCION;
  if (flat.startsWith('NUMERO') || flat.startsWith('NUMBER')) return TYPES.NUMERO;
  return null;
}

function formatToken(type, n, k = 1) {
  return k > 1 ? `[${type}_${n}_${k}]` : `[${type}_${n}]`;
}

/** Todos los marcadores de un texto, con su posición, en orden de aparición. */
function findTokens(text) {
  const input = `${text ?? ''}`;
  const found = [];
  for (const re of [BRACKETED_RE, BARE_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(input)) !== null) {
      const type = normalizeTypeName(match[1]);
      if (!type) continue;
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        raw: match[0],
        type,
        n: Number(match[2]),
        k: match[3] ? Number(match[3]) : 1
      });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  // Un marcador con corchetes también contiene la forma sin corchetes: se
  // deduplica quedándose con el tramo más largo.
  const merged = [];
  for (const item of found) {
    const last = merged[merged.length - 1];
    if (last && item.start < last.end) continue;
    merged.push(item);
  }
  return merged;
}

function containsToken(text) {
  return findTokens(text).length > 0;
}

/**
 * Reemplaza cada marcador por lo que devuelva `fn(token)`. Si devuelve
 * `undefined`, el marcador se deja tal cual (es lo que pasa con un id que esta
 * llamada no emitió).
 */
function replaceTokens(text, fn) {
  const input = `${text ?? ''}`;
  const tokens = findTokens(input);
  if (tokens.length === 0) return input;
  let out = '';
  let cursor = 0;
  for (const token of tokens) {
    const replacement = fn(token);
    out += input.slice(cursor, token.start);
    out += replacement === undefined ? token.raw : replacement;
    cursor = token.end;
  }
  return out + input.slice(cursor);
}

// Etiqueta de la casilla de identificación justo antes de un marcador. Sirve
// tanto con saltos de línea reales como con el `\n` escapado de un JSON crudo.
const IDENTITY_LABEL_BEFORE = /(?:^|\n|\\n|"|\\")[ \t]*(?:nombre|documento|c[ée]dula|identificaci[óo]n|cc|ti|nuip)\b[^:\n]{0,40}:[ \t]*$/i;

/**
 * En las líneas «Nombre:» / «Documento:» un alias (`_n_k`) se lleva a su forma
 * principal (`_n`): la identificación de la consulta tiene que salir completa,
 * no con el diminutivo que el modelo copió de la prosa.
 */
function normalizeIdentityAliases(text) {
  const input = `${text ?? ''}`;
  return replaceTokens(input, (token) => {
    if (token.k <= 1) return undefined;
    const before = input.slice(Math.max(0, token.start - 80), token.start);
    if (!IDENTITY_LABEL_BEFORE.test(before)) return undefined;
    return formatToken(token.type, token.n, 1);
  });
}

module.exports = {
  TYPES,
  TYPE_LIST,
  formatToken,
  findTokens,
  containsToken,
  replaceTokens,
  normalizeIdentityAliases,
  normalizeTypeName
};
