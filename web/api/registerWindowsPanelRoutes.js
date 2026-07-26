// @ts-check
// Rutas de LECTURA del panel Windows en Provider Studio (dashboard). Solo-admin,
// mismo gate que el panel Android (workflowAccess.canManageGlobalWorkflows, que
// adjunta requireAccountAuth + attachWorkflowAccess en server.js).
//
//   GET /api/windows/engines                   -> catálogo de motores (las tabs)
//   GET /api/windows/users                     -> selector de usuarios
//   GET /api/windows/users/:email/events       -> pulsos + logs (?since, ?limit)
//   GET /api/windows/users/:email/events/stream -> lo mismo, EN VIVO (SSE)
//   GET /api/windows/users/:email/stats        -> marcador de pruebas por motor
//   GET /api/windows/users/:email/graph        -> subconsciente (apps->wf->nodos)

const { engineCatalog } = require('../../src/domain/windowsEngines');

// --- Parámetros del stream -------------------------------------------------
// Cada cuánto el servidor le pregunta a Supabase si hay algo nuevo. Es el techo
// de latencia del último tramo (Supabase -> navegador). 400 ms es imperceptible
// y mantiene el coste en ~150 consultas por minuto y espectador.
const STREAM_TICK_MS = 400;
// Vercel corta la función a los 60 s (vercel.json: maxDuration). Cerramos ANTES,
// limpio, para que el cliente reconecte sin ver un error de red.
const STREAM_MAX_MS = 50000;
// Latido: sin bytes en el cable, proxies y antivirus cierran la conexión.
const STREAM_PING_MS = 15000;

function requireProviderAdmin(req, res, next) {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar el panel Windows.' });
  }
  return next();
}

function registerWindowsPanelRoutes(app, deps = {}) {
  const windowsPanelService = deps.windowsPanelService;

  if (!app || !windowsPanelService) {
    throw new Error('registerWindowsPanelRoutes requiere app y windowsPanelService');
  }

  // Las tabs del panel se construyen desde aquí: añadir un motor es tocar solo
  // src/domain/windowsEngines.js, nunca el front.
  app.get('/api/windows/engines', requireProviderAdmin, (req, res) => {
    res.json({ engines: engineCatalog() });
  });

  app.get('/api/windows/users', requireProviderAdmin, async (req, res) => {
    try {
      res.json({ users: await windowsPanelService.listUsers() });
    } catch (error) {
      console.error(`[Windows Panel] listUsers error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los usuarios.' });
    }
  });

  app.get('/api/windows/users/:email/events', requireProviderAdmin, async (req, res) => {
    try {
      const result = await windowsPanelService.listEvents(req.params.email, {
        since: req.query.since,
        limit: req.query.limit
      });
      res.json(result);
    } catch (error) {
      console.error(`[Windows Panel] listEvents error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los eventos.' });
    }
  });

  // ---------------------------------------------------------------------------
  // EL STREAM EN VIVO.
  //
  // Es SSE por el formato del cuerpo, pero el cliente NO usa EventSource: lo lee
  // con fetch() en streaming. La razón es de seguridad, no de gusto — EventSource
  // no admite cabeceras, así que la única forma de autenticarlo sería meter el
  // Bearer en el query string, donde queda en logs de acceso e historial. Con
  // fetch el token viaja en Authorization como el resto del panel.
  //
  // El bucle sondea Supabase cada STREAM_TICK_MS y empuja SOLO lo nuevo (id >
  // lastId). El navegador conserva su lastId, así que una reconexión no duplica
  // ni pierde eventos.
  // ---------------------------------------------------------------------------
  app.get('/api/windows/users/:email/events/stream', requireProviderAdmin, async (req, res) => {
    const email = req.params.email;
    let lastId = Number.parseInt(`${req.query.since || 0}`, 10);
    if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sin esto, un proxy con buffering (nginx, y algunos edge) retiene el
      // cuerpo hasta cerrar la conexión y el "tiempo real" se convierte en un
      // volcado al final. Es el fallo clásico de SSE detrás de proxy.
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    let closed = false;
    const send = (event, data) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // El cliente necesita saber desde dónde arrancó el servidor para no pedir
    // dos veces lo mismo por el endpoint no-streaming.
    send('open', { since: lastId, tickMs: STREAM_TICK_MS });

    const startedAt = Date.now();
    let lastPingAt = startedAt;
    let polling = false;

    const finish = (reason) => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        // 'bye' le dice al cliente que esto es un cierre planificado (el tope de
        // 50 s), no una caída: reconecta de inmediato y sin backoff.
        res.write(`event: bye\ndata: ${JSON.stringify({ reason, lastId })}\n\n`);
        res.end();
      } catch (_) { /* el socket ya se fue */ }
    };

    const timer = setInterval(async () => {
      if (closed) return;
      if (Date.now() - startedAt > STREAM_MAX_MS) return finish('max-duration');

      // Si la consulta anterior sigue en vuelo, saltamos el turno en vez de
      // encolar otra. Sin esto, una Supabase lenta acumula consultas en
      // paralelo y el orden de llegada deja de estar garantizado.
      if (polling) return;
      polling = true;
      try {
        const { events, lastId: newLastId } = await windowsPanelService.listEvents(email, {
          since: lastId,
          limit: 200
        });
        if (events.length) {
          lastId = newLastId;
          send('events', { events, lastId });
          lastPingAt = Date.now();
        } else if (Date.now() - lastPingAt > STREAM_PING_MS) {
          // Comentario SSE: mantiene el socket vivo sin ser un evento.
          res.write(': ping\n\n');
          lastPingAt = Date.now();
        }
      } catch (error) {
        send('warn', { message: error.message || 'fallo leyendo eventos' });
      } finally {
        polling = false;
      }
    }, STREAM_TICK_MS);

    req.on('close', () => { closed = true; clearInterval(timer); });
  });

  // El marcador: % de éxito por motor y por versión de la app.
  app.get('/api/windows/users/:email/stats', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsPanelService.listEngineStats(req.params.email, { limit: req.query.limit }));
    } catch (error) {
      console.error(`[Windows Panel] listEngineStats error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible calcular el marcador.' });
    }
  });

  app.get('/api/windows/users/:email/graph', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsPanelService.getUserGraph(req.params.email));
    } catch (error) {
      console.error(`[Windows Panel] getUserGraph error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer el grafo del usuario.' });
    }
  });
}

module.exports = registerWindowsPanelRoutes;
