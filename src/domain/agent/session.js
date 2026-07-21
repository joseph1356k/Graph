// Estado del cerebro consciente entre turnos, serializado como blob OPACO que el
// cliente Windows reenvía sin leer. Port 1:1 de Android/backend/src/domain/session.ts.
//
// El backend es stateless (Vercel serverless): no guarda memoria entre requests.
// Todo el estado del hilo del cerebro (el `previous_response_id` de OpenAI, las
// llamadas pendientes, el objetivo, el historial de Gemini) viaja firmado con
// HMAC dentro de `session`. El cliente lo trata como caja negra: lo recibe y lo
// vuelve a mandar el siguiente turno. La firma impide manipulación; no contiene
// prompts ni keys, así que la innovación sigue viviendo solo en el servidor.
//
// IMPORTANTE (paridad): el formato del token (`<base64url payload>.<base64url hmac>`)
// y el secreto por defecto de desarrollo son IDÉNTICOS a los del backend viejo,
// para que una sesión emitida por uno pueda seguir en el otro durante la migración.

const crypto = require('crypto');

/**
 * Crea el estado inicial de una sesión del cerebro.
 * provider: 'openai' | 'gemini' — fija el formato del resto de campos.
 */
function freshSession(provider, goal, model, effort) {
  return {
    provider,
    goal,
    model,
    effort,
    previousId: '',
    startId: '',
    continuationMessage: '',
    informText: '',
    pending: [],
    gemini: provider === 'gemini' ? { history: [], pending: [] } : undefined
  };
}

// Mismo comportamiento permisivo de dev que el backend original: si SESSION_SECRET
// no está en el entorno, se usa un secreto fijo inseguro (solo para desarrollo).
function secret() {
  return process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-me';
}

/** Firma y codifica el estado en un token opaco `<base64url payload>.<base64url hmac>`. */
function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

/** Decodifica y verifica el token. Lanza si la firma no cuadra (manipulación). */
function decodeSession(token) {
  const [payload, mac] = `${token}`.split('.');
  if (!payload || !mac) {
    throw new Error('session token malformado');
  }
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = new Uint8Array(Buffer.from(mac));
  const b = new Uint8Array(Buffer.from(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('firma de sesión inválida');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

module.exports = { freshSession, encodeSession, decodeSession };
