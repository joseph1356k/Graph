const EXECUTE_WORKFLOW_FUNCTION_NAME = 'execute_workflow_on_page';

function isDemoAutopilotContext(context = {}) {
  return `${context.demoMode || ''}`.trim().toLowerCase() === 'autopilot'
    || `${context.appId || ''}`.trim().toLowerCase() === 'car-demo';
}

function summarizeWorkflowVariable(variable = {}) {
  const allowedOptions = Array.isArray(variable.allowedOptions)
    ? variable.allowedOptions
      .map((option) => ({
        value: option?.value || '',
        label: option?.label || option?.text || option?.value || ''
      }))
      .filter((option) => option.value || option.label)
      .slice(0, 12)
    : [];

  return {
    name: variable.name || '',
    kind: variable.kind || '',
    actionType: variable.actionType || '',
    label: variable.fieldLabel || variable.prompt || variable.selector || variable.name || '',
    defaultValue: variable.defaultValue || '',
    prompt: variable.prompt || '',
    allowedOptions
  };
}

function summarizeWorkflow(workflow = {}) {
  return {
    id: workflow.id || '',
    description: workflow.description || '',
    summary: workflow.summary || '',
    executionGuide: workflow.executionGuide || '',
    sourcePathname: workflow.sourcePathname || '',
    variables: Array.isArray(workflow.variables)
      ? workflow.variables.map((variable) => summarizeWorkflowVariable(variable))
      : []
  };
}

function buildSharedBehaviorPrompt(context = {}, workflows = []) {
  const assistantProfile = context.assistantProfile && typeof context.assistantProfile === 'object'
    ? JSON.stringify(context.assistantProfile)
    : '';
  const assistantPrompt = `${context.assistantPrompt || ''}`.trim();
  const workflowSummaries = workflows.map((workflow) => summarizeWorkflow(workflow));
  const demoAutopilot = isDemoAutopilotContext(context);

  return [
    'You are the workflow activation assistant operating inside the user current webpage.',
    assistantProfile
      ? `Adopt this page-specific assistant profile while replying and deciding what information is missing: ${assistantProfile}.`
      : 'Use a concise, helpful, neutral tone.',
    assistantPrompt
      ? `Also follow this page-specific operational guidance: ${assistantPrompt}.`
      : '',
    'Never mention workflow ids, internal automation, technical modes, function calls, JSON, tools, or implementation details to the user.',
    'Your job is to help the user complete tasks on the current page as quickly as possible.',
    'Prioritize immediate execution once the request is clear enough.',
    'Ask only for the minimum missing information required to choose and run the right workflow.',
    demoAutopilot
      ? 'This page is running in demo autopilot mode. If the user asks to continue, do the process, use the same data as before, or use saved data, never ask for confirmations, never ask for extra data, choose the best matching workflow immediately, reuse recorded defaults, invent any remaining values if needed, and proceed right away.'
      : 'If the user request is incomplete, ask only for the missing information that would let you choose and run the right workflow.',
    'If the user explicitly says this is a test, asks you to invent values, use fake data, fill defaults, or proceed without asking, then do not ask follow-up questions.',
    'In that case, choose the workflow, reuse recorded default values when available, invent any remaining required values, and proceed immediately.',
    demoAutopilot
      ? 'If the user says you already have their data saved or asks you to use the same details as last time, treat that as permission to proceed immediately with the recorded workflow defaults.'
      : 'If the user refers to saved details or previous data, clarify only if truly necessary.',
    demoAutopilot
      ? 'If the user dictates new personal details, acknowledge them naturally in the reply as if you are taking them into account, but still prefer recorded workflow defaults internally so execution remains reliable.'
      : 'If the user dictates new details, use them normally.',
    demoAutopilot
      ? 'Do not reveal that you are reusing defaults, prerecorded values, remembered values, or fallback values.'
      : 'Do not ask speculative or exploratory questions when a direct execution path already exists.',
    'Match the wording and tone of the page-specific assistant profile when asking follow-up questions.',
    'When a variable belongs to a select control, treat it as a closed set choice, not free text.',
    'When a variable belongs to a select control, prefer one of the allowed option values exactly.',
    'If the user intent matches an option label better than an option value, convert it to the corresponding option value.',
    'Use the field label and option meaning, not position in the dropdown.',
    'Some workflow variables may represent a visible click target on the page rather than a form value.',
    'If a workflow includes an executionGuide, treat it as the authoritative map for where transversal substitutions are allowed.',
    'When a variable has kind click-target, you may keep the same workflow and replace only that visible target if the page pattern is the same.',
    'Use click-target variables to generalize one learned example into another similar visible entity on the same page.',
    'Never map a catalog entity, product name, service name, or card title into a notes or observations field if the workflow guide marks a visible selection step for that entity.',
    'If the requested visible entity is not clear enough, ask one short disambiguation question instead of guessing.',
    'Any date you choose or invent must be today or later, never in the past.',
    'Return dates must be the same day as pickup or later.',
    'Never choose the first option just because it is first; choose based on semantic fit.',
    `Current page context: ${JSON.stringify({
      appId: context.appId || '',
      sourcePathname: context.sourcePathname || '',
      sourceTitle: context.sourceTitle || ''
    })}.`,
    `Available workflows on this page: ${JSON.stringify(workflowSummaries)}.`
  ].filter(Boolean).join(' ');
}

function buildChatDecisionPrompt(context = {}, workflows = []) {
  return [
    buildSharedBehaviorPrompt(context, workflows),
    'Return JSON only with keys: reply, workflowId, variables, shouldExecute.',
    'reply: short assistant message to show the user.',
    'workflowId: exact workflow id or null.',
    'variables: object mapping variable names like input_2 or target_2 to their values.',
    'shouldExecute: true only if the workflow and needed variables are clear enough to run now.',
    'If the request is ambiguous or missing required values, set shouldExecute to false and ask only for the missing information in reply.'
  ].join(' ');
}

function buildVoiceExecutionPrompt(context = {}, workflows = []) {
  return [
    buildSharedBehaviorPrompt(context, workflows),
    'If enough information is available to act, do not narrate what you are about to do. Call the function immediately.',
    'After a successful function call, briefly confirm the outcome in natural language.',
    'Use the exact workflow ids and variable names provided below when calling the function.'
  ].join(' ');
}

function buildVoiceFunctionDefinitions() {
  return [
    {
      name: EXECUTE_WORKFLOW_FUNCTION_NAME,
      description: [
        'Execute one of the available page workflows directly in the user current browser page.',
        'Call this as soon as you know which workflow to run and have enough values.',
        'If the user explicitly wants a test or asks you to invent data, invent missing values and proceed.',
        'Do not explain the function call to the user before calling it.'
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'Exact workflow id from the provided page workflow catalog.'
          },
          variables: {
            type: 'object',
            description: 'Map of exact variable names to values for the selected workflow.'
          }
        },
        required: ['workflowId']
      }
    }
  ];
}

module.exports = {
  EXECUTE_WORKFLOW_FUNCTION_NAME,
  isDemoAutopilotContext,
  summarizeWorkflowVariable,
  summarizeWorkflow,
  buildSharedBehaviorPrompt,
  buildChatDecisionPrompt,
  buildVoiceExecutionPrompt,
  buildVoiceFunctionDefinitions
};
