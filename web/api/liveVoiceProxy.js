// Proxy WebSocket de voz Live (gpt-live-1) para Android: el celular nunca ve
// la key real de OpenAI. El backend mantiene ÉL el socket saliente hacia
// OpenAI con la key real y hace de relay transparente — el reemplazo del
// token efímero de gpt-realtime, que gpt-live-1 no tiene
// (/v1/live/client_secrets y /v1/live/sessions/client_secrets dan 404,
// confirmado 2026-09-18).
//
// PIPE, NO INTÉRPRETE: este módulo no conoce el protocolo GPT-Live (JSON por
// texto — confirmado leyendo CanalOkHttp.kt del cliente Android, que ya
// ignora los binarios porque "la voz solo habla texto"). Reenvía cada trama
// tal cual llega, en el tipo que llega (texto o binario), en las dos
// direcciones. Si algún día el protocolo agrega binario, este proxy ya lo
// soporta sin cambios porque no filtra por tipo.
//
// AL LOG, NUNCA EL CONTENIDO — mismo principio que CanalOkHttp.kt: sólo
// tamaño en bytes, cantidad de tramas y timestamps. No se parsea el JSON
// para sacar el `type` del evento porque eso ya es interpretar el
// protocolo, que es justo lo que este proxy no hace.
//
// DIAGNÓSTICO DEL CIERRE: el log de cierre dice POR QUÉ OpenAI rechazó, con tres
// campos de valores acotados y de lista blanca: `upstream_status` (HTTP del
// saludo rechazado), `upstream_error_code` (el `error.code` del cuerpo JSON de
// OpenAI, p. ej. invalid_api_key / insufficient_quota / model_not_found /
// rate_limit_exceeded) y `upstream_close_code` (el código de `close` si cerró
// OpenAI). Lo que NO sale jamás al log: el `error.message` (una key inválida
// vuelve como «Incorrect API key provided: sk-proj-***…»: trae trozos de la
// key), las cabeceras, el cuerpo ni la key. Lo que ve el celular no cambia.
//
// MONTAJE: se cuelga del evento 'upgrade' del http.Server con
// { noServer: true } (no el modo automático `new WebSocketServer({ server })`
// de los ejemplos básicos de la doc de Vercel) porque necesitamos autorizar
// el dispositivo contra Supabase ANTES de completar el handshake — el modo
// automático siempre acepta el upgrade primero. El rechazo pre-handshake es
// el patrón que documenta la propia librería `ws` para autenticar upgrades
// (server.handleUpgrade + escritura HTTP cruda antes de destruir el socket).

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

// maskDeviceId / scrubDeviceId: ningún log de este proxy lleva el device_id
// completo (ver web/api/logRedaction.js para el porqué).
const { maskDeviceId, scrubDeviceId } = require('./logRedaction');

const LIVE_PROXY_PATH = '/api/android/live/session';
const OPENAI_LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

// La key real de OpenAI se lee de OPENAI_LIVE_KEY o, si esa no está, de
// openai_live_key. En el proyecto de Vercel la variable quedó cargada en
// minúsculas (tipo sensible: Vercel no permite renombrarla) y en Vercel los
// nombres distinguen mayúsculas, así que leer sólo el nombre exacto dejaba al
// proxy en 500 con la key ya cargada. Gana la de mayúsculas.
const LIVE_KEY_ENV_NAMES = ['OPENAI_LIVE_KEY', 'openai_live_key'];

// Devuelve la key ya recortada, o '' si ningún nombre trae un valor. Es la ÚNICA
// lectura de la key en el proxy: el valor es un secreto, nunca se loguea ni se
// devuelve al cliente (el log de «no configurada» sólo nombra las variables).
function readLiveKey(env = process.env) {
  for (const name of LIVE_KEY_ENV_NAMES) {
    const value = `${env[name] || ''}`.trim();
    if (value) return value;
  }
  return '';
}

// Vercel Hobby, con Fluid compute (default desde 2025-04-23 para proyectos
// nuevos — este es de junio 2026, así que lo tiene): el techo real de
// duración de una función es 300s, default Y máximo, sin extended-duration
// (eso es sólo Pro/Enterprise). Un WebSocket se cierra cuando la función
// llega a su maxDuration (doc Vercel "WebSockets": "WebSocket connections
// close when a Vercel Function reaches its maximum duration"). Cerramos
// nosotros mismos ANTES de ese corte duro, con un código que el cliente
// Android puede distinguir de un error real, para que reconecte limpio en
// vez de ver un 1006 a mitad de trama.
const MAX_DURATION_MS = 285_000; // 4m45s: 15s de margen bajo el techo de 300s de Vercel
const DURATION_LIMIT_CLOSE_CODE = 4408; // rango privado 4000-4999 (RFC 6455)
const DURATION_LIMIT_REASON = 'proxy_duration_limit_reconnect';

const CLOSE_REASON_MAX_BYTES = 123; // límite del protocolo WS para el motivo de cierre

function truncateReason(reason) {
  const text = `${reason || ''}`;
  if (Buffer.byteLength(text) <= CLOSE_REASON_MAX_BYTES) return text;
  return Buffer.from(text).subarray(0, CLOSE_REASON_MAX_BYTES).toString();
}

function safeCloseCode(code) {
  // 1005/1006 son reservados por el spec WS y ws.close() lanza si se los pasa.
  if (typeof code === 'number' && code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006) {
    return code;
  }
  return 1000;
}

function closeSocket(socket, code, reason) {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(safeCloseCode(code), truncateReason(reason));
    }
  } catch (error) {
    try { socket.terminate(); } catch (_) { /* ya no hay nada que hacer */ }
  }
}

// --- Diagnóstico del rechazo del upstream (ver «DIAGNÓSTICO DEL CIERRE» arriba) ---

const UPSTREAM_ERROR_BODY_MAX_BYTES = 2048; // el error de OpenAI es un JSON de unos 200 bytes
// Un upstream que promete un cuerpo y no lo termina no puede dejar al celular
// esperando: pasado este plazo se cierra igual, sin código.
const UPSTREAM_ERROR_BODY_TIMEOUT_MS = 1000;
const UPSTREAM_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

// Sólo un HTTP de verdad (100-599); cualquier otra cosa se registra como null.
function safeHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

// El código de `close` del upstream (1005/1006 incluidos: son diagnóstico, no se
// mandan a nadie). Fuera de 1000-4999 no es un código WS: null.
function safeUpstreamCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : null;
}

// Saca `error.code` del cuerpo de error de OpenAI y NADA más: el resto del
// cuerpo (message, type, param) se descarta acá y no viaja a ninguna parte. Sólo
// pasa un texto corto de [A-Za-z0-9_.-]; lo demás es null. Defensa en
// profundidad: un «código» que sea o parezca una key (prefijo sk-, o la propia
// key del proxy) tampoco pasa, aunque cumpla el patrón.
function extractUpstreamErrorCode(bodyText, apiKey) {
  let code;
  try {
    code = JSON.parse(bodyText)?.error?.code;
  } catch (error) {
    return null;
  }
  if (typeof code !== 'string' || !UPSTREAM_ERROR_CODE_PATTERN.test(code)) return null;
  if (/^sk-/i.test(code) || (apiKey && code.includes(apiKey))) return null;
  return code;
}

// Lee como mucho UPSTREAM_ERROR_BODY_MAX_BYTES del cuerpo de la respuesta de
// error y llama `done(código | null)` UNA sola vez. Un cuerpo más grande, uno
// que se corta o uno que no termina en UPSTREAM_ERROR_BODY_TIMEOUT_MS da null.
// Al terminar destruye la respuesta: no deja el socket del saludo colgado.
function readUpstreamErrorCode(res, apiKey, done) {
  const chunks = [];
  let received = 0;
  let settled = false;

  const timer = setTimeout(() => settle(null), UPSTREAM_ERROR_BODY_TIMEOUT_MS);
  timer.unref?.();

  function settle(code) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { res.destroy(); } catch (error) { /* ya estaba caída */ }
    done(code);
  }

  res.on('data', (chunk) => {
    if (settled) return;
    received += chunk.length;
    if (received > UPSTREAM_ERROR_BODY_MAX_BYTES) return settle(null);
    chunks.push(chunk);
  });
  res.on('end', () => settle(extractUpstreamErrorCode(Buffer.concat(chunks).toString('utf8'), apiKey)));
  res.on('error', () => settle(null));
  res.on('close', () => settle(null));
}

function byteSize(data) {
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + byteSize(chunk), 0);
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

// Rechazo pre-handshake: se escribe la respuesta HTTP cruda y se destruye el
// socket, antes de que exista ningún WebSocket. Del lado de OkHttp/Android
// esto llega como Apertura.Rechazo(código HTTP) — el mismo camino que ya
// maneja CanalOkHttp.kt para un 401/403 de gpt-realtime.
function rejectUpgrade(socket, statusCode, statusText) {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\n\r\n`);
  } catch (error) {
    // el socket ya pudo haberse caído; no hay nada más que hacer
  } finally {
    socket.destroy();
  }
}

const STATUS_TEXT = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  // SupabaseRestClient.requireConfig() lanza 503 si el backend no tiene
  // Supabase configurado — el authorizer no lo intercepta, así que puede
  // llegar tal cual hasta acá.
  503: 'Service Unavailable'
};

// Reenvía cada trama tal cual llega, sin tocar el contenido. Cierra el otro
// lado en cuanto uno de los dos se cae, y nunca deja un socket huérfano.
function runRelay({ clientWs, upstreamUrl, apiKey, deviceId, WebSocketCtor, log }) {
  const startedAt = Date.now();
  const stats = { clientFrames: 0, clientBytes: 0, upstreamFrames: 0, upstreamBytes: 0 };
  let closed = false;
  const pending = [];
  // Por qué cerró OpenAI (null = no aplica). Ver «DIAGNÓSTICO DEL CIERRE».
  const diagnostico = { status: null, errorCode: null, closeCode: null };

  const upstream = new WebSocketCtor(upstreamUrl, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  const durationTimer = setTimeout(() => {
    finish({ code: DURATION_LIMIT_CLOSE_CODE, reason: DURATION_LIMIT_REASON, closedBy: 'proxy (límite de duración)' });
  }, MAX_DURATION_MS);
  durationTimer.unref?.();

  function finish({ code, reason, closedBy }) {
    if (closed) return;
    closed = true;
    clearTimeout(durationTimer);
    closeSocket(clientWs, code, reason);
    closeSocket(upstream, code, reason);
    log(JSON.stringify({
      canal: 'live-voice-proxy',
      device_id: maskDeviceId(deviceId),
      t: new Date().toISOString(),
      ms: Date.now() - startedAt,
      client_frames: stats.clientFrames,
      client_bytes: stats.clientBytes,
      upstream_frames: stats.upstreamFrames,
      upstream_bytes: stats.upstreamBytes,
      closed_by: closedBy,
      upstream_status: diagnostico.status,
      upstream_error_code: diagnostico.errorCode,
      upstream_close_code: diagnostico.closeCode
    }));
  }

  clientWs.on('message', (data, isBinary) => {
    stats.clientFrames += 1;
    stats.clientBytes += byteSize(data);
    if (upstream.readyState === WebSocketCtor.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else {
      pending.push({ data, isBinary });
    }
  });

  upstream.on('open', () => {
    for (const frame of pending.splice(0)) {
      upstream.send(frame.data, { binary: frame.isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    stats.upstreamFrames += 1;
    stats.upstreamBytes += byteSize(data);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  clientWs.on('close', (code, reason) => {
    finish({ code, reason: reason?.toString(), closedBy: 'celular' });
  });
  clientWs.on('error', () => {
    finish({ code: 1011, reason: 'error del cliente', closedBy: 'celular (error)' });
  });

  upstream.on('close', (code, reason) => {
    diagnostico.closeCode = safeUpstreamCloseCode(code);
    finish({ code, reason: reason?.toString(), closedBy: 'OpenAI' });
  });
  upstream.on('error', () => {
    finish({ code: 1011, reason: 'error del upstream', closedBy: 'OpenAI (error)' });
  });
  // OpenAI rechazó el saludo con un HTTP de error (401 key inválida, 429 sin
  // cuota o límite de tasa, 404 sin acceso al modelo...). Con un listener acá `ws`
  // ya no emite 'error' por su cuenta: leemos el motivo (acotado) y cerramos igual
  // que antes, con el mismo 1011 hacia el celular. finish() cierra el saludo.
  upstream.on('unexpected-response', (req, res) => {
    diagnostico.status = safeHttpStatus(res.statusCode);
    readUpstreamErrorCode(res, apiKey, (errorCode) => {
      diagnostico.errorCode = errorCode;
      finish({ code: 1011, reason: 'error del upstream', closedBy: 'OpenAI (error)' });
    });
  });
}

/**
 * Cuelga el proxy de voz Live sobre un http.Server ya existente (compartido
 * con Express, como en el patrón oficial de Vercel para WebSockets +
 * Express: `http.createServer(app)` + `WebSocketServer`). Usable tanto desde
 * la función dedicada de Vercel (api/android-live-session.js) como desde el
 * server local (web/server.js), para tener el mismo comportamiento en los
 * dos entornos.
 *
 * `options.path` acepta un string o un array de paths válidos; por defecto
 * es [LIVE_PROXY_PATH] (lo que pide el celular: /api/android/live/session),
 * correcto para el server local sin rewrite.
 *
 * MEDIDO CONTRA PRODUCCIÓN (2026-09-18): se asumía que en Vercel la función
 * recibe el path de DESTINO del rewrite (/api/android-live-session) para
 * un WebSocket upgrade, igual que para un request HTTP normal (que sí lo
 * hace, confirmado con curl). Un cliente `ws` real contra el endpoint
 * público dio 404 con esa única opción -- el upgrade real llega con OTRO
 * pathname (probablemente el de origen, /api/android/live/session; Vercel
 * parece tratar el routing de upgrades distinto al de requests HTTP
 * normales). En vez de apostar a cuál es el real, se aceptan los dos: son
 * rutas que controlamos nosotros mismos, sin costo de seguridad.
 */
function attachLiveVoiceProxy(server, options = {}) {
  if (!(server instanceof http.Server)) {
    throw new Error('attachLiveVoiceProxy requires an http.Server');
  }
  const authorizer = options.authorizer;
  if (!authorizer || typeof authorizer.requireAuthorizedDevice !== 'function') {
    throw new Error('attachLiveVoiceProxy requires an authorizer with requireAuthorizedDevice()');
  }
  const targetPaths = new Set(
    (Array.isArray(options.path) ? options.path : [options.path || LIVE_PROXY_PATH]).filter(Boolean)
  );
  const upstreamUrl = options.openaiLiveUrl || OPENAI_LIVE_URL;
  const WebSocketCtor = options.WebSocketCtor || WebSocket;
  const log = options.log || console.log;
  const logError = options.logError || console.error;

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    let deviceId = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      pathname = url.pathname;
      deviceId = url.searchParams.get('device_id') || '';
    } catch (error) {
      return rejectUpgrade(socket, 400, STATUS_TEXT[400]);
    }

    if (!targetPaths.has(pathname)) {
      // No es nuestra ruta: no la tocamos silenciosamente colgada — se
      // rechaza igual que un 404 normal de HTTP.
      return rejectUpgrade(socket, 404, STATUS_TEXT[404]);
    }

    authorizer.requireAuthorizedDevice(deviceId)
      .then(() => {
        const apiKey = readLiveKey();
        if (!apiKey) {
          logError(`[Live Voice Proxy] ${LIVE_KEY_ENV_NAMES.join(' u ')} no configurada`);
          return rejectUpgrade(socket, 500, STATUS_TEXT[500]);
        }
        wss.handleUpgrade(req, socket, head, (clientWs) => {
          runRelay({ clientWs, upstreamUrl, apiKey, deviceId, WebSocketCtor, log });
        });
      })
      .catch((error) => {
        const statusCode = error.statusCode || 400;
        logError(`[Live Voice Proxy] upgrade rechazado (device_id=${maskDeviceId(deviceId)}): ${scrubDeviceId(error.message, deviceId)}`);
        rejectUpgrade(socket, statusCode, STATUS_TEXT[statusCode] || STATUS_TEXT[400]);
      });
  });

  return wss;
}

module.exports = attachLiveVoiceProxy;
module.exports.LIVE_PROXY_PATH = LIVE_PROXY_PATH;
module.exports.OPENAI_LIVE_URL = OPENAI_LIVE_URL;
module.exports.MAX_DURATION_MS = MAX_DURATION_MS;
module.exports.readLiveKey = readLiveKey;
module.exports.maskDeviceId = maskDeviceId;
