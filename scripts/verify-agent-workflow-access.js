#!/usr/bin/env node
// Aislamiento de workflows por API key en el turno del agente, sin red ni Neo4j.
//   node scripts/verify-agent-workflow-access.js
//
// Cada API key de MIRACLE_API_KEYS es un dueño `api-client:<label>`
// (requireApiKey). El cerebro del turno declara los workflows como herramientas
// MCP, con su nombre y su descripción: si el catálogo no se acota a la key que
// llama, el modelo de un cliente lee y puede invocar lo que grabó otro.
//
// Se recorre la cadena REAL: requireApiKey → POST /api/v1/agent/turn →
// AgentTurnService → AgentWorkflowStore → WorkflowCatalog. Solo son falsos el
// repositorio (filtra como Neo4jWorkflowRepository.buildWorkflowVisibilityClause)
// y el cerebro (anota qué herramientas le llegaron).
const assert = require('assert');
const { requireApiKey } = require('../web/api/requireAuth');
const registerWindowsAgentRoutes = require('../web/api/registerWindowsAgentRoutes');
const AgentTurnService = require('../src/application/use-cases/AgentTurnService');
const AgentWorkflowStore = require('../src/application/use-cases/AgentWorkflowStore');
const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');

const KEY_A = 'verify-key-clinica-a';
const KEY_B = 'verify-key-clinica-b';

const step = (explanation) => ({ stepOrder: 0, actionType: 'click', explanation });
const ROWS = [
  { id: 'wf_propio_a', description: 'Admisión de la clínica A.', ownerId: 'api-client:clinica_a', scope: 'private', steps: [step('Abrir admisión A')] },
  { id: 'wf_propio_b', description: 'Facturación secreta de la clínica B.', ownerId: 'api-client:clinica_b', scope: 'private', steps: [step('Abrir facturación B')] },
  { id: 'wf_global', description: 'Abrir el HIS.', ownerId: '', scope: 'global', steps: [step('Abrir HIS')] },
  { id: 'wf_publicado', description: 'Publicado por un admin.', ownerId: 'admin-1', scope: 'global', steps: [step('Abrir agenda')] }
];

// Repositorio falso con la MISMA regla de visibilidad que el de Neo4j: sin dueño
// en el acceso no restringe; con dueño, lo propio más lo global (scope global o
// sin ownerId) salvo includeGlobal=false.
class FakeWorkflowRepository {
  constructor() {
    this.calls = [];
  }

  async getWorkflowRows(workflowId = null, access = null) {
    this.calls.push(access);
    const ownerId = `${(access && access.ownerId) || ''}`.trim();
    const includeGlobal = !access || access.includeGlobal !== false;
    return ROWS
      .filter((row) => !workflowId || row.id === workflowId)
      .filter((row) => {
        if (!ownerId) return true;
        if (row.ownerId === ownerId) return true;
        return includeGlobal && (row.scope === 'global' || !row.ownerId);
      })
      .flatMap((row) => row.steps.map((s) => ({ ...row, ...s, steps: undefined })));
  }
}

function mount() {
  const repository = new FakeWorkflowRepository();
  const seen = [];
  const service = new AgentTurnService({
    memoryRepository: { forPrompt: async () => '' },
    learningStore: new AgentWorkflowStore({ catalogService: new WorkflowCatalog(repository) }),
    resolveConfig: () => ({ provider: 'openai', apiKey: 'verify', model: 'gpt-verify', effort: 'low', configured: true }),
    runProviderTurn: async ({ session, tools }) => {
      seen.push(tools);
      return { session, turn: { actions: [], question: null, done: true, text: '', needsScreenshot: false, narration: '', speech: null, intents: [] } };
    }
  });
  let handler = null;
  const app = { post(path, fn) { if (path === '/api/v1/agent/turn') handler = fn; } };
  registerWindowsAgentRoutes(app, { agentTurnService: service, teachVideoService: {} });
  return { handler, repository, seen };
}

// Una petición que pasa por requireApiKey y, si la key es válida, por la ruta.
async function turnWithKey(mounted, key, appHeader = null) {
  const headers = { 'x-api-key': key };
  if (appHeader) headers['x-miracle-app'] = appHeader;
  const req = {
    body: { goal: 'abre lo mío', state: { screen: 'Escritorio', uiContext: '', width: 1920, height: 1080 }, results: [] },
    headers,
    get: (name) => headers[`${name}`.toLowerCase()]
  };
  const res = {
    statusCode: 0,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let passedGate = false;
  requireApiKey(req, res, () => { passedGate = true; });
  if (passedGate) await mounted.handler(req, res);
  const tools = mounted.seen[mounted.seen.length - 1] || [];
  return { status: res.statusCode, names: tools.map((tool) => tool.name), text: JSON.stringify(tools) };
}

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  not ok - ${name}\n      ${`${error.message}`.split('\n')[0].slice(0, 400)}`);
  }
}

async function main() {
  process.env.MIRACLE_API_KEYS = `clinica_a:${KEY_A},clinica_b:${KEY_B}`;

  for (const app of [null, 'android_app']) {
    const label = app ? 'android_app' : 'Windows';
    await check(`${label}: la key A ve sus workflows y los globales, y NO los de la key B (ni su descripción)`, async () => {
      const turn = await turnWithKey(mount(), KEY_A, app);
      assert.strictEqual(turn.status, 200);
      assert.ok(turn.names.includes('workflow_wf_propio_a'), `faltan los propios: ${turn.names.filter((n) => n.startsWith('workflow_'))}`);
      assert.ok(turn.names.includes('workflow_wf_global'), 'falta el global sin dueño');
      assert.ok(turn.names.includes('workflow_wf_publicado'), 'falta el global publicado');
      assert.ok(!turn.names.includes('workflow_wf_propio_b'), 'la key A ve el workflow de la key B');
      assert.ok(!turn.text.includes('Facturación secreta'), 'la descripción del workflow de B llegó al cerebro de A');
    });

    await check(`${label}: la key B ve lo suyo y los globales, y NO lo de la key A`, async () => {
      const turn = await turnWithKey(mount(), KEY_B, app);
      assert.strictEqual(turn.status, 200);
      assert.ok(turn.names.includes('workflow_wf_propio_b'), 'faltan los propios de B');
      assert.ok(turn.names.includes('workflow_wf_global'), 'falta el global para B');
      assert.ok(!turn.names.includes('workflow_wf_propio_a'), 'la key B ve el workflow de la key A');
    });
  }

  await check('el catálogo se consulta con el acceso de la key que llama (api-client:<label> + globales)', async () => {
    const mounted = mount();
    await turnWithKey(mounted, KEY_A);
    assert.strictEqual(mounted.repository.calls.length, 1, 'se esperaba una sola consulta al catálogo');
    const access = mounted.repository.calls[0];
    assert.ok(access && access.ownerId === 'api-client:clinica_a', `acceso recibido: ${JSON.stringify(access)}`);
    assert.strictEqual(access.includeGlobal, true);
  });

  await check('una key inválida no llega al turno (401) y no consulta el catálogo', async () => {
    const mounted = mount();
    const turn = await turnWithKey(mounted, 'key-que-no-existe');
    assert.strictEqual(turn.status, 401);
    assert.strictEqual(mounted.repository.calls.length, 0);
  });

  await check('sin identidad del llamador el store no cae en el catálogo de todas las keys: devuelve []', async () => {
    const repository = new FakeWorkflowRepository();
    const store = new AgentWorkflowStore({ catalogService: new WorkflowCatalog(repository) });
    assert.deepStrictEqual(await store.workflows('anon', [], null), []);
    assert.deepStrictEqual(await store.workflows('anon', [], null, { includeGlobal: true }), []);
    assert.strictEqual(repository.calls.length, 0, 'sin dueño no se consulta el catálogo');
  });

  console.log(`\nverify-agent-workflow-access: ${passed} checks ok, ${failed.length} fallidos`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
