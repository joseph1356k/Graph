// Evals del generador de nota clínica sobre fixtures anonimizadas.
//
// Dos modos:
//   - GRABADO (default, corre en `npm test`): pasa la salida grabada de cada
//     fixture por el validador real (ClinicalNoteValidationService) y mide las
//     métricas. Determinístico: protege el contrato del validador y las
//     métricas mismas.
//   - VIVO (GRAPH_EVAL_LIVE=1): genera la nota con el proveedor configurado
//     (GRAPH_LLM_*), imprime las métricas por caso y las compara con la
//     salida grabada. Nunca falla el CI: es una medición, no un test.
//
// Añadir un caso = un JSON en tests/fixtures/note-evals con template_snapshot,
// transcript, recorded_output y expect (ver note-eval-metrics.js).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const NoteModeResolver = require('../src/application/use-cases/NoteModeResolver');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const { evaluateNote } = require('./lib/note-eval-metrics');

const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'note-evals');
const LIVE = process.env.GRAPH_EVAL_LIVE === '1';

function loadFixtures() {
  return fs.readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')));
}

function formatMetrics(metrics) {
  return Object.entries(metrics)
    .map(([key, value]) => `${key}=${typeof value === 'number' ? Number(value.toFixed(2)) : value}`)
    .join(' ');
}

async function runRecorded(fixtures) {
  const validation = new ClinicalNoteValidationService();
  let passed = 0;
  for (const fixture of fixtures) {
    const modes = NoteModeResolver.resolve(fixture.template_snapshot);
    const note = validation.validateAndRepair(fixture.recorded_output, fixture.template_snapshot, {
      transcript: fixture.transcript,
      modes
    });
    const { metrics, failures } = evaluateNote(note, fixture, { transcript: fixture.transcript, modes });
    assert.deepStrictEqual(failures, [], `${fixture.id}: ${failures.join(' | ')}`);
    passed += 1;
    console.log(`  ok ${passed}. ${fixture.id} — ${formatMetrics(metrics)}`);
  }

  // Las métricas tienen que DETECTAR regresiones, no sólo aprobar lo grabado:
  // se degrada la salida grabada de tres formas y cada una debe fallar.
  const general = fixtures.find((fixture) => fixture.id === 'general-interpretive');
  if (general) {
    const modes = NoteModeResolver.resolve(general.template_snapshot);
    const degrade = (mutate) => {
      const copy = JSON.parse(JSON.stringify(general.recorded_output));
      mutate(copy);
      const note = validation.validateAndRepair(copy, general.template_snapshot, { transcript: general.transcript, modes });
      return evaluateNote(note, general, { transcript: general.transcript, modes }).failures;
    };
    const lostNegation = degrade((copy) => {
      copy.sections[1].content = 'Cefalea frontal opresiva de tres días con fiebre y náuseas.';
    });
    assert.ok(lostNegation.some((f) => f.includes('negación perdida para "fiebre"')), `debe detectar la negación perdida: ${lostNegation}`);
    const invented = degrade((copy) => {
      copy.sections[3].content = 'Tensión arterial 130/80, afebril, sin signos meníngeos.';
      copy.sections[3].grounding = 'explicit';
      copy.sections[3].evidence = ['tensión arterial 130/80'];
    });
    assert.ok(invented.some((f) => f.includes('debía quedar ausente')) && invented.some((f) => f.includes('inferred')), `debe detectar el examen físico inventado: ${invented}`);
    const lostLiteral = degrade((copy) => {
      copy.sections[2].content = 'Refiere hipertensión en tratamiento con losartán 500 mg cada día.';
    });
    assert.ok(lostLiteral.some((f) => f.includes('literal perdido: "losartán 50 mg"')), `debe detectar la dosis alterada: ${lostLiteral}`);
    // clinical-note@9: lo que solo dice el paciente lleva su fuente también en el summary.
    const noSource = degrade((copy) => {
      copy.summary = copy.summary.replace('refiere hipertensión en tratamiento', 'hipertenso en tratamiento');
    });
    assert.ok(noSource.some((f) => f.includes('término prohibido presente: "hipertenso en tratamiento"')), `debe detectar el antecedente sin fuente en el summary: ${noSource}`);
    passed += 1;
    console.log(`  ok ${passed}. las métricas detectan negación perdida, examen físico inventado, dosis alterada y antecedente sin fuente`);
  }

  // Sin impresión del médico, la nota no la escribe y un warning la pide (clinical-note@9).
  const voces = fixtures.find((fixture) => fixture.id === 'varias-voces-el-medico-manda');
  if (voces) {
    const modes = NoteModeResolver.resolve(voces.template_snapshot);
    const degrade = (mutate) => {
      const copy = JSON.parse(JSON.stringify(voces.recorded_output));
      mutate(copy);
      const note = validation.validateAndRepair(copy, voces.template_snapshot, { transcript: voces.transcript, modes });
      return evaluateNote(note, voces, { transcript: voces.transcript, modes }).failures;
    };
    const silent = degrade((copy) => { copy.warnings = []; });
    assert.ok(silent.some((f) => f.includes('falta un warning sobre "impresión diagnóstica"')), `debe detectar que nadie pidió la impresión: ${silent}`);
    const ownImpression = degrade((copy) => {
      const analisis = copy.sections.find((section) => section.key === 'analisis');
      analisis.content += '\n\nCuadro compatible con gastritis.';
    });
    assert.ok(ownImpression.some((f) => f.includes('término prohibido presente: "compatible con"')), `debe detectar una impresión que el médico no dio: ${ownImpression}`);
    const mixedSources = degrade((copy) => {
      copy.summary = 'Consulta por ardor epigástrico en paciente que refiere gastritis y diabetes.';
    });
    assert.ok(mixedSources.some((f) => f.includes('término prohibido presente: "gastritis y diabetes"')), `debe detectar la diabetes de la acompañante atribuida al paciente: ${mixedSources}`);
    passed += 1;
    console.log(`  ok ${passed}. las métricas detectan la impresión sin pedir, la impresión inventada y la fuente mezclada`);
  }
  return passed;
}

async function runLive(fixtures) {
  const LLMProvider = require('../src/infrastructure/LLMProvider');
  const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
  const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');

  const llmProvider = new LLMProvider();
  if (!llmProvider.hasApiKey()) {
    console.log('[verify-note-evals] GRAPH_EVAL_LIVE=1 pero no hay GRAPH_LLM_* configurado; nada que medir.');
    return 0;
  }
  const generator = new ClinicalNoteGeneratorService({
    llmProvider,
    promptBuilder: new ClinicalNotePromptBuilder(),
    validationService: new ClinicalNoteValidationService()
  });

  let measured = 0;
  for (const fixture of fixtures) {
    const startedAt = Date.now();
    try {
      const { noteJson, promptVersion, noteMode, temperature } = await generator.generateFromTranscript({
        transcript: fixture.transcript,
        templateSnapshot: fixture.template_snapshot,
        sessionId: `eval:${fixture.id}`
      });
      const modes = NoteModeResolver.resolve(fixture.template_snapshot);
      const { metrics, failures } = evaluateNote(noteJson, fixture, { transcript: fixture.transcript, modes });
      measured += 1;
      console.log(`  ${failures.length === 0 ? 'ok ' : 'warn'} ${fixture.id} [${noteMode} T=${temperature} ${promptVersion}] ${Date.now() - startedAt}ms — ${formatMetrics(metrics)}`);
      for (const failure of failures) console.log(`       · ${failure}`);
      if (process.env.GRAPH_EVAL_PRINT === '1') {
        console.log(JSON.stringify(noteJson, null, 2));
      }
    } catch (error) {
      console.log(`  fail ${fixture.id}: ${error.message}`);
    }
  }
  return measured;
}

async function main() {
  const fixtures = loadFixtures();
  assert.ok(fixtures.length >= 3, 'se esperan al menos tres fixtures de evals');
  for (const fixture of fixtures) {
    assert.ok(fixture.id && fixture.template_snapshot && fixture.transcript && fixture.recorded_output && fixture.expect, `fixture incompleta: ${fixture.id || '?'}`);
  }

  if (LIVE) {
    console.log(`[verify-note-evals] modo VIVO sobre ${fixtures.length} casos`);
    const measured = await runLive(fixtures);
    console.log(`\n[verify-note-evals] ${measured} casos medidos (modo vivo no falla el CI)`);
    return;
  }

  const passed = await runRecorded(fixtures);
  console.log(`\n[verify-note-evals] ${passed} verificaciones OK (modo grabado; GRAPH_EVAL_LIVE=1 para medir contra el proveedor)`);
}

main().catch((error) => {
  console.error(`\n[verify-note-evals] FALLÓ: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
