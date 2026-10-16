#!/usr/bin/env node
// Juez de las promesas de docs/specs/010-cada-funcion-corre-en-el-modelo-que-gano-la-medida.md.
//
//   node scripts/verify-modelos-por-funcion.js
const assert = require('assert');
const axios = require('axios');
const { promesa, cerrar } = require('./lib/promesas');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
const { PROMPT_VERSION, buildNoteFieldMatchingPrompt } = require('../src/application/use-cases/NoteFieldMatchingPolicy');
const GraphProviderConfigService = require('../src/application/use-cases/GraphProviderConfigService');
const BiopsyPhotoProviderConfigService = require('../src/application/use-cases/BiopsyPhotoProviderConfigService');
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

  cerrar('verify-modelos-por-funcion');
}

main();
