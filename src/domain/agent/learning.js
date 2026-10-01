// Aprendizaje del agente de escritorio: los workflows (el puente consciente ↔
// subconsciente) declarados como herramientas del modelo. Port de
// Android/backend/src/learning/workflows.ts.
//
// Las «herramientas aprendidas del árbol de UI» (una secuencia de `taps` por app)
// se borraron el 2026-10-01: nunca hubo quien las captara y el store siempre las
// devolvía vacías, pero el prompt y el catálogo seguían cargando su regla. Los
// clientes conservan su soporte de `taps`, que es inofensivo.
//
// El store real de workflows es application/use-cases/AgentWorkflowStore.js
// (catálogo de Neo4j). El de aquí, en memoria, es el de los tests y el de un
// arranque sin catálogo.

const { WORKFLOW_VIA } = require('./mcpCatalog');
const { PLATFORMS } = require('./platform');

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

const MAX_STEPS_IN_DESCRIPTION = 8;

/**
 * Declara un workflow como McpTool `workflow_*` (el modelo lo invoca entero con `context`).
 * La descripción lleva la app y los primeros pasos: es lo que el modelo necesita para saber si el
 * objetivo coincide. Cuántos pasos son «subconscientes» no le dice nada y se quitó.
 */
function workflowToMcp(workflow) {
  const steps = workflow.steps || [];
  const apps = [...new Set(steps.map((step) => step.app).filter(Boolean))];
  const appNote = apps.length ? `[app: ${apps.join(', ')}] ` : '';
  const shown = steps.slice(0, MAX_STEPS_IN_DESCRIPTION).map((step) => step.action).join(' → ');
  const more = steps.length > MAX_STEPS_IN_DESCRIPTION ? ' …' : '';
  return {
    name: `workflow_${sanitize(workflow.name)}`,
    description: `${appNote}${workflow.description}${shown ? ` Pasos: ${shown}${more}.` : ''}`,
    params: [{ name: 'context', description: 'Los datos de ESTA vez (nombres, textos, cantidades) que el workflow necesita; "" si no necesita ninguno' }],
    via: WORKFLOW_VIA
  };
}

// Esquema del origen grabado → dispositivo que sabe reproducir el workflow. android:// lo graba
// el teléfono (AndroidSurface); uia://, sapgui:// y web:// los graba U.exe (SurfaceLocator).
const DEVICE_BY_SCHEME = Object.freeze({
  android: PLATFORMS.ANDROID,
  uia: PLATFORMS.WINDOWS,
  sapgui: PLATFORMS.WINDOWS,
  web: PLATFORMS.WINDOWS
});

/**
 * El dispositivo donde se grabó un workflow, o '' si no se sabe. Manda el esquema de
 * `sourceOrigin`; sin origen, una app .exe en los pasos también es del PC.
 */
function workflowDevice(workflow) {
  const origin = `${(workflow && workflow.sourceOrigin) || ''}`.trim().toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//.exec(origin);
  if (scheme) return DEVICE_BY_SCHEME[scheme[1]] || '';
  const steps = (workflow && Array.isArray(workflow.steps)) ? workflow.steps : [];
  return steps.some((step) => /\.exe$/i.test(`${(step && step.app) || ''}`.trim())) ? PLATFORMS.WINDOWS : '';
}

/**
 * Si un workflow se le puede declarar al cerebro de esta plataforma. Cada cliente reproduce solo
 * lo que grabó su propio dispositivo: un workflow de his.exe no corre en un teléfono, y uno del
 * teléfono no corre en U.exe. Lo que no se sabe de dónde es se declara, como siempre. El Mac no
 * reproduce workflows.
 */
function workflowRunsOn(workflow, platform) {
  if (platform === PLATFORMS.MAC) return false;
  const device = workflowDevice(workflow);
  if (!device) return true;
  return device === (platform === PLATFORMS.ANDROID ? PLATFORMS.ANDROID : PLATFORMS.WINDOWS);
}

/**
 * Store de workflows en memoria (se pierde entre cold starts). Devuelve lo que
 * se le haya añadido con addWorkflow en el mismo proceso.
 */
class InMemoryAgentLearningStore {
  constructor() {
    this.wf = [];
  }

  // Los parámetros (userId, apps, surface, access) existen para que el store real
  // pueda filtrar; aquí se ignoran a propósito.
  async workflows() {
    return this.wf;
  }

  addWorkflow(workflow) {
    this.wf.push(workflow);
  }
}

module.exports = { sanitize, workflowToMcp, workflowDevice, workflowRunsOn, InMemoryAgentLearningStore };
