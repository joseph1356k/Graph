// Las herramientas de Miracle Notes en el catálogo del cerebro: declaradas SOLO
// para turnos de aparatos con vínculo médico activo, ejecutadas por el cliente.
//   node scripts/verify-notes-tools.js
//
// Usa el AgentTurnService real con un cerebro de mentira que captura lo que el
// turno le declara — exactamente la costura que el cliente Windows no ve.
const assert = require('assert');

const AgentTurnService = require('../src/application/use-cases/AgentTurnService');
const { notesCatalog } = require('../src/domain/agent/mcpCatalog');

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  console.log('Catálogo clínico del cerebro:');

  let declared = null;
  let declaredMcpNames = null;
  const service = new AgentTurnService({
    memoryRepository: { forPrompt: async () => '' },
    resolveConfig: () => ({
      configured: true, provider: 'openai', model: 'gpt-test', effort: 'low', apiKey: 'k'
    }),
    runProviderTurn: async ({ session, tools, mcpNames }) => {
      declared = tools;
      declaredMcpNames = mcpNames;
      return {
        session,
        turn: {
          ok: true,
          actions: [{ kind: 'mcp', tool: 'notes_nueva_consulta', args: { plantilla_id: 'tpl-1', tipo: 'presencial' } }]
        }
      };
    }
  });

  const body = { goal: 'atiende la consulta', state: { screen: '(pantalla)', apps: [] } };

  // --- sin identidad de aparato: el catálogo clínico NO existe ----------------
  let result = await service.handleTurn(body, {});
  assert.strictEqual(result.status, 200);
  assert.ok(!declared.some((tool) => tool.name.startsWith('notes_')),
    'sin apiClient no se declara ninguna notes_*');
  check('turno sin identidad → el modelo ni ve las herramientas clínicas');

  // --- key de env (sin vínculo): tampoco --------------------------------------
  result = await service.handleTurn(body, { apiClient: { label: 'fleet', deviceId: null, clinicalLink: null } });
  assert.ok(!declared.some((tool) => tool.name.startsWith('notes_')));
  check('key de env o aparato sin vincular → tampoco (clinicalLink es la llave)');

  // --- aparato con vínculo: la familia completa -------------------------------
  result = await service.handleTurn(body, {
    apiClient: {
      label: 'Consultorio 3',
      deviceId: 'maquina-1',
      clinicalLink: { linkId: 'l1', doctorId: '11111111-1111-4111-8111-111111111111', organizationId: 'org-1' }
    }
  });
  assert.strictEqual(result.status, 200);
  const expected = notesCatalog().map((tool) => tool.name);
  for (const name of expected) {
    assert.ok(declared.some((tool) => tool.name === name), `falta ${name}`);
    assert.ok(declaredMcpNames.has(name), `${name} no está en mcpNames (el parser no la reconocería)`);
  }
  check(`aparato vinculado → las ${expected.length} herramientas notes_* declaradas y reconocibles`);

  // --- la acción viaja al cliente tal cual ------------------------------------
  const action = result.json.actions.find((item) => item.tool === 'notes_nueva_consulta');
  assert.ok(action, 'la acción MCP llegó en la respuesta del turno');
  assert.deepStrictEqual(action.args, { plantilla_id: 'tpl-1', tipo: 'presencial' });
  check('la llamada del modelo llega al cliente como Action {kind:mcp} con sus args');

  // --- higiene del catálogo ----------------------------------------------------
  for (const tool of notesCatalog()) {
    assert.ok(tool.description.length > 20, `${tool.name} sin descripción útil`);
    assert.ok(Array.isArray(tool.params), `${tool.name} sin params`);
  }
  assert.ok(!notesCatalog().some((tool) => /firmar|exportar/i.test(tool.name)),
    'firmar/exportar no existen como herramientas: son del médico');
  check('catálogo: descripciones útiles y sin firmar/exportar (eso es del médico)');

  console.log(`\n${checks} comprobaciones pasaron.`);
}

main().catch((error) => {
  console.error(`\nFALLO: ${error.message}`);
  process.exit(1);
});
