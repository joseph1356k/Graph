// Rutas de exportación de nota clínica a la historia clínica.
//
// DOS carriles de autenticación, deliberadamente separados:
//
//   /api/clinical/exports        → JWT de Supabase del médico (requireClinicalAuth,
//                                  req.clinicalUser). Es el carril de Miracle Notes.
//   /api/v1/operations/exports   → X-API-Key de cliente (requireApiKey, req.apiClient).
//                                  Es el carril del ejecutor de Operations.
//
// El ejecutor trabaja por PULL: reclama trabajo y reporta resultado. Nunca se le
// abre un puerto ni se le empuja nada, así que da igual que viva detrás del
// firewall del hospital. El simulador
// (scripts/simulate-operations-executor.js) y el futuro cliente Windows hablan
// EXACTAMENTE este contrato: cambiar de uno a otro no toca el frontend.
const { isClinicalError } = require('../../src/application/use-cases/ClinicalErrors');

function respondExportError(res, error, logPrefix) {
  if (isClinicalError(error)) {
    return res.status(error.statusCode || 500).json({
      error: { code: error.code, message: error.message }
    });
  }
  // Nunca se filtra el mensaje interno (podría traer detalles de la base de
  // datos) ni contenido clínico en logs.
  console.error(`${logPrefix} ${error.message}`);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' }
  });
}

function requesterFrom(req) {
  return {
    id: `${req.clinicalUser?.id || ''}`,
    email: `${req.clinicalUser?.email || ''}`
  };
}

// Identidad del ejecutor: la manda en `device` y se cruza con la etiqueta de la
// API key. Es lo que queda auditado en `claimed_by` y lo que valida el lease al
// reportar el resultado.
function executorIdentityFrom(req) {
  const device = `${req.body?.device || req.get('x-miracle-device') || ''}`.trim();
  if (device) return device;
  return `${req.apiClient?.label || ''}`.trim();
}

function registerNoteExportRoutes(app, deps = {}) {
  const noteExportService = deps.noteExportService;

  function requireService(res) {
    if (!noteExportService) {
      res.status(503).json({
        error: {
          code: 'SUPABASE_NOT_CONFIGURED',
          message: 'La exportación a historia clínica no está configurada en este entorno.'
        }
      });
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Carril Miracle Notes
  // -------------------------------------------------------------------------

  // Pide la exportación. Responde de inmediato con el trabajo en 'pending':
  // NUNCA espera al ejecutor y NUNCA reporta éxito aquí.
  app.post('/api/clinical/exports', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const { duplicate, export: job } = await noteExportService.createExport({
        consultationId: req.body?.consultation_id,
        requester: requesterFrom(req)
      });

      if (duplicate) {
        // 409 con el estado del trabajo que YA existe. Para el frontend esto no
        // es un error: es la respuesta idempotente a "ya habías pedido esto"
        // (doble clic, dos pestañas, reintento de red). El cliente adopta este
        // estado en vez de crear un segundo trabajo.
        return res.status(409).json({
          error: {
            code: 'EXPORT_ALREADY_EXISTS',
            message: 'Ya existe una exportación para esta consulta.'
          },
          export: job
        });
      }
      return res.status(201).json({ export: job });
    } catch (error) {
      return respondExportError(res, error, '[note-export create]');
    }
  });

  // Estado actual: carga inicial del detalle (tras recargar la página) y
  // respaldo de polling cuando Realtime no está disponible.
  app.get('/api/clinical/exports', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await noteExportService.getExportForConsultation({
        consultationId: req.query?.consultation_id,
        requester: requesterFrom(req)
      });
      return res.json(result);
    } catch (error) {
      return respondExportError(res, error, '[note-export get]');
    }
  });

  app.post('/api/clinical/exports/:exportId/retry', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await noteExportService.retryExport({
        exportId: req.params.exportId,
        requester: requesterFrom(req)
      });
      return res.json(result);
    } catch (error) {
      return respondExportError(res, error, '[note-export retry]');
    }
  });

  app.post('/api/clinical/exports/:exportId/cancel', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await noteExportService.cancelExport({
        exportId: req.params.exportId,
        requester: requesterFrom(req)
      });
      return res.json(result);
    } catch (error) {
      return respondExportError(res, error, '[note-export cancel]');
    }
  });

  // -------------------------------------------------------------------------
  // Carril Operations (pull)
  // -------------------------------------------------------------------------

  // Reclama el siguiente trabajo. 204 = no hay nada que hacer (el ejecutor
  // vuelve a preguntar luego). 200 = trabajo + payload (+ plan si Graph lo
  // resuelve server-side).
  app.post('/api/v1/operations/exports/claim', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await noteExportService.claimNext({ claimedBy: executorIdentityFrom(req) });
      if (!result.export) {
        return res.status(204).end();
      }
      return res.json({
        export: {
          id: result.export.id,
          workflow_id: result.export.workflow_id,
          attempts: result.export.attempts,
          lease_expires_at: result.export.lease_expires_at
        },
        payload: result.payload,
        plan: result.plan
      });
    } catch (error) {
      return respondExportError(res, error, '[note-export claim]');
    }
  });

  // Reporta el desenlace. El ejecutor DEBE reintentar hasta recibir ack: esto
  // nunca es best-effort, porque es lo que decide si la consulta queda
  // exportada. Reenviar el mismo resultado es seguro (idempotente).
  app.post('/api/v1/operations/exports/:exportId/result', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await noteExportService.reportResult({
        exportId: req.params.exportId,
        claimedBy: executorIdentityFrom(req),
        outcome: req.body?.outcome,
        folio: req.body?.folio,
        unresolvedFields: req.body?.unresolved_fields,
        errorCode: req.body?.error_code,
        detailCode: req.body?.detail_code
      });
      return res.json(result);
    } catch (error) {
      return respondExportError(res, error, '[note-export result]');
    }
  });
}

module.exports = registerNoteExportRoutes;
module.exports.respondExportError = respondExportError;
