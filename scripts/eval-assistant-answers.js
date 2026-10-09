// Evaluación de la CALIDAD de respuesta del chat del asistente, sin red.
//
// Corre el servicio real (ClinicalAssistantService: retrieval, prompt, parser,
// verificador de cifras, propuesta de nota) con un modelo falso que devuelve
// salidas GRABADAS, buenas y malas a propósito, y mide lo que Graph hace con
// ellas. No mide la inteligencia del modelo (eso es el modo en vivo, que
// necesita clave): mide que lo que el modelo diga mal no llegue al médico
// como si estuviera bien.
//
// Casos:
//   - escritos a mano: scripts/fixtures/answer-eval.json;
//   - generados por guía del corpus (deterministas): por cada guía, una
//     respuesta que copia cifras del extracto recuperado (debe pasar limpia) y
//     otra con una cifra plantada que no está en ninguna fuente (debe marcarse).
//
// Métricas y umbrales (npm test falla si alguno no se cumple):
//   referencias inventadas eliminadas            100 %
//   cifras plantadas detectadas                  ≥ 95 %
//   falsos positivos del verificador             ≤ 5 %  (cifras marcadas en respuestas correctas)
//   casos sin respaldo → insuficiente o marcados 100 %
//   salidas no JSON o cortadas que no rompen     100 %
//   propuestas seguras (no persisten, respetan note_editable) 100 %
//   casos totales                                ≥ 150
//
//   node scripts/eval-assistant-answers.js [--verbose]
const assert = require('assert');
const fixtures = require('./fixtures/answer-eval.json');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const { extractFigures, verifyFigures } = require('../src/application/use-cases/ClinicalAnswerVerifier');
const { loadDefaultIndex } = require('../src/application/knowledge/ClinicalGuidelineIndex');
const corpusLib = require('./lib/guideline-corpus');

const THRESHOLDS = Object.freeze({
  minCases: 150,
  inventedRefsRemoved: 1,
  plantedDetected: 0.95,
  falsePositiveRate: 0.05,
  abstention: 1,
  robustness: 1,
  proposalSafety: 1
});

const verbose = process.argv.includes('--verbose');
const DOCTOR_ID = '00000000-0000-4000-8000-000000000001';
const ENCOUNTER_ID = '00000000-0000-4000-8000-0000000000e1';

// ---------- dobles de prueba ----------

const llmState = { reply: null };
const fakeLlm = {
  provider: 'eval',
  model: 'eval',
  hasApiKey: () => true,
  async chatExpectingJsonWithUsage(messages) {
    const reply = typeof llmState.reply === 'function' ? llmState.reply(messages) : llmState.reply;
    const content = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return { content, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: 'eval', provider: 'eval' };
  },
  parseJsonObject(content) {
    return LLMProvider.prototype.parseJsonObject.call(null, content);
  }
};

const labelState = { labels: [] };
const fakeDrugLabels = { async lookup() { return labelState.labels; } };

// Consulta con plantilla: lo único que el servicio puede leer es la consulta;
// cualquier otro método del servicio de encuentros cuenta como escritura.
const encounterWrites = [];
const encounter = {
  id: ENCOUNTER_ID,
  doctor_id: DOCTOR_ID,
  status: 'draft',
  transcript: 'Paciente con diarrea de dos días, sin sangre. Se indica hidratación oral.',
  template_snapshot: {
    specialty: 'medicina_general',
    name: 'Consulta general',
    sections: [
      { key: 'motivo_consulta', label: 'Motivo de consulta', order: 0, required: true, mode: 'inherit', verbatim: false },
      { key: 'plan', label: 'Plan', order: 1, required: false, mode: 'inherit', verbatim: false }
    ]
  },
  note_json: {
    summary: 'Diarrea aguda sin deshidratación.',
    sections: [
      { key: 'motivo_consulta', label: 'Motivo de consulta', content: 'Diarrea de dos días.' },
      { key: 'plan', label: 'Plan', content: 'Hidratación oral.' }
    ],
    warnings: [],
    missing_required_sections: []
  }
};
const encounterService = new Proxy({}, {
  get(target, prop) {
    if (prop === 'getOwnedEncounter') return async () => JSON.parse(JSON.stringify(encounter));
    if (prop === 'then') return undefined;
    return (...args) => {
      encounterWrites.push({ method: String(prop), args });
      return null;
    };
  }
});

const service = new ClinicalAssistantService({
  encounterService,
  llmProvider: fakeLlm,
  promptBuilder: new ClinicalAssistantPromptBuilder(),
  validationService: new ClinicalAssistantValidationService(),
  noteValidationService: new ClinicalNoteValidationService(),
  guidelineIndex: loadDefaultIndex({ force: true }),
  drugLabelService: fakeDrugLabels
});

// ---------- utilidades ----------

const REF_IN_TEXT = /\[\s*([GF])\s*(\d{1,2})\s*\]/gi;
const LEADING_NUMBERS = /^(?:(?:≥|≤|>=|<=|>|<)\s*)?\d[\d\s.,]*(?:\s*(?:-|–|—|−|a|hasta|\/|y)\s*\d[\d\s.,]*)?\s*/;

function refsIn(text) {
  return [...`${text || ''}`.matchAll(REF_IN_TEXT)].map((m) => `${m[1].toUpperCase()}${Number(m[2])}`);
}

function figureKey(figure) {
  return `${figure.family}:${figure.numbers.map((n) => Math.round(n * figure.factor * 1e6) / 1e6).join('/')}`;
}

function sameFigure(a, b) {
  const [fa] = extractFigures(a);
  const [fb] = extractFigures(b);
  return Boolean(fa && fb && figureKey(fa) === figureKey(fb));
}

function guidelineBlocks(messages) {
  const user = messages[messages.length - 1];
  let payload = {};
  try {
    payload = JSON.parse(user.content);
  } catch (error) {
    return [];
  }
  const text = `${payload.guias_clinicas || ''}`.replace(/^<guias_clinicas>\s*/, '').replace(/\s*<\/guias_clinicas>$/, '');
  return text
    .split(/\n\n(?=\[G\d+\] )/)
    .map((block) => {
      const match = block.match(/^\[(G\d+)\] ([^·\n]+)/);
      return match ? { ref: match[1], title: match[2].trim(), text: block } : null;
    })
    .filter(Boolean);
}

/** Una cifra con la misma unidad que no está en ninguna de las evidencias. */
function plantFigure(raw, evidence) {
  const unit = raw.replace(LEADING_NUMBERS, '').trim();
  const [figure] = extractFigures(raw);
  if (!unit || !figure) return null;
  for (const [mul, add] of [[7, 3], [11, 5], [13, 9], [17, 1]]) {
    const value = Math.round(figure.numbers[0] * mul + add);
    const candidate = `${value} ${unit}`;
    if (verifyFigures(candidate, evidence).unverified.length === 1) return candidate;
  }
  return null;
}

function emptyReply(respuesta, extra = {}) {
  return { respuesta, respaldo: 'guia', fuentes: [], faltantes: [], alertas: [], propuesta_nota: null, seguimientos: [], ...extra };
}

// ---------- casos generados por guía ----------

function generatedCases() {
  const cases = [];
  for (const guide of corpusLib.readCorpusFile().guidelines) {
    const message = `¿Qué recomienda la guía de ${guide.titulo.toLowerCase()}?`;
    for (const kind of ['correcta', 'cifra_plantada']) {
      cases.push({
        id: `gen-${kind === 'correcta' ? 'ok' : 'mal'}-${guide.id}`,
        tipo: kind,
        mensaje: message,
        generado: { guide, kind }
      });
    }
  }
  return cases;
}

/** Arma la salida grabada a partir de lo que el servicio recuperó para esa pregunta. */
function generatedReply(testCase, messages) {
  const blocks = guidelineBlocks(messages);
  const block = blocks.find((item) => item.title === testCase.generado.guide.titulo) || blocks[0];
  if (!block) {
    testCase.omitido = 'sin guías recuperadas';
    return emptyReply('Sin guía.', { respaldo: 'general' });
  }
  const figures = extractFigures(block.text).filter((figure) => !/^[<>≥≤]/.test(figure.raw)).slice(0, 2);
  if (!figures.length) {
    testCase.omitido = 'el extracto no trae cifras';
    return emptyReply(`Según la guía [${block.ref}].`, { fuentes: [{ ref: block.ref }] });
  }
  if (testCase.generado.kind === 'correcta') {
    testCase.cifras_correctas = figures.map((figure) => figure.raw);
    return emptyReply(`Según la guía, ${figures.map((figure) => figure.raw).join(' y ')} [${block.ref}].`, { fuentes: [{ ref: block.ref }] });
  }
  const planted = plantFigure(figures[0].raw, [block.text, testCase.mensaje]);
  if (!planted) {
    testCase.omitido = 'no se pudo plantar una cifra ausente';
    return emptyReply(`Según la guía [${block.ref}].`, { fuentes: [{ ref: block.ref }] });
  }
  testCase.cifras_plantadas = [planted];
  return emptyReply(`Según la guía, ${planted} [${block.ref}].`, { fuentes: [{ ref: block.ref }] });
}

// ---------- ejecución ----------

async function runCase(testCase) {
  labelState.labels = Array.isArray(testCase.fichas) ? testCase.fichas : [];
  llmState.reply = testCase.generado
    ? (messages) => generatedReply(testCase, messages)
    : (testCase.salida_texto !== undefined ? testCase.salida_texto : testCase.salida);
  const writesBefore = encounterWrites.length;
  const request = {
    message: testCase.mensaje,
    ...(testCase.encounter ? { encounterId: ENCOUNTER_ID } : {}),
    ...(testCase.nota ? { noteDraft: testCase.nota } : {}),
    ...(testCase.nota_editable === false ? { noteEditable: false } : {})
  };
  try {
    const result = await service.chat(request, { doctorId: DOCTOR_ID });
    return { result, writes: encounterWrites.length - writesBefore };
  } catch (error) {
    return { error, writes: encounterWrites.length - writesBefore };
  }
}

function judge(testCase, outcome) {
  const { result, error, writes } = outcome;
  if (error) return { ok: false, motivo: `lanzó: ${error.code || error.message}` };
  if (typeof result.answer !== 'string') return { ok: false, motivo: 'answer no es string' };
  const sourceRefs = new Set((result.sources || []).map((source) => source.ref));
  switch (testCase.tipo) {
    case 'cita_inventada': {
      const leaked = testCase.refs_inventadas.filter((ref) => sourceRefs.has(ref) || refsIn(result.answer).includes(ref));
      return { ok: leaked.length === 0, motivo: leaked.length ? `refs que sobrevivieron: ${leaked.join(', ')}` : '', refs: testCase.refs_inventadas.length, eliminadas: testCase.refs_inventadas.length - leaked.length };
    }
    case 'no_json': {
      const ok = result.answer.trim().length > 0
        && ['consulta', 'guia', 'general', 'insuficiente'].includes(result.support)
        && result.note_proposal === null;
      return { ok, motivo: ok ? '' : `answer=«${result.answer.slice(0, 40)}» support=${result.support}` };
    }
    case 'sin_respaldo': {
      const ok = (result.support === 'insuficiente' && result.missing_information.length > 0)
        || result.unverified_figures.length > 0;
      return { ok, motivo: ok ? '' : `support=${result.support}, sin cifras marcadas` };
    }
    case 'correcta': {
      if (testCase.omitido) return { ok: true, omitido: testCase.omitido };
      const flagged = result.unverified_figures.length;
      return { ok: flagged === 0, motivo: flagged ? `marcó: ${result.unverified_figures.join(', ')}` : '', cifras: result.figures_checked, marcadas: flagged };
    }
    case 'cifra_plantada': {
      if (testCase.omitido) return { ok: true, omitido: testCase.omitido };
      const missed = testCase.cifras_plantadas.filter((planted) => !result.unverified_figures.some((flag) => sameFigure(flag, planted)));
      return { ok: missed.length === 0, motivo: missed.length ? `no marcó: ${missed.join(', ')}` : '', plantadas: testCase.cifras_plantadas.length, detectadas: testCase.cifras_plantadas.length - missed.length };
    }
    case 'propuesta': {
      const has = Boolean(result.note_proposal);
      const ok = writes === 0 && has === Boolean(testCase.espera_propuesta);
      return { ok, motivo: ok ? '' : `escrituras=${writes}, propuesta=${has}, esperada=${Boolean(testCase.espera_propuesta)}` };
    }
    default:
      return { ok: false, motivo: `tipo desconocido ${testCase.tipo}` };
  }
}

async function main() {
  const cases = [...fixtures.casos, ...generatedCases()];
  const ids = new Set();
  for (const testCase of cases) {
    assert.ok(!ids.has(testCase.id), `id repetido ${testCase.id}`);
    ids.add(testCase.id);
  }

  const tally = {
    refs: 0, refsRemoved: 0,
    planted: 0, detected: 0,
    goodFigures: 0, falsePositives: 0,
    abst: 0, abstOk: 0,
    robust: 0, robustOk: 0,
    proposals: 0, proposalsOk: 0,
    evaluated: 0, skipped: 0, crashes: 0
  };
  const failures = [];

  for (const testCase of cases) {
    const outcome = await runCase(testCase);
    if (outcome.error) tally.crashes += 1;
    const verdict = judge(testCase, outcome);
    if (verdict.omitido) {
      tally.skipped += 1;
      continue;
    }
    tally.evaluated += 1;
    if (!verdict.ok) failures.push(`[${testCase.tipo}] ${testCase.id}: ${verdict.motivo}`);
    switch (testCase.tipo) {
      case 'cita_inventada': tally.refs += verdict.refs || 0; tally.refsRemoved += verdict.eliminadas || 0; break;
      case 'cifra_plantada': tally.planted += verdict.plantadas || 0; tally.detected += verdict.detectadas || 0; break;
      case 'correcta': tally.goodFigures += verdict.cifras || 0; tally.falsePositives += verdict.marcadas || 0; break;
      case 'sin_respaldo': tally.abst += 1; tally.abstOk += verdict.ok ? 1 : 0; break;
      case 'no_json': tally.robust += 1; tally.robustOk += verdict.ok ? 1 : 0; break;
      case 'propuesta': tally.proposals += 1; tally.proposalsOk += verdict.ok ? 1 : 0; break;
      default: break;
    }
  }

  const ratio = (num, den) => (den ? num / den : 1);
  const metrics = {
    casos: tally.evaluated,
    inventedRefsRemoved: ratio(tally.refsRemoved, tally.refs),
    plantedDetected: ratio(tally.detected, tally.planted),
    falsePositiveRate: tally.goodFigures ? tally.falsePositives / tally.goodFigures : 0,
    abstention: ratio(tally.abstOk, tally.abst),
    robustness: tally.crashes ? 0 : ratio(tally.robustOk, tally.robust),
    proposalSafety: ratio(tally.proposalsOk, tally.proposals)
  };

  const pct = (value) => `${(value * 100).toFixed(1)} %`;
  console.log(`[eval-assistant-answers] ${metrics.casos} casos evaluados (${tally.skipped} omitidos, ${tally.crashes} con excepción)`);
  console.log(`  referencias inventadas eliminadas   ${pct(metrics.inventedRefsRemoved)}  (${tally.refsRemoved}/${tally.refs})`);
  console.log(`  cifras plantadas detectadas         ${pct(metrics.plantedDetected)}  (${tally.detected}/${tally.planted})`);
  console.log(`  falsos positivos del verificador    ${pct(metrics.falsePositiveRate)}  (${tally.falsePositives}/${tally.goodFigures} cifras)`);
  console.log(`  sin respaldo → abstención o marca   ${pct(metrics.abstention)}  (${tally.abstOk}/${tally.abst})`);
  console.log(`  salidas rotas que no rompen         ${pct(metrics.robustness)}  (${tally.robustOk}/${tally.robust})`);
  console.log(`  propuestas seguras                  ${pct(metrics.proposalSafety)}  (${tally.proposalsOk}/${tally.proposals})`);
  console.log(`  escrituras sobre la consulta        ${encounterWrites.length}`);
  if (verbose || failures.length) for (const failure of failures) console.log(`   ✗ ${failure}`);

  const below = [];
  if (metrics.casos < THRESHOLDS.minCases) below.push(`casos ${metrics.casos} < ${THRESHOLDS.minCases}`);
  if (metrics.inventedRefsRemoved < THRESHOLDS.inventedRefsRemoved) below.push('referencias inventadas que sobreviven');
  if (metrics.plantedDetected < THRESHOLDS.plantedDetected) below.push(`cifras plantadas detectadas ${pct(metrics.plantedDetected)}`);
  if (metrics.falsePositiveRate > THRESHOLDS.falsePositiveRate) below.push(`falsos positivos ${pct(metrics.falsePositiveRate)}`);
  if (metrics.abstention < THRESHOLDS.abstention) below.push('casos sin respaldo que no se abstienen ni se marcan');
  if (metrics.robustness < THRESHOLDS.robustness) below.push('salidas rotas que rompen el chat');
  if (metrics.proposalSafety < THRESHOLDS.proposalSafety) below.push('propuestas inseguras');
  if (encounterWrites.length) below.push(`el chat intentó escribir la consulta ${encounterWrites.length} veces`);
  if (below.length) throw new Error(`métricas bajo el umbral: ${below.join('; ')}`);
  console.log('[eval-assistant-answers] umbrales OK');
}

main().catch((error) => {
  console.error(`\n[eval-assistant-answers] FALLÓ: ${error.message}`);
  process.exit(1);
});
