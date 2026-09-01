// Rutas del MEDIDOR de impacto bajo /api/v1/metrics (ya gated con X-API-Key por
// requireApiKey en server.js). Las llama UMedidor.exe — un cliente Windows
// SEPARADO de U.exe, dedicado a medir el trabajo operativo del médico:
//   POST /api/v1/metrics/enroll   -> canjea un código por identidad + secreto HMAC
//   GET  /api/v1/metrics/config   -> config/roster/fases nuevos (o {unchanged:true})
//   POST /api/v1/metrics/batch    -> lote de turnos/muestras/eventos/visitas
//
// A diferencia de la telemetría de U.exe, esto NO es best-effort: un lote que se
// pierde es un hueco en el baseline de un estudio. Por eso el batch responde con
// exactamente qué aceptó y qué rechazó por fila, y el cliente ajusta su spool con
// eso (confirmar lo aceptado, envenenar lo rechazado). Idempotencia por claves
// naturales → jamás 409.

function registerMetricsRoutes(app, deps = {}) {
  const metricsIngestService = deps.metricsIngestService;
  if (!app || !metricsIngestService) {
    throw new Error('registerMetricsRoutes requiere app y metricsIngestService');
  }

  function fallo(res, error, prefijo) {
    // El secreto interno y los detalles de la base nunca se filtran al cliente.
    const codigo = error.statusCode || 500;
    if (codigo >= 500) console.error(`${prefijo} ${error.message}`);
    res.status(codigo).json({ ok: false, error: codigo >= 500 ? 'Error interno.' : error.message });
  }

  app.post('/api/v1/metrics/enroll', async (req, res) => {
    try { res.json(await metricsIngestService.enroll(req.body || {})); }
    catch (error) { fallo(res, error, '[Medidor] enroll:'); }
  });

  app.get('/api/v1/metrics/config', async (req, res) => {
    try { res.json(await metricsIngestService.config(req.query || {})); }
    catch (error) { fallo(res, error, '[Medidor] config:'); }
  });

  app.post('/api/v1/metrics/batch', async (req, res) => {
    try { res.json(await metricsIngestService.ingestBatch(req.body || {})); }
    catch (error) { fallo(res, error, '[Medidor] batch:'); }
  });
}

module.exports = registerMetricsRoutes;
