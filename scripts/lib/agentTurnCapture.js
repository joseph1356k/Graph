// Captura, SIN red ni keys, lo que el cerebro consciente le manda al proveedor en
// una conversación de dos turnos por la ruta REAL `POST /api/v1/agent/turn`.
//
// Monta registerWindowsAgentRoutes sobre una app falsa, stubbea `fetch` con
// respuestas fijas del proveedor y devuelve, por turno, el request que salió
// (URL, Authorization, cuerpo) y la respuesta HTTP que vio el cliente.
//
// POR QUÉ ES UN HELPER Y NO VIVE EN EL TEST. El snapshot de Windows
// (tests/fixtures/agent-platform/windows-snapshot.json) se sacó con ESTE archivo
// contra el código anterior a la plataforma Android. verify-agent-platform.js lo
// vuelve a correr contra el código actual: si los dos lados no usan exactamente
// las mismas entradas, la comparación no prueba nada.
const registerWindowsAgentRoutes = require('../../web/api/registerWindowsAgentRoutes');
const AgentTurnService = require('../../src/application/use-cases/AgentTurnService');
const { baseCatalog } = require('../../src/domain/agent/mcpCatalog');
const { learnedToMcp, workflowToMcp } = require('../../src/domain/agent/learning');
const { goalPrompt } = require('../../src/infrastructure/conscious-brain/prompt');
const { decodeSession } = require('../../src/domain/agent/session');

// Variables que decide el cerebro. Se borran TODAS antes de cada captura: un
// .env local o una variable del shell no pueden cambiar lo que se compara.
const ENV_FALLBACKS = [
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'MODEL', 'EFFORT',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL', 'SESSION_SECRET'
];

const MEMORY = 'WhatsApp:\n- "Sebas" es Sebastián Ríos';
const LEARNED = [{ name: 'Chat WhatsApp', app: 'WhatsApp', description: 'Abre un chat por nombre.', elements: ['Buscar', 'Enviar'] }];
const WORKFLOWS = [{ id: 'wf_demo', name: 'wf_demo', description: 'Abre el HIS en admisiones.', steps: [{ action: 'Abrir HIS', app: 'his.exe', subconscious: true }] }];

const FIRST_BODY = {
  goal: 'Pon una alarma a las 7 y abre el HIS',
  userId: 'u-verify',
  state: {
    screen: 'Escritorio',
    uiContext: 'Botón Inicio · Barra de tareas',
    width: 1920,
    height: 1080,
    screenshot: 'iVBORw0KGgo=',
    apps: ['Google Chrome', 'WhatsApp'],
    surfaceId: 'uia://explorer.exe/escritorio',
    surfaceOrigin: 'uia://explorer.exe',
    surfacePathname: '/escritorio'
  },
  results: []
};

function secondBody(session) {
  return {
    session,
    state: { ...FIRST_BODY.state, screen: 'Reloj', uiContext: 'Alarmas · 07:00' },
    results: ['ok', 'ok', 'ok'],
    inform: 'a las 7 de la mañana'
  };
}

// Respuestas fijas del proveedor: el turno 1 llama una herramienta del sistema,
// un workflow y computer-use; el turno 2 cierra con texto.
const CANNED = {
  openai: [
    {
      id: 'resp_1',
      output: [
        { type: 'function_call', call_id: 'c1', name: 'set_alarm', arguments: JSON.stringify({ hour: '7', minute: '0', message: '', intent: 'Pongo la alarma ⏰' }) },
        { type: 'function_call', call_id: 'c2', name: 'workflow_wf_demo', arguments: JSON.stringify({ context: '', intent: 'Abro el HIS' }) },
        { type: 'computer_call', call_id: 'c3', actions: [{ type: 'click', x: 10, y: 20 }] }
      ]
    },
    { id: 'resp_2', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Listo.' }] }] }
  ],
  gemini: [
    {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { name: 'set_alarm', args: { hour: '7', minute: '0', message: '', intent: 'Pongo la alarma ⏰' } } },
            { functionCall: { name: 'workflow_wf_demo', args: { context: '', intent: 'Abro el HIS' } } },
            { functionCall: { name: 'computer_tap', args: { x: 10, y: 20 } } }
          ]
        }
      }]
    },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Listo.' }] } }] }
  ]
};

function withEnv(env, run) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MIRACLE_CONSCIOUS_') || ENV_FALLBACKS.includes(key)) delete process.env[key];
  }
  process.env.SESSION_SECRET = 'verify-agent-platform-secret';
  Object.assign(process.env, env);
  const restore = () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  };
  return Promise.resolve().then(run).finally(restore);
}

function stubFetch() {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    const href = `${url}`;
    const kind = href.includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai';
    const count = requests.filter((request) => request.kind === kind).length;
    requests.push({
      kind,
      url: href,
      authorization: (init.headers && init.headers.Authorization) || '',
      body: init.body ? JSON.parse(init.body) : null
    });
    const payload = CANNED[kind][Math.min(count, CANNED[kind].length - 1)];
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  return { requests, restore: () => { global.fetch = original; } };
}

function mountTurnRoute() {
  const service = new AgentTurnService({
    memoryRepository: { forPrompt: async () => MEMORY },
    learningStore: { learnedTools: async () => LEARNED, workflows: async () => WORKFLOWS }
  });
  let handler = null;
  const app = { post(path, fn) { if (path === '/api/v1/agent/turn') handler = fn; } };
  registerWindowsAgentRoutes(app, { agentTurnService: service, teachVideoService: {} });
  return handler;
}

async function callRoute(handler, body, appHeader) {
  const headers = appHeader == null ? {} : { 'x-miracle-app': appHeader };
  const req = { body, headers, get: (name) => headers[`${name}`.toLowerCase()] };
  const res = {
    statusCode: 0,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(JSON.stringify(res.payload)) };
}

/**
 * Conversación de dos turnos. `firstApp`/`secondApp` son el valor de la cabecera
 * X-Miracle-App en cada turno (null = sin cabecera). Devuelve un turno por
 * request, con lo que salió hacia el proveedor y lo que volvió al cliente.
 */
async function captureConversation({ env = {}, firstApp = null, secondApp = null } = {}) {
  return withEnv(env, async () => {
    const handler = mountTurnRoute();
    const fetchStub = stubFetch();
    try {
      const first = await callRoute(handler, JSON.parse(JSON.stringify(FIRST_BODY)), firstApp);
      const firstRequests = fetchStub.requests.splice(0);
      const second = first.json && first.json.session
        ? await callRoute(handler, secondBody(first.json.session), secondApp)
        : null;
      const secondRequests = fetchStub.requests.splice(0);
      return [
        { requests: firstRequests, response: first },
        { requests: secondRequests, response: second }
      ];
    } finally {
      fetchStub.restore();
    }
  });
}

// Configuración de prueba por proveedor (valores falsos: nunca salen a la red).
const PROVIDER_ENVS = Object.freeze({
  openai: Object.freeze({ MIRACLE_CONSCIOUS_LLM_PROVIDER: 'openai', MIRACLE_CONSCIOUS_LLM_API_KEY: 'verify-openai-key', MIRACLE_CONSCIOUS_LLM_MODEL: 'gpt-verify' }),
  gemini: Object.freeze({ MIRACLE_CONSCIOUS_LLM_PROVIDER: 'google', MIRACLE_CONSCIOUS_LLM_API_KEY: 'verify-gemini-key', MIRACLE_CONSCIOUS_LLM_MODEL: 'gemini-verify' }),
  disabled: Object.freeze({ MIRACLE_CONSCIOUS_LLM_PROVIDER: 'disabled' })
});

// La matriz de errores del contrato (500 cerebro sin configurar, 400 request
// inválido) y su PRECEDENCIA: con el cerebro apagado y la sesión rota gana el 500.
const ERROR_CASES = Object.freeze([
  { name: 'sin state', env: 'openai', body: { goal: 'x' } },
  { name: 'primer turno sin goal', env: 'openai', body: { state: FIRST_BODY.state } },
  { name: 'sesión manipulada', env: 'openai', body: { session: 'abc.def', state: FIRST_BODY.state } },
  { name: 'cerebro deshabilitado y sesión manipulada', env: 'disabled', body: { session: 'abc.def', state: FIRST_BODY.state } }
]);

async function captureErrors(appHeader = null) {
  const out = [];
  for (const errorCase of ERROR_CASES) {
    const captured = await withEnv(PROVIDER_ENVS[errorCase.env], async () => {
      const fetchStub = stubFetch();
      try {
        const response = await callRoute(mountTurnRoute(), JSON.parse(JSON.stringify(errorCase.body)), appHeader);
        return { name: errorCase.name, response, providerCalls: fetchStub.requests.length };
      } finally {
        fetchStub.restore();
      }
    });
    out.push(captured);
  }
  return out;
}

/** Lee una sesión emitida por captureConversation (va firmada con el secreto de prueba). */
function readSession(token) {
  return withEnv({}, () => decodeSession(token));
}

/** Entradas fijas del prompt: con todo (memoria, aprendidas, workflows) y sin nada. */
function promptInputs(tools) {
  const full = [...tools, ...LEARNED.map(learnedToMcp), ...WORKFLOWS.map(workflowToMcp)];
  return {
    full: { goal: FIRST_BODY.goal, tools: full, memory: MEMORY, stateBlock: 'Pantalla actual: Escritorio' },
    bare: { goal: FIRST_BODY.goal, tools, memory: '', stateBlock: '' }
  };
}

/** Prompt de Windows tal como lo arma goalPrompt sin indicar plataforma. */
function windowsPrompts(prompt = goalPrompt, catalog = baseCatalog()) {
  const inputs = promptInputs(catalog);
  return { full: prompt(inputs.full), bare: prompt(inputs.bare) };
}

module.exports = {
  captureConversation,
  captureErrors,
  readSession,
  promptInputs,
  windowsPrompts,
  PROVIDER_ENVS,
  FIRST_BODY,
  MEMORY,
  LEARNED,
  WORKFLOWS
};
