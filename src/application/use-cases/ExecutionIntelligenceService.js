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

  buildMessages(workflow = {}, payload = {}) {
    const currentStep = payload.currentStep || null;
    const nextSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
    const workflowVariables = Array.isArray(workflow.variables) ? workflow.variables : [];
    const stepVariableName = currentStep?.stepOrder ? 'input_' + currentStep.stepOrder : '';
    const stepVariable = stepVariableName
      ? {
          name: stepVariableName,
          value: payload.variables?.[stepVariableName],
          metadata: workflowVariables.find((variable) => variable?.name === stepVariableName) || null
        }
      : null;

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
        stepIndex: payload.stepIndex,
        currentStep,
        nextSteps,
        variables: payload.variables || {},
        stepVariable,
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
