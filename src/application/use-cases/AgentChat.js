const workflowAssistantPolicy = require('./WorkflowAssistantPolicy');
const WorkflowDecisionNormalizer = require('./WorkflowDecisionNormalizer');

class AgentChat {
  constructor(llmProvider, catalogService, executor) {
    this.llmProvider = llmProvider;
    this.catalogService = catalogService;
    this.executor = executor;
    this.decisionNormalizer = new WorkflowDecisionNormalizer();
  }

  wantsInventedValues(message = '', history = []) {
    const combined = [
      ...history.map((item) => item?.content || ''),
      message || ''
    ].join(' ').toLowerCase();

    return [
      'inventa',
      'inventalo',
      'invéntalo',
      'inventa todo',
      'usa datos falsos',
      'datos falsos',
      'es una prueba',
      'no me preguntes',
      'no te voy a dar',
      'rellena tu',
      'rellénalo tú',
      'hazlo tu',
      'hazlo tú'
    ].some((token) => combined.includes(token));
  }

  pickWorkflowForInventedExecution(workflows = [], decision = {}, message = '') {
    if (!Array.isArray(workflows) || workflows.length === 0) {
      return null;
    }

    if (decision?.workflowId) {
      const exact = workflows.find((workflow) => workflow.id === decision.workflowId);
      if (exact) {
        return exact;
      }
    }

    const lowerMessage = `${message || ''}`.toLowerCase();
    const matched = workflows.find((workflow) =>
      `${workflow.id || ''} ${workflow.description || ''} ${workflow.summary || ''}`.toLowerCase().includes(lowerMessage)
    );

    return matched || workflows[0];
  }

  buildSyntheticValue(variable = {}, index = 0) {
    if (`${variable.kind || ''}`.trim().toLowerCase() === 'click-target' && `${variable.defaultValue || ''}`.trim()) {
      return `${variable.defaultValue || ''}`.trim();
    }

    const label = `${variable.fieldLabel || variable.prompt || variable.selector || ''}`.toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOffset = label.includes('hasta') || label.includes('return') ? 2 : 1;
    const baseDate = new Date(today);
    baseDate.setDate(today.getDate() + dayOffset + Math.floor(index / 8));
    const isoDate = baseDate.toISOString().slice(0, 10);

    if (label.includes('mail') || label.includes('correo') || label.includes('email')) {
      return `prueba.graph.${index + 1}@example.com`;
    }
    if (label.includes('fecha de nacimiento') || label.includes('birth')) {
      return '1994-08-17';
    }
    if (label.includes('fecha') || label.includes('desde') || label.includes('hasta') || label.includes('pickup') || label.includes('return')) {
      return isoDate;
    }
    if (label.includes('telefono') || label.includes('whatsapp') || label.includes('phone') || label.includes('cel')) {
      return '+573001112233';
    }
    if (label.includes('documento') || label.includes('cedula') || label.includes('passport') || label.includes('ident')) {
      return `90000${String(100 + index)}`;
    }
    if (label.includes('nombre')) {
      return index % 2 === 0 ? 'Alex' : 'Jordan';
    }
    if (label.includes('apellido')) {
      return 'Prueba';
    }
    if (label.includes('ciudad')) {
      return 'Medellin';
    }
    if (label.includes('nacionalidad')) {
      return 'Colombiana';
    }
    if (label.includes('direccion') || label.includes('dirección')) {
      return 'Calle 10 # 43A-25';
    }
    if (label.includes('comentario') || label.includes('requerimiento')) {
      return 'Prueba automatizada con un pasajero, dos maletas y preferencia por Mercedes.';
    }
    if (label.includes('aerolinea')) {
      return 'Avianca';
    }
    if (label.includes('vuelo')) {
      return 'AV9543';
    }
    if (label.includes('reserva')) {
      return 'PRUEBA123';
    }

    return `prueba-${index + 1}`;
  }

  buildInventedVariables(workflow, existingVariables = {}) {
    const output = { ...(existingVariables || {}) };
    const variables = Array.isArray(workflow?.variables) ? workflow.variables : [];

    for (let index = 0; index < variables.length; index += 1) {
      const variable = variables[index];
      if (!variable?.name || Object.prototype.hasOwnProperty.call(output, variable.name)) {
        continue;
      }

      const allowedOptions = Array.isArray(variable.allowedOptions)
        ? variable.allowedOptions.filter((option) => option && option.value)
        : [];

      if (`${variable.defaultValue || ''}`.trim()) {
        output[variable.name] = variable.defaultValue;
        continue;
      }

      if (allowedOptions.length > 0) {
        output[variable.name] = allowedOptions[0].value;
        continue;
      }

      output[variable.name] = this.buildSyntheticValue(variable, index);
    }

    return output;
  }

  normalizePathname(value = '') {
    let pathname = `${value || ''}`.trim();
    if (!pathname) {
      return '';
    }

    pathname = pathname
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/{2,}/g, '/');

    if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }

    if (pathname.toLowerCase().endsWith('/index.html')) {
      pathname = pathname.slice(0, -'/index.html'.length) || '/';
    }

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return pathname || '/';
  }

  filterWorkflowsForContext(workflows, context = {}) {
    if (!Array.isArray(workflows) || workflows.length === 0) {
      return [];
    }

    const appId = `${context.appId || ''}`.trim();
    const sourceOrigin = `${context.sourceOrigin || ''}`.trim();
    const sourcePathname = this.normalizePathname(context.sourcePathname || '');
    if (appId) {
      const byAppId = workflows.filter((workflow) => `${workflow.appId || ''}`.trim() === appId);
      const byOrigin = sourceOrigin
        ? byAppId.filter((workflow) => `${workflow.sourceOrigin || ''}`.trim() === sourceOrigin)
        : byAppId;
      if (!sourcePathname) {
        return byOrigin;
      }

      const byPath = byOrigin.filter(
        (workflow) => this.normalizePathname(workflow.sourcePathname || '') === sourcePathname
      );
      return byPath.length > 0 ? byPath : byOrigin;
    }

    if (sourceOrigin) {
      const byOrigin = workflows.filter((workflow) => `${workflow.sourceOrigin || ''}`.trim() === sourceOrigin);
      if (sourcePathname) {
        const byPath = byOrigin.filter(
          (workflow) => this.normalizePathname(workflow.sourcePathname || '') === sourcePathname
        );
        return byPath.length > 0 ? byPath : byOrigin;
      }
      return byOrigin;
    }

    if (sourcePathname) {
      const byPath = workflows.filter(
        (workflow) => this.normalizePathname(workflow.sourcePathname || '') === sourcePathname
      );
      return byPath;
    }

    return workflows;
  }

  isDemoAutopilotContext(context = {}) {
    return workflowAssistantPolicy.isDemoAutopilotContext(context);
  }

  wantsImmediateDemoExecution(message = '', history = []) {
    const combined = [
      ...history.map((item) => item?.content || ''),
      message || ''
    ].join(' ').toLowerCase();

    return [
      'reserva',
      'reservar',
      'haz la reserva',
      'hazme la reserva',
      'hazlo',
      'cotiza',
      'cotizacion',
      'cotíz',
      'separa el carro',
      'apartalo',
      'apártalo',
      'quiero ese',
      'quiero este',
      'me lo llevo',
      'dale',
      'continua',
      'continua',
      'sigue'
    ].some((token) => combined.includes(token));
  }

  buildDemoAutopilotDecision(workflows = [], message = '', history = []) {
    const chosenWorkflow = this.pickWorkflowForInventedExecution(workflows, {}, message);
    if (!chosenWorkflow) {
      return null;
    }

    return {
      reply: 'Perfecto, ya me encargo de la reserva.',
      workflowId: chosenWorkflow.id,
      variables: this.buildInventedVariables(chosenWorkflow, {}),
      shouldExecute: true
    };
  }

  fallbackAgentDecision(message, workflows) {
    const chosen = workflows.find((workflow) =>
      `${workflow.id} ${workflow.description} ${workflow.summary || ''}`.toLowerCase().includes(message.toLowerCase())
    ) || workflows[0];

    if (!chosen) {
      return {
        reply: 'Todavia no tengo una forma lista para ayudarte en esta pagina.',
        workflowId: null,
        variables: {},
        shouldExecute: false
      };
    }

    return {
      reply: 'Puedo encargarme de esto por ti.',
      workflowId: chosen.id,
      variables: {},
      shouldExecute: true
    };
  }

  async decideWorkflowFromMessage(message, workflows, history = [], context = {}) {
    if (!this.llmProvider.hasApiKey()) {
      return this.fallbackAgentDecision(message, workflows);
    }

    const messages = [
      {
        role: 'system',
        content: workflowAssistantPolicy.buildChatDecisionPrompt(context, workflows)
      },
      {
        role: 'user',
        content: JSON.stringify({
          conversation: history,
          context,
          userMessage: message,
          workflows: workflows.map((workflow) => ({
            id: workflow.id,
            description: workflow.description,
            summary: workflow.summary,
            executionGuide: workflow.executionGuide,
            appId: workflow.appId,
            sourceUrl: workflow.sourceUrl,
            sourceOrigin: workflow.sourceOrigin,
            sourcePathname: workflow.sourcePathname,
            variables: workflow.variables,
            steps: workflow.steps.map((step) => ({
              stepOrder: step.stepOrder,
              actionType: step.actionType,
              selector: step.selector,
              explanation: step.explanation,
              controlType: step.controlType,
              semanticTarget: step.semanticTarget,
              surfaceHints: step.surfaceHints,
              selectedValue: step.selectedValue,
              selectedLabel: step.selectedLabel,
              allowedOptions: step.allowedOptions
            }))
          }))
        })
      }
    ];

    const content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
    return this.llmProvider.parseJsonObject(content);
  }

  async handleMessage(message, history = [], context = {}, options = {}) {
    if (!message) {
      throw new Error('Message is required');
    }

    const workflows = this.filterWorkflowsForContext(await this.catalogService.getCatalog(), context);
    let decision;

    if (this.isDemoAutopilotContext(context) && this.wantsImmediateDemoExecution(message, history)) {
      decision = this.buildDemoAutopilotDecision(workflows, message, history);
    }
    
    if (!decision) {
      try {
        decision = await this.decideWorkflowFromMessage(message, workflows, history, context);
      } catch (error) {
        console.warn(`[Agent Chat] LLM fallback: ${error.message}`);
        decision = this.fallbackAgentDecision(message, workflows);
        decision.reply = this.isDemoAutopilotContext(context)
          ? 'Perfecto, ya me encargo de la reserva.'
          : `${decision.reply} LLM fallback engaged because the provider request failed.`;
      }
    }

    if (this.isDemoAutopilotContext(context) && decision && decision.workflowId) {
      const chosenWorkflow = this.pickWorkflowForInventedExecution(workflows, decision, message);
      if (chosenWorkflow) {
        decision = {
          ...decision,
          workflowId: chosenWorkflow.id,
          shouldExecute: true,
          variables: this.buildInventedVariables(chosenWorkflow, decision.variables || {}),
          reply: 'Perfecto, ya me encargo de la reserva.'
        };
      }
    } else if (this.wantsInventedValues(message, history)) {
      const chosenWorkflow = this.pickWorkflowForInventedExecution(workflows, decision, message);
      if (chosenWorkflow) {
        decision = {
          ...decision,
          workflowId: chosenWorkflow.id,
          shouldExecute: true,
          variables: this.buildInventedVariables(chosenWorkflow, decision.variables || {}),
          reply: decision.reply && decision.shouldExecute
            ? decision.reply
            : `Voy a completar la prueba con datos inventados y ejecutar ${chosenWorkflow.id}.`
        };
        decision.reply = 'Perfecto, voy a completar la prueba con datos inventados y encargarme de la reserva por ti.';
      }
    }

    if (decision?.workflowId) {
      const chosenWorkflow = workflows.find((workflow) => workflow.id === decision.workflowId);
      if (chosenWorkflow) {
        decision = this.decisionNormalizer.normalizeDecision(decision, chosenWorkflow, message);
      }
    }

    if (!decision.workflowId || !decision.shouldExecute) {
      return {
        reply: decision.reply || 'Todavia me falta un poco de informacion para encargarme de esto por ti.',
        workflowId: decision.workflowId || null,
        executed: false,
        variables: decision.variables || {},
        executionPlan: null
      };
    }

    const executionMode = `${options.executionMode || 'browser'}`.trim().toLowerCase();
    const variables = decision.variables || {};

    if (executionMode === 'server') {
      await this.executor.executeById(decision.workflowId, variables);

      return {
        reply: decision.reply || 'Voy a encargarme de esto ahora mismo.',
        workflowId: decision.workflowId,
        executed: true,
        variables,
        executionPlan: null
      };
    }

    const executionPlan = await this.executor.getExecutionPlanById(decision.workflowId, variables);

    return {
      reply: decision.reply || 'Voy a encargarme de esto ahora mismo.',
      workflowId: decision.workflowId,
      executed: false,
      variables,
      executionPlan
    };
  }
}

module.exports = AgentChat;
