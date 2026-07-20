// Routes for the "Android App" panel in Provider Studio: telemetry of the
// Android installations plus the distributed client config. Every route is
// admin-only, mirroring the /api/providers/* gate (workflowAccess is attached
// by requireAccountAuth + attachWorkflowAccess in server.js).

function requireProviderAdmin(req, res, next) {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar el panel Android.' });
  }
  return next();
}

function registerAndroidPanelRoutes(app, deps = {}) {
  const androidPanelService = deps.androidPanelService;

  if (!app || !androidPanelService) {
    throw new Error('registerAndroidPanelRoutes requires app and androidPanelService');
  }

  app.get('/api/android/users', requireProviderAdmin, async (req, res) => {
    try {
      res.json({ users: await androidPanelService.listUsers() });
    } catch (error) {
      console.error(`[Android Panel] listUsers error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los usuarios.' });
    }
  });

  app.get('/api/android/users/:deviceId/prompts', requireProviderAdmin, async (req, res) => {
    try {
      const prompts = await androidPanelService.listPrompts(req.params.deviceId, req.query.limit || 100);
      res.json({ prompts });
    } catch (error) {
      console.error(`[Android Panel] listPrompts error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los prompts.' });
    }
  });

  app.get('/api/android/users/:deviceId/logs', requireProviderAdmin, async (req, res) => {
    try {
      const logs = await androidPanelService.getDeviceLogs(req.params.deviceId, req.query.limit || 300);
      res.json({ logs });
    } catch (error) {
      console.error(`[Android Panel] getDeviceLogs error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los logs del dispositivo.' });
    }
  });

  app.get('/api/android/prompts/:promptId/logs', requireProviderAdmin, async (req, res) => {
    try {
      const logs = await androidPanelService.getPromptLogs(req.params.promptId);
      res.json({ logs });
    } catch (error) {
      console.error(`[Android Panel] getPromptLogs error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los logs del prompt.' });
    }
  });

  app.get('/api/android/client-config', requireProviderAdmin, async (req, res) => {
    try {
      res.json({ config: await androidPanelService.getClientConfig() });
    } catch (error) {
      console.error(`[Android Panel] getClientConfig error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer la configuracion distribuida.' });
    }
  });

  app.post('/api/android/client-config', requireProviderAdmin, async (req, res) => {
    try {
      res.json({ config: await androidPanelService.updateClientConfig(req.body || {}) });
    } catch (error) {
      console.error(`[Android Panel] updateClientConfig error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible guardar la configuracion distribuida.' });
    }
  });
}

module.exports = registerAndroidPanelRoutes;
