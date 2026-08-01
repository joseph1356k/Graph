// Mantenimiento programado del motor clínico: una sola ruta que el cron de
// Vercel llama a diario para revisar el estado del sistema, avisar por correo si
// hay algo que atender y limpiar las consultas que quedaron vacías.
//
// Autenticación: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Si no
// hay secreto configurado la ruta responde 503 en vez de quedar abierta —
// preferimos que el mantenimiento no corra a que corra sin protección.

function isAuthorized(req) {
  const expected = `${process.env.CRON_SECRET || process.env.GRAPH_INTERNAL_TOKEN || ''}`.trim();
  if (!expected) {
    return false;
  }
  const header = `${req.get('authorization') || ''}`.trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || '';
  const custom = `${req.get('x-graph-internal-token') || ''}`.trim();
  return bearer === expected || custom === expected;
}

function registerMaintenanceRoutes(app, deps = {}) {
  const { healthAlertService, restClient } = deps;

  if (!app || !healthAlertService) {
    throw new Error('registerMaintenanceRoutes requires app and healthAlertService');
  }

  app.all('/api/internal/maintenance/daily', async (req, res) => {
    if (!`${process.env.CRON_SECRET || process.env.GRAPH_INTERNAL_TOKEN || ''}`.trim()) {
      return res.status(503).json({
        error: 'Mantenimiento no configurado: falta CRON_SECRET.',
      });
    }
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'No autorizado.' });
    }

    const result = { purged: null, alert: null, errors: [] };

    // La limpieza va primero para que el correo refleje el estado ya depurado.
    if (restClient) {
      try {
        const purgeDays = Number(process.env.ABANDONED_ENCOUNTER_DAYS || 7);
        const purged = await restClient.rpc('purge_abandoned_encounters', {
          p_days: Number.isFinite(purgeDays) ? purgeDays : 7,
        });
        result.purged = typeof purged === 'number' ? purged : Number(purged) || 0;
      } catch (error) {
        result.errors.push(`purge: ${error.message}`);
        console.error(`[Mantenimiento] Limpieza falló: ${error.message}`);
      }
    }

    try {
      const force = `${req.query?.force || ''}`.trim() === '1';
      result.alert = await healthAlertService.send({ force });
    } catch (error) {
      result.errors.push(`alerta: ${error.message}`);
      console.error(`[Mantenimiento] Alerta falló: ${error.message}`);
    }

    const hallazgos = result.alert?.findings?.length ?? 0;
    console.log(
      `[Mantenimiento] Limpiadas ${result.purged ?? 0} · ${hallazgos} hallazgo(s) · correo ${result.alert?.sent ? 'enviado' : `no enviado (${result.alert?.reason || 'error'})`}`,
    );

    // 207 cuando algo falló pero el resto siguió: el cron no debe reintentar en
    // bucle por un fallo parcial, pero tampoco debe reportar éxito limpio.
    return res.status(result.errors.length > 0 ? 207 : 200).json(result);
  });
}

module.exports = registerMaintenanceRoutes;
