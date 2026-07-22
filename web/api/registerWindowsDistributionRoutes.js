// Distribución de la app de Windows (Ü) desde Provider Studio: disparar un
// build en GitHub Actions, consultar su estado, y resolver el instalador
// vigente. Las rutas /api/providers/windows-app/* son admin-only (mismo
// gate que el resto del panel); /api/windows/latest-installer es pública a
// propósito — la usan tanto el botón de Provider Studio como el landing page
// externo (landing-descargas), sin sesión ni API key.

function requireProviderAdmin(req, res, next) {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para distribuir la app de Windows.' });
  }
  return next();
}

function registerWindowsDistributionRoutes(app, deps = {}) {
  const windowsAppReleaseService = deps.windowsAppReleaseService;

  if (!app || !windowsAppReleaseService) {
    throw new Error('registerWindowsDistributionRoutes requires app and windowsAppReleaseService');
  }

  app.get('/api/providers/windows-app/status', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsAppReleaseService.status());
    } catch (error) {
      console.error(`[Windows App] status error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer el estado de distribución.' });
    }
  });

  app.post('/api/providers/windows-app/build', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsAppReleaseService.triggerBuild());
    } catch (error) {
      console.error(`[Windows App] triggerBuild error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible disparar el build.' });
    }
  });

  app.get('/api/providers/windows-app/build/status', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsAppReleaseService.pollBuildStatus(req.query.request_id));
    } catch (error) {
      console.error(`[Windows App] pollBuildStatus error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer el estado del build.' });
    }
  });

  app.get('/api/providers/windows-app/build-info', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await windowsAppReleaseService.getLastBuildStatus());
    } catch (error) {
      console.error(`[Windows App] getLastBuildStatus error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer el último build.' });
    }
  });

  // Pública a propósito: no pasa por requireAccountAuth/requireApiKey (ver
  // web/server.js, prefijos /api/providers, /api/android y /api/v1 — este
  // path no coincide con ninguno).
  app.get('/api/windows/latest-installer', async (req, res) => {
    try {
      const { url } = await windowsAppReleaseService.getLatestInstallerUrl();
      return res.redirect(302, url);
    } catch (error) {
      return res.status(error.statusCode || 502).json({ error: error.message || 'No fue posible resolver el instalador.' });
    }
  });
}

module.exports = registerWindowsDistributionRoutes;
