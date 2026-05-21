const TransversalWorkflowComposer = require('./TransversalWorkflowComposer');

class WorkflowExecutor {
  constructor(catalogService, runner, llmProvider) {
    this.catalogService = catalogService;
    this.runner = runner; // Expects an object with an `executeWorkflow` method
    this.llmProvider = llmProvider;
    this.transversalComposer = new TransversalWorkflowComposer();
  }

  defaultSelectChoices(selects) {
    return selects.map((select) => ({
      field: select.testid || select.id || select.name || 'select',
      value: select.options.find((option) => option.value)?.value || ''
    }));
  }

  isExecutableStep(step) {
    if (!step || !step.actionType) return false;
    if (step.actionType === 'navigation') return Boolean(step.url);
    if (step.actionType === 'click') return Boolean(step.selector);
    if (step.actionType === 'input') return Boolean(step.selector);
    if (step.actionType === 'select') return Boolean(step.selector);
    return false;
  }

  buildExecutionPlan(workflow, variables = {}) {
    if (!workflow || !workflow.steps || workflow.steps.length === 0) {
      throw new Error(`Workflow ${workflow?.id || 'unknown'} not found or has no steps.`);
    }

    const executableSteps = this.transversalComposer
      .composeSteps(workflow.steps, variables)
      .filter((step) => this.isExecutableStep(step));
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
      variables: { ...variables },
      steps: executableSteps
    };
  }

  async getExecutionPlanById(workflowId, variables = {}) {
    const workflow = await this.catalogService.getWorkflowById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found or has no steps.`);
    }

    return this.buildExecutionPlan(workflow, variables);
  }

  async chooseDynamicOptions(selects, context = {}) {
    if (!Array.isArray(selects) || selects.length === 0) {
      return [];
    }

    if (!this.llmProvider || typeof this.llmProvider.hasApiKey !== 'function' || !this.llmProvider.hasApiKey()) {
      return this.defaultSelectChoices(selects);
    }

    const messages = [
      {
        role: 'system',
        content: [
          'You choose values for UI select fields during agent workflow execution.',
          'Return JSON only.',
          'The JSON must be an object with a single key "choices" which is an array of objects.',
          'Each object in the "choices" array must have keys: field and value.',
          'field must match the provided field identifier exactly.',
          'value must be exactly one of that field allowed option values.',
          'Use the field label and option labels to infer the best value semantically.',
          'Prefer choices that make the workflow coherent.',
          'Do not default to the first option unless it is semantically the best match.',
          'Never invent values outside the allowed options.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          context,
          selects: selects.map((select) => ({
            field: select.testid || select.id || select.name || 'select',
            label: select.label || '',
            currentValue: select.value || '',
            options: select.options.map((option) => ({
              value: option.value,
              label: option.label || option.text || option.value,
              text: option.text || ''
            }))
          }))
        })
      }
    ];

    let content;
    try {
      content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
      console.log('[DEBUG] LLM dynamic options raw response:', content);
    } catch (error) {
      console.warn(`[DEBUG] LLM select choice fallback to defaults: ${error.message}`);
      return this.defaultSelectChoices(selects);
    }
    
    let parsed;
    try {
      parsed = this.llmProvider.parseJsonObject(content);
    } catch (e) {
      console.warn(`[DEBUG] Failed to parse JSON: ${e.message}`);
      return this.defaultSelectChoices(selects);
    }

    let rawChoices = Array.isArray(parsed) ? parsed : (parsed.choices || parsed.fields || parsed.selects);
    
    if (!Array.isArray(rawChoices)) {
      // Fallback: If the LLM returned a key-value mapping directly
      const keys = Object.keys(parsed);
      if (keys.length > 0 && typeof parsed[keys[0]] === 'string') {
        rawChoices = keys.map(key => ({ field: key, value: parsed[key] }));
      } else {
        console.warn(`[DEBUG] Parsed JSON does not contain an array of choices. Parsed:`, parsed);
        return this.defaultSelectChoices(selects);
      }
    }

    return rawChoices;
  }

  async executeById(workflowId, variables = {}) {
    const plan = await this.getExecutionPlanById(workflowId, variables);
    const executableSteps = plan.steps;

    console.log(`\x1b[33mActivating Workflow: ${workflowId}\x1b[0m`);
    
    // Inject the dynamic option chooser into the runner
    await this.runner.executeWorkflow(executableSteps, variables, { 
      workflowId, 
      optionGuesser: this.chooseDynamicOptions.bind(this) 
    });
    return `Workflow ${workflowId} executed successfully.`;
  }
}

module.exports = WorkflowExecutor;
