// Captura, SIN red ni keys, lo que el cerebro consciente le manda al proveedor en
// una conversación de dos turnos por la ruta REAL `POST /api/v1/agent/turn`.
//
// Monta registerWindowsAgentRoutes sobre una app falsa, stubbea `fetch` con
// respuestas fijas del proveedor y devuelve, por turno, el request que salió
// (URL, Authorization, cuerpo) y la respuesta HTTP que vio el cliente.
//
// POR QUÉ ES UN HELPER Y NO VIVE EN EL TEST. El snapshot de Windows
// (tests/fixtures/agent-platform/windows-snapshot.json) se saca con ESTE archivo
// (scripts/lib/write-windows-snapshot.js) y verify-agent-platform.js lo vuelve a
// correr contra el código actual: si los dos lados no usan exactamente las mismas
// entradas, la comparación no prueba nada. Lo que U.exe VE de esas mismas
// conversaciones está congelado aparte, desde e9d0d44, en
// tests/fixtures/agent-platform/windows-contract-e9d0d44.json.
const registerWindowsAgentRoutes = require('../../web/api/registerWindowsAgentRoutes');
const AgentTurnService = require('../../src/application/use-cases/AgentTurnService');
const { baseCatalog } = require('../../src/domain/agent/mcpCatalog');
const { workflowToMcp } = require('../../src/domain/agent/learning');
const { normalizeProfile } = require('../../src/domain/agent/profile');
const { goalPrompt } = require('../../src/infrastructure/conscious-brain/prompt');
const { decodeSession } = require('../../src/domain/agent/session');

// Variables que decide el cerebro. Se borran TODAS antes de cada captura: un
// .env local o una variable del shell no pueden cambiar lo que se compara.
const ENV_FALLBACKS = [
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'MODEL', 'EFFORT',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL', 'SESSION_SECRET'
];

const MEMORY = 'WhatsApp:\n- "Sebas" es Sebastián Ríos';
// wf_demo es del PC (his.exe) y wf_tel del teléfono (android://): cada plataforma recibe solo el
// suyo (learning.js, workflowRunsOn), así que Windows ve lo mismo que antes de existir wf_tel.
const WORKFLOWS = [
  { id: 'wf_demo', name: 'wf_demo', description: 'Abre el HIS en admisiones.', steps: [{ action: 'Abrir HIS', app: 'his.exe' }] },
  { id: 'wf_tel', name: 'wf_tel', description: 'Le escribe a Sebas por WhatsApp.', sourceOrigin: 'android://com.whatsapp', steps: [{ action: 'Abrir el chat', app: 'com.whatsapp' }] }
];

// La hora, como la manda U.exe en cada turno (AgentLoop.cs): fija, para que el
// «Ahora: …» del estado no cambie entre corridas.
const CLOCK = Object.freeze({ timezone: 'America/Bogota', locale: 'es-CO', clientNowUtc: '2026-10-01T15:35:00Z' });

// Los perfiles del cable (domain/agent/profile.js).
const PROFILES = Object.freeze({
  medico: Object.freeze({ kind: 'medico', specialty: 'cardiologia', specialtyName: 'Cardiología' }),
  persona: Object.freeze({ kind: 'persona', specialty: '', specialtyName: '' })
});

const FIRST_BODY = {
  goal: 'Pon una alarma a las 7 y abre el HIS',
  userId: 'u-verify',
  ...CLOCK,
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
    inform: 'a las 7 de la mañana',
    ...CLOCK
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
    learningStore: { workflows: async () => WORKFLOWS }
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
 * X-Miracle-App en cada turno (null = sin cabecera); `profile`, el perfil del cable
 * en el primer turno (null = sin perfil, como una U.exe vieja). Devuelve un turno
 * por request, con lo que salió hacia el proveedor y lo que volvió al cliente.
 */
async function captureConversation({ env = {}, firstApp = null, secondApp = null, profile = null } = {}) {
  return withEnv(env, async () => {
    const handler = mountTurnRoute();
    const fetchStub = stubFetch();
    try {
      const firstBody = JSON.parse(JSON.stringify(FIRST_BODY));
      if (profile) firstBody.profile = profile;
      const first = await callRoute(handler, firstBody, firstApp);
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

/**
 * Un turno más sobre una sesión ya emitida, con OTRO entorno. Sirve para probar
 * que lo que la sesión congeló (plataforma, proveedor, modelo) no se mueve si las
 * variables cambian entre turnos. No interviene en el snapshot de Windows.
 */
async function continueConversation({ env = {}, session, app = null } = {}) {
  return withEnv(env, async () => {
    const handler = mountTurnRoute();
    const fetchStub = stubFetch();
    try {
      const response = await callRoute(handler, secondBody(session), app);
      return { requests: fetchStub.requests.splice(0), response };
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

/**
 * Entradas fijas del prompt: con todo (memoria y workflows), sin nada, y con todo
 * más cada perfil.
 */
function promptInputs(tools) {
  const full = [...tools, ...WORKFLOWS.map(workflowToMcp)];
  const withAll = { goal: FIRST_BODY.goal, tools: full, memory: MEMORY };
  return {
    full: withAll,
    bare: { goal: FIRST_BODY.goal, tools, memory: '' },
    medico: { ...withAll, profile: normalizeProfile(PROFILES.medico) },
    persona: { ...withAll, profile: normalizeProfile(PROFILES.persona) }
  };
}

/** Prompt de Windows tal como lo arma goalPrompt sin indicar plataforma. */
function windowsPrompts(prompt = goalPrompt, catalog = baseCatalog()) {
  const inputs = promptInputs(catalog);
  return {
    full: prompt(inputs.full),
    bare: prompt(inputs.bare),
    medico: prompt(inputs.medico),
    persona: prompt(inputs.persona)
  };
}

module.exports = {
  captureConversation,
  continueConversation,
  captureErrors,
  readSession,
  promptInputs,
  windowsPrompts,
  PROVIDER_ENVS,
  FIRST_BODY,
  CLOCK,
  PROFILES,
  MEMORY,
  WORKFLOWS
};
