class TransversalWorkflowComposer {
  normalizeText(value = '') {
    return `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  getTargetVariableName(step = {}) {
    return `target_${step.stepOrder}`;
  }

  getBaselineTarget(step = {}) {
    return `${step.semanticTarget || step.label || ''}`.trim();
  }

  getRequestedTarget(step = {}, variables = {}) {
    const key = this.getTargetVariableName(step);
    return `${variables?.[key] || ''}`.trim();
  }

  hasTargetOverride(step = {}, variables = {}) {
    if (`${step.actionType || ''}`.trim().toLowerCase() !== 'click') {
      return false;
    }

    const requested = this.getRequestedTarget(step, variables);
    if (!requested) {
      return false;
    }

    const baseline = this.getBaselineTarget(step);
    if (!baseline) {
      return false;
    }

    return this.normalizeText(requested) !== this.normalizeText(baseline);
  }

  composeSteps(steps = [], variables = {}) {
    return (Array.isArray(steps) ? steps : []).map((step) => {
      if (!this.hasTargetOverride(step, variables)) {
        return { ...step };
      }

      return {
        ...step,
        transversalTarget: this.getRequestedTarget(step, variables),
        transversalSourceTarget: this.getBaselineTarget(step)
      };
    });
  }
}

module.exports = TransversalWorkflowComposer;
