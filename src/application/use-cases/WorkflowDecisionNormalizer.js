class WorkflowDecisionNormalizer {
  normalizeText(value = '') {
    return `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  isFreeTextVariable(variable = {}) {
    const label = this.normalizeText(variable.fieldLabel || variable.prompt || variable.selector || '');
    return [
      'observacion',
      'observaciones',
      'nota',
      'notas',
      'comentario',
      'comentarios',
      'detalle',
      'detalles',
      'instruccion',
      'instrucciones'
    ].some((token) => label.includes(token));
  }

  collectKnownTargets(workflow = {}) {
    const targets = [];
    const seen = new Set();
    const clickSteps = Array.isArray(workflow?.steps) ? workflow.steps : [];

    clickSteps.forEach((step) => {
      if (`${step?.actionType || ''}`.trim().toLowerCase() !== 'click') {
        return;
      }

      const stepOrder = Number(step.stepOrder);
      const options = [
        `${step.semanticTarget || step.label || ''}`.trim(),
        ...(Array.isArray(step?.surfaceHints?.alternativeTargets) ? step.surfaceHints.alternativeTargets : [])
      ];

      options
        .map((value) => `${value || ''}`.trim())
        .filter(Boolean)
        .forEach((value) => {
          const normalized = this.normalizeText(value);
          if (!normalized || seen.has(`${stepOrder}:${normalized}`)) {
            return;
          }
          seen.add(`${stepOrder}:${normalized}`);
          targets.push({
            stepOrder,
            value,
            normalized
          });
        });
    });

    return targets;
  }

  findRequestedTarget(message = '', knownTargets = []) {
    const normalizedMessage = this.normalizeText(message);
    if (!normalizedMessage) {
      return null;
    }

    let best = null;

    knownTargets.forEach((target) => {
      const normalized = target.normalized;
      if (!normalized) {
        return;
      }

      const isExact = normalizedMessage.includes(normalized);
      const isContained = normalized.includes(normalizedMessage) && normalizedMessage.length >= 4;
      const tokenMatch = normalized
        .split(' ')
        .filter((token) => token.length >= 4)
        .some((token) => normalizedMessage.includes(token));

      if (!isExact && !isContained && !tokenMatch) {
        return;
      }

      const score = isExact ? 100 : isContained ? 80 : 60;
      if (!best || score > best.score || (score === best.score && normalized.length > best.target.normalized.length)) {
        best = {
          score,
          target
        };
      }
    });

    return best?.target || null;
  }

  normalizeDecision(decision = {}, workflow = {}, message = '') {
    if (!decision || !workflow || !decision.workflowId || decision.workflowId !== workflow.id) {
      return decision;
    }

    const variables = {
      ...(decision.variables || {})
    };
    const workflowVariables = Array.isArray(workflow.variables) ? workflow.variables : [];
    const clickTargetVariables = workflowVariables.filter((variable) =>
      this.normalizeText(variable.kind) === 'click-target'
    );

    if (clickTargetVariables.length === 0) {
      return {
        ...decision,
        variables
      };
    }

    const knownTargets = this.collectKnownTargets(workflow);
    const requestedTarget = this.findRequestedTarget(message, knownTargets);
    if (!requestedTarget) {
      return {
        ...decision,
        variables
      };
    }

    const targetVariable = clickTargetVariables.find((variable) => Number(variable.sourceStep) === requestedTarget.stepOrder)
      || clickTargetVariables[0];

    if (!targetVariable?.name) {
      return {
        ...decision,
        variables
      };
    }

    variables[targetVariable.name] = requestedTarget.value;

    workflowVariables
      .filter((variable) => this.isFreeTextVariable(variable))
      .forEach((variable) => {
        const currentValue = `${variables[variable.name] || ''}`.trim();
        if (!currentValue) {
          return;
        }

        const normalizedCurrent = this.normalizeText(currentValue);
        if (
          normalizedCurrent === requestedTarget.normalized
          || requestedTarget.normalized.includes(normalizedCurrent)
          || normalizedCurrent.includes(requestedTarget.normalized)
        ) {
          delete variables[variable.name];
        }
      });

    return {
      ...decision,
      variables
    };
  }
}

module.exports = WorkflowDecisionNormalizer;
