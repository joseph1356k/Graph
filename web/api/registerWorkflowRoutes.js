const WorkflowBranchLearning = require('../../src/application/use-cases/WorkflowBranchLearning');
const { statusForError, publicErrorMessage } = require('./httpErrors');

function registerWorkflowRoutes(app, deps = {}) {
  const catalogService = deps.catalogService;
  const workflowExecutor = deps.workflowExecutor;
  const noteFieldMatcher = deps.noteFieldMatcher;

  if (!app || !catalogService || !workflowExecutor) {
    throw new Error('registerWorkflowRoutes requires app, catalogService, and workflowExecutor');
  }

  const workflowBranchLearning = deps.workflowBranchLearning
    || new WorkflowBranchLearning(catalogService.repository, catalogService);

  function buildPermissions(req) {
    return {
      canManageGlobalWorkflows: Boolean(req.workflowAccess?.canManageGlobalWorkflows)
    };
  }

  app.get('/api/workflows', async (req, res) => {
    try {
      const workflows = await catalogService.getCatalog(req.workflowAccess || null);
      res.json({ workflows, permissions: buildPermissions(req) });
    } catch (err) {
      console.error(`[Workflows] List Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.get('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = await catalogService.getWorkflowById(req.params.id, req.workflowAccess || null);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      res.json({ workflow, permissions: buildPermissions(req) });
    } catch (err) {
      console.error(`[Workflows] Read Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows', async (req, res) => {
    try {
      const workflow = req.body || {};
      workflow.id = (workflow.id || '').trim() || `wf_${Date.now()}`;
      const newWf = await catalogService.saveWorkflow(workflow, req.workflowAccess || null);
      res.status(201).json({ workflow: newWf, permissions: buildPermissions(req) });
    } catch (err) {
      console.error(`[Workflows] Create Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.put('/api/workflows/:id', async (req, res) => {
    try {
      const workflow = { ...req.body, id: (req.params.id || '').trim() };
      const updated = await catalogService.updateWorkflow(workflow, req.workflowAccess || null);
      res.json({ workflow: updated, permissions: buildPermissions(req) });
    } catch (err) {
      console.error(`[Workflows] Update Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      await catalogService.deleteWorkflow(workflowId, req.workflowAccess || null);
      res.json({ deleted: true, id: workflowId });
    } catch (err) {
      console.error(`[Workflows] Delete Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows/:id/publish-global', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const workflow = await catalogService.publishWorkflowGlobal(workflowId, req.workflowAccess || null);
      res.status(201).json({ workflow, permissions: buildPermissions(req) });
    } catch (err) {
      console.error(`[Workflows] Publish Global Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows/:id/execute', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const workflow = await catalogService.getWorkflowById(workflowId, req.workflowAccess || null);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      await workflowExecutor.executeById(workflowId, req.body?.variables || {}, req.workflowAccess || null);
      res.json({ executed: true, workflowId });
    } catch (err) {
      console.error(`[Workflows] Execute Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows/:id/plan', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const plan = await workflowExecutor.getExecutionPlanById(
        workflowId,
        req.body?.variables || {},
        req.body?.executionIntent || {},
        req.workflowAccess || null
      );
      res.json({ executionPlan: plan });
    } catch (err) {
      console.error(`[Workflows] Plan Error: ${err.message}`);
      if ((err.message || '').includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows/:id/note-field-matches', async (req, res) => {
    try {
      if (!noteFieldMatcher) {
        return res.status(503).json({ error: 'Note field matcher not configured' });
      }
      const workflowId = `${req.params.id || ''}`.trim();
      const workflow = await catalogService.getWorkflowById(workflowId, req.workflowAccess || null);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      const result = await noteFieldMatcher.match({
        noteContent: req.body?.noteContent || '',
        fields: req.body?.fields || [],
        alreadyFulfilled: req.body?.alreadyFulfilled || [],
        pageUrl: req.body?.pageUrl || ''
      });
      res.json(result);
    } catch (err) {
      console.error(`[Workflows] Note Field Match Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/workflows/:id/branch-observation', async (req, res) => {
    try {
      const workflowId = (req.params.id || '').trim();
      const result = await workflowBranchLearning.recordObservation(workflowId, req.body || {}, req.workflowAccess || null);
      res.json(result);
    } catch (err) {
      console.error(`[Workflows] Branch Observation Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });
}

module.exports = registerWorkflowRoutes;
