// Rutas de INGESTA de "Windows Live" bajo /api/v1 (ya gated con X-API-Key por
// requireApiKey en server.js). Las llama el cliente Windows (BackendClient):
//   POST /api/v1/agent/register  -> alta/heartbeat del usuario (upsert por email)
//   POST /api/v1/agent/events    -> lote de eventos de telemetria
//
// La telemetria NUNCA debe tumbar al agente: los errores se responden con su
// codigo pero el cliente los traga. Aun asi devolvemos JSON consistente.

function registerWindowsTelemetryRoutes(app, deps = {}) {
  const windowsTelemetryService = deps.windowsTelemetryService;

  if (!app || !windowsTelemetryService) {
    throw new Error('registerWindowsTelemetryRoutes requiere app y windowsTelemetryService');
  }

  app.post('/api/v1/agent/register', async (req, res) => {
    try {
      const result = await windowsTelemetryService.register(req.body || {});
      res.json(result);
    } catch (error) {
      console.error(`[Windows Live] register error: ${error.message}`);
      res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'No fue posible registrar el usuario.' });
    }
  });

  app.post('/api/v1/agent/events', async (req, res) => {
    try {
      const result = await windowsTelemetryService.ingestEvents(req.body || {});
      res.json(result);
    } catch (error) {
      console.error(`[Windows Live] ingestEvents error: ${error.message}`);
      res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'No fue posible guardar los eventos.' });
    }
  });
}

module.exports = registerWindowsTelemetryRoutes;
