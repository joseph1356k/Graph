// Use-case del bucle del agente de escritorio (Ü): resuelve UN turno del lado
// servidor. Port de Android/backend/src/http/handleTurn.ts + application/engine.ts.
//
// El bucle completo (capturar pantalla → decidir → ejecutar → repetir) lo
// conduce el CLIENTE Windows; aquí solo se resuelve cada turno de forma
// stateless: la decisión (brain) vive en el servidor, la ejecución (gestos/MCP)
// vive en el cliente. El contrato `Action[]`/`BrainTurn` es la costura y es
// SAGRADO: mismos nombres de campos JSON que Protocol.cs del cliente.
//
// CONTRATO (espejo de windows-client/src/Domain/Protocol.cs):
//   Request : { session?, goal?, userId?, state{screen,uiContext,width,height,
//               screenshot?,apps?}, results?[], inform? }
//   Response: { session, actions[], question?, done, text, needsScreenshot,
//               narration, speech?, intents[] }  |  { error }
//
// La autenticación NO vive aquí: el gate de X-API-Key de /api/v1 (requireApiKey)
// reemplaza al CLIENT_TOKEN Bearer del backend viejo.

const { freshSession, encodeSession, decodeSession } = require('../../domain/agent/session');
const { baseCatalog, catalogNames } = require('../../domain/agent/mcpCatalog');
const { learnedToMcp, workflowToMcp, InMemoryAgentLearningStore } = require('../../domain/agent/learning');
const { runProviderTurn } = require('../../infrastructure/conscious-brain');
const { resolveConsciousConfig } = require('../../infrastructure/conscious-brain/config');

class AgentTurnService {
  /**
   * @param {object} deps
   * @param {object} deps.memoryRepository forPrompt(userId)/remember(...) — Supabase con fallback en memoria.
   * @param {object} [deps.learningStore]  learnedTools(userId, apps)/workflows(userId, apps).
   * @param {Function} [deps.runProviderTurn] inyectable para tests (mock del cerebro).
   * @param {Function} [deps.resolveConfig]   inyectable para tests (config fake).
   */
  constructor(deps = {}) {
    if (!deps.memoryRepository) {
      throw new Error('AgentTurnService requiere memoryRepository');
    }
    this.memoryRepository = deps.memoryRepository;
    this.learningStore = deps.learningStore || new InMemoryAgentLearningStore();
    this.runProviderTurn = deps.runProviderTurn || runProviderTurn;
    this.resolveConfig = deps.resolveConfig || resolveConsciousConfig;
  }

  /**
   * Ensambla el catálogo MCP que el cerebro declara al modelo este turno: base
   * (gestos + sistema) + herramientas aprendidas + workflows, según lo que el
   * store sepa de las apps visibles. Todo esto es innovación server-side; el
   * cliente solo recibe el `Action[]` resultante.
   */
  async assembleTools(userId, apps) {
    const learned = await this.learningStore.learnedTools(userId, apps);
    const workflows = await this.learningStore.workflows(userId, apps);
    return [...baseCatalog(), ...learned.map(learnedToMcp), ...workflows.map(workflowToMcp)];
  }

  /**
   * Resuelve un turno. Devuelve {status, json} para que la ruta lo escriba tal
   * cual — misma matriz de códigos del backend viejo: 400 request inválido,
   * 500 provider sin configurar, 502 error del cerebro.
   */
  async handleTurn(body = {}) {
    const config = this.resolveConfig();
    if (!config.configured) {
      return { status: 500, json: { error: config.errorMessage } };
    }

    if (!body.state || typeof body.state.screen !== 'string') {
      return { status: 400, json: { error: 'falta `state` (screen, uiContext, width, height)' } };
    }

    const userId = `${body.userId || ''}`.trim() || 'anon';

    let session;
    try {
      session = body.session
        ? decodeSession(body.session)
        : freshSession(config.provider, `${body.goal || ''}`.trim(), config.model, config.effort);
    } catch (error) {
      return { status: 400, json: { error: `sesión inválida: ${error.message}` } };
    }
    if (!body.session && !session.goal) {
      return { status: 400, json: { error: 'el primer turno requiere `goal`' } };
    }

    if (typeof body.inform === 'string') session.informText = body.inform;

    try {
      const apps = Array.isArray(body.state.apps) ? body.state.apps : [];
      const tools = await this.assembleTools(userId, apps);
      const memory = await this.memoryRepository.forPrompt(userId);

      const { session: next, turn } = await this.runProviderTurn({
        session,
        tools,
        mcpNames: catalogNames(tools),
        memory,
        apps,
        state: body.state,
        results: Array.isArray(body.results) ? body.results : [],
        apiKey: config.apiKey
      });

      return { status: 200, json: { session: encodeSession(next), ...turn } };
    } catch (error) {
      return { status: 502, json: { error: `cerebro: ${error.message}` } };
    }
  }
}

module.exports = AgentTurnService;
