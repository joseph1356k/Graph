// El VOCABULARIO del medidor: la lista blanca de kinds de evento y de claves de
// `detail`. Es el espejo servidor de medidor/Dominio/Cable.cs — la segunda valla
// de privacidad. La primera vive en el cliente (Cable), pero una valla que solo
// existe en un lado degrada en silencio (aprendizaje del guardia que se cree
// puesto): el contenido clínico no puede entrar a metrics_events aunque un
// cliente malicioso o con bug lo mande, porque aquí se saneia otra vez.
//
// Si un kind o una clave nueva hace falta, se añade en LOS DOS lados a la vez.

const KINDS = new Set([
  'shift_start', 'shift_end', 'doctor_prompted',
  'encounter_enter', 'encounter_exit', 'encounter_unknown',
  'lock', 'unlock', 'suspend', 'resume',
  'medidor_start', 'medidor_stop', 'pausa_usuario', 'reanudar_usuario',
  'sap_attach', 'sap_detach', 'sap_user_seen',
  'clock_jump', 'spool_drop', 'hooks_degradados', 'config_applied',
  'ops_run', 'calidad',
]);

// Claves permitidas dentro de `detail`. Nada de texto libre con nombres o
// documentos: son conteos, razones tipadas, e identificadores de workflow/run.
const CLAVES_DETALLE = new Set([
  'from', 'to', 'ms', 'reason', 'count', 'user', 'run_id', 'workflow_id',
  'steps', 'rule', 'version', 'total_ms', 'align_ms', 'outcome',
]);

const TOPE_TEXTO = 120;

// Superficies que el medidor puede reportar. Cualquier otra cosa se rechaza: una
// superficie con forma inesperada podría llevar un título colado.
const RE_SURFACE = /^(sapgui:\/\/[^/]+\/[^/]*\/[^/]*\/[^/]*(\/[A-Za-z0-9_:.-]+)?|web:\/\/[a-z0-9.-]+|uia:\/\/[a-z0-9._-]+)$/i;

function saneaDetalle(detail) {
  const limpio = {};
  if (!detail || typeof detail !== 'object') return limpio;
  for (const clave of Object.keys(detail)) {
    if (!CLAVES_DETALLE.has(clave)) continue;
    const v = detail[clave];
    if (typeof v === 'string') limpio[clave] = v.length <= TOPE_TEXTO ? v : v.slice(0, TOPE_TEXTO);
    else if (v === null || typeof v === 'number' || typeof v === 'boolean') limpio[clave] = v;
    // objetos/arrays anidados NO entran: un detail no es un contenedor libre
  }
  return limpio;
}

// Una huella de encounter es hex de 32 (16 bytes) o null. Cualquier otra cosa se
// rechaza: si llegara un valor con otra forma, no es una huella nuestra.
function esEncounterKey(v) {
  return v == null || (typeof v === 'string' && /^[0-9a-f]{32}$/.test(v));
}

function surfaceValida(v) {
  return v == null || v === '' || (typeof v === 'string' && RE_SURFACE.test(v));
}

module.exports = { KINDS, CLAVES_DETALLE, saneaDetalle, esEncounterKey, surfaceValida };
