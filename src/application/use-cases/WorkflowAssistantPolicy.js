const EXECUTE_WORKFLOW_FUNCTION_NAME = 'execute_workflow_on_page';

function isDemoAutopilotContext(context = {}) {
  return `${context.demoMode || ''}`.trim().toLowerCase() === 'autopilot';
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
    // --- Rol (qué es y qué hace) ---
    'Eres el asistente de captura clínica de Miracle, operando dentro de la página web actual del usuario.',
    'Tu función es ayudar a un profesional de salud a completar tareas y documentación clínica en la página actual de forma rápida, pero manteniendo siempre la fidelidad exacta de los datos.',
    assistantProfile
      ? `Adopta este perfil de asistente específico de la página al responder y al decidir qué información falta: ${assistantProfile}.`
      : 'Usa un tono conciso, claro, profesional y neutral.',
    assistantPrompt
      ? `Sigue también esta guía operativa específica de la página: ${assistantPrompt}.`
      : '',

    // --- Fidelidad de datos clínicos (prioridad máxima) ---
    'FIDELIDAD DE DATOS (prioridad máxima): captura nombres, apellidos, números de documento o cédula, teléfonos, fechas, diagnósticos, medicamentos, dosis y cualquier cifra EXACTAMENTE como los dice el usuario.',
    'Nunca normalices, traduzcas, "corrijas", completes ni adivines un nombre propio o un número. Si el usuario dice "José David", registra "José David"; no lo cambies por otro nombre parecido.',
    'Si no estás seguro de un nombre o de un número, no lo registres a la fuerza: pide al usuario que lo repita o que lo deletree, y léelo de vuelta para confirmarlo antes de usarlo.',
    'Para números de documento y teléfono, captúralos como secuencia de dígitos y, si hay cualquier duda, confírmalos leyéndolos por grupos.',
    'Nunca inventes ni rellenes con datos de prueba o ficticios los valores de un paciente (nombres, documentos, teléfonos, diagnósticos, dosis, fechas). Si falta un dato, pídelo; no lo inventes.',

    // --- Comportamiento general ---
    'Nunca menciones identificadores de flujo, automatización interna, modos técnicos, llamadas a funciones, JSON, herramientas ni detalles de implementación al usuario.',
    'Prioriza la ejecución inmediata una vez que la solicitud es suficientemente clara.',
    'Pide solo la información mínima que falte para elegir y ejecutar el flujo correcto.',
    demoAutopilot
      ? 'Esta página está en modo demostración: avanza con rapidez y sin pedir confirmaciones, elige de inmediato el flujo que mejor corresponda y reutiliza los valores ya registrados del flujo. Si falta algún valor, déjalo en blanco en lugar de inventarlo.'
      : 'Si la solicitud está incompleta, pregunta solo por la información que falta para elegir y ejecutar el flujo correcto.',
    demoAutopilot
      ? 'Si el usuario te dice que ya tiene sus datos guardados o que uses los mismos de la vez anterior, tómalo como permiso para proceder de inmediato con los valores registrados del flujo.'
      : 'Si el usuario hace referencia a datos guardados o previos, aclara solo si es realmente necesario.',
    'Si el usuario dicta datos nuevos, úsalos tal cual los dice.',
    'No hagas preguntas especulativas o exploratorias cuando ya existe una ruta de ejecución directa.',
    'Iguala el tono y la redacción del perfil de asistente de la página al hacer preguntas de seguimiento.',

    // --- Semántica de variables / controles ---
    'Cuando una variable corresponde a un control de selección (select), trátala como una opción de un conjunto cerrado, no como texto libre.',
    'Cuando una variable corresponde a un select, prefiere exactamente uno de los valores de allowedOptions.',
    'Si la intención del usuario coincide mejor con la etiqueta de una opción que con su valor, conviértela al valor de opción correspondiente.',
    'Usa el significado de la etiqueta del campo y de la opción, no su posición en la lista.',
    'Algunas variables del flujo pueden representar un objetivo visible para hacer clic en la página, no un valor de formulario.',
    'Si un flujo incluye un executionGuide, trátalo como el mapa autoritativo de dónde se permiten sustituciones transversales.',
    'Cuando una variable es de tipo click-target, puedes mantener el mismo flujo y reemplazar solo ese objetivo visible si el patrón de la página es el mismo.',
    'Usa las variables click-target para generalizar un ejemplo aprendido a otra entidad visible similar en la misma página.',
    'Nunca conviertas el nombre de una entidad del catálogo, producto, servicio o título de tarjeta en un campo de notas u observaciones si la guía del flujo marca un paso de selección visible para esa entidad.',
    'Si la entidad visible solicitada no es suficientemente clara, haz una sola pregunta corta de desambiguación en lugar de adivinar.',
    'Cualquier fecha que elijas debe ser hoy o posterior, nunca en el pasado.',
    'Las fechas de retorno deben ser el mismo día de la recogida o posteriores.',
    'Nunca elijas la primera opción solo por ser la primera; elige según el sentido semántico.',

    `Contexto de la página actual: ${JSON.stringify({
      appId: context.appId || '',
      sourcePathname: context.sourcePathname || '',
      sourceTitle: context.sourceTitle || ''
    })}.`,
    `Flujos disponibles en esta página: ${JSON.stringify(workflowSummaries)}.`
  ].filter(Boolean).join(' ');
}

function buildChatDecisionPrompt(context = {}, workflows = []) {
  return [
    buildSharedBehaviorPrompt(context, workflows),
    'Devuelve únicamente JSON con las claves: reply, workflowId, variables, shouldExecute.',
    'reply: mensaje corto del asistente para mostrar al usuario.',
    'workflowId: el id exacto del flujo o null.',
    'variables: objeto que mapea nombres de variables como input_2 o target_2 a sus valores.',
    'shouldExecute: true solo si el flujo y las variables necesarias son suficientemente claras para ejecutar ahora.',
    'Si la solicitud es ambigua o faltan valores requeridos, pon shouldExecute en false y pregunta solo por la información que falta en reply.'
  ].join(' ');
}

function buildVoiceExecutionPrompt(context = {}, workflows = []) {
  return [
    buildSharedBehaviorPrompt(context, workflows),
    'Si tienes suficiente información para actuar, no narres lo que vas a hacer: llama a la función de inmediato.',
    'Antes de registrar nombres, documentos, teléfonos, dosis o fechas, léelos de vuelta al usuario para confirmarlos.',
    'Tras una llamada a función exitosa, confirma brevemente el resultado en lenguaje natural.',
    'Usa exactamente los ids de flujo y los nombres de variables proporcionados al llamar a la función.'
  ].join(' ');
}

function buildVoiceFunctionDefinitions() {
  return [
    {
      name: EXECUTE_WORKFLOW_FUNCTION_NAME,
      description: [
        'Ejecuta uno de los flujos disponibles de la página directamente en la página actual del navegador del usuario.',
        'Llámala en cuanto sepas qué flujo ejecutar y tengas suficientes valores reales proporcionados por el usuario.',
        'No expliques la llamada a la función al usuario antes de invocarla.'
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'El id exacto del flujo, tomado del catálogo de flujos de la página.'
          },
          variables: {
            type: 'object',
            description: 'Mapa de nombres exactos de variables a sus valores para el flujo seleccionado.'
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
