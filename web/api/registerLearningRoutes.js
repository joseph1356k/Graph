const { statusForError, publicErrorMessage } = require('./httpErrors');

function registerLearningRoutes(app, deps = {}) {
  const learningSessionService = deps.learningSessionService;

  if (!app || !learningSessionService) {
    throw new Error('registerLearningRoutes requires app and learningSessionService');
  }

  app.get('/api/status', (req, res) => {
    res.json(learningSessionService.getStatus({ access: req.workflowAccess || null }));
  });

  app.post('/api/workflow/start', async (req, res) => {
    try {
      const description = (req.body?.description || '').trim() || 'Untitled workflow';
      const workflowId = await learningSessionService.startSession(
        description,
        {
          ...(req.body?.context || {}),
          scope: 'private',
          ownerId: req.workflowAccess?.ownerId || ''
        },
        { access: req.workflowAccess || null }
      );
      console.log(`[Server] Starting workflow: ${workflowId}`);
      res.json({ id: workflowId });
    } catch (err) {
      console.error(`[Server] Start Error: ${err.message}`);
      learningSessionService.reset({ access: req.workflowAccess || null });
      res.status(statusForError(err)).send(publicErrorMessage(err));
    }
  });

  app.post('/api/step', async (req, res) => {
    try {
      const workflowId = learningSessionService.resolveSessionId(req.body?.sessionId, {
        access: req.workflowAccess || null
      });
      const stepOrder = await learningSessionService.recordStep(req.body, {
        sessionId: workflowId,
        access: req.workflowAccess || null
      });
      console.log(`[Server] Logging step ${stepOrder} for ${workflowId}`);
      res.sendStatus(200);
    } catch (err) {
      console.error(`[Server] Step Error: ${err.message}`);
      res.status(statusForError(err)).send(publicErrorMessage(err));
    }
  });

  app.post('/api/workflow/context-note', async (req, res) => {
    try {
      await learningSessionService.addContextNote(req.body?.note || {}, {
        sessionId: req.body?.sessionId || '',
        access: req.workflowAccess || null
      });
      res.sendStatus(200);
    } catch (err) {
      console.error(`[Server] Context Note Error: ${err.message}`);
      res.status(statusForError(err)).send(publicErrorMessage(err));
    }
  });

  app.post('/api/workflow/stop', async (req, res) => {
    try {
      const workflowId = learningSessionService.resolveSessionId(req.body?.sessionId, {
        access: req.workflowAccess || null
      });
      console.log(`[Server] Stopping workflow: ${workflowId}`);
      const { summary } = await learningSessionService.finishSession({
        sessionId: workflowId,
        access: req.workflowAccess || null
      });
      console.log(`[Server] Final Summary: ${summary}`);
      res.sendStatus(200);
    } catch (err) {
      console.error(`[Server] Stop Error: ${err.message}`);
      res.status(statusForError(err)).send(publicErrorMessage(err));
    }
  });

  app.post('/api/reset', (req, res) => {
    console.log('[Server] Manual status reset');
    learningSessionService.reset({ access: req.workflowAccess || null });
    res.sendStatus(200);
  });
}

module.exports = registerLearningRoutes;
