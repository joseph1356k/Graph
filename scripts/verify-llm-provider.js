#!/usr/bin/env node
// LLMProvider: parámetros de generación, timeout y recuperación de JSON.
//   node scripts/verify-llm-provider.js
const assert = require('assert');
const axios = require('axios');
const LLMProvider = require('../src/infrastructure/LLMProvider');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function providerWith(env = {}) {
  const prefix = 'VERIFY';
  const keys = ['PROVIDER', 'API_KEY', 'BASE_URL', 'MODEL', 'TIMEOUT_MS', 'DISABLE_TEMPERATURE'];
  for (const key of keys) delete process.env[`${prefix}_LLM_${key}`];
  process.env.VERIFY_LLM_PROVIDER = 'openai';
  process.env.VERIFY_LLM_API_KEY = 'test-key';
  process.env.VERIFY_LLM_MODEL = 'gpt-test';
  for (const [key, value] of Object.entries(env)) process.env[`${prefix}_LLM_${key}`] = value;
  return new LLMProvider(prefix);
}

async function captureCall(provider, run) {
  const original = axios.post;
  const calls = [];
  axios.post = async (url, payload, config) => {
    calls.push({ url, payload, config });
    return { data: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: 'gpt-test' } };
  };
  try {
    await run(provider);
  } finally {
    axios.post = original;
  }
  return calls;
}

(async () => {
  {
    const provider = providerWith({ TIMEOUT_MS: '1234' });
    const calls = await captureCall(provider, (p) => p.chatWithUsage([{ role: 'user', content: 'hola' }], { temperature: 0.2, maxTokens: 300 }));
    check('temperature y max_tokens viajan en el body cuando el llamador los fija', () => {
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].payload.temperature, 0.2);
      assert.strictEqual(calls[0].payload.max_tokens, 300);
    });
    check('el timeout del env llega a axios', () => {
      assert.strictEqual(calls[0].config.timeout, 1234);
    });
  }

  {
    const provider = providerWith();
    const calls = await captureCall(provider, (p) => p.chatExpectingJson([{ role: 'user', content: 'hola' }], { type: 'json_object' }));
    check('sin opciones no se envía temperature ni max_tokens (comportamiento anterior intacto)', () => {
      assert.ok(!('temperature' in calls[0].payload));
      assert.ok(!('max_tokens' in calls[0].payload));
      assert.strictEqual(calls[0].payload.response_format.type, 'json_object');
      assert.strictEqual(calls[0].config.timeout, 60000);
    });
  }

  {
    const provider = providerWith({ TIMEOUT_MS: '60000' });
    const calls = await captureCall(provider, async (p) => {
      await p.chatExpectingJson([{ role: 'user', content: 'hola' }], { type: 'json_object' }, { timeoutMs: 160000 });
      await p.chatWithUsage([{ role: 'user', content: 'hola' }], { timeoutMs: 90000 });
      await p.chatWithUsage([{ role: 'user', content: 'hola' }], {});
    });
    check('un timeout por llamada gana al de la instancia solo en esa llamada', () => {
      assert.strictEqual(calls[0].config.timeout, 160000);
      assert.strictEqual(calls[1].config.timeout, 90000);
      assert.strictEqual(calls[2].config.timeout, 60000, 'sin timeoutMs vuelve el de la instancia');
      assert.ok(!('timeoutMs' in calls[0].payload), 'el timeout no viaja al proveedor');
    });
  }

  {
    const provider = providerWith({ DISABLE_TEMPERATURE: '1' });
    const calls = await captureCall(provider, (p) => p.chatWithUsage([{ role: 'user', content: 'hola' }], { temperature: 0 }));
    check('DISABLE_TEMPERATURE omite el parámetro para modelos que lo rechazan', () => {
      assert.ok(!('temperature' in calls[0].payload));
    });
  }

  {
    const provider = providerWith();
    check('parseJsonObject: fences al principio y al final', () => {
      assert.deepStrictEqual(provider.parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
    });
    check('parseJsonObject: un fence DENTRO de un valor no corrompe el JSON', () => {
      const raw = '{"content":"usa ```python``` para esto"}';
      assert.deepStrictEqual(provider.parseJsonObject(raw), { content: 'usa ```python``` para esto' });
    });
    check('parseJsonObject: prosa alrededor del objeto', () => {
      assert.deepStrictEqual(provider.parseJsonObject('Aquí tienes:\n{"b":2}\nGracias.'), { b: 2 });
    });
    check('parseJsonObject: arrays', () => {
      assert.deepStrictEqual(provider.parseJsonObject('[{"stepOrder":1}]'), [{ stepOrder: 1 }]);
      assert.deepStrictEqual(provider.parseJsonObject('resultado: [1,2] fin'), [1, 2]);
    });
    check('parseJsonObject: vacío o no-string lanza', () => {
      assert.throws(() => provider.parseJsonObject(''), /empty/);
      assert.throws(() => provider.parseJsonObject(null), /string/);
    });
    check('translateToCypher ya no existe', () => {
      assert.strictEqual(typeof provider.translateToCypher, 'undefined');
    });
  }

  console.log(`\nverify-llm-provider: ${passed} checks ok`);
})().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
