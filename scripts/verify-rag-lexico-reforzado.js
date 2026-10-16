#!/usr/bin/env node
// Juez de las promesas de docs/specs/007-el-asistente-encuentra-la-guia-o-calla.md:
// el buscador de guías reforzado (consultas doc2query, endurecimientos léxicos y cabeza léxica).
//
// Las métricas salen de scripts/eval-guideline-prompt.js (lo que de verdad llega al prompt,
// medido con la misma función que usa el chat). Detalle con:
//   npm run eval:prompt
//
//   node scripts/verify-rag-lexico-reforzado.js
const assert = require('assert');
const { promesa, cerrar } = require('./lib/promesas');
const { measure, belowThreshold } = require('./eval-guideline-prompt');
const corpusLib = require('./lib/guideline-corpus');
const ProtectionMap = require('../src/domain/privacy/ProtectionMap');
const { retrieveForPrompt, headMode } = require('../src/application/knowledge/ClinicalGuidelineIndex');
const UsageEvent = require('../src/domain/usage/UsageEvent');

const pct = (value) => `${(value * 100).toFixed(1)} %`;

async function main() {
  let medida;
  try {
    medida = measure();
  } catch (error) {
    // Sin medida (cabeza de otro corpus, corpus roto…) ninguna promesa se cumple.
    for (const numero of [701, 702, 703, 704, 705]) {
      // eslint-disable-next-line no-await-in-loop
      await promesa(numero, 'no se pudo medir el buscador', () => { throw error; });
    }
    cerrar('verify-rag-lexico-reforzado');
    return;
  }
  const { metrics, head, index } = medida;
  console.log(`  en el prompt: repo ${pct(metrics.repoInPrompt)} · 259 coloquiales ${pct(metrics.coloquialesInPrompt)} · 97 limpias ${pct(metrics.limpiasInPrompt)} · fresco D ${pct(metrics.frescoDInPrompt)} · fresco C4 ${pct(metrics.frescoC4InPrompt)} · urgencias ${pct(metrics.urgentInPrompt)}`);
  console.log(`  sin guía: fuera de tema vacío ${pct(metrics.offTopicEmpty)} · fuera del corpus con extractos ${metrics.outOfCorpusWithExtracts}/84 · con «alta» ${metrics.outOfCorpusHigh} · G1 equivocada «alta» en el repo ${metrics.repoWrongHigh}`);
  console.log(`  cabeza léxica: carga ${metrics.headLoadMs.toFixed(0)} ms · p95 ${metrics.headP95Ms.toFixed(2)} ms · veto K=${head.vetoK} · cupo p≥${head.cupoP}\n`);

  await promesa(701, 'La guía correcta llega al prompt en el 100 % de la evaluación del repo y, en los conjuntos ciegos que nadie ajusta, en el 96 % o más de las 259 coloquiales, el 95 % o más de las 97 limpias, el 98 % o más del fresco D, el 94 % o más del fresco C4 y el 95 % o más de las urgencias', () => {
    const below = belowThreshold(metrics, ['repoInPrompt', 'coloquialesInPrompt', 'limpiasInPrompt', 'frescoDInPrompt', 'frescoC4InPrompt', 'urgentInPrompt']);
    assert.deepStrictEqual(below, [], below.join('; '));
  });

  await promesa(702, 'Sin guía para el tema, el prompt va limpio: ninguna pregunta fuera de tema lleva extractos, como mucho 54 de las 84 preguntas fuera del corpus llevan alguno y como mucho 1 lleva uno «alta», y en el repo como mucho 12 preguntas tienen una G1 equivocada con relevancia «alta»', () => {
    const below = belowThreshold(metrics, ['offTopicEmpty', 'outOfCorpusWithExtracts', 'outOfCorpusHigh', 'repoWrongHigh']);
    assert.deepStrictEqual(below, [], below.join('; '));
  });

  await promesa(703, 'La cabeza léxica es del corpus compilado (mismo source_hash y mismas guías), el runtime reproduce los rankings del build, carga en 150 ms o menos y responde con p95 de 2 ms o menos, sin red ni dependencias', () => {
    const corpus = corpusLib.readCorpusFile();
    assert.strictEqual(head.sourceHash, corpus.source_hash, 'la cabeza es de otro corpus: npm run build:head');
    assert.deepStrictEqual([...head.gids].sort(), corpus.guidelines.map((guideline) => guideline.id).sort());
    // eslint-disable-next-line global-require
    const { rankingFingerprint } = require('./build-guideline-head');
    // eslint-disable-next-line global-require
    const repoEval = require('./fixtures/rag-eval.json');
    const texts = Object.values(repoEval.sets).flat().map((item) => item.message);
    assert.strictEqual(rankingFingerprint(head, texts), head.model.reference.sha256, 'el runtime ya no reproduce los rankings del build');
    const below = belowThreshold(metrics, ['headLoadMs', 'headP95Ms']);
    assert.deepStrictEqual(below, [], below.join('; '));
    // eslint-disable-next-line global-require
    const source = require('fs').readFileSync(require.resolve('../src/application/knowledge/GuidelineHead'), 'utf8');
    assert.ok(!/require\(/.test(source.replace(/\/\/.*$/gm, '')), 'GuidelineHead.js no importa nada');
  });

  await promesa(704, `Cada guía trae al menos ${corpusLib.MIN_QUERIES} consultas (doc2query), ninguna dispara el escudo de privacidad, ninguna copia una pregunta de la evaluación y ninguna llega al prompt`, () => {
    const corpus = corpusLib.buildCorpus();
    for (const guideline of corpus.guidelines) {
      assert.ok(guideline.consultas.length >= corpusLib.MIN_QUERIES, `${guideline.id}: ${guideline.consultas.length} consultas`);
      for (const query of guideline.consultas) {
        const map = new ProtectionMap({ seeds: [], excludedNames: [] });
        assert.strictEqual(map.protectText(query), query, `${guideline.id}: el escudo taparía «${query}»`);
      }
    }
    // Las copias de la evaluación las rechaza verify-guideline-corpus (601); aquí, que el
    // texto de las consultas no viaja: ningún resultado trae el campo ni lo pega en el texto.
    const queries = corpus.guidelines.flatMap((guideline) => guideline.consultas);
    const sample = retrieveForPrompt(index, { message: 'lo mordió una culebra en el monte y le sangran las encías' });
    assert.ok(sample.guidelines.length > 0);
    for (const guideline of sample.guidelines) {
      assert.ok(!('consultas' in guideline));
      assert.ok(!queries.some((query) => guideline.text.includes(query)), 'una consulta llegó al prompt');
    }
  });

  await promesa(705, 'Cada decisión del buscador es auditable sin texto (modo léxico, veto o cupo e ids de guía en used_context y en el ledger) y la cabeza se apaga o pasa a sombra con MIRACLE_ASSISTANT_RAG_HEAD en off o shadow, sin desplegar código', () => {
    assert.strictEqual(headMode({}), 'on');
    assert.strictEqual(headMode({ MIRACLE_ASSISTANT_RAG_HEAD: 'off' }), 'off');
    assert.strictEqual(headMode({ MIRACLE_ASSISTANT_RAG_HEAD: 'shadow' }), 'shadow');
    const outOfCorpus = { message: 'tratamiento de la hidradenitis supurativa' };
    assert.strictEqual(retrieveForPrompt(index, outOfCorpus, { mode: 'on' }).mode, 'veto');
    const off = retrieveForPrompt(index, outOfCorpus, { mode: 'off' });
    assert.strictEqual(off.mode, 'lexico');
    assert.ok(off.guidelines.length > 0, 'apagada, el prompt es el del buscador');
    const shadow = retrieveForPrompt(index, outOfCorpus, { mode: 'shadow' });
    assert.deepStrictEqual([shadow.mode, shadow.shadow], ['lexico', 'veto']);
    assert.deepStrictEqual(shadow.guidelines.map((g) => g.guideline_id), off.guidelines.map((g) => g.guideline_id));
    const metadata = UsageEvent.sanitizeMetadata({ retrievalMode: 'veto', retrievalShadow: 'cupo', pregunta: 'texto del médico' });
    assert.strictEqual(metadata.retrievalMode, 'veto');
    assert.strictEqual(metadata.retrievalShadow, 'cupo');
    assert.ok(!('pregunta' in metadata), 'el ledger no guarda texto fuera de la lista');
  });

  cerrar('verify-rag-lexico-reforzado');
}

main();
