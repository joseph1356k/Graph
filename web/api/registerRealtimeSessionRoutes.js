// Ruta PÚBLICA (sin auth de admin, sin sesión de Provider Studio): la llama
// directo el celular para pedir un token efímero de voz Live (OpenAI
// Realtime). Server.js excluye este path puntual del gate requireAccountAuth
// que cubre el resto de /api/android/* — la autorización acá es la whitelist
// graph_app_users.realtime_allowed, resuelta dentro de RealtimeSessionService.

function registerRealtimeSessionRoutes(app, deps = {}) {
  const realtimeSessionService = deps.realtimeSessionService;

  if (!app || !realtimeSessionService) {
    throw new Error('registerRealtimeSessionRoutes requires app and realtimeSessionService');
  }

  app.post('/api/android/realtime/session', async (req, res) => {
    const deviceId = req.body?.device_id;
    if (!`${deviceId == null ? '' : deviceId}`.trim()) {
      return res.status(400).json({ error: 'Falta device_id.' });
    }
    try {
      const session = await realtimeSessionService.createSession(deviceId);
      res.json(session);
    } catch (error) {
      console.error(`[Realtime Session] session error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible crear la sesión de voz Live.' });
    }
  });
}

module.exports = registerRealtimeSessionRoutes;
