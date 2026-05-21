const Workflow = require('../../domain/entities/Workflow');
const WorkflowExecutionGuideBuilder = require('./WorkflowExecutionGuideBuilder');

class WorkflowLearner {
  constructor(repository, llmProvider, catalogWriter, catalogService) {
    this.repository = repository;
    this.llmProvider = llmProvider;
    this.catalogWriter = catalogWriter;
    this.catalogService = catalogService; // To rebuild catalog after stopping
    this.executionGuideBuilder = new WorkflowExecutionGuideBuilder(llmProvider);
  }

  async startSession(description, context = {}) {
    const id = `wf_${Date.now()}`;
    await this.repository.startWorkflow(id, description || 'Untitled workflow', context);
    return id;
  }

  async recordStep(workflowId, stepData) {
    if (!workflowId) throw new Error('No active workflow');
    const Step = require('../../domain/entities/Step');
    const step = new Step(stepData);
    if (!step.actionType || step.actionType === 'unknown') throw new Error('Step requires actionType');

    const nextStepOrder = (await this.repository.getStepCount(workflowId)) + 1;
    step.stepOrder = nextStepOrder;
    await this.repository.addStep(workflowId, step, nextStepOrder);
    return nextStepOrder;
  }

  async addContextNote(workflowId, note) {
    if (!workflowId) throw new Error('No active workflow');
    if (!note || typeof note !== 'object') throw new Error('Context note is required');
    await this.repository.addContextNote(workflowId, note);
  }

  async finishSession(workflowId) {
    if (!workflowId) throw new Error('No active workflow');

    const steps = await this.repository.getWorkflowSteps(workflowId);
    const initialDesc = await this.repository.getWorkflowDescription(workflowId);
    const workflow = new Workflow({
      id: workflowId,
      description: initialDesc,
      steps
    });

    let summary = initialDesc;
    let executionGuide = '';
    try {
      if (!this.llmProvider.hasApiKey()) {
        const firstActions = steps
          .slice(0, 3)
          .map((step) => `${step.actionType} ${step.selector || step.url || ''}`.trim())
          .join(', ');
        summary = `${initialDesc}. Steps: ${firstActions || 'No recorded steps.'}`;
      } else {
        const messages = [
          {
            role: 'system',
            content: 'Summarize a user navigation workflow for a technical log. Use the initial description and the steps provided. Keep it concise but clear.'
          },
          { role: 'user', content: `Initial Description: ${initialDesc}\nSteps: ${JSON.stringify(steps)}` }
        ];
        summary = await this.llmProvider.chat(messages);
      }

      executionGuide = await this.executionGuideBuilder.buildGuide({
        ...workflow.toJSON(),
        summary
      });
    } catch (err) {
      console.warn(`[WorkflowLearner] LLM Warning: ${err.message}`);
    }

    if (!executionGuide) {
      executionGuide = this.executionGuideBuilder.buildDraft(summary || initialDesc, workflow.steps || []);
    }

    await this.repository.completeWorkflow(workflowId, summary, executionGuide);

    // Rebuild catalog
    if (this.catalogService && this.catalogWriter) {
      const catalog = await this.catalogService.getCatalog();
      this.catalogWriter.writeCatalog(catalog);
    }

    return summary;
  }
}

module.exports = WorkflowLearner;
