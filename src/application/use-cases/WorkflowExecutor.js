const TransversalWorkflowComposer = require('./TransversalWorkflowComposer');
const WorkflowBranchPlanner = require('./WorkflowBranchPlanner');

class WorkflowExecutor {
  constructor(catalogService) {
    this.catalogService = catalogService;
    this.transversalComposer = new TransversalWorkflowComposer();
    this.branchPlanner = new WorkflowBranchPlanner(this.transversalComposer);
  }

  isExecutableStep(step) {
    if (!step || !step.actionType) return false;
    if (step.actionType === 'navigation') return Boolean(step.url);
    if (step.actionType === 'click') return Boolean(step.selector);
    if (step.actionType === 'input') return Boolean(step.selector);
    if (step.actionType === 'select') return Boolean(step.selector);
    // Teclas de acción (Enter, etc.): no apuntan a un elemento, van al foco. Basta con la tecla.
    if (step.actionType === 'key') return Boolean(step.value || step.selector);
    return false;
  }

  buildExecutionPlan(workflow, variables = {}, executionIntent = {}) {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) {
      throw new Error(`Workflow ${workflow?.id || 'unknown'} not found or has no steps.`);
    }

    const branchPlan = this.branchPlanner.plan(workflow, variables, workflow.branches || []);
    const executableSteps = branchPlan.steps.filter((step) => this.isExecutableStep(step));
    if (executableSteps.length === 0) {
      throw new Error(`Workflow ${workflow.id} has no executable steps.`);
    }

    return {
      workflowId: workflow.id,
      description: workflow.description || '',
      appId: workflow.appId || '',
      sourceUrl: workflow.sourceUrl || '',
      sourceOrigin: workflow.sourceOrigin || '',
      sourcePathname: workflow.sourcePathname || '',
      sourceTitle: workflow.sourceTitle || '',
      executionGuide: workflow.executionGuide || '',
      variables: { ...variables },
      executionIntent: { ...(executionIntent || {}) },
      runtimeIntelligence: {
        maxCallsPerStep: 5,
        decisions: []
      },
      branchContext: branchPlan.branchContext,
      steps: executableSteps
    };
  }

  async getExecutionPlanById(workflowId, variables = {}, executionIntent = {}, access = null) {
    const workflow = await this.catalogService.getWorkflowById(workflowId, access);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found or has no steps.`);
    }

    return this.buildExecutionPlan(workflow, variables, executionIntent);
  }
}

module.exports = WorkflowExecutor;
