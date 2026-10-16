// ¿La guía correcta LLEGA AL PROMPT? Y cuando no hay guía, ¿el prompt va limpio?
//
// eval-guideline-retrieval.js mide el ranking de la búsqueda (recall@k). Esto
// mide lo que de verdad ve el modelo: el resultado de retrieveForPrompt, la
// misma función que usa el chat (búsqueda, cabeza léxica y selección dentro
// del presupuesto). Sobre dos familias de conjuntos:
//   - el del repo (scripts/fixtures/rag-eval.json), con el que se ajusta el
//     buscador;
//   - los CIEGOS (scripts/fixtures/rag-ciego/), escritos por otros autores en
//     el torneo de RAG del 2026-10-14. Contra estos NO se ajusta nada: solo
//     miden. Si una pregunta ciega falla, el arreglo se valida con el repo y se
//     acepta el resultado ciego que salga.
// Métricas:
//   - guía correcta en el prompt (repo, 259 coloquiales, 97 limpias, fresco de
//     D, fresco de C4);
//   - urgencias en el prompt (coloquiales cuya guía es de urgencia);
//   - fuera de tema: prompt vacío;
//   - fuera del corpus (temas sin guía): cuántos prompts llevan extractos, cuántos
//     caracteres de guías ajenas, y cuántos llevan un extracto «alta»;
//   - G1 equivocada con relevancia «alta» en el repo.
// Sin modelo y sin red; corre en `npm test` (promesas 701 y 702 de la spec 007).
//   node scripts/eval-guideline-prompt.js [--verbose] [--json]
const repo = require('./fixtures/rag-eval.json');
const coloquiales = require('./fixtures/rag-ciego/coloquiales.json');
const frescoD = require('./fixtures/rag-ciego/fresco-d.json');
const frescoC4 = require('./fixtures/rag-ciego/fresco-c4.json');
const {
  loadDefaultIndex,
  loadDefaultHead,
  buildSearchQuery,
  retrieveForPrompt
} = require('../src/application/knowledge/ClinicalGuidelineIndex');

// Los umbrales solo suben (o bajan, en los máximos). La línea base (buscador de
// la spec 006, 2026-10-16) y cada cambio están en docs/asistente/RAG-LEXICO-REFORZADO.md.
const THRESHOLDS = Object.freeze({
  repoInPrompt: 1,
  coloquialesInPrompt: 0.96,
  limpiasInPrompt: 0.95,
  frescoDInPrompt: 0.98,
  frescoC4InPrompt: 0.94,
  urgentInPrompt: 0.95,
  offTopicEmpty: 1,
  // máximos
  outOfCorpusWithExtracts: 54,
  outOfCorpusHigh: 1,
  repoWrongHigh: 12,
  headLoadMs: 150,
  headP95Ms: 2
});

// Guías de urgencia: perder una en el prompt pesa más que cualquier promedio.
const URGENT = new Set([
  'dolor-toracico-sindrome-coronario-agudo', 'hemorragia-posparto', 'convulsiones-estatus-y-febril', 'sepsis-adultos',
  'crisis-hiperglucemicas-e-hipoglucemia', 'acv-isquemico-agudo', 'anafilaxia', 'ansiedad-y-riesgo-suicida',
  'paro-cardiorrespiratorio-rcp', 'intoxicacion-por-organofosforados', 'preeclampsia-trastornos-hipertensivos-embarazo',
  'sangrado-primer-trimestre', 'meningitis-bacteriana', 'hemorragia-digestiva', 'accidente-ofidico', 'ictericia-neonatal'
]);

const verbose = process.argv.includes('--verbose');
// Con --json no se imprime la tabla: sirve para comparar antes y después.
const asJson = process.argv.includes('--json');
const asList = (value) => (Array.isArray(value) ? value : [value]);

function run(index, item) {
  const query = buildSearchQuery({
    message: item.message,
    noteJson: item.note || null,
    codes: item.codes || [],
    history: item.history || [],
    specialty: item.specialty || '',
    patient: item.patient || null
  });
  return retrieveForPrompt(index, query);
}

function measureInPrompt(index, name, items, failures) {
  let hit = 0;
  for (const item of items) {
    const expected = asList(item.expected);
    const { guidelines } = run(index, item);
    if (guidelines.some((guideline) => expected.includes(guideline.guideline_id))) hit += 1;
    else failures.push(`[${name}] «${item.message}» → esperado ${expected.join(' | ')}; en el prompt: ${[...new Set(guidelines.map((g) => g.guideline_id))].join(', ') || '(nada)'}`);
  }
  return { n: items.length, hit, rate: items.length ? hit / items.length : 1 };
}

/** Mide todo y devuelve { metrics, sets, ooc, offTopic, failures, head, index }. */
function measure() {
  const index = loadDefaultIndex({ force: true });
  // La cabeza léxica se carga al primer uso; se mide aparte del índice (mejor de tres).
  let headLoadMs = Infinity;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    delete require.cache[require.resolve('../knowledge/guias-clinicas/guideline-head.json')];
    const started = process.hrtime.bigint();
    loadDefaultHead();
    headLoadMs = Math.min(headLoadMs, Number(process.hrtime.bigint() - started) / 1e6);
  }
  const head = index.getHead();
  if (!head) throw new Error('la cabeza léxica no cargó o es de otro corpus: npm run build:head');
  const failures = [];
  const repoItems = Object.values(repo.sets).flat();
  const limpias = coloquiales.coloquiales.filter((item) => item.limpia);
  const urgentes = coloquiales.coloquiales.filter((item) => asList(item.expected).some((id) => URGENT.has(id)));

  const sets = {
    repo: measureInPrompt(index, 'repo', repoItems, failures),
    coloquiales: measureInPrompt(index, 'coloquiales', coloquiales.coloquiales, []),
    limpias: measureInPrompt(index, 'limpias', limpias, failures),
    frescoD: measureInPrompt(index, 'fresco D', frescoD.cases, failures),
    frescoC4: measureInPrompt(index, 'fresco C4', frescoC4.cases, failures),
    urgent: measureInPrompt(index, 'urgencia', urgentes, failures)
  };

  let repoWrongHigh = 0;
  for (const item of repoItems) {
    const query = buildSearchQuery({ message: item.message, noteJson: item.note || null, codes: item.codes || [], history: item.history || [], specialty: item.specialty || '', patient: item.patient || null });
    const results = index.search(query);
    if (results.length && !asList(item.expected).includes(results[0].guideline_id) && results[0].relevance === 'alta') repoWrongHigh += 1;
  }

  const offTopic = [...repo.offTopic, ...coloquiales.fueraDeTema];
  let offTopicEmpty = 0;
  for (const message of offTopic) {
    const { guidelines } = run(index, { message });
    if (!guidelines.length) offTopicEmpty += 1;
    else failures.push(`[fuera de tema] «${message}» llevó ${guidelines.map((g) => g.guideline_id).join(', ')}`);
  }

  // Fuera del corpus: los 84 del torneo (repo 45 + ciego A 20 + C 5 + fresco D 14)
  // y, aparte, los 45 del fresco C4.
  const outOfCorpus = {
    principal: [
      ...repo.fueraDelCorpus,
      ...coloquiales.fueraDelCorpus.map((item) => item.message),
      ...frescoD.fueraDelCorpus
    ],
    frescoC4: frescoC4.fueraDelCorpus
  };
  const ooc = {};
  for (const [name, messages] of Object.entries(outOfCorpus)) {
    let withExtracts = 0;
    let chars = 0;
    let high = 0;
    const modes = {};
    for (const message of messages) {
      const { guidelines, mode } = run(index, { message: typeof message === 'string' ? message : message.message });
      modes[mode] = (modes[mode] || 0) + 1;
      if (guidelines.length) withExtracts += 1;
      chars += guidelines.reduce((sum, guideline) => sum + `${guideline.text || ''}`.length, 0);
      if (guidelines.some((guideline) => guideline.relevance === 'alta')) {
        high += 1;
        failures.push(`[fuera del corpus · ${name}] «${message}» llevó un extracto «alta» (${guidelines.filter((g) => g.relevance === 'alta').map((g) => g.guideline_id).join(', ')})`);
      }
    }
    ooc[name] = { n: messages.length, withExtracts, chars, high, modes };
  }

  // p95 de la cabeza: el MEJOR de tres pasadas (después de una de calentamiento),
  // como la construcción del índice. En el runner de GitHub, con los demás jueces
  // en paralelo, una sola pasada dio 2,16 ms para una cabeza que responde en ~0,35 ms.
  let headP95Ms = Infinity;
  for (let pass = 0; pass < 4; pass += 1) {
    const latencies = repoItems.map((item) => {
      const started = process.hrtime.bigint();
      head.rank(item.message, 20);
      return Number(process.hrtime.bigint() - started) / 1e6;
    }).sort((a, b) => a - b);
    if (pass > 0) headP95Ms = Math.min(headP95Ms, latencies[Math.floor(latencies.length * 0.95)]);
  }

  const metrics = {
    headLoadMs,
    headP95Ms,
    repoInPrompt: sets.repo.rate,
    coloquialesInPrompt: sets.coloquiales.rate,
    limpiasInPrompt: sets.limpias.rate,
    frescoDInPrompt: sets.frescoD.rate,
    frescoC4InPrompt: sets.frescoC4.rate,
    urgentInPrompt: sets.urgent.rate,
    offTopicEmpty: offTopic.length ? offTopicEmpty / offTopic.length : 1,
    outOfCorpusWithExtracts: ooc.principal.withExtracts,
    outOfCorpusHigh: ooc.principal.high,
    repoWrongHigh
  };
  return { metrics, sets, ooc, offTopic: { n: offTopic.length, empty: offTopicEmpty }, repoWrongHigh, failures, head, index };
}

const MIN_KEYS = ['repoInPrompt', 'coloquialesInPrompt', 'limpiasInPrompt', 'frescoDInPrompt', 'frescoC4InPrompt', 'urgentInPrompt', 'offTopicEmpty'];
const MAX_KEYS = ['outOfCorpusWithExtracts', 'outOfCorpusHigh', 'repoWrongHigh', 'headLoadMs', 'headP95Ms'];

/** Las métricas de `keys` que no cumplen su umbral, como texto. */
function belowThreshold(metrics, keys = [...MIN_KEYS, ...MAX_KEYS]) {
  const below = [];
  for (const key of keys) {
    if (MIN_KEYS.includes(key) && metrics[key] < THRESHOLDS[key]) below.push(`${key} ${(metrics[key] * 100).toFixed(1)} % < ${(THRESHOLDS[key] * 100).toFixed(1)} %`);
    if (MAX_KEYS.includes(key) && metrics[key] > THRESHOLDS[key]) below.push(`${key} ${Number(metrics[key].toFixed(2))} > ${THRESHOLDS[key]}`);
  }
  return below;
}

function main() {
  const { metrics, sets, ooc, offTopic, repoWrongHigh, failures, head, index } = measure();
  const { headLoadMs, headP95Ms } = metrics;
  const offTopicEmpty = offTopic.empty;
  if (asJson) {
    console.log(JSON.stringify({ sets, ooc, offTopic, repoWrongHigh, metrics }, null, 2));
  } else {
    const pct = (value) => `${(value * 100).toFixed(1)} %`;
    const row = (label, set) => `  ${label.padEnd(26)} ${pct(set.rate).padStart(7)}  (${set.hit}/${set.n})`;
    console.log(`[eval-guideline-prompt] guía correcta EN EL PROMPT (${index.stats().guidelines} guías)`);
    console.log(row('repo', sets.repo));
    console.log(row('ciego: 259 coloquiales', sets.coloquiales));
    console.log(row('ciego: 97 limpias', sets.limpias));
    console.log(row('ciego: fresco D', sets.frescoD));
    console.log(row('ciego: fresco C4', sets.frescoC4));
    console.log(row('urgencias (coloquiales)', sets.urgent));
    console.log(`  cabeza léxica: carga ${headLoadMs.toFixed(0)} ms · p95 ${headP95Ms.toFixed(2)} ms · veto K=${head.vetoK} · cupo p≥${head.cupoP}`);
    console.log(`  fuera de tema con prompt vacío  ${offTopicEmpty}/${offTopic.n} · G1 equivocada con «alta» en el repo: ${repoWrongHigh}`);
    for (const [name, data] of Object.entries(ooc)) {
      console.log(`  fuera del corpus (${name}, ${data.n})  con extractos ${data.withExtracts} · con «alta» ${data.high} · ${data.chars} caracteres de guías ajenas · modos ${JSON.stringify(data.modes)}`);
    }
  }
  if (verbose) for (const failure of failures) console.log(`   ✗ ${failure}`);

  const below = belowThreshold(metrics);
  if (below.length) throw new Error(`métricas fuera del umbral: ${below.join('; ')}`);
  if (!asJson) console.log('[eval-guideline-prompt] umbrales OK');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\n[eval-guideline-prompt] FALLÓ: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { measure, belowThreshold, THRESHOLDS, URGENT };
