const runtimeExecutionPolicy = require('./RuntimeExecutionPolicy');

class ExecutionIntelligenceService {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  parseDecision(content = '') {
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    return this.normalizeDecision(parsed);
  }

  normalizeDecision(decision = {}) {
    const allowedActions = new Set(['continue', 'patch_step', 'skip_step', 'retry_step', 'ask_user', 'abort']);
    const action = allowedActions.has(`${decision.action || ''}`.trim())
      ? `${decision.action || ''}`.trim()
      : 'continue';

    const stepPatches = Array.isArray(decision.stepPatches)
      ? decision.stepPatches.filter((patch) => patch && typeof patch === 'object')
      : [];
    if (decision.stepPatch && typeof decision.stepPatch === 'object') {
      stepPatches.unshift(decision.stepPatch);
    }

    return {
      action,
      reason: `${decision.reason || ''}`.trim(),
      userMessage: `${decision.userMessage || ''}`.trim(),
      variablePatch: decision.variablePatch && typeof decision.variablePatch === 'object' && !Array.isArray(decision.variablePatch)
        ? decision.variablePatch
        : {},
      stepPatches,
      skipStepOrders: Array.isArray(decision.skipStepOrders)
        ? decision.skipStepOrders.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [],
      retry: Boolean(decision.retry || action === 'retry_step')
    };
  }

  buildFallbackDecision(payload = {}) {
    const reason = `${payload.reason || ''}`.trim();
    if (reason === 'element_not_found') {
      return {
        action: 'abort',
        reason: 'runtime intelligence unavailable for missing element',
        userMessage: 'No pude encontrar el siguiente elemento necesario en esta pagina.',
        variablePatch: {},
        stepPatches: [],
        skipStepOrders: [],
        retry: false
      };
    }

    return {
      action: 'continue',
      reason: 'runtime intelligence unavailable; keep learned path',
      userMessage: '',
      variablePatch: {},
      stepPatches: [],
      skipStepOrders: [],
      retry: false
    };
  }

  normalizeText(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  findAllowedOption(variable = {}, value = '') {
    const normalizedValue = this.normalizeText(value);
    if (!normalizedValue || !Array.isArray(variable.allowedOptions)) {
      return null;
    }

    return variable.allowedOptions.find((option) => {
      const optionValue = this.normalizeText(option?.value || '');
      const optionLabel = this.normalizeText(option?.label || option?.text || '');
      return optionValue === normalizedValue || optionLabel === normalizedValue;
    }) || null;
  }

  scoreVariableForStep(variable = {}, currentStep = {}, activeVariables = {}) {
    if (!variable?.name) {
      return 0;
    }

    let score = 0;
    const directName = currentStep?.stepOrder ? 'input_' + currentStep.stepOrder : '';
    const variableValue = activeVariables?.[variable.name];
    const hasActiveValue = Object.prototype.hasOwnProperty.call(activeVariables || {}, variable.name)
      && String(variableValue || '').trim();

    if (variable.name === directName) score += 70;
    if (Number(variable.sourceStep) === Number(currentStep?.stepOrder)) score += 60;
    if (variable.selector && currentStep?.selector && variable.selector === currentStep.selector) score += 90;
    if (this.normalizeText(variable.fieldLabel) && this.normalizeText(variable.fieldLabel) === this.normalizeText(currentStep?.label)) score += 50;
    if (variable.actionType && currentStep?.actionType && variable.actionType === currentStep.actionType) score += 20;
    if (variable.controlType && currentStep?.controlType && variable.controlType === currentStep.controlType) score += 20;
    if (hasActiveValue) score += 40;

    return score;
  }

  buildStepVariableContext(workflowVariables = [], currentStep = {}, activeVariables = {}) {
    const directName = currentStep?.stepOrder ? 'input_' + currentStep.stepOrder : '';
    const candidates = workflowVariables
      .map((variable) => {
        const score = this.scoreVariableForStep(variable, currentStep, activeVariables);
        const value = activeVariables?.[variable?.name];
        const hasValue = Object.prototype.hasOwnProperty.call(activeVariables || {}, variable?.name)
          && String(value || '').trim();
        if (score <= 0 || (!hasValue && variable?.name !== directName)) {
          return null;
        }

        return {
          name: variable.name,
          value,
          matchedAllowedOption: this.findAllowedOption(variable, value),
          metadata: variable,
          score
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);

    if (candidates.length > 0) {
      return {
        primary: candidates[0],
        candidates
      };
    }

    return {
      primary: directName
        ? {
            name: directName,
            value: activeVariables?.[directName],
            matchedAllowedOption: null,
            metadata: workflowVariables.find((variable) => variable?.name === directName) || null,
            score: 0
          }
        : null,
      candidates: []
    };
  }

  buildMessages(workflow = {}, payload = {}) {
    const currentStep = payload.currentStep || null;
    const nextSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
    const workflowVariables = Array.isArray(workflow.variables) ? workflow.variables : [];
    const stepVariableContext = this.buildStepVariableContext(workflowVariables, currentStep, payload.variables || {});
    const stepVariable = stepVariableContext.primary;

    const messagePayload = {
      reason: payload.reason || '',
      trigger: payload.trigger || '',
      authorityOrder: [
        'currentPage',
        'currentExecutionIntent',
        'learnedWorkflowMemory'
      ],
      currentPage: {
        url: payload.currentUrl || '',
        pageSnapshot: payload.pageSnapshot || {}
      },
      currentExecutionIntent: {
        userMessage: payload.executionIntent?.userMessage || '',
        assistantReply: payload.executionIntent?.assistantReply || '',
        stepIndex: payload.stepIndex,
        currentStep,
        nextSteps,
        variables: payload.variables || {},
        stepVariable,
        stepVariableCandidates: stepVariableContext.candidates,
        failure: payload.failure || null,
        previousRuntimeDecisions: payload.previousRuntimeDecisions || []
      },
      learnedWorkflowMemory: {
        id: workflow.id || payload.workflowId || '',
        description: workflow.description || '',
        summary: workflow.summary || '',
        executionGuide: workflow.executionGuide || payload.executionGuide || '',
        variables: workflowVariables,
        currentStep,
        nextSteps
      }
    };

    return [
      {
        role: 'system',
        content: runtimeExecutionPolicy.buildRuntimeDecisionPrompt()
      },
      {
        role: 'user',
        content: JSON.stringify(messagePayload)
      }
    ];
  }

  async decide(workflow = {}, payload = {}) {
    if (!this.hasLlm()) {
      return this.buildFallbackDecision(payload);
    }

    try {
      const content = await this.llmProvider.chatExpectingJson(
        this.buildMessages(workflow, payload),
        { type: 'json_object' }
      );
      return this.parseDecision(content);
    } catch (error) {
      return {
        ...this.buildFallbackDecision(payload),
        reason: `runtime intelligence failed: ${error.message || 'unknown error'}`
      };
    }
  }
}

module.exports = ExecutionIntelligenceService;
