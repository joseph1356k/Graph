// Entrena la cabeza léxica de las guías y la escribe en
// knowledge/guias-clinicas/guideline-head.json (se COMMITEA, como el corpus).
//
//   npm run build:corpus && npm run build:head
//
// 1. Entrena con el texto público del corpus compilado (títulos, palabras
//    clave, «título. sección» y consultas): ~40 s, sin red.
// 2. Calibra sus dos umbrales SOLO con la evaluación del repo
//    (scripts/fixtures/rag-eval.json), nunca con los conjuntos ciegos:
//      - veto_k: el menor K de la lista que no saca del prompt ninguna guía
//        correcta del repo (0 pérdidas);
//      - cupo_p: la menor probabilidad con la que el cupo no agrega ninguna
//        guía en las preguntas fuera del corpus del repo.
// 3. Guarda el source_hash del corpus: verify-guideline-corpus.js falla si la
//    cabeza quedó de otro corpus (y en runtime se apaga sola).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const corpusLib = require('./lib/guideline-corpus');
const { trainHead, trainingPairs } = require('./lib/guideline-head-trainer');
const { GuidelineHead } = require('../src/application/knowledge/GuidelineHead');
const {
  ClinicalGuidelineIndex,
  buildSearchQuery,
  retrieveForPrompt
} = require('../src/application/knowledge/ClinicalGuidelineIndex');

const HEAD_FILE = path.join(corpusLib.CORPUS_DIR, 'guideline-head.json');
const VETO_K_CANDIDATES = [3, 5, 8, 10, 12, 15, 20];
const REFERENCE_TOP = 5;

const asList = (value) => (Array.isArray(value) ? value : [value]);

function queryFor(item) {
  return buildSearchQuery({
    message: item.message,
    noteJson: item.note || null,
    codes: item.codes || [],
    history: item.history || [],
    specialty: item.specialty || '',
    patient: item.patient || null
  });
}

/** Huella de los rankings de la cabeza: si cambia el código o el modelo, cambia. */
function rankingFingerprint(head, texts) {
  const hash = crypto.createHash('sha256');
  for (const text of texts) hash.update(`${head.rank(text, REFERENCE_TOP).map(([id]) => id).join(',')}\n`);
  return hash.digest('hex');
}

function calibrate(index, head, repoEval) {
  const items = Object.values(repoEval.sets).flat().map((item) => ({ item, query: queryFor(item) }));
  const inPrompt = (item, guidelines) => guidelines.some((guideline) => asList(item.expected).includes(guideline.guideline_id));
  const baseline = items.map(({ item, query }) => inPrompt(item, retrieveForPrompt(index, query, { mode: 'off' }).guidelines));
  let vetoK = null;
  for (const k of VETO_K_CANDIDATES) {
    const losses = items.filter(({ item, query }, position) => (
      baseline[position] && !inPrompt(item, retrieveForPrompt(index, query, { mode: 'on', head, vetoK: k, cupoP: null }).guidelines)
    )).length;
    if (losses === 0) {
      vetoK = k;
      break;
    }
  }
  const outOfCorpus = repoEval.fueraDelCorpus.map((message) => buildSearchQuery({ message }));
  let cupoP = 1;
  for (let step = 0; step <= 100; step += 1) {
    const p = step / 100;
    const acts = outOfCorpus.filter((query) => retrieveForPrompt(index, query, { mode: 'on', head, vetoK: null, cupoP: p }).mode === 'cupo').length;
    if (acts === 0) {
      cupoP = p;
      break;
    }
  }
  return { vetoK, cupoP };
}

function main() {
  const started = Date.now();
  const corpus = corpusLib.readCorpusFile();
  const fresh = corpusLib.buildCorpus();
  if (fresh.source_hash !== corpus.source_hash) {
    throw new Error('guidelines.corpus.json no está al día con los Markdown: corre primero `npm run build:corpus`');
  }
  const model = trainHead(trainingPairs(corpus), { log: (line) => console.log(`  ${line}`) });
  model.source_hash = corpus.source_hash;
  const head = new GuidelineHead(model);
  const index = new ClinicalGuidelineIndex({ corpus, synonyms: corpusLib.readSynonyms(), head });
  // eslint-disable-next-line global-require
  const repoEval = require('./fixtures/rag-eval.json');
  const { vetoK, cupoP } = calibrate(index, head, repoEval);
  if (!vetoK) throw new Error(`ningún K de ${VETO_K_CANDIDATES.join(', ')} deja el repo sin pérdidas: revisa las consultas antes de activar el veto`);
  model.veto_k = vetoK;
  model.cupo_p = cupoP;
  const referenceTexts = Object.values(repoEval.sets).flat().map((item) => item.message);
  model.reference = { texts: referenceTexts.length, top: REFERENCE_TOP, sha256: rankingFingerprint(head, referenceTexts) };
  const ordered = {
    _comentario: 'Generado por scripts/build-guideline-head.js. No se edita a mano.',
    source_hash: model.source_hash,
    veto_k: model.veto_k,
    cupo_p: model.cupo_p,
    training: model.training,
    reference: model.reference,
    gids: model.gids,
    scale: model.scale,
    intercept: model.intercept,
    word: model.word,
    char: model.char,
    W: model.W
  };
  fs.writeFileSync(HEAD_FILE, `${JSON.stringify(ordered)}\n`);
  const size = fs.statSync(HEAD_FILE).size;
  console.log(`[build-guideline-head] ${model.gids.length} guías · veto K=${vetoK} · cupo p≥${cupoP} · ${(size / 1024 / 1024).toFixed(2)} MB · ${((Date.now() - started) / 1000).toFixed(1)} s → ${HEAD_FILE}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[build-guideline-head] FALLÓ: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { HEAD_FILE, REFERENCE_TOP, rankingFingerprint, calibrate };
