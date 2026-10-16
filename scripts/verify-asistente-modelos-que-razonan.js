#!/usr/bin/env node
// Juez de las promesas de docs/specs/009-el-asistente-corre-en-modelos-que-razonan.md.
//
//   node scripts/verify-asistente-modelos-que-razonan.js
const assert = require('assert');
const axios = require('axios');
const { promesa, cerrar } = require('./lib/promesas');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
const MiracleAssistantProviderConfigService = require('../src/application/use-cases/MiracleAssistantProviderConfigService');
const { calculateCost } = require('../src/domain/usage/pricing');
const { loadDefaultIndex } = require('../src/application/knowledge/ClinicalGuidelineIndex');

const RAZONAN = ['gpt-5-mini', 'gpt-5.6-luna', 'gpt-6-luna', 'gpt-6.1-sol', 'o4-mini', 'openai/gpt-5-mini'];
const NO_RAZONAN = ['gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.5'];

function providerWith(model) {
  for (const key of ['PROVIDER', 'API_KEY', 'BASE_URL', 'MODEL', 'TIMEOUT_MS', 'DISABLE_TEMPERATURE']) delete process.env[`RAZONA_LLM_${key}`];
  process.env.RAZONA_LLM_PROVIDER = 'openai';
  process.env.RAZONA_LLM_API_KEY = 'test-key';
  process.env.RAZONA_LLM_MODEL = model;
  return new LLMProvider('RAZONA');
}

/** Lo que el proveedor mandaría a la API (sin red). */
async function payloadOf(provider, options) {
  const original = axios.post;
  let sent = null;
  axios.post = async (url, payload) => {
    sent = payload;
    return { data: { choices: [{ message: { content: '{"respuesta":"ok","respaldo":"general"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
  };
  try {
    await provider.chatExpectingJsonWithUsage([{ role: 'user', content: 'hola' }], { type: 'json_object' }, options);
  } finally {
    axios.post = original;
  }
  return sent;
}

async function chatOptions(model, message) {
  const provider = providerWith(model);
  let options = null;
  const llm = {
    provider: provider.provider,
    model: provider.model,
    hasApiKey: () => true,
    usesCompletionTokens: (...args) => provider.usesCompletionTokens(...args),
    parseJsonObject: (content) => provider.parseJsonObject(content),
    async chatExpectingJsonWithUsage(messages, format, opts) {
      options = opts;
      return { content: '{"respuesta":"ok","respaldo":"general"}', usage: null, model, provider: 'openai' };
    }
  };
  const service = new ClinicalAssistantService({
    encounterService: { getOwnedEncounter: async () => null },
    llmProvider: llm,
    promptBuilder: new ClinicalAssistantPromptBuilder(),
    validationService: new ClinicalAssistantValidationService(),
    guidelineIndex: loadDefaultIndex()
  });
  await service.chat({ message });
  return options;
}

async function main() {
  await promesa(901, 'Con un modelo que razona (gpt-5-mini, gpt-5.6-luna, gpt-6-luna, la serie o) el proveedor manda max_completion_tokens y esfuerzo de razonamiento y nunca temperature; con uno que no razona manda temperature y max_tokens como antes', async () => {
    for (const model of RAZONAN) {
      const payload = await payloadOf(providerWith(model), { temperature: 0.3, maxTokens: 900, reasoningEffort: 'low' });
      assert.ok(!('temperature' in payload), `${model} recibe temperature (la API responde 400)`);
      assert.ok(!('max_tokens' in payload), `${model} recibe max_tokens (la API responde 400)`);
      assert.strictEqual(payload.max_completion_tokens, 900, model);
      assert.strictEqual(payload.reasoning_effort, 'low', model);
    }
    for (const model of NO_RAZONAN) {
      const payload = await payloadOf(providerWith(model), { temperature: 0.3, maxTokens: 900, reasoningEffort: 'low' });
      assert.strictEqual(payload.temperature, 0.3, model);
      assert.strictEqual(payload.max_tokens, 900, model);
      assert.ok(!('reasoning_effort' in payload), `${model} recibe reasoning_effort (la API responde 400)`);
    }
  });

  await promesa(902, 'El chat del asistente con un modelo que razona sube el tope de salida (5 000 directo, 9 000 razonado) para que el razonamiento no corte el JSON, con esfuerzo bajo en lo directo y medio en lo razonado; con un modelo que no razona los topes siguen en 1 800 y 3 500', async () => {
    const directoRazona = await chatOptions('gpt-5-mini', 'dosis de amoxicilina en otitis media aguda');
    const casoRazona = await chatOptions('gpt-6-luna', '¿Qué hago con este paciente?');
    assert.deepStrictEqual([directoRazona.maxTokens, directoRazona.reasoningEffort], [5000, 'low']);
    assert.deepStrictEqual([casoRazona.maxTokens, casoRazona.reasoningEffort], [9000, 'medium']);
    const directo = await chatOptions('gpt-4.1-mini', 'dosis de amoxicilina en otitis media aguda');
    const caso = await chatOptions('gpt-4.1-mini', '¿Qué hago con este paciente?');
    assert.strictEqual(directo.maxTokens, 1800);
    assert.strictEqual(caso.maxTokens, 3500);
  });

  await promesa(903, 'Provider Studio ofrece gpt-5-mini, gpt-5.6-luna y gpt-6-luna para el asistente con OpenAI, y el registro de consumo les pone precio', () => {
    const service = new MiracleAssistantProviderConfigService({ provider: 'openai', model: 'gpt-4.1-mini', hasApiKey: () => true, configSource: 'env' }, { vercelEnvService: { isConfigured: () => false, status: () => ({ configured: false }) } });
    const options = service.status().providers.find((item) => item.id === 'openai').model_options;
    for (const model of ['gpt-5-mini', 'gpt-5.6-luna', 'gpt-6-luna']) {
      assert.ok((options || []).includes(model), `${model} no aparece en Provider Studio`);
      const cost = calculateCost({ provider: 'openai', model, apiFamily: 'chat_completions', inputTokens: 6000, outputTokens: 1000 });
      assert.strictEqual(cost.costStatus, 'priced', `${model} sin tarifa en el registro de consumo`);
      assert.ok(cost.costUsd > 0);
    }
  });

  cerrar('verify-asistente-modelos-que-razonan');
}

main();
