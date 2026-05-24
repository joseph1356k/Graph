const WorkflowBranchLearning = require('../../src/application/use-cases/WorkflowBranchLearning');

function registerWorkflowRoutes(app, deps = {}) {
  const catalogService = deps.catalogService;
  const workflowExecutor = deps.workflowExecutor;

  if (!app || !catalogService || !workflowExecutor) {
    throw new Error('registerWorkflowRoutes requires app, catalogService, and workflowExecutor');
  }

  const workflowBranchLearning = deps.workflowBranchLearning
    || new WorkflowBranchLearning(catalogService.repository, catalogService);

  app.get('/api/workflows', async (req, res) => {
    try {
      const workflows = await catalogService.getCatalog();
      res.json({ workflows });
    } catch (err) {
      console.error(`[Workflows] List Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = await catalogService.getWorkflowById(req.params.id);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      res.json({ workflow });
    } catch (err) {
      console.error(`[Workflows] Read Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workflows', async (req, res) => {
    try {
      const workflow = req.body || {};
      workflow.id = (workflow.id || '').trim() || `wf_${Date.now()}`;
      const newWf = await catalogService.saveWorkflow(workflow);
      res.status(201).json({ workflow: newWf });
    } catch (err) {
      console.error(`[Workflows] Create Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = { ...req.body, id: (req.params.id || '').trim() };
      const updated = await catalogService.updateWorkflow(workflow);
      res.json({ workflow: updated });
    } catch (err) {
      console.error(`[Workflows] Update Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      await catalogService.deleteWorkflow(workflowId);
      res.json({ deleted: true, id: workflowId });
    } catch (err) {
      console.error(`[Workflows] Delete Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workflows/:id/execute', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const workflow = await catalogService.getWorkflowById(workflowId);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      await workflowExecutor.executeById(workflowId, req.body?.variables || {});
      res.json({ executed: true, workflowId });
    } catch (err) {
      console.error(`[Workflows] Execute Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workflows/:id/plan', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const plan = await workflowExecutor.getExecutionPlanById(workflowId, req.body?.variables || {}, req.body?.executionIntent || {});
      res.json({ executionPlan: plan });
    } catch (err) {
      console.error(`[Workflows] Plan Error: ${err.message}`);
      if ((err.message || '').includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workflows/:id/branch-observation', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const result = await workflowBranchLearning.recordObservation(workflowId, req.body || {});
      res.json(result);
    } catch (err) {
      console.error(`[Workflows] Branch Observation Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = registerWorkflowRoutes;
