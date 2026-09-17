// Application service for Android Live voice: emite un token efímero de
// OpenAI Realtime a dispositivos habilitados vía graph_app_users.realtime_allowed.
// La OPENAI_REALTIME_KEY real nunca llega al cliente — sólo el client_secret
// de un solo uso que OpenAI genera por sesión.
//
// Deliberadamente simple: sin límite de gasto ni cola, eso quedó descartado
// para esta ronda. Si hace falta, es una pieza aparte sobre este servicio.

const OPENAI_REALTIME_SESSIONS_URL = 'https://api.openai.com/v1/realtime/sessions';
const REALTIME_MODEL = 'gpt-realtime';

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function upstreamError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

class RealtimeSessionService {
  constructor(supabaseRestClient, options = {}) {
    if (!supabaseRestClient) {
      throw new Error('RealtimeSessionService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
    this.fetchImpl = options.fetch || globalThis.fetch;
  }

  // Sólo lee: la whitelist la escribe el backend con service-role desde el
  // panel (AndroidPanelService.setRealtimeAllowed), nunca este servicio.
  async requireAuthorizedDevice(deviceId) {
    const id = `${deviceId == null ? '' : deviceId}`.trim();
    if (!id) {
      throw badRequest('Falta device_id.');
    }
    const rows = await this.supabase.select(
      'graph_app_users',
      `select=device_id,realtime_allowed&device_id=eq.${encodeURIComponent(id)}&limit=1`
    );
    const user = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!user || user.realtime_allowed !== true) {
      throw forbidden('dispositivo no autorizado para voz Live');
    }
    return user;
  }

  // Crea la sesión efímera en OpenAI para un dispositivo ya autorizado. No
  // agrega configuración de voz/modalidad acá: eso lo decide el cliente
  // Android en su propio session.update tras conectar.
  async createSession(deviceId) {
    await this.requireAuthorizedDevice(deviceId);

    const apiKey = `${process.env.OPENAI_REALTIME_KEY || ''}`.trim();
    if (!apiKey) {
      console.error('[Realtime Session] OPENAI_REALTIME_KEY no configurada');
      const error = new Error('OPENAI_REALTIME_KEY no configurada');
      error.statusCode = 500;
      throw error;
    }

    const response = await this.fetchImpl(OPENAI_REALTIME_SESSIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: REALTIME_MODEL })
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        body = null;
      }
    }

    if (!response.ok) {
      const message = body?.error?.message
        || (typeof body === 'string' ? body : '')
        || `OpenAI Realtime respondió ${response.status}.`;
      console.error(`[Realtime Session] OpenAI error ${response.status}: ${message}`);
      throw upstreamError(message);
    }

    // El shape documentado trae client_secret como objeto ({ value, expires_at });
    // se acepta también un string plano por si la API lo simplifica.
    const clientSecret = typeof body?.client_secret === 'string'
      ? body.client_secret
      : body?.client_secret?.value;
    const expiresAt = body?.expires_at ?? body?.client_secret?.expires_at ?? null;

    if (!clientSecret) {
      console.error(`[Realtime Session] OpenAI no devolvió client_secret: ${text.slice(0, 300)}`);
      throw upstreamError('OpenAI Realtime no devolvió client_secret.');
    }

    // Nunca reenviar el body crudo de OpenAI: sólo lo que el cliente necesita.
    return { client_secret: clientSecret, expires_at: expiresAt };
  }
}

module.exports = RealtimeSessionService;
