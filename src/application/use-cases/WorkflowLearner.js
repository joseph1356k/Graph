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

  normalizeAccess(access = null) {
    if (!access || typeof access !== 'object') {
      return { ownerId: '', includeGlobal: true };
    }
    return {
      ownerId: `${access.ownerId || ''}`.trim(),
      includeGlobal: access.includeGlobal !== false
    };
  }

  async assertMutableWorkflow(workflowId, access = null) {
    const normalized = this.normalizeAccess(access);
    if (!normalized.ownerId) {
      return;
    }
    const rows = await this.repository.getWorkflowRows(workflowId, {
      ownerId: normalized.ownerId,
      includeGlobal: false
    });
    const workflow = rows[0] || null;
    if (!workflow || `${workflow.scope || 'private'}`.trim() === 'global') {
      throw new Error('Workflow not found');
    }
  }

  async startSession(description, context = {}, options = {}) {
    const id = `wf_${Date.now()}`;
    const access = options.access || null;
    const normalized = this.normalizeAccess(access);
    const ownedContext = normalized.ownerId
      ? { ...(context || {}), scope: 'private', ownerId: normalized.ownerId }
      : context;
    await this.repository.startWorkflow(id, description || 'Untitled workflow', ownedContext, access);
    return id;
  }

  async recordStep(workflowId, stepData, options = {}) {
    if (!workflowId) throw new Error('No active workflow');
    await this.assertMutableWorkflow(workflowId, options.access || null);
    const Step = require('../../domain/entities/Step');
    const step = new Step(stepData);
    if (!step.actionType || step.actionType === 'unknown') throw new Error('Step requires actionType');

    const nextStepOrder = (await this.repository.getStepCount(workflowId, options.access || null)) + 1;
    step.stepOrder = nextStepOrder;
    await this.repository.addStep(workflowId, step, nextStepOrder, options.access || null);
    return nextStepOrder;
  }

  async addContextNote(workflowId, note, options = {}) {
    if (!workflowId) throw new Error('No active workflow');
    if (!note || typeof note !== 'object') throw new Error('Context note is required');
    await this.assertMutableWorkflow(workflowId, options.access || null);
    await this.repository.addContextNote(workflowId, note, options.access || null);
  }

  async finishSession(workflowId, options = {}) {
    if (!workflowId) throw new Error('No active workflow');
    await this.assertMutableWorkflow(workflowId, options.access || null);

    const steps = await this.repository.getWorkflowSteps(workflowId, options.access || null);
    const initialDesc = await this.repository.getWorkflowDescription(workflowId, options.access || null);
    const workflow = new Workflow({
      id: workflowId,
      description: initialDesc,
      steps
    });

    // Título, summary y clasificación de valueMode salen de UNA llamada JSON
    // (describeWorkflow); la guía de ejecución es el draft determinístico.
    // Fail-safe: sin modelo o con error, summary determinístico, sin título y
    // cada step 'fixed' (comportamiento de siempre).
    let described = this.executionGuideBuilder.fallbackDescription(workflow.toJSON());
    try {
      described = await this.executionGuideBuilder.describeWorkflow(workflow.toJSON());
    } catch (err) {
      console.warn(`[WorkflowLearner] LLM Warning: ${err.message}`);
    }
    const summary = described.summary || initialDesc;
    const executionGuide = this.executionGuideBuilder.buildDraft(summary || initialDesc, workflow.steps || []);

    // El modelo clasifica cómo debe coincidir el valor de cada step al reejecutar (fixed/dynamic/flexible):
    // así el workflow generaliza (ej. "la pestaña nueva" = flexible, no la exacta grabada). Ver doc
    // coincidencia-superficie-estado.
    try {
      if (described.valueModes.length && typeof this.repository.setStepValueModes === 'function') {
        await this.repository.setStepValueModes(workflowId, described.valueModes, options.access || null);
      }
    } catch (err) {
      console.warn(`[WorkflowLearner] valueMode classify: ${err.message}`);
    }

    // Título automático: si se enseñó sin título (placeholder del recorder o vacío), el título lo da el
    // modelo en la misma llamada; si no lo dio, la primera frase del summary. Así "Enseñar" es
    // plug-and-play, sin pedir título.
    const desc = `${initialDesc || ''}`.trim();
    const isPlaceholder = desc === '' || desc.toLowerCase() === 'workflow sin descripción';
    const autoTitle = isPlaceholder
      ? (described.title || `${summary || ''}`.split(/[.\n]/)[0].trim().slice(0, 80) || null)
      : null;

    await this.repository.completeWorkflow(workflowId, summary, executionGuide, options.access || null, autoTitle);

    // Rebuild catalog
    if (this.catalogService && this.catalogWriter) {
      await this.catalogService.rebuildCatalogFile(options.access || null);
    }

    return summary;
  }
}

module.exports = WorkflowLearner;
