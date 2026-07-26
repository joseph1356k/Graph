// Verifica la SUSTITUCIÓN DINÁMICA DE VALORES: que el `context` que manda el agente
// ("paciente Juan Pérez, documento 12345") reemplace los valores grabados en los steps
// clasificados valueMode='dynamic' al construir el plan de ejecución.
//
// Por qué existe: hasta ahora el context viajaba cliente -> /workflows/:id/plan -> executor
// y se descartaba — "crea un paciente llamado X" creaba SIEMPRE al paciente grabado. Este
// script reproduce ese contrato antes del fix y lo protege después.
//
// Sin dependencias externas (ni Neo4j, ni LLM real: el provider se simula), como los demás verify-*.

const assert = require('node:assert');
const Step = require('../src/domain/entities/Step');
const WorkflowExecutor = require('../src/application/use-cases/WorkflowExecutor');
const DynamicValueResolver = require('../src/application/use-cases/DynamicValueResolver');

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

// ── Utilería ────────────────────────────────────────────────────────────────

// Workflow estilo "crear paciente": navegación fija + documento y nombre dinámicos (nombre
// repartido en dos campos atados por bindTo) + un botón fijo.
function patientWorkflow() {
  return {
    id: 'wf_test_patient',
    description: 'crear paciente (prueba)',
    appId: 'saplogon.exe',
    branches: [],
    steps: [
      new Step({ stepOrder: 1, actionType: 'click', selector: 'sap:wnd[0]/shell#node=vw00073', label: 'Triaje administrativo', valueMode: 'fixed' }),
      new Step({ stepOrder: 2, actionType: 'input', selector: 'sap:wnd[0]/usr/txtDOC', label: 'Nº documento', value: '70103027', valueMode: 'dynamic', bindTo: 'documento' }),
      new Step({ stepOrder: 3, actionType: 'input', selector: 'sap:wnd[0]/usr/txtNOM1', label: 'Primer nombre', value: 'Cristian', valueMode: 'dynamic', bindTo: 'nombre' }),
      new Step({ stepOrder: 4, actionType: 'click', selector: 'sap:wnd[0]/usr/btnBUSCAR', label: 'Buscar', valueMode: 'fixed' })
    ]
  };
}

function executorWith(workflow, resolver) {
  return new WorkflowExecutor({ getWorkflowById: async () => workflow }, resolver);
}

// Un LLMProvider simulado con la misma interfaz que usa NoteFieldMatcher.
function fakeLlm(values, { calls = { count: 0 } } = {}) {
  return {
    _calls: calls,
    hasApiKey: () => true,
    parseJsonObject: (s) => JSON.parse(s),
    chatExpectingJsonWithUsage: async () => {
      calls.count += 1;
      return { content: JSON.stringify({ values }), usage: null, provider: 'fake' };
    }
  };
}

// ── Casos ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('Sustitución dinámica de valores:');

  await check('con contexto, los steps dynamic salen con el valor de ESTA ejecución', async () => {
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: '12345678', confidence: 0.95, evidence: 'documento 12345678' },
      { stepOrder: 3, value: 'Juan Pérez', confidence: 0.9, evidence: 'paciente Juan Pérez' }
    ]));
    const plan = await executorWith(patientWorkflow(), resolver)
      .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan Pérez, documento 12345678' });
    assert.strictEqual(plan.steps[1].value, '12345678');
    assert.strictEqual(plan.steps[2].value, 'Juan Pérez');
  });

  await check('los steps fixed NUNCA se tocan, con o sin contexto', async () => {
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: '12345678', confidence: 0.95, evidence: 'doc' },
      { stepOrder: 3, value: 'Juan', confidence: 0.9, evidence: 'nombre' },
      { stepOrder: 4, value: 'HACKED', confidence: 0.99, evidence: 'no debería aplicarse' }
    ]));
    const plan = await executorWith(patientWorkflow(), resolver)
      .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan, documento 12345678' });
    assert.strictEqual(plan.steps[0].selector, 'sap:wnd[0]/shell#node=vw00073');
    assert.strictEqual(plan.steps[3].value ?? '', '');
  });

  await check('sin contexto, el plan queda intacto y el LLM ni se llama (retrocompatibilidad)', async () => {
    const calls = { count: 0 };
    const resolver = new DynamicValueResolver(fakeLlm([], { calls }));
    const plan = await executorWith(patientWorkflow(), resolver)
      .getExecutionPlanById('wf_test_patient', {});
    assert.strictEqual(plan.steps[1].value, '70103027'); // el valor grabado, como siempre
    assert.strictEqual(calls.count, 0);
  });

  await check('un dynamic que el contexto NO trae hace fallar el plan con un error accionable', async () => {
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: '12345678', confidence: 0.95, evidence: 'doc' }
      // el nombre (paso 3) no viene
    ]));
    await assert.rejects(
      () => executorWith(patientWorkflow(), resolver)
        .getExecutionPlanById('wf_test_patient', { context: 'documento 12345678' }),
      (error) => {
        assert.match(error.message, /Primer nombre/); // dice QUÉ falta, no un error genérico
        return true;
      }
    );
  });

  await check('bindTo comparte el valor resuelto entre steps atados a la misma variable', async () => {
    const wf = patientWorkflow();
    wf.steps.push(new Step({
      stepOrder: 5, actionType: 'input', selector: 'sap:wnd[0]/usr/txtDOC2',
      label: 'Confirmar documento', value: '70103027', valueMode: 'dynamic', bindTo: 'documento'
    }));
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: '12345678', confidence: 0.95, evidence: 'doc' },
      { stepOrder: 3, value: 'Juan', confidence: 0.9, evidence: 'nombre' }
      // el paso 5 no viene: debe heredar el de su bindTo
    ]));
    const plan = await executorWith(wf, resolver)
      .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan, documento 12345678' });
    assert.strictEqual(plan.steps[4].value, '12345678');
  });

  await check('en un select dynamic se sustituye la CLAVE (selectedValue), no solo el texto', async () => {
    const wf = patientWorkflow();
    wf.steps[1] = new Step({
      stepOrder: 2, actionType: 'select', selector: 'sap:wnd[0]/usr/cmbTIPODOC', label: 'Tipo de documento',
      selectedValue: 'CC', valueMode: 'dynamic',
      allowedOptions: [{ value: 'CC', label: 'Cédula' }, { value: 'TI', label: 'Tarjeta de identidad' }]
    });
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: 'TI', confidence: 0.9, evidence: 'tarjeta de identidad' },
      { stepOrder: 3, value: 'Juan', confidence: 0.9, evidence: 'nombre' }
    ]));
    const plan = await executorWith(wf, resolver)
      .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan, tarjeta de identidad' });
    assert.strictEqual(plan.steps[1].selectedValue, 'TI');
    assert.strictEqual(plan.steps[1].selectedLabel, 'Tarjeta de identidad');
  });

  await check('con contexto y dynamics pero SIN LLM configurado, el plan falla claro (no repite el paciente grabado)', async () => {
    const resolver = new DynamicValueResolver({ hasApiKey: () => false });
    await assert.rejects(
      () => executorWith(patientWorkflow(), resolver)
        .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan, documento 12345678' }),
      /LLM/
    );
  });

  await check('el resolver descarta valores con confianza baja', async () => {
    const resolver = new DynamicValueResolver(fakeLlm([
      { stepOrder: 2, value: '99999999', confidence: 0.3, evidence: 'dudoso' },
      { stepOrder: 3, value: 'Juan', confidence: 0.9, evidence: 'nombre' }
    ]));
    await assert.rejects(
      () => executorWith(patientWorkflow(), resolver)
        .getExecutionPlanById('wf_test_patient', { context: 'paciente Juan' }),
      /Nº documento/
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nSustitución dinámica verificada.');
})();
