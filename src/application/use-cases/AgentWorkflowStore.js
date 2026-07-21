// Store REAL de workflows para el agente de escritorio: sustituye al
// InMemoryAgentLearningStore (stub vacío) leyendo el catálogo de Neo4j vía
// WorkflowCatalog y filtrándolo por la SUPERFICIE donde el usuario está parado.
//
// La superficie llega del SurfaceLocator del cliente (uia://proc.exe + /ventana,
// web://dominio + /ruta) y el matching replica EXACTAMENTE la semántica de
// WorkflowPlayer.SurfaceMismatch (windows-graph): igualdad case-insensitive de
// origin y pathname, y los campos VACÍOS del workflow no restringen (un workflow
// sin source grabado aplica en cualquier parte).
//
// Sin superficie => []. Así un cliente viejo que aún no manda superficie se
// comporta igual que con el stub (ningún workflow), nunca peor.
const MAX_WORKFLOW_TOOLS = 30;

class AgentWorkflowStore {
  /** @param {object} deps  @param {object} deps.catalogService WorkflowCatalog (Neo4j). */
  constructor(deps = {}) {
    if (!deps.catalogService) {
      throw new Error('AgentWorkflowStore requiere catalogService');
    }
    this.catalogService = deps.catalogService;
  }

  // Las herramientas aprendidas (árbol de UI) siguen sin captación: ver TODO en
  // domain/agent/learning.js. Este store solo enchufa los workflows.
  async learnedTools() {
    return [];
  }

  /**
   * Workflows de la superficie actual, en el shape que espera workflowToMcp
   * ({name, description, steps[{action, subconscious}]}) más el id real para
   * que AgentTurnService pueda inyectarlo en la llamada MCP.
   */
  async workflows(userId, apps, surface = null) {
    const origin = `${surface?.origin || ''}`.trim();
    const pathname = `${surface?.pathname || ''}`.trim();
    if (!origin) return [];

    let catalog;
    try {
      catalog = await this.catalogService.getCatalog(null);
    } catch (error) {
      return []; // sin Neo4j no hay workflows; el turno sigue con el catálogo base
    }

    return catalog
      .filter((wf) => AgentWorkflowStore.matchesSurface(wf, origin, pathname))
      .slice(0, MAX_WORKFLOW_TOOLS)
      .map(AgentWorkflowStore.toAgentWorkflow);
  }

  /** Misma regla que WorkflowPlayer.SurfaceMismatch: campos vacíos del workflow no restringen. */
  static matchesSurface(wf, origin, pathname) {
    const wfOrigin = `${wf.sourceOrigin || ''}`.trim();
    const wfPathname = `${wf.sourcePathname || ''}`.trim();
    if (wfOrigin && wfOrigin.toLowerCase() !== origin.toLowerCase()) return false;
    if (wfPathname && wfPathname.toLowerCase() !== pathname.toLowerCase()) return false;
    return true;
  }

  /** Fila del catálogo Neo4j → workflow del agente (shape de workflowToMcp). */
  static toAgentWorkflow(wf) {
    const steps = (Array.isArray(wf.steps) ? wf.steps : []).map((step) => ({
      action: `${step.explanation || step.label || step.actionType || 'paso'}`.slice(0, 80),
      app: '',
      subconscious: true
    }));
    return {
      id: wf.id,
      name: wf.id, // el nombre MCP sale de sanitize(name): con el id es determinista y reversible
      description: `${wf.summary || wf.description || 'Workflow aprendido.'}`.slice(0, 300),
      steps
    };
  }
}

module.exports = AgentWorkflowStore;
