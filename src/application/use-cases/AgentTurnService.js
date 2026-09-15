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
//               screenshot?,apps?,surfaceId?,surfaceOrigin?,surfacePathname?},
//               results?[], inform? }
//   Response: { session, actions[], question?, done, text, needsScreenshot,
//               narration, speech?, intents[] }  |  { error }
//
// surface*: el ID de superficie del SurfaceLocator del cliente (uia://proc.exe
// + /ventana, web://dominio + /ruta). Con él se scopean los workflows que el
// catálogo MCP declara este turno (solo los del lugar donde el usuario está
// parado). Campos opcionales: sin ellos, el catálogo no incluye workflows.
//
// La autenticación NO vive aquí: el gate de X-API-Key de /api/v1 (requireApiKey)
// reemplaza al CLIENT_TOKEN Bearer del backend viejo.
//
// PLATAFORMA. La app Android usa este mismo turno y se identifica con
// X-Miracle-App: android_app. Eso cambia el prompt y el catálogo MCP (teléfono
// en vez de PC) y, si está configurado, el modelo (conscious-brain/config.js).
// Se decide en el primer turno y queda en la sesión firmada. Sin cabecera, o con
// cualquier otra app, el turno es el de Windows de siempre, byte a byte
// (lo vigila scripts/verify-agent-platform.js).

const { freshSession, encodeSession, decodeSession } = require('../../domain/agent/session');
const { PLATFORMS, platformFromApp, platformOfSession } = require('../../domain/agent/platform');
const { imageSize, screenScale } = require('../../domain/agent/screenScale');
const { baseCatalog, catalogNames } = require('../../domain/agent/mcpCatalog');
const { learnedToMcp, workflowToMcp, InMemoryAgentLearningStore } = require('../../domain/agent/learning');
const { runProviderTurn } = require('../../infrastructure/conscious-brain');
const { resolveConsciousConfig } = require('../../infrastructure/conscious-brain/config');

// Key de un proveedor PUNTUAL, sin pasar por la key activa general
// (MIRACLE_CONSCIOUS_LLM_API_KEY): esa es la del proveedor configurado AHORA,
// no necesariamente el que quedó congelado en la sesión de este hilo. Mismas
// variables que resuelve config.js para "otro proveedor" (ver androidAppConfig).
function apiKeyForFrozenProvider(provider) {
  const v = (name) => `${process.env[name] || ''}`.trim();
  return provider === 'gemini'
    ? (v('MIRACLE_CONSCIOUS_LLM_GOOGLE_API_KEY') || v('GEMINI_API_KEY') || v('GOOGLE_API_KEY'))
    : (v('MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY') || v('OPENAI_API_KEY'));
}

function missingKeyMessageForProvider(provider) {
  return provider === 'gemini'
    ? 'GEMINI_API_KEY no está configurada en el entorno.'
    : 'OPENAI_API_KEY no está configurada en el entorno.';
}

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
   * (gestos + sistema) + herramientas aprendidas + workflows DE LA SUPERFICIE
   * ACTUAL (scoping por origin+pathname del SurfaceLocator). Todo esto es
   * innovación server-side; el cliente solo recibe el `Action[]` resultante.
   *
   * Devuelve además el mapa herramienta→workflowId: el nombre MCP (workflow_*)
   * es para el modelo; el cliente ejecuta por id (WorkflowPlayer), así que el
   * turno inyecta el id en los args de la llamada (ver handleTurn).
   *
   * La base depende de la plataforma; aprendidas y workflows son iguales en las dos.
   * `workflowAccess` es el de la API key que llama: cada key ve sus workflows y los globales.
   */
  async assembleTools(userId, apps, surface = null, platform = PLATFORMS.WINDOWS, workflowAccess = null) {
    const learned = await this.learningStore.learnedTools(userId, apps, surface, workflowAccess);
    const workflows = await this.learningStore.workflows(userId, apps, surface, workflowAccess);
    const workflowTools = workflows.map(workflowToMcp);
    const workflowIdByTool = new Map(
      workflowTools.map((tool, i) => [tool.name, `${workflows[i].id || workflows[i].name || ''}`])
    );
    const tools = [...baseCatalog(platform), ...learned.map(learnedToMcp), ...workflowTools];
    return { tools, workflowIdByTool };
  }

  /**
   * Resuelve un turno. Devuelve {status, json} para que la ruta lo escriba tal
   * cual — misma matriz de códigos del backend viejo: 400 request inválido,
   * 500 provider sin configurar, 502 error del cerebro.
   *
   * @param {object} [context] lo que la ruta sabe de la petición y el cuerpo no:
   *   `app` es X-Miracle-App tal como llegó (se normaliza aquí);
   *   `workflowAccess` es el acceso de la API key (requireApiKey) que acota los workflows.
   */
  async handleTurn(body = {}, context = {}) {
    // La plataforma se fija en el PRIMER turno y después manda la sesión firmada:
    // un hilo no cambia de dispositivo a mitad, igual que no cambia de modelo. Se
    // resuelve antes que la config porque Android puede tener modelo propio. La
    // sesión se decodifica aquí solo para leerla; si está rota, el error sale más
    // abajo, en su lugar de la matriz (primero 500 sin cerebro, luego los 400).
    let decoded = null;
    let decodeError = null;
    if (body.session) {
      try {
        decoded = decodeSession(body.session);
      } catch (error) {
        decodeError = error;
      }
    }
    const platform = body.session ? platformOfSession(decoded) : platformFromApp(context && context.app);

    const config = this.resolveConfig({ platform });
    if (!config.configured) {
      return { status: 500, json: { error: config.errorMessage } };
    }

    // La key del cerebro va por el proveedor CONGELADO en la sesión, no por el
    // que esté configurado en este instante: si cambia a mitad de hilo, la key
    // de un proveedor no puede viajar al otro (ver cabecera del archivo).
    const sessionProvider = (body.session && !decodeError && decoded) ? decoded.provider : config.provider;
    let apiKey = config.apiKey;
    if (sessionProvider !== config.provider) {
      apiKey = apiKeyForFrozenProvider(sessionProvider);
      if (!apiKey) {
        return { status: 500, json: { error: missingKeyMessageForProvider(sessionProvider) } };
      }
    }

    if (!body.state || typeof body.state.screen !== 'string') {
      return { status: 400, json: { error: 'falta `state` (screen, uiContext, width, height)' } };
    }

    const userId = `${body.userId || ''}`.trim() || 'anon';

    let session;
    try {
      if (decodeError) throw decodeError;
      session = body.session
        ? decoded
        : freshSession(config.provider, `${body.goal || ''}`.trim(), config.model, config.effort, platform);
    } catch (error) {
      return { status: 400, json: { error: `sesión inválida: ${error.message}` } };
    }
    if (!body.session && !session.goal) {
      return { status: 400, json: { error: 'el primer turno requiere `goal`' } };
    }

    if (typeof body.inform === 'string') session.informText = body.inform;

    try {
      const apps = Array.isArray(body.state.apps) ? body.state.apps : [];
      const surface = {
        id: `${body.state.surfaceId || ''}`.trim(),
        origin: `${body.state.surfaceOrigin || ''}`.trim(),
        pathname: `${body.state.surfacePathname || ''}`.trim()
      };
      const workflowAccess = (context && context.workflowAccess) || null;
      const { tools, workflowIdByTool } = await this.assembleTools(userId, apps, surface, platform, workflowAccess);
      const memory = await this.memoryRepository.forPrompt(userId);

      // Android manda la captura achicada: el modelo da píxeles de la imagen y el
      // cliente espera píxeles de pantalla (domain/agent/screenScale). La última
      // imagen legible queda en la sesión, por si el modelo toca en un turno sin
      // captura. Windows no pasa por aquí: su sesión y sus coordenadas no cambian.
      let screenScaleOfTurn = null;
      if (platform === PLATFORMS.ANDROID) {
        const image = imageSize(body.state.screenshot) || session.imageSize || null;
        if (image) session.imageSize = image;
        screenScaleOfTurn = screenScale({ platform, state: body.state, image });
      }

      const { session: next, turn } = await this.runProviderTurn({
        session,
        tools,
        mcpNames: catalogNames(tools),
        memory,
        apps,
        state: body.state,
        results: Array.isArray(body.results) ? body.results : [],
        apiKey,
        screenScale: screenScaleOfTurn
      });

      // El modelo llama workflow_<nombre>; el cliente ejecuta por id (WorkflowPlayer).
      // Se inyecta aquí porque solo este turno conoce el mapa nombre→id del catálogo.
      for (const action of turn.actions || []) {
        if (action && action.kind === 'mcp' && workflowIdByTool.has(action.tool)) {
          action.args = { ...(action.args || {}), workflow_id: workflowIdByTool.get(action.tool) };
        }
      }

      return { status: 200, json: { session: encodeSession(next), ...turn } };
    } catch (error) {
      return { status: 502, json: { error: `cerebro: ${error.message}` } };
    }
  }
}

module.exports = AgentTurnService;
