#!/usr/bin/env node
// Juez de las promesas de docs/specs/010-cada-funcion-corre-en-el-modelo-que-gano-la-medida.md.
//
//   node scripts/verify-modelos-por-funcion.js
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
const { promesa, saltar, cerrar } = require('./lib/promesas');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
const { PROMPT_VERSION, buildNoteFieldMatchingPrompt } = require('../src/application/use-cases/NoteFieldMatchingPolicy');
const GraphProviderConfigService = require('../src/application/use-cases/GraphProviderConfigService');
const BiopsyPhotoProviderConfigService = require('../src/application/use-cases/BiopsyPhotoProviderConfigService');
const MiracleProductLlmProviderConfigService = require('../src/application/use-cases/MiracleProductLlmProviderConfigService');
const { calculateCost } = require('../src/domain/usage/pricing');

const ENV = ['PROVIDER', 'API_KEY', 'BASE_URL', 'MODEL', 'TIMEOUT_MS', 'DISABLE_TEMPERATURE', 'REASONING_EFFORT'];

function providerWith(model, extra = {}) {
  for (const key of ENV) delete process.env[`FUNCION_LLM_${key}`];
  process.env.FUNCION_LLM_PROVIDER = 'openai';
  process.env.FUNCION_LLM_API_KEY = 'test-key';
  process.env.FUNCION_LLM_MODEL = model;
  for (const [key, value] of Object.entries(extra)) process.env[`FUNCION_LLM_${key}`] = value;
  return new LLMProvider('FUNCION');
}

/** Lo que el proveedor mandaría a la API (sin red), con lo que devuelva `content`. */
async function capture(run, content = '{"matches":[],"readyToSubmit":false,"submitReason":""}') {
  const original = axios.post;
  const sent = [];
  axios.post = async (url, payload) => {
    sent.push(payload);
    return { data: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
  };
  try {
    await run();
  } finally {
    axios.post = original;
  }
  return sent;
}

const FIELDS = [{ stepOrder: 1, actionType: 'input', label: 'Peso (kg)', selector: '#peso', controlType: 'text' }];

async function main() {
  await promesa(1001, 'Con un modelo que razona, lo que no fija su esfuerzo (la nota, los campos, la revisión) pide esfuerzo bajo, y la variable …_LLM_REASONING_EFFORT del panel lo cambia; a un modelo que no razona nunca se le pide esfuerzo', async () => {
    // Por el emparejador real: así llaman también la nota y la revisión (sin reasoningEffort).
    for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-5-mini']) {
      const [payload] = await capture(() => new NoteFieldMatcher(providerWith(model)).match({ noteContent: 'Peso 92 kg.', fields: FIELDS }));
      assert.strictEqual(payload.reasoning_effort, 'low', `${model} sin esfuerzo bajo: con «medium» gpt-5-mini tardó 72 s en una nota`);
      assert.ok(!('temperature' in payload), `${model} recibe temperature`);
    }
    const [medio] = await capture(() => new NoteFieldMatcher(providerWith('gpt-5.6-luna', { REASONING_EFFORT: 'medium' })).match({ noteContent: 'Peso 92 kg.', fields: FIELDS }));
    assert.strictEqual(medio.reasoning_effort, 'medium', 'la variable de entorno no cambia el esfuerzo');
    const [raro] = await capture(() => new NoteFieldMatcher(providerWith('gpt-5.6-luna', { REASONING_EFFORT: 'altísimo' })).match({ noteContent: 'Peso 92 kg.', fields: FIELDS }));
    assert.strictEqual(raro.reasoning_effort, 'low', 'un valor inválido en la variable llega a la API');
    // Quien sí lo fija (el chat del asistente) manda sobre el valor por defecto.
    const [explicito] = await capture(() => providerWith('gpt-5.6-luna').chatExpectingJsonWithUsage([{ role: 'user', content: 'hola' }], { type: 'json_object' }, { reasoningEffort: 'medium' }));
    assert.strictEqual(explicito.reasoning_effort, 'medium');
    for (const model of ['gpt-4.1-mini', 'gpt-4o']) {
      const [payload] = await capture(() => new NoteFieldMatcher(providerWith(model, { REASONING_EFFORT: 'medium' })).match({ noteContent: 'Peso 92 kg.', fields: FIELDS }));
      assert.ok(!('reasoning_effort' in payload), `${model} recibe reasoning_effort (la API responde 400)`);
      assert.strictEqual(payload.temperature, 0, model);
    }
  });

  await promesa(1002, 'El emparejador de campos pide solo el número cuando la etiqueta del campo ya trae la unidad o la escala, y que la conserve cuando no la trae', () => {
    const prompt = buildNoteFieldMatchingPrompt();
    assert.match(prompt, /"92", no "92 kg"/, 'el prompt no pide quitar la unidad que ya está en la etiqueta');
    assert.match(prompt, /"7", no "7\/10"/, 'el prompt no pide quitar la escala que ya está en la etiqueta');
    assert.match(prompt, /NO trae la unidad[^\n]*conserva la unidad/, 'el prompt no dice que conserve la unidad cuando la etiqueta no la trae');
    assert.match(PROMPT_VERSION, /2026-10-16\.1/, 'la regla cambió el prompt y la versión no subió');
  });

  await promesa(1003, 'Provider Studio ofrece gpt-5.6-luna como modelo por defecto de notas y campos (con gpt-6-luna como opción) y gpt-4.1-mini como modelo por defecto de Biopsia, y el registro de consumo les pone precio', () => {
    const vercelEnvService = { isConfigured: () => false, status: () => ({ configured: false }) };
    const llm = { provider: 'openai', model: 'gpt-4.1-mini', hasApiKey: () => true, configSource: 'env' };
    const graph = new GraphProviderConfigService(llm, { vercelEnvService }).status().providers.find((item) => item.id === 'openai');
    assert.strictEqual(graph.default_model, 'gpt-5.6-luna');
    for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-4.1-mini']) assert.ok(graph.model_options.includes(model), `${model} no está en Field Matching`);
    const biopsia = new BiopsyPhotoProviderConfigService({ ...llm, model: 'gpt-4o' }, { vercelEnvService }).status().providers.find((item) => item.id === 'openai');
    assert.strictEqual(biopsia.default_model, 'gpt-4.1-mini');
    assert.strictEqual(biopsia.model_options[0], 'gpt-4.1-mini');
    for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-4.1-mini']) {
      const cost = calculateCost({ provider: 'openai', model, apiFamily: 'chat_completions', inputTokens: 6000, outputTokens: 1000 });
      assert.strictEqual(cost.costStatus, 'priced', `${model} sin tarifa en el registro de consumo`);
    }
  });

  await promesa(1004, 'La hoja en blanco ofrece gpt-5.6-luna (por defecto) y gpt-6-luna en Provider Studio, y con un modelo que razona el dictado pide esfuerzo bajo y deja espacio de salida para razonar, sin mandarle esos parámetros a un modelo que no razona', () => {
    const hoja = new MiracleProductLlmProviderConfigService({ vercelEnvService: { isConfigured: () => false, status: () => ({ configured: false }) } })
      .status().providers.find((item) => item.id === 'openai');
    assert.strictEqual(hoja.default_model, 'gpt-5.6-luna');
    for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-4.1']) assert.ok(hoja.model_options.includes(model), `${model} no está en la hoja en blanco`);

    // La petición que arma el runtime Python del dictado (bounded/miracle-ai), sin red.
    const ejecutable = ['python3', 'python', 'py'].find((bin) => {
      const r = spawnSync(bin, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 20000 });
      return r.status === 0 && `${r.stdout}`.trim() === '3';
    });
    if (!ejecutable) saltar('no hay un Python 3 en esta máquina para correr el runtime del dictado');
    const sonda = [
      'import json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'from miracle_agent.integrations.product_llm.config import ProductLLMSettings',
      'from miracle_agent.integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment',
      'from miracle_agent.integrations.product_llm.note_orchestrator_adapter import ProductLLMOrchestratorAdapter',
      'seg = VoiceTranscriptSegment(segment_id="s", kind="final", transcript="dolor")',
      'req = ProductLLMOrchestratorInput(voice_session_id="v", note_path=None, note_title="n", note_content="", last_applied_note_block=None, transcript_history=["dolor"], segment=seg)',
      'out = {}',
      'for m in ["gpt-5.6-luna", "gpt-6-luna", "gpt-4.1", "gpt-4.1-mini"]:',
      '    p = ProductLLMOrchestratorAdapter(ProductLLMSettings(provider="openai", base_url="https://x", api_key="k", model=m))._planner._build_payload(req)',
      '    out[m] = {"reasoning": p.get("reasoning"), "max_output_tokens": p.get("max_output_tokens"), "temperature": p.get("temperature")}',
      'print(json.dumps(out))'
    ].join('\n');
    const r = spawnSync(ejecutable, ['-c', sonda, path.join(__dirname, '..', 'bounded', 'miracle-ai', 'src')], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0 && /ModuleNotFoundError/.test(`${r.stderr}`)) saltar(`al Python de esta máquina le falta un paquete del runtime: ${`${r.stderr}`.trim().split('\n').pop()}`);
    assert.strictEqual(r.status, 0, `el runtime no armó la petición: ${`${r.stderr}`.trim()}`);
    const pedido = JSON.parse(`${r.stdout}`.trim().split('\n').pop());
    for (const model of ['gpt-5.6-luna', 'gpt-6-luna']) {
      assert.deepStrictEqual(pedido[model].reasoning, { effort: 'low' }, `${model} sin esfuerzo bajo en el dictado`);
      assert.ok(pedido[model].max_output_tokens >= 8000, `${model} con ${pedido[model].max_output_tokens} tokens: el razonamiento corta el JSON`);
      assert.strictEqual(pedido[model].temperature, null, model);
    }
    for (const model of ['gpt-4.1', 'gpt-4.1-mini']) {
      assert.strictEqual(pedido[model].reasoning, null, `${model} recibe reasoning (la API responde 400)`);
      assert.strictEqual(pedido[model].max_output_tokens, 2000, model);
    }
  });

  cerrar('verify-modelos-por-funcion');
}

main();
