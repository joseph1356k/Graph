const Step = require('./Step');

class Workflow {
  constructor(data = {}) {
    this.id = data.id;
    this.description = data.description || '';
    this.summary = data.summary || '';
    this.executionGuide = data.executionGuide || '';
    this.status = data.status || 'draft';
    this.scope = data.scope || (data.ownerId ? 'private' : 'global');
    this.ownerId = data.ownerId || '';
    this.appId = data.appId || '';
    this.sourceUrl = data.sourceUrl || '';
    this.sourceOrigin = data.sourceOrigin || '';
    this.sourcePathname = data.sourcePathname || '';
    this.sourceTitle = data.sourceTitle || '';
    this.contextNotes = Array.isArray(data.contextNotes) ? data.contextNotes : [];
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.completedAt = data.completedAt;
    this.publishedFromWorkflowId = data.publishedFromWorkflowId || '';
    this.publishedByOwnerId = data.publishedByOwnerId || '';
    this.publishedAt = data.publishedAt;
    this.steps = Array.isArray(data.steps) ? data.steps.map(s => new Step(s)) : [];
  }

  get variables() {
    return this.inferVariables();
  }

  get totalSteps() {
    return this.steps.length;
  }

  inferVariables() {
    const variableMap = new Map();

    for (const step of this.steps) {
      const isTransversalClickStep = this.isTransversalClickStep(step);
      const isSelectableField = step.actionType === 'select' && Array.isArray(step.allowedOptions) && step.allowedOptions.length > 0;
      if (!['input', 'select'].includes(step.actionType) && !isTransversalClickStep) continue;
      if (!step.value && !isSelectableField && !isTransversalClickStep) continue;
      
      const variableName = isTransversalClickStep
        ? `target_${step.stepOrder}`
        : `input_${step.stepOrder}`;
      const optionPairs = step.controlType === 'select' && Array.isArray(step.allowedOptions) && step.allowedOptions.length > 0
        ? step.allowedOptions
            .filter((option) => option.value)
            .map((option) => `${option.value} = ${option.label || option.text || option.value}`)
        : [];
      const optionSummary = step.controlType === 'select' && Array.isArray(step.allowedOptions) && step.allowedOptions.length > 0
        ? ` Allowed options: ${optionPairs.join('; ')}.`
        : '';
      const controlHint = step.controlType === 'select'
        ? ' Choose the exact option value whose meaning best matches the request.'
        : '';
      const clickTargetHint = isTransversalClickStep
        ? ' This is a visible target on the page that can be replaced by another similar visible entity when the same workflow pattern still applies.'
        : '';
      const alternativeTargets = isTransversalClickStep && Array.isArray(step.surfaceHints?.alternativeTargets)
        ? step.surfaceHints.alternativeTargets
            .map((value) => `${value || ''}`.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
      const alternativeHint = alternativeTargets.length > 0
        ? ` Similar visible alternatives seen during learning: ${alternativeTargets.join('; ')}.`
        : '';
      const fallbackPrompt = step.controlType === 'select' && !step.value
        ? `Choose a value for ${step.label || step.selector || `step ${step.stepOrder}`}.`
        : isTransversalClickStep
          ? `Visible target to activate for ${step.semanticTarget || step.label || step.selector || `step ${step.stepOrder}`}.`
          : `Value for ${step.label || step.selector || `step ${step.stepOrder}`}`;
      
      variableMap.set(variableName, {
        name: variableName,
        selector: step.selector,
        controlType: step.controlType || '',
        actionType: step.actionType,
        kind: isTransversalClickStep ? 'click-target' : 'field-value',
        sourceStep: step.stepOrder,
        defaultValue: isTransversalClickStep ? (step.semanticTarget || step.label || '') : step.value,
        fieldLabel: step.semanticTarget || step.label || '',
        selectedLabel: step.selectedLabel || '',
        allowedOptions: step.allowedOptions,
        prompt: `${step.explanation || fallbackPrompt}${optionSummary}${controlHint}${clickTargetHint}${alternativeHint}`.trim()
      });
    }

    return Array.from(variableMap.values());
  }

  isTransversalClickStep(step) {
    if (!step || step.actionType !== 'click') {
      return false;
    }

    const semanticTarget = `${step.semanticTarget || ''}`.trim();
    if (!semanticTarget) {
      return false;
    }

    const normalized = semanticTarget
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!normalized || normalized.length < 4) {
      return false;
    }

    const genericTargets = [
      'ver mas',
      'ver más',
      'detalle',
      'detalles',
      'comprar',
      'agregar',
      'agregar al carrito',
      'anadir al carrito',
      'añadir al carrito',
      'continuar',
      'siguiente',
      'abrir',
      'seleccionar'
    ];

    return !genericTargets.some((token) => normalized === token || normalized.includes(token));
  }

  toJSON() {
    return {
      id: this.id,
      description: this.description,
      summary: this.summary,
      executionGuide: this.executionGuide,
      status: this.status,
      scope: this.scope,
      ownerId: this.ownerId,
      appId: this.appId,
      sourceUrl: this.sourceUrl,
      sourceOrigin: this.sourceOrigin,
      sourcePathname: this.sourcePathname,
      sourceTitle: this.sourceTitle,
      contextNotes: this.contextNotes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
      publishedFromWorkflowId: this.publishedFromWorkflowId,
      publishedByOwnerId: this.publishedByOwnerId,
      publishedAt: this.publishedAt,
      steps: this.steps,
      variables: this.variables,
      totalSteps: this.totalSteps
    };
  }
}

module.exports = Workflow;
