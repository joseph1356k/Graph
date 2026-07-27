const TransversalWorkflowComposer = require('./TransversalWorkflowComposer');
const WorkflowBranchPlanner = require('./WorkflowBranchPlanner');

class WorkflowExecutor {
  constructor(catalogService, dynamicValueResolver = null) {
    this.catalogService = catalogService;
    this.transversalComposer = new TransversalWorkflowComposer();
    this.branchPlanner = new WorkflowBranchPlanner(this.transversalComposer);
    // Resuelve valores por-ejecución para steps valueMode='dynamic' a partir de variables.context.
    // Opcional: sin resolver (o sin contexto) el plan sale con los valores grabados, como siempre.
    this.dynamicValueResolver = dynamicValueResolver;
  }

  isExecutableStep(step) {
    if (!step || !step.actionType) return false;
    if (step.actionType === 'navigation') return Boolean(step.url);
    if (step.actionType === 'click') return Boolean(step.selector);
    if (step.actionType === 'input') return Boolean(step.selector);
    if (step.actionType === 'select') return Boolean(step.selector);
    // Teclas de acción (Enter, etc.): no apuntan a un elemento, van al foco. Basta con la tecla.
    if (step.actionType === 'key') return Boolean(step.value || step.selector);
    // Scroll: la rueda hasta un punto. El selector lleva la posición del panel; el value, el delta.
    if (step.actionType === 'scroll') return Boolean(step.value || step.selector);
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

    const plan = this.buildExecutionPlan(workflow, variables, executionIntent);
    return this.applyDynamicValues(plan, variables);
  }

  // ── Sustitución dinámica ──────────────────────────────────────────────────
  // Convierte el `context` de ESTA ejecución ("paciente Juan Pérez, documento 12345678") en los
  // valores de los steps valueMode='dynamic'. Tres decisiones deliberadas:
  //
  //   1. Sin contexto NO pasa nada: el plan sale con los valores grabados (retrocompatible con el
  //      botón "Ejecutar ahora" y con todos los workflows existentes).
  //   2. Con contexto, un dynamic sin valor resuelto HACE FALLAR el plan, con la lista de campos
  //      que faltan. Reproducir el valor grabado ahí sería crear al paciente equivocado en
  //      silencio — el error le permite al agente pedirle el dato al usuario.
  //   3. bindTo comparte valor: dos steps atados a la misma variable ("documento" escrito en dos
  //      pantallas) reciben el mismo valor aunque el LLM solo lo haya resuelto para uno.
  async applyDynamicValues(plan, variables = {}) {
    const context = `${variables?.context || ''}`.trim();
    if (!context) return plan;

    const dynamicSteps = plan.steps.filter((step) => step.valueMode === 'dynamic');
    if (dynamicSteps.length === 0) return plan;

    if (!this.dynamicValueResolver) {
      throw new Error(
        'El workflow tiene campos dinámicos y llegó contexto, pero el backend no tiene ' +
        'configurado el resolvedor de valores (LLM).'
      );
    }

    const { values } = await this.dynamicValueResolver.resolve({ context, steps: dynamicSteps });

    // Consistencia por bindTo: el valor resuelto para una variable aplica a todos sus steps.
    const byBind = new Map();
    for (const step of dynamicSteps) {
      const value = values[step.stepOrder];
      if (value != null && step.bindTo) byBind.set(step.bindTo, value);
    }

    const missing = [];
    const steps = plan.steps.map((step) => {
      if (step.valueMode !== 'dynamic') return step;

      let value = values[step.stepOrder];
      if (value == null && step.bindTo && byBind.has(step.bindTo)) value = byBind.get(step.bindTo);
      if (value == null) {
        missing.push(step.label || step.selector || `paso ${step.stepOrder}`);
        return step;
      }

      // Copia, no mutación: el workflow cacheado no debe quedar con valores de esta ejecución.
      const next = Object.assign(Object.create(Object.getPrototypeOf(step)), step);
      if (step.actionType === 'select') {
        next.selectedValue = value;
        const option = (step.allowedOptions || []).find((o) => `${o?.value}` === value);
        if (option) next.selectedLabel = option.label || option.text || next.selectedLabel;
      } else {
        next.value = value;
      }
      return next;
    });

    if (missing.length > 0) {
      throw new Error(
        `No pude resolver del contexto los campos dinámicos: ${missing.map((m) => `«${m}»`).join(', ')}. ` +
        'Incluye esos datos en la petición.'
      );
    }

    return { ...plan, steps };
  }
}

module.exports = WorkflowExecutor;
