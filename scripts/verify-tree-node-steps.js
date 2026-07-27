// Verifica el contrato del paso de árbol SAP (nodeKey / nodePath / nodeAction) de punta a punta
// dentro del proceso: entidad -> plan de ejecución. Ver CONTRATO-PASO-ARBOL (acordado con el lado C#).
//
// Por qué existe: el cliente Windows va a emitir pasos de árbol ("clic en el nodo vw00073 del
// Entorno de trabajo"). Si la entidad Step descarta esos campos, el workflow se guarda mudo y el
// player recibe un click sin nodo -> SetFocus() al árbol entero (el bug original). Este script
// reproduce ese contrato ANTES del fix y lo protege después.
//
// Sin dependencias externas (ni Neo4j ni servidor): mismo patrón que el resto de scripts verify-*.

const assert = require('node:assert');
const Step = require('../src/domain/entities/Step');
const WorkflowExecutor = require('../src/application/use-cases/WorkflowExecutor');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${name}\n     ${error.message}`);
  }
}

console.log('Contrato del paso de árbol SAP:');

const treeStepData = {
  actionType: 'click',
  selector: 'sap:wnd[0]/shellcont/shellcont/shell/shellcont[0]/shell',
  label: 'Órdenes Clínicas',
  controlType: 'treeitem',
  nodeKey: 'vw00073',
  nodePath: '1\\2\\7',
  nodeAction: 'double',
  stepOrder: 3
};

check('Step conserva nodeKey', () => {
  assert.strictEqual(new Step(treeStepData).nodeKey, 'vw00073');
});

check('Step conserva nodePath', () => {
  assert.strictEqual(new Step(treeStepData).nodePath, '1\\2\\7');
});

check('Step conserva nodeAction', () => {
  assert.strictEqual(new Step(treeStepData).nodeAction, 'double');
});

check('nodeAction inválido se normaliza a vacío (el ejecutor asume double)', () => {
  assert.strictEqual(new Step({ ...treeStepData, nodeAction: 'triple' }).nodeAction, '');
});

check('un step normal no gana campos fantasma con contenido', () => {
  const plain = new Step({ actionType: 'input', selector: 'sap:wnd[0]/usr/txtX', value: '42' });
  assert.strictEqual(plain.nodeKey, '');
  assert.strictEqual(plain.nodePath, '');
  assert.strictEqual(plain.nodeAction, '');
});

check('el plan de ejecución pasa el paso de árbol con sus campos intactos', () => {
  const executor = new WorkflowExecutor({ getWorkflowById: async () => null });
  const plan = executor.buildExecutionPlan({
    id: 'wf_test_tree',
    description: 'crear paciente (prueba)',
    appId: 'saplogon.exe',
    steps: [new Step(treeStepData)]
  });
  assert.strictEqual(plan.steps.length, 1);
  assert.strictEqual(plan.steps[0].nodeKey, 'vw00073');
  assert.strictEqual(plan.steps[0].nodePath, '1\\2\\7');
  assert.strictEqual(plan.steps[0].nodeAction, 'double');
});

check('el paso de árbol cuenta como ejecutable (click con selector)', () => {
  const executor = new WorkflowExecutor({ getWorkflowById: async () => null });
  assert.ok(executor.isExecutableStep(new Step(treeStepData)));
});

check('el agrupador del catálogo conserva los campos en el round-trip fila→workflow→plan', () => {
  const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');
  const catalog = new WorkflowCatalog({});
  const row = {
    id: 'wf_test_tree',
    description: 'crear paciente (prueba)',
    appId: 'saplogon.exe',
    actionType: 'click',
    selector: treeStepData.selector,
    label: treeStepData.label,
    controlType: 'treeitem',
    nodeKey: treeStepData.nodeKey,
    nodePath: treeStepData.nodePath,
    nodeAction: treeStepData.nodeAction,
    stepOrder: 1
  };
  const [workflow] = catalog.groupWorkflowRows([row]);
  assert.strictEqual(workflow.steps[0].nodeKey, 'vw00073');
  assert.strictEqual(workflow.steps[0].nodePath, '1\\2\\7');
  assert.strictEqual(workflow.steps[0].nodeAction, 'double');

  const plan = new WorkflowExecutor({ getWorkflowById: async () => null })
    .buildExecutionPlan(workflow);
  assert.strictEqual(plan.steps[0].nodeKey, 'vw00073');
});

if (failures > 0) {
  console.error(`\n${failures} verificación(es) fallaron.`);
  process.exit(1);
}
console.log('\nTodo el contrato del paso de árbol verificado.');
