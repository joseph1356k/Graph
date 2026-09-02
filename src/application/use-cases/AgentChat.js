// Chat del asistente de captura en página: decide qué flujo aprendido aplicar
// y con qué variables, y devuelve el plan de ejecución (nunca ejecuta solo).
//
// Lo que ya no está aquí: la invención de datos. Antes, un `demoMode:
// "autopilot"` en el body o frases como «es una prueba», «inventa», «hazlo tú»
// en el mensaje hacían que el servidor fabricara cédulas, teléfonos, fechas de
// nacimiento y nombres, forzara shouldExecute=true por encima del modelo y
// saltara la decisión del LLM. Eso ocurría en operación normal, no sólo en
// demos. Un formulario clínico nunca se rellena con datos que nadie dijo.
//
// Lo único que se completa sin preguntar es estructural, no del paciente: el
// objetivo visible por defecto de una variable click-target y la única opción
// de un select con una sola opción.
const workflowAssistantPolicy = require('./WorkflowAssistantPolicy');
const WorkflowDecisionNormalizer = require('./WorkflowDecisionNormalizer');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');

const DECISION_TEMPERATURE = 0.2;
const MAX_FALLBACK_WORKFLOWS = 5;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const HISTORY_ROLES = new Set(['user', 'assistant']);

class AgentChat {
  constructor(llmProvider, catalogService, executor) {
    this.llmProvider = llmProvider;
    this.catalogService = catalogService;
    this.executor = executor;
    this.decisionNormalizer = new WorkflowDecisionNormalizer();
  }

  /**
   * Rellena determinísticamente lo que no requiere decisión: el objetivo por
   * defecto de un click-target y la única opción de un select unitario. Los
   * valores de campo (field-value) NUNCA se rellenan con su defaultValue: ese
   * default es el valor que se escribió al enseñar el flujo, es decir, datos
   * de otro paciente.
   */
  fillDefaultVariables(workflow, existingVariables = {}) {
    const output = { ...(existingVariables || {}) };
    const variables = Array.isArray(workflow?.variables) ? workflow.variables : [];

    for (const variable of variables) {
      if (!variable?.name) {
        continue;
      }
      const current = output[variable.name];
      if (current !== undefined && current !== null && `${current}`.trim() !== '') {
        continue;
      }

      const kind = `${variable.kind || ''}`.trim().toLowerCase();
      if (kind === 'click-target' && `${variable.defaultValue || ''}`.trim()) {
        output[variable.name] = `${variable.defaultValue}`.trim();
        continue;
      }

      const allowedOptions = Array.isArray(variable.allowedOptions)
        ? variable.allowedOptions.filter((option) => option && option.value)
        : [];
      if (allowedOptions.length === 1) {
        output[variable.name] = allowedOptions[0].value;
      }
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

  // Sin modelo no hay decisión: se describe lo disponible y no se ejecuta nada.
  fallbackAgentDecision(message, workflows = []) {
    const names = (Array.isArray(workflows) ? workflows : [])
      .slice(0, MAX_FALLBACK_WORKFLOWS)
      .map((workflow) => `${workflow.description || workflow.summary || workflow.id || ''}`.trim())
      .filter(Boolean);

    return {
      reply: names.length > 0
        ? `Ahora mismo no puedo interpretar tu solicitud. En esta página puedo ayudarte con: ${names.join('; ')}. Dime cuál necesitas y con qué datos.`
        : 'Todavía no tengo una forma lista para ayudarte en esta página.',
      workflowId: null,
      variables: {},
      shouldExecute: false
    };
  }

  sanitizeHistory(history = []) {
    return (Array.isArray(history) ? history : [])
      .filter((item) => item && HISTORY_ROLES.has(`${item.role || ''}`.trim()) && typeof item.content === 'string')
      .slice(-MAX_HISTORY_TURNS)
      .map((item) => ({ role: `${item.role}`.trim(), content: item.content.slice(0, MAX_HISTORY_CONTENT_LENGTH) }));
  }

  // Al modelo sólo le llega lo que describe la página; nada de flags ni de
  // perfiles crudos (esos ya van saneados dentro del system prompt).
  describeContextForModel(context = {}) {
    const surface = workflowAssistantPolicy.sanitizeSurfaceContext(context);
    return {
      appId: surface.appId,
      sourceOrigin: surface.sourceOrigin,
      sourcePathname: surface.sourcePathname,
      sourceTitle: surface.sourceTitle
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
          conversation: this.sanitizeHistory(history),
          context: this.describeContextForModel(context),
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
            steps: (Array.isArray(workflow.steps) ? workflow.steps : []).map((step) => ({
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

    const content = await withFeature(
      FEATURES.AGENT_CHAT,
      () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }, { temperature: DECISION_TEMPERATURE }),
      { metadata: { promptVersion: workflowAssistantPolicy.PROMPT_VERSION, temperature: DECISION_TEMPERATURE } }
    );
    return this.llmProvider.parseJsonObject(content);
  }

  async handleMessage(message, history = [], context = {}, options = {}) {
    if (!message) {
      throw new Error('Message is required');
    }

    const workflowAccess = options.workflowAccess || null;
    const workflows = this.filterWorkflowsForContext(await this.catalogService.getCatalog(workflowAccess), context);
    let decision;

    try {
      decision = await this.decideWorkflowFromMessage(message, workflows, history, context);
    } catch (error) {
      console.warn(`[Agent Chat] la decisión del modelo falló: ${error.message}`);
      decision = this.fallbackAgentDecision(message, workflows);
    }
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      decision = this.fallbackAgentDecision(message, workflows);
    }

    if (decision.workflowId) {
      const chosenWorkflow = workflows.find((workflow) => workflow.id === decision.workflowId);
      if (chosenWorkflow) {
        decision = this.decisionNormalizer.normalizeDecision(
          { ...decision, variables: this.fillDefaultVariables(chosenWorkflow, decision.variables || {}) },
          chosenWorkflow,
          message
        );
      } else {
        // Un id fuera del catálogo de esta página no se ejecuta.
        decision = { ...decision, workflowId: null, shouldExecute: false };
      }
    }

    if (!decision.workflowId || !decision.shouldExecute) {
      return {
        reply: decision.reply || 'Todavía me falta un poco de información para encargarme de esto por ti.',
        workflowId: decision.workflowId || null,
        executed: false,
        variables: decision.variables || {},
        executionPlan: null
      };
    }

    const variables = decision.variables || {};

    const executionPlan = await this.executor.getExecutionPlanById(
      decision.workflowId,
      variables,
      {
        userMessage: message,
        assistantReply: decision.reply || ''
      },
      workflowAccess
    );

    return {
      reply: decision.reply || 'Voy a encargarme de esto ahora mismo.',
      workflowId: decision.workflowId,
      executed: false,
      variables,
      executionPlan
    };
  }
}

AgentChat.DECISION_TEMPERATURE = DECISION_TEMPERATURE;

module.exports = AgentChat;
