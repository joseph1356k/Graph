// @ts-check
// Rutas de la BITÁCORA DE AVANCES del laboratorio (botón "Registrar avance").
// Mismo gate solo-admin que el resto del panel Windows: quien puede ver el
// laboratorio puede escribir en él.
//
//   GET  /api/studio/progress?engine=&docId=&limit=  -> listar
//   POST /api/studio/progress                        -> registrar

function requireProviderAdmin(req, res, next) {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para el laboratorio.' });
  }
  return next();
}

function registerStudioProgressRoutes(app, deps = {}) {
  const studioProgressService = deps.studioProgressService;

  if (!app || !studioProgressService) {
    throw new Error('registerStudioProgressRoutes requiere app y studioProgressService');
  }

  app.get('/api/studio/progress', requireProviderAdmin, async (req, res) => {
    try {
      res.json(await studioProgressService.list({
        engine: req.query.engine,
        docId: req.query.docId,
        limit: req.query.limit
      }));
    } catch (error) {
      console.error(`[Studio Progress] list error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer los avances.' });
    }
  });

  app.post('/api/studio/progress', requireProviderAdmin, async (req, res) => {
    try {
      // El autor sale de la sesión, no del cuerpo: firmar un avance con el
      // nombre de otro no debe ser posible desde el formulario.
      const author = {
        email: req.user?.email || '',
        name: req.user?.username || ''
      };
      res.json(await studioProgressService.create(req.body || {}, author));
    } catch (error) {
      console.error(`[Studio Progress] create error: ${error.message}`);
      res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible guardar el avance.' });
    }
  });
}

module.exports = registerStudioProgressRoutes;
