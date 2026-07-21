// Aprendizaje del agente de escritorio: herramientas aprendidas del árbol de UI
// y workflows (el puente consciente ↔ subconsciente). Port de
// Android/backend/src/learning/workflows.ts.
//
// Primera construcción (igual que el backend original): tipos + store en
// memoria + puntos de extensión claramente marcados. El cerebro ya sabe
// declarar estas herramientas al modelo (ver conscious-brain/prompt.js).
//
// TODO(stub): la CAPTACIÓN de aprendizajes (post-procesamiento LLM de la traza,
// reconexión MCP↔workflow, proyección al grafo de Neo4j) no existía en el
// backend viejo y sigue sin existir aquí. Cuando llegue, se enchufa aquí (p.ej.
// un SupabaseAgentLearningRepository o una proyección a Neo4jWorkflowRepository)
// sin tocar el cliente ni el contrato de acciones.

const { LEARNED_VIA, WORKFLOW_VIA } = require('./mcpCatalog');

// Nombres de herramienta seguros para function-calling (solo [a-z0-9_]).
function sanitize(value) {
  const cleaned = `${value}`
    .trim()
    .toLowerCase()
    .split('')
    .map((c) => ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ? c : '_'))
    .join('')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'learned_tool';
}

/** Declara una herramienta aprendida como McpTool (el modelo compone la secuencia de `taps`). */
function learnedToMcp(learnedTool) {
  const appNote = learnedTool.app ? `[app: ${learnedTool.app}] ` : '';
  return {
    name: sanitize(learnedTool.name),
    description: `${appNote}${learnedTool.description} Elementos disponibles (etiquetas exactas): ${(learnedTool.elements || []).join(', ')}.`,
    params: [{ name: 'taps', description: 'Etiquetas a tocar EN ORDEN, separadas por comas (usa solo las disponibles)' }],
    via: LEARNED_VIA
  };
}

/** Declara un workflow como McpTool `workflow_*` (el modelo lo invoca entero con `context`). */
function workflowToMcp(workflow) {
  const steps = workflow.steps || [];
  const sub = steps.filter((step) => step.subconscious).length;
  const apps = [...new Set(steps.map((step) => step.app).filter(Boolean))];
  const appNote = apps.length ? `[app: ${apps.join(', ')}] ` : '';
  return {
    name: `workflow_${sanitize(workflow.name)}`,
    description:
      `${appNote}${workflow.description} Steps: ${steps.map((step) => step.action).join(' → ')} `
      + `(${sub} de ${steps.length} subconscientes).`,
    params: [{ name: 'context', description: 'Datos variables de ESTA ejecución (nombres, textos, cantidades); "" si no aplica' }],
    via: WORKFLOW_VIA
  };
}

/**
 * Store de aprendizajes por app. En memoria (se pierde entre cold starts),
 * exactamente como la primera construcción del backend original: hoy siempre
 * devuelve listas vacías salvo que algo llame a addLearned/addWorkflow en el
 * mismo proceso. Es el punto de enchufe para la persistencia futura.
 */
class InMemoryAgentLearningStore {
  constructor() {
    this.learned = [];
    this.wf = [];
  }

  // Los parámetros (userId, apps) existen para que una implementación real
  // pueda filtrar por usuario y por apps visibles; aquí se ignoran a propósito.
  async learnedTools() {
    return this.learned;
  }

  async workflows() {
    return this.wf;
  }

  // Puntos de extensión para el post-procesamiento (pasivo/activo).
  addLearned(tool) {
    this.learned.push(tool);
  }

  addWorkflow(workflow) {
    this.wf.push(workflow);
  }
}

module.exports = { sanitize, learnedToMcp, workflowToMcp, InMemoryAgentLearningStore };
