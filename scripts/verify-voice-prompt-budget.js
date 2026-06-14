const assert = require('assert');
const workflowAssistantPolicy = require('../src/application/use-cases/WorkflowAssistantPolicy');

function buildLargeWorkflow(index) {
  return {
    id: `workflow-${index}`,
    description: `Descripcion ${index} ${'clinica '.repeat(120)}`,
    summary: `Resumen ${index} ${'operativo '.repeat(120)}`,
    executionGuide: `Guia ${index} ${'paso detallado '.repeat(300)}`,
    sourcePathname: '/emr-workspace.html',
    variables: Array.from({ length: 35 }, (_, variableIndex) => ({
      name: `field_${index}_${variableIndex}`,
      kind: 'input',
      actionType: 'fill',
      fieldLabel: `Campo clinico ${variableIndex} ${'descripcion '.repeat(30)}`,
      prompt: `Capture el valor ${'sin inventar '.repeat(40)}`,
      allowedOptions: Array.from({ length: 20 }, (_, optionIndex) => ({
        value: `option-${optionIndex}-${'x'.repeat(80)}`,
        label: `Opcion ${optionIndex} ${'etiqueta '.repeat(20)}`
      }))
    }))
  };
}

const workflows = Array.from({ length: 120 }, (_, index) => buildLargeWorkflow(index));
const catalog = workflowAssistantPolicy.buildVoiceWorkflowCatalog(workflows);
const prompt = workflowAssistantPolicy.buildVoiceExecutionPrompt({
  appId: 'medical-emr',
  sourcePathname: '/emr-workspace.html'
}, workflows);

assert(catalog.includedCount > 0, 'The voice catalog must include at least one workflow.');
assert(catalog.omittedCount > 0, 'The synthetic oversized catalog must be truncated.');
assert(catalog.characterCount <= 36000, 'The workflow summary exceeded its character budget.');
assert(prompt.length <= 45000, `The voice prompt is too large: ${prompt.length} characters.`);
assert(prompt.includes('workflow-0'), 'The first relevant workflow must remain available.');
assert(!prompt.includes('workflow-119'), 'Workflows outside the budget must not leak into the prompt.');

console.log(JSON.stringify({
  promptCharacters: prompt.length,
  includedWorkflows: catalog.includedCount,
  omittedWorkflows: catalog.omittedCount
}));
