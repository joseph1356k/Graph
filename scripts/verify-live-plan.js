// EL ARNÉS "CUANDO TÚ LO HAGAS": para CUALQUIER workflow ya existente (p.ej. uno recién enseñado
// desde la máquina con SAP), muestra el plan de ejecución con la sustitución dinámica aplicada,
// SIN ejecutar nada. Un comando = saber si el lado backend de ese workflow funciona antes de
// tocar SAP.
//
// Uso:  GRAPH_API_KEY=miracle_… node scripts/verify-live-plan.js <workflowId> "<context>"
//   ej: GRAPH_API_KEY=… node scripts/verify-live-plan.js wf_1785096110817 "paciente Ana Rojas, documento 111222333"
//       (context opcional: sin él muestra el plan con los valores grabados, como siempre)

const BASE = process.env.GRAPH_API_BASE || 'https://graph-eight-pied.vercel.app';
const KEY = process.env.GRAPH_API_KEY || '';
const [workflowId, context = ''] = process.argv.slice(2);

if (!KEY || !workflowId) {
  console.error('Uso: GRAPH_API_KEY=… node scripts/verify-live-plan.js <workflowId> "<context>"');
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
  try { json = await res.json(); } catch { /* no-JSON */ }
  return { status: res.status, json };
}

(async () => {
  console.log(`Workflow ${workflowId} · ${BASE}\n`);

  const got = await api('GET', `/api/v1/workflows/${workflowId}`);
  if (got.status !== 200) {
    console.error(`❌ no se pudo leer el workflow (HTTP ${got.status}): ${got.json?.error || ''}`);
    process.exit(1);
  }
  const wf = got.json.workflow || got.json;
  console.log(`«${wf.description || ''}» · app=${wf.appId || '-'} · origin=${wf.sourceOrigin || wf.sourceUrl || '-'}`);
  console.log('\nPasos grabados (modo → cómo se comporta al reejecutar):');
  for (const s of wf.steps || []) {
    const mode = s.valueMode || '(sin modo: el clasificador no corrió o no decidió)';
    const bind = s.bindTo ? ` bindTo=${s.bindTo}` : '';
    const node = s.nodeKey ? ` nodeKey=${s.nodeKey}` : '';
    console.log(`  ${s.stepOrder}. [${s.actionType}] «${s.label}» → ${mode}${bind}${node}${s.value ? ` · grabado=«${s.value}»` : ''}`);
  }

  console.log(context
    ? `\nPlan con context: "${context}"`
    : '\nPlan SIN context (valores grabados, comportamiento clásico)');

  const plan = await api('POST', `/api/v1/workflows/${workflowId}/plan`, {
    variables: context ? { context } : {}
  });

  if (plan.status !== 200) {
    console.error(`\n❌ el plan falló (HTTP ${plan.status}): ${plan.json?.error || ''}`);
    console.error('   Si lista campos faltantes: el context no trae esos datos (correcto: nunca se rellena con lo grabado).');
    console.error('   Si menciona LLM: falta GRAPH_LLM_API_KEY en el backend.');
    process.exit(1);
  }

  const steps = plan.json.execution_plan?.steps || [];
  console.log('\nPlan resultante:');
  for (const s of steps) {
    const dyn = s.valueMode === 'dynamic' ? ' ← DINÁMICO' : '';
    const val = s.actionType === 'select' ? (s.selectedValue || s.value || '') : (s.value || '');
    console.log(`  ${s.stepOrder}. [${s.actionType}] «${s.label}»${val ? ` = «${val}»` : ''}${dyn}`);
  }
  console.log(`\n✅ plan construido: ${steps.length} pasos ejecutables.`);
})().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
