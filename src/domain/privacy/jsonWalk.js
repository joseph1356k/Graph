// Recorrido de las hojas de texto de un JSON.
//
// POR QUÉ EXISTE: los prompts clínicos salen como UN SOLO `JSON.stringify`
// dentro de `messages[i].content`. Dentro de esa cadena un salto de línea son
// dos caracteres (`\n`) y las comillas van escapadas, así que un detector con
// límites de palabra Unicode ve «n» pegada a «Juan» y no lo encuentra. Se
// parsea, se recorren las hojas, y se vuelve a serializar.
//
// Las claves ESTRUCTURALES no se tocan: mutar `key` o `selector` rompería el
// mapeo de secciones o el selector SAP, y no llevan texto de nadie.

const STRUCTURAL_KEYS = Object.freeze(new Set([
  'key', 'selector', 'stepOrder', 'controlType', 'actionType', 'id', 'order', 'required',
  'verbatim', 'allowedOptions', 'page_url', 'pageUrl', 'route', 'page', 'visible_panel',
  'selected_section_key', 'user_intent_surface', 'specialty', 'especialidad',
  'especialidad_origen', 'specialty_source', 'template_name', 'bindTo', 'role', 'type', 'kind',
  'mode', 'status', 'consultation_type', 'task', 'fidelity', 'expected_schema', 'json_schema',
  'schema', 'name', 'confidence', 'urgency', 'sequence', 'session_id', 'voice_session_id',
  'event_id', 'segment_id', 'language', 'model', 'workflow_id', 'workflowId', 'template_id',
  'templateId', 'encounter_id', 'encounterId', 'consultation_id', 'consultationId', 'export_id',
  'exportId', 'created_at', 'updated_at', 'snapshot_at'
]));

/**
 * Aplica `fn` a cada string del valor (recursivo), saltando las claves
 * estructurales. Devuelve la MISMA referencia si nada cambió.
 */
function walkStrings(value, fn, options = {}) {
  const skip = options.skipKeys || STRUCTURAL_KEYS;
  const visit = (node) => {
    if (typeof node === 'string') {
      const next = fn(node);
      return next === node ? node : next;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const mapped = node.map((item) => {
        const next = visit(item);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? mapped : node;
    }
    if (node && typeof node === 'object') {
      let changed = false;
      const out = {};
      for (const [key, item] of Object.entries(node)) {
        if (skip.has(key)) {
          out[key] = item;
          continue;
        }
        const next = visit(item);
        if (next !== item) changed = true;
        out[key] = next;
      }
      return changed ? out : node;
    }
    return node;
  };
  return visit(value);
}

/** Parsea solo lo que parece un objeto o array JSON; lo demás es texto. */
function tryParseJson(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (!trimmed || !(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Transforma un texto que puede ser JSON: si parsea, se transforman sus hojas
 * y se vuelve a serializar (formato compacto: es lo que producen los
 * constructores de prompt); si no, se transforma como texto plano.
 */
function transformTextOrJson(text, fn) {
  const parsed = tryParseJson(text);
  if (parsed === undefined) return fn(text);
  const transformed = walkStrings(parsed, fn);
  return transformed === parsed ? text : JSON.stringify(transformed);
}

module.exports = {
  STRUCTURAL_KEYS,
  walkStrings,
  tryParseJson,
  transformTextOrJson
};
