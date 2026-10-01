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
  const { healthAlertService, restClient, noteRescueService, windowsTelemetryService } = deps;

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

    const result = { rescued: null, purged: null, purgedExportPayloads: null, purgedWindowsLogs: null, alert: null, errors: [] };

    // El rescate va PRIMERO: convierte en notas las consultas que quedaron a
    // medias, para que el correo no reporte como problema algo que se acaba de
    // arreglar en esta misma ejecución.
    if (noteRescueService) {
      try {
        result.rescued = await noteRescueService.run();
      } catch (error) {
        result.errors.push(`rescate: ${error.message}`);
        console.error(`[Mantenimiento] Rescate falló: ${error.message}`);
      }
    }

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

    // El payload de una exportación terminada lleva la nota firmada entera.
    // La función de purga existía desde la migración de exportaciones (72 h
    // tras el estado terminal) y nadie la llamaba: se descubrió en la auditoría
    // de privacidad del 2026-09-07.
    if (restClient) {
      try {
        const hours = Number(process.env.NOTE_EXPORT_PAYLOAD_RETENTION_HOURS || 72);
        const purged = await restClient.rpc('graph_purge_note_export_payloads', {
          p_older_than_hours: Number.isFinite(hours) ? hours : 72,
        });
        result.purgedExportPayloads = typeof purged === 'number' ? purged : Number(purged) || 0;
      } catch (error) {
        result.errors.push(`purge exportaciones: ${error.message}`);
        console.error(`[Mantenimiento] Purga de payloads de exportación falló: ${error.message}`);
      }
    }

    // El log que refleja cada equipo de Windows caduca: el 2026-10-01 eran 407.979
    // filas y 246 MB en una base de 500 MB, y nada las borraba (spec 001). Solo
    // los logs; las corridas y los pasos de workflow se quedan.
    if (windowsTelemetryService) {
      try {
        result.purgedWindowsLogs = await windowsTelemetryService.purgarLogsViejos({
          dias: process.env.WINDOWS_LOG_RETENTION_DAYS,
        });
      } catch (error) {
        result.errors.push(`purga de logs de Windows: ${error.message}`);
        console.error(`[Mantenimiento] Purga de logs de Windows falló: ${error.message}`);
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
      `[Mantenimiento] Rescatadas ${result.rescued?.rescued ?? 0} · limpiadas ${result.purged ?? 0} · ${result.purgedWindowsLogs ?? 0} log(s) de Windows caducados · ${hallazgos} hallazgo(s) · correo ${result.alert?.sent ? 'enviado' : `no enviado (${result.alert?.reason || 'error'})`}`,
    );

    // 207 cuando algo falló pero el resto siguió: el cron no debe reintentar en
    // bucle por un fallo parcial, pero tampoco debe reportar éxito limpio.
    return res.status(result.errors.length > 0 ? 207 : 200).json(result);
  });
}

module.exports = registerMaintenanceRoutes;
