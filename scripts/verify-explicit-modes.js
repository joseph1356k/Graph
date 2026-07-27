// Verifica la regla "EL QUE AUTORA MANDA": los valueMode/bindTo explícitos que trae un step al
// grabarse/autorarse se persisten tal cual, y el clasificador LLM del finish solo RELLENA los que
// quedaron sin modo — nunca pisa lo explícito.
//
// También protege contra un bug preexistente: updateFullWorkflow/copyWorkflow reconstruyen los
// steps y antes DESCARTABAN valueMode/bindTo (el prepend-alignment borraba la clasificación).
//
// Sin Neo4j real: se captura lo que el repositorio le manda a la base (db.run simulado).

const assert = require('node:assert');
const Step = require('../src/domain/entities/Step');
const Neo4jWorkflowRepository = require('../src/infrastructure/repositories/Neo4jWorkflowRepository');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${name}\n     ${error.message}`);
  }
}

function capturingRepo() {
  const calls = [];
  const repo = new Neo4jWorkflowRepository({
    run: async (query, params) => { calls.push({ query, params }); return []; }
  });
  return { repo, calls };
}

(async () => {
  console.log('Regla "el que autora manda" (valueMode/bindTo explícitos):');

  await check('Step marca si el valueMode vino explícito en el request', () => {
    assert.strictEqual(new Step({ actionType: 'input', valueMode: 'dynamic' }).valueModeExplicit, true);
    assert.strictEqual(new Step({ actionType: 'input' }).valueModeExplicit, false);
    assert.strictEqual(new Step({ actionType: 'input', valueMode: 'cualquiercosa' }).valueModeExplicit, false);
  });

  await check('addStep persiste valueMode/bindTo cuando son explícitos', async () => {
    const { repo, calls } = capturingRepo();
    const step = new Step({ actionType: 'input', selector: 'sap:x', label: 'Documento', valueMode: 'dynamic', bindTo: 'documento' });
    await repo.addStep('wf1', step, 1, null);
    const create = calls.find((c) => c.query.includes('CREATE (s:Step'));
    assert.strictEqual(create.params.valueMode, 'dynamic');
    assert.strictEqual(create.params.bindTo, 'documento');
  });

  await check('addStep deja valueMode/bindTo SIN persistir (null) cuando no vinieron — el clasificador podrá llenarlos', async () => {
    const { repo, calls } = capturingRepo();
    const step = new Step({ actionType: 'input', selector: 'sap:x', label: 'Documento' });
    await repo.addStep('wf1', step, 1, null);
    const create = calls.find((c) => c.query.includes('CREATE (s:Step'));
    assert.strictEqual(create.params.valueMode, null);
    assert.strictEqual(create.params.bindTo, null);
  });

  await check('el clasificador RELLENA sin pisar: setStepValueModes usa coalesce con lo ya persistido', async () => {
    const { repo, calls } = capturingRepo();
    await repo.setStepValueModes('wf1', [{ stepOrder: 1, valueMode: 'fixed', bindTo: '' }], null);
    const q = calls.find((c) => c.query.includes('s.valueMode')).query;
    assert.match(q, /coalesce\(\s*s\.valueMode/);
    assert.match(q, /coalesce\(\s*s\.bindTo/);
  });

  await check('updateFullWorkflow conserva valueMode/bindTo al reconstruir los steps (bug del prepend-alignment)', async () => {
    const { repo, calls } = capturingRepo();
    await repo.updateFullWorkflow({
      id: 'wf1', description: '', summary: '', executionGuide: '', status: 'complete', scope: 'global',
      ownerId: '', appId: '', sourceUrl: '', sourceOrigin: '', sourcePathname: '', sourceTitle: '',
      contextNotes: '',
      steps: [new Step({ stepOrder: 1, actionType: 'input', selector: 'sap:x', label: 'Documento', valueMode: 'dynamic', bindTo: 'documento' })]
    });
    const call = calls.find((c) => c.query.includes('UNWIND $steps'));
    assert.match(call.query, /valueMode: step\.valueMode/);
    assert.strictEqual(call.params.steps[0].valueMode, 'dynamic');
    assert.strictEqual(call.params.steps[0].bindTo, 'documento');
  });

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nRegla "el que autora manda" verificada.');
})();
