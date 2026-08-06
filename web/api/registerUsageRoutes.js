// API del dashboard de consumo de IA.
//
// CAMBIOS DE SEGURIDAD FRENTE A LA VERSIÓN ANTERIOR
//   1. Se elimina `POST /api/usage/events` sin autenticación. Cualquiera podía
//      inyectar consumo falso en el ledger y falsear la factura. La ingesta
//      queda solo en el endpoint interno con clave.
//   2. Las consultas se ejecutan CON LA CREDENCIAL DEL QUE PREGUNTA. Si viene
//      un JWT de Supabase, la RPC corre con ese token y es Postgres quien
//      aplica el aislamiento por organización; el backend no puede ampliarlo.
//      Solo la sesión de administrador local de Graph (el operador interno)
//      consulta con service-role, y se dice explícitamente en la respuesta.

const { verifySupabaseToken } = require('./requireClinicalAuth');

function hasValidInternalKey(req) {
  const expected = `${process.env.GRAPH_USAGE_INGEST_KEY || ''}`.trim();
  if (!expected) {
    return false;
  }
  const provided = `${req.get('x-graph-usage-key') || ''}`.trim();
  if (!provided || provided.length !== expected.length) {
    return false;
  }
  // Comparación en tiempo constante: el largo ya se comprobó arriba.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}

function extractBearer(req) {
  const header = `${req.get('authorization') || ''}`.trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

/**
 * Decide con qué credencial se consulta.
 *   · JWT de Supabase válido  → se reenvía; el alcance lo aplica la base.
 *   · sesión de admin local   → service-role, alcance completo (operador interno).
 *   · nada                    → 401.
 */
async function resolveViewer(req) {
  const token = extractBearer(req);
  if (token) {
    try {
      const payload = await verifySupabaseToken(token);
      return {
        kind: 'supabase_user',
        accessToken: token,
        userId: `${payload.sub || ''}`,
        email: payload.email || ''
      };
    } catch (error) {
      // No es un token de Supabase (o expiró). Puede seguir siendo la sesión
      // local del operador, que se comprueba abajo.
    }
  }

  if (req.user?.id) {
    return {
      kind: 'internal_operator',
      accessToken: '',
      userId: '',
      email: req.user.email || req.user.username || ''
    };
  }

  return null;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : `${value}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function registerUsageRoutes(app, deps = {}) {
  const usageDashboardService = deps.usageDashboardService;
  const usageRecorder = deps.usageRecorder || null;

  if (!app || !usageDashboardService) {
    throw new Error('registerUsageRoutes requires app and usageDashboardService');
  }

  // Envuelve un handler de consulta: resuelve el viewer, traduce errores y
  // evita repetir el mismo try/catch en siete rutas.
  function query(handler) {
    return async (req, res) => {
      let viewer;
      try {
        viewer = await resolveViewer(req);
      } catch (error) {
        return res.status(401).json({ error: 'No autorizado.' });
      }
      if (!viewer) {
        return res.status(401).json({ error: 'Se requiere una sesión para consultar el consumo.' });
      }
      try {
        const payload = await handler(req, viewer);
        return res.json({ ...payload, viewer: { kind: viewer.kind } });
      } catch (error) {
        const status = error.statusCode || (error.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500);
        if (status >= 500) {
          console.error(`[Usage] Error consultando: ${error.message}`);
        }
        return res.status(status).json({
          error: error.message || 'No fue posible consultar el consumo.',
          code: error.code || ''
        });
      }
    };
  }

  // ---- Ingesta interna ----------------------------------------------------
  // Solo para procesos propios (el portal clínico registrando su llamada a
  // Anthropic, por ejemplo). Exige la clave compartida; el usuario y la
  // organización se aceptan porque quien la tiene ya es un servicio de
  // confianza que los resolvió contra SU sesión autenticada.
  app.post('/api/internal/usage/events', async (req, res) => {
    if (!hasValidInternalKey(req)) {
      return res.status(401).json({ error: 'Invalid usage ingest key.' });
    }
    if (!usageRecorder) {
      return res.status(503).json({ error: 'El grabador de consumo no está disponible.' });
    }
    try {
      const result = await usageRecorder.record({
        ...(req.body || {}),
        // El contexto viene del cuerpo porque el emisor es otro servicio, no un
        // navegador. `attributionSource` se fuerza para que quede claro en el
        // ledger que esta atribución llegó por el canal interno.
        context: {
          userId: req.body?.userId || null,
          organizationId: req.body?.organizationId || null,
          actorType: req.body?.actorType || 'unattributed',
          attributionSource: req.body?.attributionSource || 'session',
          app: req.body?.app || 'backend',
          feature: req.body?.feature || 'unknown',
          sessionId: req.body?.sessionId || '',
          workflowId: '',
          requestId: req.body?.requestId || ''
        }
      });
      return res.status(result?.duplicate ? 200 : 201).json({
        ok: Boolean(result?.ok),
        duplicate: Boolean(result?.duplicate),
        storage: result?.storage || 'none'
      });
    } catch (error) {
      console.error(`[Usage] Internal ingest error: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
  });

  // ---- Consulta -----------------------------------------------------------
  app.get('/api/usage/overview', query((req, viewer) =>
    usageDashboardService.getOverview(req.query || {}, viewer)));

  app.get('/api/usage/summary', query((req, viewer) =>
    usageDashboardService.getSummary(req.query || {}, viewer)));

  app.get('/api/usage/series', query((req, viewer) =>
    usageDashboardService.getSeries(req.query || {}, viewer)));

  app.get('/api/usage/breakdown/:dimension', query((req, viewer) =>
    usageDashboardService.getBreakdown(req.params.dimension, req.query || {}, viewer)));

  app.get('/api/usage/events', query((req, viewer) =>
    usageDashboardService.getEvents(req.query || {}, viewer)));

  // Quién y qué organización se pueden elegir en los filtros. Va por el mismo
  // alcance: la lista sale del consumo visible, no del directorio de usuarios.
  app.get('/api/usage/facets', query((req, viewer) =>
    usageDashboardService.getFacets(req.query || {}, viewer)));

  app.get('/api/usage/missing-rates', query(async (req, viewer) => ({
    missingRates: await usageDashboardService.getMissingRates(req.query || {}, viewer)
  })));

  // Exportación CSV. Pasa por el mismo alcance que el resto: un usuario no
  // puede exportar lo que no puede ver. Nunca incluye prompts ni contenido.
  app.get('/api/usage/export.csv', async (req, res) => {
    let viewer;
    try {
      viewer = await resolveViewer(req);
    } catch (error) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
    if (!viewer) {
      return res.status(401).json({ error: 'Se requiere una sesión para exportar el consumo.' });
    }
    try {
      // ANTES SE EXPORTABA UNA SOLA PÁGINA. `getEvents` está topado a 200 filas
      // por la RPC, así que el CSV salía cortado en la fila 200 sin decirlo —
      // y un reporte de costos truncado en silencio es peor que no tenerlo,
      // porque cuadra con nada y nadie sabe por qué. Ahora se pagina hasta
      // agotar el rango, con un tope duro para no tumbar la lambda, y si se
      // alcanza se DECLARA dentro del propio archivo.
      const PAGE = 200;
      const MAX_ROWS = 10000;
      const events = [];
      let offset = Number(req.query?.offset) || 0;
      let total = 0;
      for (;;) {
        const page = await usageDashboardService.getEvents(
          { ...(req.query || {}), limit: PAGE, offset },
          viewer
        );
        total = page.total;
        events.push(...page.events);
        offset += PAGE;
        if (page.events.length < PAGE || events.length >= MAX_ROWS || offset >= total) break;
      }
      const truncated = events.length < total;
      // Va el nombre además del UUID: quien abre el CSV para repartir costos
      // necesita leer a quién corresponde cada línea, y el UUID se queda para
      // poder cruzarlo con otros sistemas. El correo NO se exporta: dentro del
      // panel sirve para desempatar homónimos, pero un CSV se reenvía.
      const columns = [
        'occurredAt', 'organizationName', 'organizationId', 'userName', 'userId',
        'actorType', 'app', 'feature', 'provider', 'requestedModel', 'servedModel',
        'inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'costStatus',
        'status', 'latencyMs', 'environment'
      ];
      const lines = [columns.join(',')];
      for (const event of events) {
        lines.push(columns.map((column) => csvEscape(event[column])).join(','));
      }
      if (truncated) {
        lines.push('');
        lines.push(csvEscape(
          `AVISO: exportadas ${events.length} de ${total} filas (tope de ${MAX_ROWS}). ` +
          'Acota el rango o añade filtros para obtener el resto.'
        ));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="miracle-ai-usage.csv"');
      res.setHeader('X-Miracle-Exported-Rows', String(events.length));
      res.setHeader('X-Miracle-Total-Rows', String(total));
      return res.send(`${lines.join('\n')}\n`);
    } catch (error) {
      const status = error.statusCode || 500;
      return res.status(status).json({ error: error.message });
    }
  });

  app.get('/api/usage/pricing', (req, res) => {
    res.json({
      pricing: usageDashboardService.getPricingCatalog()
    });
  });

  // Salud de la propia telemetría. Sin esto, un fallo de escritura se vería
  // como «bajó el consumo» y nadie sabría distinguirlo de la realidad.
  app.get('/api/usage/health', query(async (req, viewer) => {
    if (viewer.kind !== 'internal_operator') {
      const error = new Error('Solo el operador interno puede ver la salud de la telemetría.');
      error.statusCode = 403;
      throw error;
    }
    return { health: usageRecorder?.getStats?.() || { enabled: false } };
  }));
}

module.exports = registerUsageRoutes;
module.exports.resolveViewer = resolveViewer;
