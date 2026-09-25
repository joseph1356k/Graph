// Enmascarado de identificadores en los LOGS.
//
// El device_id AUTORIZA la voz (graph_app_users.device_id + realtime_allowed:
// quien lo repita gasta el OpenAI de Live), y desde el cliente Android 0.51 es
// el UUID de telemetría. Los logs de Vercel los lee más gente que la que
// debería poder repetirlo, así que ningún log lleva el id completo: sólo los
// primeros MASK_PREFIX_LEN caracteres + «…», suficiente para correlacionar dos
// líneas de la misma sesión.
//
// Lo usan el proxy de voz Live (web/api/liveVoiceProxy.js) y el middleware
// `[HTTP]` de web/server.js, que escribía la URL entera de cada request
// (`GET /api/android/users/<device_id>/logs` dejaba el UUID en el log).

const MASK_PREFIX_LEN = 8;
const EMPTY_DEVICE_ID_LABEL = '(vacío)';

// Un id de MASK_PREFIX_LEN o menos se recortaría a sí mismo entero, así que ahí
// se muestra como mucho la mitad. Mismo trim que LiveVoiceDeviceAuthorizer, para
// que el log describa el id que se autorizó.
function maskDeviceId(deviceId) {
  const id = `${deviceId == null ? '' : deviceId}`.trim();
  if (!id) return EMPTY_DEVICE_ID_LABEL;
  return `${id.slice(0, Math.min(MASK_PREFIX_LEN, Math.floor(id.length / 2)))}…`;
}

// Defensa en profundidad: el mensaje de un error (authorizer, Supabase) puede
// repetir el id, y ese mensaje también va al log. Sólo se limpia un id lo bastante
// largo para ser real (un UUID, un Android ID); uno de menos de MASK_PREFIX_LEN
// caracteres reemplazaría fragmentos sueltos de cualquier mensaje.
function scrubDeviceId(text, deviceId) {
  const id = `${deviceId == null ? '' : deviceId}`.trim();
  if (id.length < MASK_PREFIX_LEN) return `${text}`;
  return `${text}`.split(id).join(maskDeviceId(id));
}

// Segmento de path con forma de UUID (8-4-4-4-12 hex, sin distinguir mayúsculas).
// Tiene que ser el segmento ENTERO: `/<uuid>/` o `/<uuid>` al final, no un UUID
// incrustado en otro token.
const UUID_PATH_SEGMENT = /(^|\/)([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const DEVICE_ID_QUERY_PARAM = /([?&]device_id=)([^&#]*)/gi;

function decodeQueryValue(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

/**
 * La URL de un request lista para escribirla en un log: el valor de `device_id=`
 * en la query sale enmascarado, y cualquier segmento de path con forma de UUID
 * se reduce a sus primeros 8 caracteres + «…». El resto queda idéntico. Sólo
 * cambia lo que se LOGUEA; el enrutamiento sigue viendo `req.url` tal cual.
 */
function redactUrlForLog(url) {
  const text = `${url == null ? '' : url}`;
  const queryStart = text.indexOf('?');
  const pathPart = queryStart === -1 ? text : text.slice(0, queryStart);
  const queryPart = queryStart === -1 ? '' : text.slice(queryStart);
  return pathPart.replace(UUID_PATH_SEGMENT, '$1$2…')
    + queryPart.replace(DEVICE_ID_QUERY_PARAM, (match, key, value) => `${key}${maskDeviceId(decodeQueryValue(value))}`);
}

module.exports = {
  MASK_PREFIX_LEN,
  maskDeviceId,
  scrubDeviceId,
  redactUrlForLog
};
