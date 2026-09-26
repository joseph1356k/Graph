// Detectores deterministas de identificadores directos en texto clínico
// dictado en español colombiano. Sin ningún modelo: usar un LLM para decidir
// qué no mandarle al LLM sería circular.
//
// Cada detector devuelve TRAMOS: { type, start, end, value, role, anchored }.
// `value` es el texto exacto del tramo, porque el marcador tiene que restaurar
// esa forma y no otra. Los tramos se resuelven después contra las semillas y
// entre sí (ProtectionMap): aquí solo se encuentran.
//
// Precisión por encima de recall en los nombres: un tramo dudoso que se tapa
// de más es reversible (el marcador lo devuelve), pero degrada lo que el
// modelo entiende; y un nombre suelto que es palabra corriente («Luz»,
// «Dolores») solo se acepta con mayúscula o pegado a un ancla.

const { TYPES } = require('./tokens');
const {
  PARTICLE_SET,
  PALABRAS_NUMERO,
  normalizeToken,
  tokenToPattern,
  documentKey,
  digitsOf,
  startsUpper,
  isCommonWordName
} = require('./canon');

// «veintitrés» y «veintitres» son la misma cifra: el patrón es insensible a tildes.
const NUMERO_EN_PALABRAS = PALABRAS_NUMERO.map(tokenToPattern).join('|');

const ROLES = Object.freeze({ PACIENTE: 'paciente', MEDICO: 'medico', DESCONOCIDO: 'desconocido' });

const NAME_WORD = "\\p{Lu}[\\p{L}'’-]+";
const PARTICLE = '(?:de|del|la|las|los|y|e|da|dos|san|santa|van|von)';
const NAME_SEQ = `${NAME_WORD}(?:\\s+(?:${PARTICLE}\\s+){0,2}${NAME_WORD}){0,5}`;
const ANY_WORD = "[\\p{L}][\\p{L}'’-]+";
const LOOSE_SEQ = `${ANY_WORD}(?:\\s+${ANY_WORD}){0,5}`;

// Anclas fuertes: lo que sigue es un nombre aunque venga en minúscula (el
// proveedor de transcripción no siempre capitaliza).
const STRONG_PATIENT_ANCHOR = '(?:se\\s+llama|me\\s+llamo|mi\\s+nombre\\s+es|su\\s+nombre\\s+es|nombre\\s+(?:completo\\s+)?(?:del?\\s+|de\\s+la\\s+)?paciente\\s*(?:es|:)|identificad[oa]\\s+como|a\\s+nombre\\s+de)';
// Anclas débiles: exigen mayúscula inicial en el nombre.
// Los familiares y acompañantes también son terceros identificables («su
// esposa Martha Ruiz», «acompañante Pedro Gil»): mismo trato, mayúscula exigida.
const WEAK_PATIENT_ANCHOR = '(?:paciente\\s*:|paciente|señora?|sr\\.?|sra\\.?|don|doña|usuari[oa]|niñ[oa]|joven|espos[oa]|herman[oa]|hij[oa]|madre|padre|mam[áa]|pap[áa]|acompañante|cuidador[a]?|familiar)';
const DOCTOR_ANCHOR = '(?:soy\\s+(?:el|la)\\s+(?:doctora?|dra?\\.?|m[ée]dic[oa])|doctora?|dra?\\.|m[ée]dic[oa]\\s+tratante|enfermer[oa])';

const STRONG_RE = new RegExp(`(?<![\\p{L}])${STRONG_PATIENT_ANCHOR}[ \\t]+(${LOOSE_SEQ})`, 'giu');
const WEAK_RE = new RegExp(`(?<![\\p{L}])${WEAK_PATIENT_ANCHOR}[ \\t]+(${NAME_SEQ})`, 'giu');
const DOCTOR_RE = new RegExp(`(?<![\\p{L}])${DOCTOR_ANCHOR}[ \\t]+(${NAME_SEQ})`, 'giu');
// Línea etiquetada de la casilla de identificación («Nombre: María López»).
// Con la bandera `i` \p{Lu} también acepta minúsculas, así que la mayúscula
// exigida en NAME_SEQ se comprueba aparte, con este patrón sin bandera.
const CASE_SENSITIVE_NAME_RE = new RegExp(`^${NAME_SEQ}`, 'u');

const NAME_LABEL_RE = /(?:^|\n|\\n|[.;!?]\s+|"\s*)[ \t]*nombre(?:\s+(?:completo|del?\s+paciente|de\s+la\s+paciente))?\s*:[ \t]*([^\n"\\]{2,80})/giu;

// Palabras con las que se corta un nombre capturado en minúscula tras un ancla
// fuerte: «se llama juan pérez y consulta por…».
const NOMBRE_TERMINADORES = new Set([
  'que', 'quien', 'quien', 'con', 'por', 'para', 'tiene', 'tengo', 'viene', 'vengo', 'refiere',
  'consulta', 'presenta', 'edad', 'anos', 'ano', 'cedula', 'documento', 'identificado',
  'identificada', 'es', 'esta', 'y', 'o', 'u', 'a', 'al', 'en', 'el', 'lo', 'le', 'se', 'me', 'no',
  'si', 'pero', 'porque', 'cuando', 'donde', 'como', 'muy', 'mas', 'tambien', 'ya', 'hoy',
  'ayer', 'desde', 'hace', 'anos', 'meses', 'dias', 'paciente', 'acompanado', 'acompanada',
  'masculino', 'femenino', 'masculina', 'femenina', 'adulto', 'adulta', 'mayor', 'menor',
  'hombre', 'mujer', 'varon', 'lactante', 'gestante', 'embarazada', 'sexo', 'genero',
  'refiere', 'ingresa', 'llega', 'acude', 'manifiesta', 'niega', 'sin', 'del',
  // Etiquetas de casilla: nunca empiezan un nombre.
  'nombre', 'nombres', 'apellido', 'apellidos', 'documento', 'identificacion', 'fecha', 'motivo', 'diagnostico'
]);
const PRUDENT_VALUE = /^(no\s+(referid|mencionad|documentad|registrad|consta)|sin\s+(dato|informaci)|pendiente|desconocid|n\/?a\b|nn\b|por\s+(establecer|definir|confirmar))/i;

function cutLooseName(raw) {
  const words = raw.split(/\s+/);
  const kept = [];
  for (const word of words) {
    const norm = normalizeToken(word);
    if (NOMBRE_TERMINADORES.has(norm) && !(PARTICLE_SET.has(norm) && kept.length > 0)) break;
    kept.push(word);
    if (kept.length >= 5) break;
  }
  // Una partícula al final no es parte del nombre («juan de»).
  while (kept.length && PARTICLE_SET.has(normalizeToken(kept[kept.length - 1]))) kept.pop();
  return kept.join(' ');
}

function cleanLabelName(raw) {
  let name = `${raw}`.replace(/\s+/g, ' ').trim();
  name = name.split(/[(;]/)[0].trim();
  if (/\d/.test(name)) name = name.split(',')[0].trim();
  name = name.replace(/[\s.,;:]+$/, '').trim();
  if (!name || name.length > 80 || /\d/.test(name)) return '';
  if (PRUDENT_VALUE.test(normalizeToken(name))) return '';
  return name;
}

function significantCount(name) {
  return `${name}`.split(/\s+/).filter((w) => {
    const n = normalizeToken(w);
    return n.length >= 3 && !PARTICLE_SET.has(n);
  }).length;
}

function pushSpan(spans, { type, start, end, value, role, anchored, mask = true }) {
  if (!value || end <= start) return;
  spans.push({ type, start, end, value, role, anchored, mask });
}

/* ------------------------------------------------------------------ */
/* Nombres                                                              */
/* ------------------------------------------------------------------ */

function detectNames(text) {
  const spans = [];
  let match;

  DOCTOR_RE.lastIndex = 0;
  while ((match = DOCTOR_RE.exec(text)) !== null) {
    const start = match.index + match[0].length - match[1].length;
    const strict = CASE_SENSITIVE_NAME_RE.exec(text.slice(start));
    if (!strict) continue;
    const value = strict[0];
    pushSpan(spans, { type: TYPES.PACIENTE_NOMBRE, start, end: start + value.length, value, role: ROLES.MEDICO, anchored: true, mask: false });
  }

  STRONG_RE.lastIndex = 0;
  while ((match = STRONG_RE.exec(text)) !== null) {
    const cut = cutLooseName(match[1]);
    if (!cut || significantCount(cut) === 0) continue;
    const start = match.index + match[0].length - match[1].length;
    pushSpan(spans, { type: TYPES.PACIENTE_NOMBRE, start, end: start + cut.length, value: cut, role: ROLES.PACIENTE, anchored: true });
  }

  WEAK_RE.lastIndex = 0;
  while ((match = WEAK_RE.exec(text)) !== null) {
    const start = match.index + match[0].length - match[1].length;
    const strict = CASE_SENSITIVE_NAME_RE.exec(text.slice(start));
    if (!strict) continue;
    const value = strict[0];
    // «paciente Refiere dolor» al inicio de frase: exigimos que la primera
    // palabra no sea un verbo/término corriente capitalizado por puntuación.
    const first = normalizeToken(value.split(/\s+/)[0]);
    if (NOMBRE_TERMINADORES.has(first)) continue;
    if (significantCount(value) === 1 && isCommonWordName(value)) continue;
    pushSpan(spans, { type: TYPES.PACIENTE_NOMBRE, start, end: start + value.length, value, role: ROLES.PACIENTE, anchored: true });
  }

  NAME_LABEL_RE.lastIndex = 0;
  while ((match = NAME_LABEL_RE.exec(text)) !== null) {
    const cleaned = cleanLabelName(match[1]);
    if (!cleaned) continue;
    const offset = match[0].indexOf(match[1]);
    const rawStart = match.index + offset;
    const innerOffset = match[1].indexOf(cleaned);
    const start = rawStart + (innerOffset >= 0 ? innerOffset : 0);
    pushSpan(spans, { type: TYPES.PACIENTE_NOMBRE, start, end: start + cleaned.length, value: cleaned, role: ROLES.PACIENTE, anchored: true });
  }

  return spans;
}

/* ------------------------------------------------------------------ */
/* Documento                                                            */
/* ------------------------------------------------------------------ */

const DOC_ANCHOR = '(?:c[ée]dula(?:\\s+de\\s+(?:ciudadan[íi]a|extranjer[íi]a))?|documento(?:\\s+de\\s+identidad)?|identificaci[óo]n|tarjeta\\s+de\\s+identidad|registro\\s+civil|pasaporte|nuip|(?<![\\p{L}])(?:cc|ti|ce|rc)(?![\\p{L}])|(?<![\\p{L}])(?:c\\.\\s?c|t\\.\\s?i|c\\.\\s?e|r\\.\\s?c)\\.?(?![\\p{L}]))';
const DOC_VALUE = `(?:(?:[A-Z]{2,4}[\\s.:-]+)?[0-9][0-9 .\\-]{4,30}|(?:[A-Z]{2,4}\\s+)?[A-Za-z]{1,3}[-.]?[0-9]{4,12}|(?:${NUMERO_EN_PALABRAS})(?:[\\s,.-]+(?:${NUMERO_EN_PALABRAS}|y))+)`;
const DOC_RE = new RegExp(`${DOC_ANCHOR}\\s*(?:n[úu]mero|nro\\.?|no\\.?|#|n[°º])?\\s*(?:es|:|del?\\s+paciente\\s*:?)?\\s*(${DOC_VALUE})`, 'giu');
const CORRECTION_RE = /(?:repito|corrijo|perd[óo]n|mejor\s+dicho|es\s+decir)\s*[:,]?\s*([0-9][0-9 .\-]{4,30})/giu;

function trimDocValue(raw) {
  // Sin separadores colgando: «1.023.456.789, » → «1.023.456.789».
  return `${raw}`.replace(/[\s.,\-]+$/, '');
}

function detectDocuments(text) {
  const spans = [];
  let match;
  for (const re of [DOC_RE, CORRECTION_RE]) {
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const value = trimDocValue(match[1]);
      if (!documentKey(value)) continue;
      const start = match.index + match[0].indexOf(match[1]);
      pushSpan(spans, { type: TYPES.DOCUMENTO, start, end: start + value.length, value, role: ROLES.PACIENTE, anchored: true });
    }
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* Teléfono, correo, dirección                                          */
/* ------------------------------------------------------------------ */

// El número: indicativo opcional («+57», «(+57)»), celular 3xx o fijo 60x
// —con o sin paréntesis—, y el último bloque en 4 o en 2+2 («45 67»), que es
// como se dicta.
const PHONE_NUMBER = '(?:\\(?\\+?57\\)?[\\s.-]?)?\\(?(?:3\\d{2}|60\\d)\\)?[\\s.-]?\\d{3}[\\s.-]?(?:\\d{4}|\\d{2}[\\s.-]\\d{2})';
const PHONE_ANCHOR_RE = new RegExp(`(?:celular|tel[ée]fono|tel\\.?|cel\\.?|whatsapp|contacto|m[óo]vil)(?:\\s+(?:fijo|celular|m[óo]vil|de\\s+contacto|de\\s+la\\s+casa|del\\s+paciente|de\\s+el\\s+paciente|es|n[úu]mero))*\\s*(?::|#|n[°º])?\\s*(${PHONE_NUMBER})(?!\\d)`, 'giu');
// Sin ancla, solo el celular: seguido (3001234567) o en sus grupos 3-3-4 con un
// único separador («300 123 4567», «+57 300-123-4567»). Esa forma exacta no la
// tiene ningún valor clínico.
const MOBILE_RE = /(?<![\d\p{L}+])(?:\+?57[\s.-]?)?3\d{2}(?:\d{7}|([\s.-])\d{3}\1\d{4})(?![\d\p{L}])/gu;

function detectPhones(text) {
  const spans = [];
  let match;
  PHONE_ANCHOR_RE.lastIndex = 0;
  while ((match = PHONE_ANCHOR_RE.exec(text)) !== null) {
    const value = match[1];
    const start = match.index + match[0].indexOf(value);
    pushSpan(spans, { type: TYPES.TELEFONO, start, end: start + value.length, value, role: ROLES.PACIENTE, anchored: true });
  }
  MOBILE_RE.lastIndex = 0;
  while ((match = MOBILE_RE.exec(text)) !== null) {
    pushSpan(spans, { type: TYPES.TELEFONO, start: match.index, end: match.index + match[0].length, value: match[0], role: ROLES.PACIENTE, anchored: false });
  }
  return spans;
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

function detectEmails(text) {
  const spans = [];
  let match;
  EMAIL_RE.lastIndex = 0;
  while ((match = EMAIL_RE.exec(text)) !== null) {
    pushSpan(spans, { type: TYPES.CORREO, start: match.index, end: match.index + match[0].length, value: match[0], role: ROLES.PACIENTE, anchored: false });
  }
  return spans;
}

const ADDRESS_ANCHOR_RE = /(?:direcci[óo]n|vive\s+en|reside\s+en|residente\s+en|domicilio|domiciliad[oa]\s+en)\s*(?:es|:|de\s+residencia\s*:?)?\s*/giu;
const VIAL_RE = /(?<![\p{L}])(?:calle|cll?\.?|carrera|cra\.?|cr\.?|kr\.?|kra\.?|avenida|av\.?|transversal|tv\.?|trans\.?|diagonal|dg\.?|diag\.?|manzana|mz\.?|casa|apartamento|apto\.?|barrio|vereda|kil[óo]metro|km\.?|conjunto|torre|bloque)(?![\p{L}])/iu;
// Un punto cierra la dirección salvo que sea de abreviatura («Cra.», «Cll.»,
// «No.», «Apto.») o vaya seguido de una cifra: antes «dirección: Cra. 7 # 45-10»
// no se tapaba y «Carrera 7 No. 45-10» salía como «[DIRECCION_1]. 45-10».
const ADDRESS_END_RE = /(?<!(?:^|[^\p{L}])(?:cra|cr|kr|kra|cl|cll|av|tv|trans|dg|diag|mz|apto|km|no|nro|br|brr|urb|int|ed|edif))\.(?!\s*\d)|[;\n]|\\n|"|\s+(?:tel[ée]fono|celular|correo|documento|c[ée]dula)\b/iu;

function detectAddresses(text) {
  const spans = [];
  let match;
  ADDRESS_ANCHOR_RE.lastIndex = 0;
  while ((match = ADDRESS_ANCHOR_RE.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const window = text.slice(start, start + 140);
    const endMatch = ADDRESS_END_RE.exec(window);
    const chunk = (endMatch ? window.slice(0, endMatch.index) : window).replace(/\s+$/, '');
    if (chunk.length < 4) continue;
    const vial = VIAL_RE.exec(chunk.slice(0, 50));
    if (!vial) continue;
    pushSpan(spans, { type: TYPES.DIRECCION, start, end: start + chunk.length, value: chunk, role: ROLES.PACIENTE, anchored: true });
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* Corridas largas de dígitos sin ancla                                 */
/* ------------------------------------------------------------------ */

// Cédulas agrupadas («1.023.456.789») y corridas contiguas de 7–12 dígitos.
// Se conservan valores clínicos: «250.000» plaquetas (6 dígitos), «120/80»,
// fechas, horas y dosis no llegan a siete cifras seguidas.
const GROUPED_RE = /(?<!\d)\d{1,3}(?:\.\d{3}){2,3}(?!\d)/g;
const PLAIN_RE = /(?<![\d])\d{7,12}(?![\d])/g;

function detectNumbers(text) {
  const spans = [];
  let match;
  GROUPED_RE.lastIndex = 0;
  while ((match = GROUPED_RE.exec(text)) !== null) {
    const digits = digitsOf(match[0]);
    if (digits.length < 7 || digits.length > 12) continue;
    pushSpan(spans, { type: TYPES.NUMERO, start: match.index, end: match.index + match[0].length, value: match[0], role: ROLES.DESCONOCIDO, anchored: false });
  }
  PLAIN_RE.lastIndex = 0;
  while ((match = PLAIN_RE.exec(text)) !== null) {
    pushSpan(spans, { type: TYPES.NUMERO, start: match.index, end: match.index + match[0].length, value: match[0], role: ROLES.DESCONOCIDO, anchored: false });
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* Todo junto, sin solapes                                              */
/* ------------------------------------------------------------------ */

const PRIORITY = {
  [TYPES.DOCUMENTO]: 1,
  [TYPES.TELEFONO]: 2,
  [TYPES.CORREO]: 3,
  [TYPES.DIRECCION]: 4,
  [TYPES.PACIENTE_NOMBRE]: 5,
  [TYPES.NUMERO]: 6
};

/** Resuelve solapes: primero el que empieza antes; a igual inicio, el más largo; luego la prioridad. */
function resolveOverlaps(spans) {
  const sorted = [...spans].sort((a, b) =>
    a.start - b.start || (b.end - b.start) - (a.end - a.start) || (PRIORITY[a.type] || 9) - (PRIORITY[b.type] || 9)
  );
  const kept = [];
  for (const span of sorted) {
    const last = kept[kept.length - 1];
    if (last && span.start < last.end) {
      // Un tramo más largo con más prioridad que el ya aceptado lo reemplaza
      // solo si empieza en el mismo sitio (ya ordenado); si no, se descarta.
      continue;
    }
    kept.push(span);
  }
  return kept;
}

function detectAll(text) {
  const input = `${text ?? ''}`;
  if (!input.trim()) return [];
  const spans = [
    ...detectDocuments(input),
    ...detectPhones(input),
    ...detectEmails(input),
    ...detectAddresses(input),
    ...detectNames(input),
    ...detectNumbers(input)
  ];
  return resolveOverlaps(spans);
}

module.exports = {
  ROLES,
  detectAll,
  detectNames,
  detectDocuments,
  detectPhones,
  detectEmails,
  detectAddresses,
  detectNumbers,
  resolveOverlaps,
  cleanLabelName,
  PRUDENT_VALUE,
  STRONG_PATIENT_ANCHOR,
  WEAK_PATIENT_ANCHOR,
  DOCTOR_ANCHOR
};
