// Autoriza dispositivos para el proxy de voz Live (gpt-live-1, WebSocket vía
// web/api/liveVoiceProxy.js). Mismo patrón de lectura que
// RealtimeSessionService.requireAuthorizedDevice() (misma tabla/columna:
// graph_app_users.realtime_allowed) — la migración de gpt-realtime a
// gpt-live-1 es un REEMPLAZO, no una coexistencia, así que "voz Live
// habilitada" sigue siendo la misma bandera y no hace falta una columna
// nueva ni una migración.
//
// Vive aparte de RealtimeSessionService a propósito: ese servicio es del
// flujo de token efímero de gpt-realtime (que queda intacto pero sin uso
// activo, ver web/api/registerRealtimeSessionRoutes.js) y este proxy no
// depende de él — así ninguno arrastra al otro si uno se retira más
// adelante.
//
// Sólo lee: la whitelist la escribe el backend con service-role desde el
// panel (AndroidPanelService.setRealtimeAllowed), nunca este servicio.

// Marca de los errores PROPIOS de este autorizador (falta el id / dispositivo no autorizado). El
// statusCode solo no alcanza para distinguirlos: SupabaseRestClient también propaga el estado de
// PostgREST (403 por service-role mala o RLS, 400 por consulta rota) en `statusCode`. Quien necesite
// separar «este dispositivo no puede» de «no pude comprobarlo» mira esta marca, no el estado.
const OWN_ERROR_MARK = 'liveVoiceDeviceAuthorizer';

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error[OWN_ERROR_MARK] = true;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  error[OWN_ERROR_MARK] = true;
  return error;
}

function isOwnError(error) {
  return Boolean(error) && error[OWN_ERROR_MARK] === true;
}

class LiveVoiceDeviceAuthorizer {
  constructor(supabaseRestClient) {
    if (!supabaseRestClient) {
      throw new Error('LiveVoiceDeviceAuthorizer requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
  }

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
}

module.exports = LiveVoiceDeviceAuthorizer;
module.exports.isOwnError = isOwnError;
