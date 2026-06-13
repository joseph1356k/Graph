function registerExecutionIntelligenceRoutes(app, deps = {}) {
  const catalogService = deps.catalogService;
  const executionIntelligenceService = deps.executionIntelligenceService;

  if (!app || !catalogService || !executionIntelligenceService) {
    throw new Error('registerExecutionIntelligenceRoutes requires app, catalogService, and executionIntelligenceService');
  }

  app.post('/api/workflows/:id/intelligence', async (req, res) => {
    try {
      const workflowId = `${req.params.id || ''}`.trim();
      const workflow = await catalogService.getWorkflowById(workflowId, req.workflowAccess || null);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      const decision = await executionIntelligenceService.decide(workflow, {
        ...(req.body || {}),
        workflowId
      });
      res.json({ decision });
    } catch (err) {
      console.error(`[Execution Intelligence] Decision Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });
}

module.exports = registerExecutionIntelligenceRoutes;
const { statusForError, publicErrorMessage } = require('./httpErrors');
