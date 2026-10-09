// Evaluación del retrieval de guías del asistente con un conjunto fijo de
// preguntas reales de consulta (scripts/fixtures/rag-eval.json):
//   - parafraseo: la misma duda dicha como la diría un médico en consulta;
//   - digitación: errores de tecleo frecuentes;
//   - seguimiento: preguntas cortas que dependen de la anterior;
//   - población: la misma pregunta con un niño, un adulto o una gestante;
//   - fuera de tema: charla o preguntas de la app que NO deben traer guías.
// Mide recall@1, recall@3, MRR y la latencia de búsqueda, y falla si alguna
// métrica cae por debajo del umbral. Sin modelo, sin red: corre en `npm test`.
//   node scripts/eval-guideline-retrieval.js [--verbose]
const assert = require('assert');
const fixtures = require('./fixtures/rag-eval.json');
const {
  loadDefaultIndex,
  buildRetrievalContext,
  lastUserQuestion,
  inferPopulations
} = require('../src/application/knowledge/ClinicalGuidelineIndex');

const THRESHOLDS = Object.freeze({
  recallAt3: 0.9,
  mrr: 0.75,
  offTopicPrecision: 1,
  p95LatencyMs: 25
});

const verbose = process.argv.includes('--verbose');

function asList(expected) {
  return Array.isArray(expected) ? expected : [expected];
}

function runCase(index, item) {
  const context = buildRetrievalContext({ noteJson: item.note || null, codes: item.codes || [] });
  const followUp = lastUserQuestion(item.history || []);
  const populations = inferPopulations({ message: item.message, patient: item.patient || null, context, codes: item.codes || [] });
  const started = process.hrtime.bigint();
  const results = index.search({ message: item.message, context, followUp, populations, specialty: item.specialty || '' });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const ids = [];
  for (const result of results) if (!ids.includes(result.guideline_id)) ids.push(result.guideline_id);
  return { ids, elapsedMs };
}

function main() {
  const index = loadDefaultIndex({ force: true });
  const known = new Set(index.chunks.map((chunk) => chunk.guideline_id));
  const latencies = [];
  const rows = [];
  const failures = [];
  let hits1 = 0;
  let hits3 = 0;
  let reciprocal = 0;
  let total = 0;

  for (const [set, items] of Object.entries(fixtures.sets)) {
    let setHits3 = 0;
    for (const item of items) {
      const expected = asList(item.expected);
      for (const id of expected) assert.ok(known.has(id), `rag-eval: la guía esperada "${id}" no existe en el corpus`);
      const { ids, elapsedMs } = runCase(index, item);
      latencies.push(elapsedMs);
      const rank = ids.findIndex((id) => expected.includes(id));
      total += 1;
      if (rank === 0) hits1 += 1;
      if (rank >= 0 && rank < 3) {
        hits3 += 1;
        setHits3 += 1;
      } else {
        failures.push(`[${set}] «${item.message}» → esperado ${expected.join(' | ')}; obtuvo ${ids.slice(0, 3).join(', ') || '(nada)'}`);
      }
      if (rank >= 0) reciprocal += 1 / (rank + 1);
    }
    rows.push({ set, n: items.length, recallAt3: items.length ? setHits3 / items.length : 1 });
  }

  let offTopicEmpty = 0;
  for (const message of fixtures.offTopic) {
    const { ids, elapsedMs } = runCase(index, { message });
    latencies.push(elapsedMs);
    if (!ids.length) offTopicEmpty += 1;
    else failures.push(`[fuera de tema] «${message}» trajo ${ids.slice(0, 3).join(', ')}`);
  }

  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  const metrics = {
    preguntas: total,
    recallAt1: hits1 / total,
    recallAt3: hits3 / total,
    mrr: reciprocal / total,
    offTopicPrecision: fixtures.offTopic.length ? offTopicEmpty / fixtures.offTopic.length : 1,
    p95LatencyMs: p95
  };

  const pct = (value) => `${(value * 100).toFixed(1)} %`;
  console.log(`[eval-guideline-retrieval] ${index.stats().guidelines} guías · ${index.stats().chunks} fragmentos · ${total} preguntas + ${fixtures.offTopic.length} fuera de tema`);
  for (const row of rows) console.log(`  ${row.set.padEnd(12)} n=${String(row.n).padStart(3)}  recall@3 ${pct(row.recallAt3)}`);
  console.log(`  global       recall@1 ${pct(metrics.recallAt1)} · recall@3 ${pct(metrics.recallAt3)} · MRR ${metrics.mrr.toFixed(3)} · fuera de tema sin guías ${pct(metrics.offTopicPrecision)} · p95 ${metrics.p95LatencyMs.toFixed(2)} ms`);
  if (verbose || failures.length) for (const failure of failures) console.log(`   ✗ ${failure}`);

  const below = [];
  if (metrics.recallAt3 < THRESHOLDS.recallAt3) below.push(`recall@3 ${pct(metrics.recallAt3)} < ${pct(THRESHOLDS.recallAt3)}`);
  if (metrics.mrr < THRESHOLDS.mrr) below.push(`MRR ${metrics.mrr.toFixed(3)} < ${THRESHOLDS.mrr}`);
  if (metrics.offTopicPrecision < THRESHOLDS.offTopicPrecision) below.push(`fuera de tema ${pct(metrics.offTopicPrecision)} < ${pct(THRESHOLDS.offTopicPrecision)}`);
  if (metrics.p95LatencyMs > THRESHOLDS.p95LatencyMs) below.push(`p95 ${metrics.p95LatencyMs.toFixed(2)} ms > ${THRESHOLDS.p95LatencyMs} ms`);
  if (below.length) throw new Error(`métricas bajo el umbral: ${below.join('; ')}`);
  console.log('[eval-guideline-retrieval] umbrales OK');
}

try {
  main();
} catch (error) {
  console.error(`\n[eval-guideline-retrieval] FALLÓ: ${error.message}`);
  process.exit(1);
}
