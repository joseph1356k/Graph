// PRUEBA E2E EN VIVO de la sustitución dinámica, contra el backend desplegado (Vercel).
//
// Recorre el ciclo COMPLETO que usará el equipo, por la misma API pública que usa el cliente
// Windows: autora un workflow estilo "crear paciente" con campos dinámicos explícitos → verifica
// que la clasificación explícita sobrevive al finish → pide el plan con un contexto nuevo →
// verifica que los valores sustituidos son los del contexto (no los grabados) → verifica que un
// contexto incompleto falla listando qué falta.
//
// Uso:  GRAPH_API_KEY=miracle_… node scripts/e2e-dynamic-live.js
//       (opcional GRAPH_API_BASE, default https://graph-eight-pied.vercel.app)
//
// Crea un workflow marcado "[prueba e2e]" en la base real; se borra después desde el dashboard.

const assert = require('node:assert');

const BASE = process.env.GRAPH_API_BASE || 'https://graph-eight-pied.vercel.app';
const KEY = process.env.GRAPH_API_KEY || '';

if (!KEY) {
  console.error('Falta GRAPH_API_KEY (la X-API-Key de /api/v1).');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });
  let json = null;
  try { json = await res.json(); } catch { /* cuerpo no-JSON */ }
  return { status: res.status, json };
}

function fail(msg, extra) {
  console.error(`\n❌ ${msg}`);
  if (extra !== undefined) console.error(JSON.stringify(extra, null, 2).slice(0, 2000));
  process.exit(1);
}

const STEPS = [
  {
    actionType: 'click',
    selector: 'sap:wnd[0]/shellcont/shellcont/shell/shellcont[0]/shell#node=vw_demo01',
    label: 'Triaje administrativo (demo)',
    controlType: 'treeitem',
    nodeKey: 'vw_demo01',
    nodePath: '1\\2',
    valueMode: 'fixed'
  },
  {
    actionType: 'input',
    selector: 'sap:wnd[0]/usr/txtDEMO-DOC',
    label: 'Nº documento',
    controlType: 'text',
    value: '70103027',
    valueMode: 'dynamic',
    bindTo: 'documento'
  },
  {
    actionType: 'input',
    selector: 'sap:wnd[0]/usr/txtDEMO-NOM',
    label: 'Nombre del paciente',
    controlType: 'text',
    value: 'Cristian Felipe',
    valueMode: 'dynamic',
    bindTo: 'nombre'
  },
  {
    actionType: 'click',
    selector: 'sap:wnd[0]/usr/btnDEMO-BUSCAR',
    label: 'Buscar',
    controlType: 'button',
    valueMode: 'fixed'
  }
];

(async () => {
  console.log(`E2E sustitución dinámica · ${BASE}\n`);

  // 1. Autorar: sesión de learning + steps con modos explícitos + finish.
  console.log('1) Autorando workflow de prueba por la API de learning…');
  const open = await api('POST', '/api/v1/learning/sessions', {
    description: '[prueba e2e] crear paciente — verificación de sustitución dinámica',
    app_id: 'saplogon.exe',
    source_url: 'sapgui://DEMO/NV2000',
    source_origin: 'sapgui://DEMO',
    source_pathname: '/NV2000'
  });
  if (open.status !== 201) fail(`no se pudo abrir la sesión de learning (HTTP ${open.status})`, open.json);
  const wfId = open.json.session.workflow_id;
  console.log(`   sesión/workflow: ${wfId}`);

  for (const step of STEPS) {
    const r = await api('POST', `/api/v1/learning/sessions/${wfId}/steps`, step);
    if (r.status !== 201) fail(`no se pudo subir el paso «${step.label}» (HTTP ${r.status})`, r.json);
  }
  console.log(`   ${STEPS.length} pasos subidos`);

  const finish = await api('POST', `/api/v1/learning/sessions/${wfId}/finish`, {});
  if (finish.status !== 200) fail(`el finish falló (HTTP ${finish.status})`, finish.json);
  console.log('   finish OK (Graph estructuró y persistió en Neo4j)');

  // 2. La clasificación explícita sobrevive al clasificador LLM del finish.
  console.log('\n2) Verificando que los valueMode explícitos sobrevivieron…');
  const got = await api('GET', `/api/v1/workflows/${wfId}`);
  if (got.status !== 200) fail(`no se pudo leer el workflow (HTTP ${got.status})`, got.json);
  const steps = got.json.workflow?.steps || got.json.steps || [];
  const byLabel = (label) => steps.find((s) => s.label === label);
  try {
    assert.strictEqual(byLabel('Nº documento')?.valueMode, 'dynamic');
    assert.strictEqual(byLabel('Nº documento')?.bindTo, 'documento');
    assert.strictEqual(byLabel('Nombre del paciente')?.valueMode, 'dynamic');
  } catch (e) {
    fail('la clasificación explícita NO sobrevivió (¿deploy sin la regla "el que autora manda"?)', steps.map((s) => ({ label: s.label, valueMode: s.valueMode, bindTo: s.bindTo })));
  }
  console.log('   ✅ «Nº documento» y «Nombre del paciente» siguen dynamic con su bindTo');

  // 3. El plan con contexto sustituye los valores.
  const CONTEXT = 'paciente Ana María Rojas, documento 111222333';
  console.log(`\n3) Pidiendo plan con context: "${CONTEXT}"…`);
  const plan = await api('POST', `/api/v1/workflows/${wfId}/plan`, { variables: { context: CONTEXT } });
  if (plan.status !== 200) {
    fail(
      'el plan con contexto falló. Si el error menciona LLM, falta configurar GRAPH_LLM_API_KEY ' +
      '(y opcionalmente GRAPH_LLM_PROVIDER/GRAPH_LLM_MODEL) en el proyecto de Vercel.',
      plan.json
    );
  }
  const planSteps = plan.json.execution_plan?.steps || [];
  const planBy = (label) => planSteps.find((s) => s.label === label);
  console.log('   valores en el plan:');
  for (const s of planSteps) {
    if (s.valueMode === 'dynamic') console.log(`     · «${s.label}»: grabado=«${STEPS.find((x) => x.label === s.label)?.value}» → plan=«${s.value}»`);
  }
  try {
    assert.strictEqual(planBy('Nº documento')?.value, '111222333');
    const nombre = planBy('Nombre del paciente')?.value || '';
    assert.ok(nombre.includes('Ana'), `nombre sustituido inesperado: «${nombre}»`);
    assert.notStrictEqual(nombre, 'Cristian Felipe');
  } catch (e) {
    fail(`la sustitución no dio los valores del contexto: ${e.message}`, planSteps);
  }
  console.log('   ✅ el plan sale con los datos de ESTA ejecución, no los grabados');

  // 4. Contexto incompleto → error accionable, nunca el valor grabado en silencio.
  console.log('\n4) Pidiendo plan con contexto INCOMPLETO (sin nombre)…');
  const bad = await api('POST', `/api/v1/workflows/${wfId}/plan`, { variables: { context: 'documento 999888777' } });
  if (bad.status === 200) fail('el plan con contexto incompleto NO falló — habría creado al paciente grabado en silencio', bad.json);
  const msg = `${bad.json?.error || ''}`;
  if (!msg.includes('Nombre del paciente')) fail('el error no lista el campo faltante', bad.json);
  console.log(`   ✅ falla claro: "${msg.slice(0, 160)}"`);

  console.log(`\n🎉 E2E COMPLETO. La sustitución dinámica funciona de punta a punta contra ${BASE}`);
  console.log(`   workflow de prueba: ${wfId} — marcado "[prueba e2e]", borrar desde el dashboard cuando quieran.`);
})().catch((e) => fail(`error inesperado: ${e.message}`));
