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
// MONTAJE: se cuelga del evento 'upgrade' del http.Server con
// { noServer: true } (no el modo automático `new WebSocketServer({ server })`
// de los ejemplos básicos de la doc de Vercel) porque necesitamos autorizar
// el dispositivo contra Supabase ANTES de completar el handshake — el modo
// automático siempre acepta el upgrade primero. El rechazo pre-handshake es
// el patrón que documenta la propia librería `ws` para autenticar upgrades
// (server.handleUpgrade + escritura HTTP cruda antes de destruir el socket).

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const LIVE_PROXY_PATH = '/api/android/live/session';
const OPENAI_LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

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

// El device_id AUTORIZA la voz (graph_app_users.device_id + realtime_allowed:
// quien lo repita gasta el OpenAI de Live), y desde el cliente Android 0.51 es
// el UUID de telemetría. Los logs de Vercel los lee más gente que la que
// debería poder repetirlo, así que ningún log lleva el id completo: sólo los
// primeros MASK_PREFIX_LEN caracteres + «…», suficiente para correlacionar dos
// líneas de la misma sesión. Un id de MASK_PREFIX_LEN o menos se recortaría a sí
// mismo entero, así que ahí se muestra como mucho la mitad. Mismo trim que
// LiveVoiceDeviceAuthorizer, para que el log describa el id que se autorizó.
const MASK_PREFIX_LEN = 8;
const EMPTY_DEVICE_ID_LABEL = '(vacío)';

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
      closed_by: closedBy
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
    finish({ code, reason: reason?.toString(), closedBy: 'OpenAI' });
  });
  upstream.on('error', () => {
    finish({ code: 1011, reason: 'error del upstream', closedBy: 'OpenAI (error)' });
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
        const apiKey = `${process.env.OPENAI_LIVE_KEY || ''}`.trim();
        if (!apiKey) {
          logError('[Live Voice Proxy] OPENAI_LIVE_KEY no configurada');
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
module.exports.maskDeviceId = maskDeviceId;
