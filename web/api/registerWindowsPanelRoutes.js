// Rutas de LECTURA del panel Windows en Provider Studio (dashboard). Solo-admin,
// mismo gate que el panel Android (workflowAccess.canManageGlobalWorkflows, que
// adjunta requireAccountAuth + attachWorkflowAccess en server.js).
//
//   GET /api/windows/users                     -> selector de usuarios
//   GET /api/windows/users/:email/events       -> pulsos + logs (?since, ?limit)
//   GET /api/windows/users/:email/graph        -> subconsciente (apps->wf->nodos)

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
