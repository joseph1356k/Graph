// Lee la respuesta JSON del chat del asistente (prompt v3/v4) y la deja en una
// forma que el servicio puede devolver sin sorpresas. Puro: sin IO.
//
// LO QUE PROMETE EL PROMPT AQUÍ SE COMPRUEBA:
//   - «cita solo guías recuperadas» → una referencia que no está en la lista
//     se descarta de "fuentes" Y se borra del texto; si el modelo dijo
//     "respaldo: guia" y no queda ninguna fuente, baja a "general";
//   - «abstente» → "insuficiente" sin "faltantes" recibe un ítem genérico,
//     para que la tarjeta de la pantalla nunca salga en blanco;
//   - «solo las secciones que cambian» → la propuesta se acota por key y
//     tamaño; el merge y la validación contra la plantilla los hace el
//     servicio con el validador de notas.
//
// SI NO LLEGA JSON (modelo en texto, proveedor falso de las pruebas de
// privacidad, respuesta cortada): el texto crudo es la respuesta, con
// respaldo "general" y sin propuesta. La conversación no se rompe.

const SUPPORT_VALUES = Object.freeze(['consulta', 'guia', 'general', 'insuficiente']);
const DEFAULT_SUPPORT = 'general';
const MAX_LIST_ITEMS = 6;
const MAX_LIST_ITEM_LENGTH = 200;
const MAX_FOLLOW_UPS = 3;
const MAX_FOLLOW_UP_LENGTH = 160;
const MAX_PROPOSAL_SECTIONS = 20;
const MAX_PROPOSAL_CONTENT_LENGTH = 8000;
const MAX_PROPOSAL_REASON_LENGTH = 300;
const MAX_PROPOSAL_SUMMARY_LENGTH = 2000;
const INSUFFICIENT_FALLBACK = 'No hay respaldo suficiente en la consulta ni en las guías disponibles para responder con seguridad; verifique en la fuente correspondiente.';
// [G#] guías clínicas recuperadas; [F#] fichas técnicas de medicamentos.
const REF_PATTERN = /\[\s*([GF])\s*(\d{1,2})\s*\]/gi;

function normalizeRef(value) {
  const match = `${value || ''}`.trim().toUpperCase().match(/^\[?\s*([GF])\s*(\d{1,2})\s*\]?$/);
  return match ? `${match[1]}${Number(match[2])}` : '';
}

function normalizeSupport(value) {
  const clean = `${value || ''}`.trim().toLowerCase();
  return SUPPORT_VALUES.includes(clean) ? clean : DEFAULT_SUPPORT;
}

function coerceList(value, { maxItems, maxLength }) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = (typeof item === 'string' ? item : `${item?.text ?? item?.texto ?? ''}`).replace(/\s+/g, ' ').trim().slice(0, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function stripCodeFences(text) {
  return `${text || ''}`.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Metadatos de una fuente, sin el texto del fragmento (la web no lo necesita). */
function sourceOf(item) {
  return {
    ref: item.ref,
    kind: item.kind === 'ficha_tecnica' ? 'ficha_tecnica' : 'guia',
    guideline_id: item.guideline_id,
    title: item.title,
    organism: item.organism,
    year: item.year,
    section: item.section,
    source: item.source,
    ...(item.url ? { url: item.url } : {})
  };
}

function sanitizeProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const seen = new Set();
  const secciones = [];
  for (const item of Array.isArray(raw.secciones) ? raw.secciones : []) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.key || ''}`.trim();
    const content = `${item.content ?? ''}`.trim().slice(0, MAX_PROPOSAL_CONTENT_LENGTH);
    if (!key || !content || seen.has(key)) continue;
    seen.add(key);
    secciones.push({ key, content });
    if (secciones.length >= MAX_PROPOSAL_SECTIONS) break;
  }
  const resumen = typeof raw.resumen === 'string' && raw.resumen.trim()
    ? raw.resumen.trim().slice(0, MAX_PROPOSAL_SUMMARY_LENGTH)
    : null;
  if (!secciones.length && !resumen) return null;
  return {
    motivo: `${raw.motivo || ''}`.replace(/\s+/g, ' ').trim().slice(0, MAX_PROPOSAL_REASON_LENGTH),
    resumen,
    secciones
  };
}

/**
 * @param {string} rawContent  contenido devuelto por el modelo (ya rehidratado)
 * @param {object} options
 * @param {Array} options.guidelines  fragmentos de guías recuperados (con `ref` G#)
 * @param {Array} [options.drugLabels]  extractos de fichas técnicas (con `ref` F#)
 * @param {(text: string) => unknown} options.parseJsonObject
 */
function parseAssistantReply(rawContent, { guidelines = [], drugLabels = [], parseJsonObject } = {}) {
  const byRef = new Map([
    ...(Array.isArray(guidelines) ? guidelines : []),
    ...(Array.isArray(drugLabels) ? drugLabels : [])
  ].map((item) => [item.ref, item]));
  const raw = `${rawContent || ''}`;

  let parsed = null;
  try {
    const candidate = typeof parseJsonObject === 'function' ? parseJsonObject(raw) : JSON.parse(raw);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof candidate.respuesta === 'string') {
      parsed = candidate;
    }
  } catch (error) {
    parsed = null;
  }

  if (!parsed) {
    const text = stripCodeFences(raw);
    return {
      parsed: false,
      answer: text === '{}' ? '' : text,
      support: DEFAULT_SUPPORT,
      sources: [],
      missing_information: [],
      alarm_signs: [],
      follow_up_questions: [],
      proposal: null
    };
  }

  // Referencias: las declaradas en "fuentes" más las citadas en el texto;
  // solo sobreviven las que existen en lo recuperado.
  const cited = new Set();
  for (const item of Array.isArray(parsed.fuentes) ? parsed.fuentes : []) {
    const ref = normalizeRef(typeof item === 'string' ? item : item?.ref);
    if (ref && byRef.has(ref)) cited.add(ref);
  }
  let answer = `${parsed.respuesta}`.trim();
  answer = answer.replace(REF_PATTERN, (match, kind, number) => {
    const ref = `${kind.toUpperCase()}${Number(number)}`;
    if (byRef.has(ref)) {
      cited.add(ref);
      return `[${ref}]`;
    }
    return '';
  })
    // Al borrar una cita inventada quedan huecos: «Nada más .» → «Nada más.».
    .replace(/ +([.,;:!?)])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const sources = [...byRef.keys()].filter((ref) => cited.has(ref)).map((ref) => sourceOf(byRef.get(ref)));

  let support = normalizeSupport(parsed.respaldo);
  if (support === 'guia' && !sources.length) support = DEFAULT_SUPPORT;

  const missing = coerceList(parsed.faltantes, { maxItems: MAX_LIST_ITEMS, maxLength: MAX_LIST_ITEM_LENGTH });
  if (support === 'insuficiente' && !missing.length) missing.push(INSUFFICIENT_FALLBACK);

  return {
    parsed: true,
    answer,
    support,
    sources,
    missing_information: missing,
    alarm_signs: coerceList(parsed.alertas, { maxItems: MAX_LIST_ITEMS, maxLength: MAX_LIST_ITEM_LENGTH }),
    follow_up_questions: coerceList(parsed.seguimientos, { maxItems: MAX_FOLLOW_UPS, maxLength: MAX_FOLLOW_UP_LENGTH }),
    proposal: sanitizeProposal(parsed.propuesta_nota)
  };
}

module.exports = {
  parseAssistantReply,
  normalizeSupport,
  normalizeRef,
  SUPPORT_VALUES,
  INSUFFICIENT_FALLBACK,
  MAX_FOLLOW_UPS
};
