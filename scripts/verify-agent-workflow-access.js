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
// repositorio y el cerebro (anota qué herramientas le llegaron). El repositorio
// falso NO copia la regla de visibilidad: filtra con la cláusula que arma el real,
// Neo4jWorkflowRepository.buildWorkflowVisibilityClause, evaluada sin Neo4j.
const assert = require('assert');
const { requireApiKey } = require('../web/api/requireAuth');
const registerWindowsAgentRoutes = require('../web/api/registerWindowsAgentRoutes');
const AgentTurnService = require('../src/application/use-cases/AgentTurnService');
const AgentWorkflowStore = require('../src/application/use-cases/AgentWorkflowStore');
const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');
const Neo4jWorkflowRepository = require('../src/infrastructure/repositories/Neo4jWorkflowRepository');

const KEY_A = 'verify-key-clinica-a';
const KEY_B = 'verify-key-clinica-b';

const step = (explanation) => ({ stepOrder: 0, actionType: 'click', explanation });
const ROWS = [
  { id: 'wf_propio_a', description: 'Admisión de la clínica A.', ownerId: 'api-client:clinica_a', scope: 'private', steps: [step('Abrir admisión A')] },
  { id: 'wf_propio_b', description: 'Facturación secreta de la clínica B.', ownerId: 'api-client:clinica_b', scope: 'private', steps: [step('Abrir facturación B')] },
  { id: 'wf_global', description: 'Abrir el HIS.', ownerId: '', scope: 'global', steps: [step('Abrir HIS')] },
  { id: 'wf_publicado', description: 'Publicado por un admin.', ownerId: 'admin-1', scope: 'global', steps: [step('Abrir agenda')] }
];

// ---- La regla REAL de visibilidad, evaluada sin Neo4j ------------------------
// buildWorkflowVisibilityClause devuelve un trozo de WHERE de Cypher y llena sus
// parámetros. Este evaluador entiende justo el subconjunto que ese builder usa
// (alias.prop, $param, 'texto', true/false/null, =, <>, AND, OR, NOT, coalesce y
// paréntesis) con la lógica de tres valores de Cypher: el WHERE deja pasar solo lo
// que da true. Si el builder empieza a usar otra sintaxis, el evaluador lanza y el
// check se pone rojo: se amplía el evaluador, no se vuelve a copiar la regla.
function cypherPredicate(clause, params, alias) {
  if (!`${clause || ''}`.trim()) return () => true;
  const tokens = [];
  const lexer = /\s*(?:(<>|=|\(|\)|,)|'((?:[^'\\]|\\.)*)'|\$([A-Za-z_]\w*)|([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?)/y;
  let at = 0;
  while (at < clause.length) {
    if (!clause.slice(at).trim()) break;
    lexer.lastIndex = at;
    const m = lexer.exec(clause);
    if (!m) throw new Error(`cláusula con sintaxis que el evaluador no conoce: «${clause.slice(at)}»`);
    at = lexer.lastIndex;
    if (m[1]) tokens.push({ op: m[1] });
    else if (m[2] !== undefined) tokens.push({ value: m[2].replace(/\\(.)/g, '$1') });
    else if (m[3]) tokens.push({ param: m[3] });
    else if (m[5]) tokens.push({ prop: [m[4], m[5]] });
    else tokens.push({ word: m[4].toUpperCase() });
  }
  let i = 0;
  const peek = (key, val) => tokens[i] && tokens[i][key] === val;
  const expect = (key, val) => {
    if (!peek(key, val)) throw new Error(`se esperaba «${val}» en «${clause}»`);
    i += 1;
  };
  const or = () => {
    const parts = [and()];
    while (peek('word', 'OR')) { i += 1; parts.push(and()); }
    return parts.length === 1 ? parts[0] : (row) => {
      const values = parts.map((part) => part(row));
      return values.includes(true) ? true : values.includes(null) ? null : false;
    };
  };
  const and = () => {
    const parts = [not()];
    while (peek('word', 'AND')) { i += 1; parts.push(not()); }
    return parts.length === 1 ? parts[0] : (row) => {
      const values = parts.map((part) => part(row));
      return values.includes(false) ? false : values.includes(null) ? null : true;
    };
  };
  const not = () => {
    if (!peek('word', 'NOT')) return comparison();
    i += 1;
    const inner = not();
    return (row) => { const v = inner(row); return v === null ? null : !v; };
  };
  const comparison = () => {
    const left = value();
    if (!peek('op', '=') && !peek('op', '<>')) return left;
    const equal = tokens[i].op === '=';
    i += 1;
    const right = value();
    return (row) => {
      const a = left(row);
      const b = right(row);
      if (a === null || b === null) return null;
      return equal ? a === b : a !== b;
    };
  };
  const value = () => {
    const token = tokens[i];
    if (!token) throw new Error(`la cláusula termina antes de tiempo: «${clause}»`);
    i += 1;
    if (token.op === '(') { const inner = or(); expect('op', ')'); return inner; }
    if (token.value !== undefined) return () => token.value;
    if (token.param) {
      if (!(token.param in params)) throw new Error(`la cláusula usa $${token.param} y no está en los parámetros`);
      return () => params[token.param];
    }
    if (token.prop) {
      if (token.prop[0] !== alias) throw new Error(`la cláusula usa el alias ${token.prop[0]}, no ${alias}`);
      return (row) => (row[token.prop[1]] === undefined ? null : row[token.prop[1]]);
    }
    if (token.word === 'TRUE' || token.word === 'FALSE') return () => token.word === 'TRUE';
    if (token.word === 'NULL') return () => null;
    if (token.word === 'COALESCE') {
      expect('op', '(');
      const args = [or()];
      while (peek('op', ',')) { i += 1; args.push(or()); }
      expect('op', ')');
      return (row) => { for (const arg of args) { const v = arg(row); if (v !== null) return v; } return null; };
    }
    throw new Error(`token que el evaluador no conoce en «${clause}»: ${JSON.stringify(token)}`);
  };
  const predicate = or();
  if (i !== tokens.length) throw new Error(`sobra cláusula sin evaluar: «${clause}»`);
  return (row) => predicate(row) === true;
}

/** Filtro de filas con la cláusula y los parámetros que arma el repositorio REAL para `access`. */
function visibleTo(access) {
  const params = {};
  const clause = new Neo4jWorkflowRepository(null).buildWorkflowVisibilityClause('w', access, params);
  return { clause, params, visible: cypherPredicate(clause, params, 'w') };
}

// Repositorio falso: guarda cada acceso recibido y filtra con la regla real.
class FakeWorkflowRepository {
  constructor() {
    this.calls = [];
  }

  async getWorkflowRows(workflowId = null, access = null) {
    this.calls.push(access);
    const { visible } = visibleTo(access);
    return ROWS
      .filter((row) => !workflowId || row.id === workflowId)
      .filter(visible)
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

  await check('la regla REAL (buildWorkflowVisibilityClause) con owner api-client:a deja lo propio y lo global, y saca lo de otro dueño', async () => {
    const nodes = [
      { id: 'propio', ownerId: 'api-client:a', scope: 'private' },
      { id: 'propio_sin_scope', ownerId: 'api-client:a' },
      { id: 'global_sin_duenio', ownerId: '', scope: 'global' },
      { id: 'global_publicado', ownerId: 'admin-1', scope: 'global' },
      { id: 'legado_sin_duenio' },
      { id: 'ajeno', ownerId: 'api-client:b', scope: 'private' },
      { id: 'ajeno_sin_scope', ownerId: 'api-client:b' },
      { id: 'ajeno_prefijo', ownerId: 'api-client:ab', scope: 'private' }
    ];
    const ids = (access) => {
      const { visible } = visibleTo(access);
      return nodes.filter(visible).map((node) => node.id);
    };

    const { clause, params } = visibleTo({ ownerId: 'api-client:a', includeGlobal: true });
    assert.ok(clause, 'con dueño la cláusula no puede venir vacía');
    assert.strictEqual(params.accessOwnerId, 'api-client:a', `parámetros: ${JSON.stringify(params)}`);
    assert.ok(!clause.includes('api-client:a'), `el dueño va por parámetro, no pegado en la cláusula: ${clause}`);
    assert.deepStrictEqual(ids({ ownerId: 'api-client:a', includeGlobal: true }), ['propio', 'propio_sin_scope', 'global_sin_duenio', 'global_publicado', 'legado_sin_duenio']);
    assert.deepStrictEqual(ids({ ownerId: 'api-client:a', includeGlobal: false }), ['propio', 'propio_sin_scope'], 'includeGlobal=false deja solo lo propio');

    // Un dueño con comillas no se cuela en el Cypher ni abre lo ajeno.
    const hostile = "api-client:a' OR true OR '";
    assert.ok(!visibleTo({ ownerId: hostile }).clause.includes(hostile), 'el dueño se pegó en la cláusula');
    assert.deepStrictEqual(ids({ ownerId: hostile }), ['global_sin_duenio', 'global_publicado', 'legado_sin_duenio']);
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
