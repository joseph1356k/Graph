#!/usr/bin/env node
// ¿Cuántas veces el asistente dice «no sé»? El dueño pidió como mucho 20 %; el umbral es 5 %,
// sin inventar cifras.
//
// El conjunto (scripts/fixtures/abstencion-eval.json) son preguntas que un
// médico hace de verdad y que merecen una respuesta útil: casos con la consulta
// cargada («¿qué hago con este paciente?»), temas sin guía en el corpus,
// preguntas con guía y cifras difíciles (dosis en Child C, neonatos…).
//
// Cada respuesta pasa por el servicio real (contexto, retrieval, prompt, parser
// y verificador de cifras) con un modelo que devuelve la respuesta grabada. Se
// mide:
//   - abstención: respaldo "insuficiente" o una respuesta que se niega («no
//     puedo responder», «no tengo información»…) sin dar contenido;
//   - JSON válido y que el razonamiento interno nunca llegue al médico;
//   - cifras sin respaldo marcadas por el verificador (promedio por respuesta).
//
// Las respuestas grabadas (scripts/fixtures/abstencion-respuestas.json) las
// escribió un modelo sustituto con el prompt de la versión que declaran: si el
// prompt cambia, hay que regrabarlas (el script falla si la versión no
// coincide). Con MIRACLE_ASSISTANT_LLM_API_KEY y --live se mide el modelo real.
//
//   node scripts/eval-assistant-abstention.js [--verbose]
//   node scripts/eval-assistant-abstention.js --dump <carpeta>   escribe los mensajes de cada caso
//   node scripts/eval-assistant-abstention.js --live             contra el modelo configurado
const fs = require('fs');
const path = require('path');
const fixture = require('./fixtures/abstencion-eval.json');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const { loadDefaultIndex } = require('../src/application/knowledge/ClinicalGuidelineIndex');

const crypto = require('crypto');

const RECORDED_FILE = path.join(__dirname, 'fixtures', 'abstencion-respuestas.json');

/** Huella del texto del prompt del chat: cambia con cualquier palabra, no solo con la versión. */
function promptHash() {
  const builder = new ClinicalAssistantPromptBuilder();
  const hash = crypto.createHash('sha256');
  for (const depth of ['directo', 'razonado']) hash.update(builder.buildChatSystemPrompt({ depth }));
  hash.update(ClinicalAssistantPromptBuilder.NO_GUIDELINES_NOTICE);
  return hash.digest('hex').slice(0, 16);
}
const THRESHOLDS = Object.freeze({
  minCases: 40,
  abstentionRate: 0.05,
  jsonValid: 1,
  reasoningLeaks: 0
});

// Frases de negativa. Cuentan como «no sé» solo si la respuesta no trae
// contenido clínico (menos de REFUSAL_MAX_CHARS caracteres).
const REFUSAL = /\b(no (puedo|podr[ií]a) (responder|recomendar|orientar|dar una recomendaci[oó]n)|no (tengo|cuento con|dispongo de) (informaci[oó]n|respaldo|datos suficientes|una gu[ií]a)|no es posible (responder|recomendar)|no hay (suficiente )?(respaldo|informaci[oó]n) (suficiente )?para responder|fuera de mi alcance)\b/i;
const REFUSAL_MAX_CHARS = 400;

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const live = args.includes('--live');
const dumpIndex = args.indexOf('--dump');
const dumpDir = dumpIndex >= 0 ? args[dumpIndex + 1] : null;

function makeService(llm) {
  return new ClinicalAssistantService({
    encounterService: { getOwnedEncounter: async () => null },
    llmProvider: llm,
    promptBuilder: new ClinicalAssistantPromptBuilder(),
    validationService: new ClinicalAssistantValidationService(),
    noteValidationService: new ClinicalNoteValidationService(),
    guidelineIndex: loadDefaultIndex(),
    drugLabelService: { lookup: async () => [] }
  });
}

function requestFor(item) {
  return {
    message: item.message,
    specialty: item.specialty || 'medicina_general',
    ...(item.note ? { noteDraft: item.note } : {}),
    ...(item.patient ? { patientContext: item.patient } : {})
  };
}

/** ¿La respuesta es un «no sé»? */
function isAbstention(result) {
  if (result.support === 'insuficiente') return true;
  const answer = `${result.answer || ''}`;
  return answer.length < REFUSAL_MAX_CHARS && REFUSAL.test(answer);
}

function capturingLlm(contentFor) {
  const state = { messages: null, options: null };
  return {
    state,
    llm: {
      provider: 'evaluacion',
      model: 'evaluacion',
      hasApiKey: () => true,
      async chatExpectingJsonWithUsage(messages, format, options = {}) {
        state.messages = messages;
        state.options = options;
        return { content: await contentFor(messages, options), usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, model: 'evaluacion', provider: 'evaluacion' };
      },
      parseJsonObject(content) {
        return LLMProvider.prototype.parseJsonObject.call(null, content);
      }
    }
  };
}

async function dump(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const item of fixture.casos) {
    const { llm, state } = capturingLlm(async () => '{"respuesta":"-","respaldo":"general"}');
    // eslint-disable-next-line no-await-in-loop
    const result = await makeService(llm).chat(requestFor(item));
    fs.writeFileSync(path.join(dir, `${item.id}.json`), `${JSON.stringify({
      id: item.id,
      grupo: item.grupo,
      prompt_version: ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION,
      prompt_hash: promptHash(),
      answer_depth: result.used_context.answer_depth,
      retrieval_mode: result.used_context.retrieval_mode,
      max_tokens: state.options.maxTokens,
      messages: state.messages
    }, null, 2)}\n`);
  }
  console.log(`[eval-assistant-abstention] ${fixture.casos.length} casos → ${dir}`);
}

async function liveContent(provider) {
  return async (messages, options) => (await provider.chatExpectingJsonWithUsage(messages, { type: 'json_object' }, options)).content;
}

async function main() {
  if (dumpDir) return dump(dumpDir);
  let contentFor;
  let source;
  if (live) {
    if (!process.env.MIRACLE_ASSISTANT_LLM_API_KEY) {
      console.log('[eval-assistant-abstention] --live: no ejecutado (falta MIRACLE_ASSISTANT_LLM_API_KEY)');
      return;
    }
    const provider = new LLMProvider('MIRACLE_ASSISTANT');
    contentFor = await liveContent(provider);
    source = 'modelo configurado (en vivo)';
  } else {
    const recorded = JSON.parse(fs.readFileSync(RECORDED_FILE, 'utf8'));
    if (recorded.prompt_version !== ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION || recorded.prompt_hash !== promptHash()) {
      throw new Error(`las respuestas grabadas son de otro prompt (${recorded.prompt_version} · ${recorded.prompt_hash}; el actual es ${ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION} · ${promptHash()}): regrábalas con --dump y el modelo sustituto`);
    }
    contentFor = async (messages) => {
      const id = currentId;
      if (!(id in recorded.respuestas)) throw new Error(`falta la respuesta grabada de ${id}`);
      return recorded.respuestas[id];
    };
    source = `grabadas (${recorded.modelo}, ${recorded.fecha})`;
  }

  let currentId = null;
  const rows = [];
  for (const item of fixture.casos) {
    currentId = item.id;
    const { llm } = capturingLlm((messages, options) => contentFor(messages, options));
    // eslint-disable-next-line no-await-in-loop
    const result = await makeService(llm).chat(requestFor(item));
    const raw = live ? '' : JSON.parse(fs.readFileSync(RECORDED_FILE, 'utf8')).respuestas[item.id];
    let jsonValid = true;
    let reasoning = '';
    try {
      const parsed = LLMProvider.prototype.parseJsonObject.call(null, raw || '{}');
      jsonValid = typeof parsed?.respuesta === 'string' || live;
      reasoning = `${parsed?.razonamiento || ''}`.trim();
    } catch (error) {
      jsonValid = live;
    }
    // Filtración = el razonamiento completo aparece en lo que recibe el médico.
    // Que respuesta y razonamiento empiecen con el mismo resumen del caso es normal.
    const leak = reasoning.length >= 60 && JSON.stringify(result).includes(JSON.stringify(reasoning).slice(1, -1));
    rows.push({
      id: item.id,
      grupo: item.grupo,
      abstains: isAbstention(result),
      support: result.support,
      depth: result.used_context.answer_depth,
      unverified: result.unverified_figures.length,
      jsonValid,
      leak,
      chars: result.answer.length
    });
  }

  const n = rows.length;
  const pct = (value) => `${(value * 100).toFixed(1)} %`;
  const abstentionRate = rows.filter((row) => row.abstains).length / n;
  const metrics = {
    abstentionRate,
    jsonValid: rows.filter((row) => row.jsonValid).length / n,
    reasoningLeaks: rows.filter((row) => row.leak).length,
    unverifiedPerAnswer: rows.reduce((sum, row) => sum + row.unverified, 0) / n,
    reasonedShare: rows.filter((row) => row.depth === 'razonado').length / n,
    medianChars: rows.map((row) => row.chars).sort((a, b) => a - b)[Math.floor(n / 2)]
  };
  console.log(`[eval-assistant-abstention] ${n} preguntas · respuestas ${source} · prompt ${ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION}`);
  for (const grupo of [...new Set(rows.map((row) => row.grupo))]) {
    const subset = rows.filter((row) => row.grupo === grupo);
    console.log(`  ${grupo.padEnd(14)} n=${String(subset.length).padStart(2)}  «no sé» ${pct(subset.filter((row) => row.abstains).length / subset.length).padStart(7)} · cifras sin respaldo por respuesta ${(subset.reduce((s, r) => s + r.unverified, 0) / subset.length).toFixed(2)} · razonado ${subset.filter((row) => row.depth === 'razonado').length}/${subset.length}`);
  }
  console.log(`  global         «no sé» ${pct(abstentionRate)} · JSON válido ${pct(metrics.jsonValid)} · razonamiento filtrado ${metrics.reasoningLeaks} · cifras sin respaldo por respuesta ${metrics.unverifiedPerAnswer.toFixed(2)} · mediana ${metrics.medianChars} caracteres`);
  if (verbose) for (const row of rows.filter((item) => item.abstains)) console.log(`   ✗ «no sé» en ${row.id} (respaldo ${row.support})`);

  const below = [];
  if (n < THRESHOLDS.minCases) below.push(`casos ${n} < ${THRESHOLDS.minCases}`);
  if (abstentionRate > THRESHOLDS.abstentionRate) below.push(`«no sé» ${pct(abstentionRate)} > ${pct(THRESHOLDS.abstentionRate)}`);
  if (metrics.jsonValid < THRESHOLDS.jsonValid) below.push(`JSON válido ${pct(metrics.jsonValid)}`);
  if (metrics.reasoningLeaks > THRESHOLDS.reasoningLeaks) below.push(`razonamiento filtrado al médico en ${metrics.reasoningLeaks}`);
  if (below.length) throw new Error(`métricas fuera del umbral: ${below.join('; ')}`);
  console.log('[eval-assistant-abstention] umbrales OK');
  return metrics;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\n[eval-assistant-abstention] FALLÓ: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { isAbstention, promptHash, REFUSAL, THRESHOLDS };
