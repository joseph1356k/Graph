// Verifica las dos costuras por las que una API key nueva puede no llegar nunca
// al runtime, y la traducción de fallos del proveedor a códigos accionables.
//
// El caso real que originó estas pruebas: el asistente clínico respondía
// ASSISTANT_FAILED ("intenta de nuevo en unos segundos", con botón Reintentar)
// mientras OpenAI devolvía 429 insufficient_quota. Ni el médico ni el
// administrador podían saber que era un problema de facturación, y la key
// cambiada en la variable equivocada se veía igual que una que sí tomó efecto.
//
//   node scripts/verify-llm-provider-config.js
const assert = require('assert');

const LLMProvider = require('../src/infrastructure/LLMProvider');
const { classifyLlmFailure } = require('../src/application/use-cases/LlmFailure');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const ASSISTANT_ENV_KEYS = [
  'MIRACLE_ASSISTANT_LLM_PROVIDER',
  'MIRACLE_ASSISTANT_LLM_API_KEY',
  'MIRACLE_ASSISTANT_LLM_BASE_URL',
  'MIRACLE_ASSISTANT_LLM_MODEL',
  'MIRACLE_ASSISTANT_LLM_OPENAI_API_KEY',
  'MIRACLE_ASSISTANT_LLM_GOOGLE_API_KEY'
];

function withAssistantEnv(values, fn) {
  const saved = new Map(ASSISTANT_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
    for (const [key, value] of saved) {
      if (value !== undefined) process.env[key] = value;
    }
  }
}

// Un fallo tal y como lo lanza LLMProvider.postChatCompletions.
function providerFailure({ status, code = '', type = '' }) {
  const error = new Error(`LLM request failed (${status}): simulado`);
  error.status = status;
  error.providerErrorCode = code;
  error.providerErrorType = type;
  return error;
}

function assistantWithFailure(error) {
  return new ClinicalAssistantService({
    encounterService: { getOwnedEncounter: async () => null },
    llmProvider: {
      hasApiKey: () => true,
      chatWithUsage: async () => { throw error; }
    },
    promptBuilder: new ClinicalAssistantPromptBuilder(),
    validationService: new ClinicalAssistantValidationService()
  });
}

async function codeForChatFailure(error) {
  try {
    await assistantWithFailure(error).chat({ message: 'hola' });
  } catch (thrown) {
    return { code: thrown.code, statusCode: thrown.statusCode };
  }
  throw new Error('se esperaba un error del asistente');
}

async function main() {
  console.log('Resolución de la API key del runtime');

  await check('lee la key genérica MIRACLE_ASSISTANT_LLM_API_KEY', () => {
    withAssistantEnv({
      MIRACLE_ASSISTANT_LLM_PROVIDER: 'openai',
      MIRACLE_ASSISTANT_LLM_API_KEY: 'sk-generica'
    }, () => {
      const provider = new LLMProvider('MIRACLE_ASSISTANT');
      assert.strictEqual(provider.hasApiKey(), true);
      assert.strictEqual(provider.apiKey, 'sk-generica');
      assert.strictEqual(provider.apiKeySource, 'generic');
    });
  });

  // La regresión concreta: el Provider Studio guarda la key en DOS variables y
  // el runtime solo leía una. Cambiarla en la por-provider no surtía efecto y el
  // panel seguía mostrando "Configurado" con la key vieja en uso.
  await check('cae a la key por-provider cuando la genérica está vacía', () => {
    withAssistantEnv({
      MIRACLE_ASSISTANT_LLM_PROVIDER: 'openai',
      MIRACLE_ASSISTANT_LLM_OPENAI_API_KEY: 'sk-por-provider'
    }, () => {
      const provider = new LLMProvider('MIRACLE_ASSISTANT');
      assert.strictEqual(provider.hasApiKey(), true);
      assert.strictEqual(provider.apiKey, 'sk-por-provider');
      assert.strictEqual(provider.apiKeySource, 'per-provider');
    });
  });

  await check('la genérica manda sobre la por-provider (es la documentada como activa)', () => {
    withAssistantEnv({
      MIRACLE_ASSISTANT_LLM_PROVIDER: 'openai',
      MIRACLE_ASSISTANT_LLM_API_KEY: 'sk-generica',
      MIRACLE_ASSISTANT_LLM_OPENAI_API_KEY: 'sk-por-provider'
    }, () => {
      assert.strictEqual(new LLMProvider('MIRACLE_ASSISTANT').apiKey, 'sk-generica');
    });
  });

  await check('la key por-provider corresponde al provider activo, no a otro', () => {
    withAssistantEnv({
      MIRACLE_ASSISTANT_LLM_PROVIDER: 'google',
      MIRACLE_ASSISTANT_LLM_OPENAI_API_KEY: 'sk-de-openai'
    }, () => {
      const provider = new LLMProvider('MIRACLE_ASSISTANT');
      assert.strictEqual(provider.hasApiKey(), false, 'una key de OpenAI no debe configurar Google');
    });
  });

  await check('azure-foundry mapea al nombre de env con guion bajo', () => {
    withAssistantEnv({
      MIRACLE_ASSISTANT_LLM_PROVIDER: 'azure-foundry',
      MIRACLE_ASSISTANT_LLM_AZURE_FOUNDRY_API_KEY: 'sk-foundry'
    }, () => {
      const provider = new LLMProvider('MIRACLE_ASSISTANT');
      assert.strictEqual(provider.apiKey, 'sk-foundry');
    });
  });

  await check('sin ninguna key el asistente queda sin configurar', () => {
    withAssistantEnv({ MIRACLE_ASSISTANT_LLM_PROVIDER: 'openai' }, () => {
      assert.strictEqual(new LLMProvider('MIRACLE_ASSISTANT').hasApiKey(), false);
    });
  });

  console.log('\nClasificación de fallos del proveedor');

  await check('429 insufficient_quota NO es un fallo transitorio', () => {
    assert.strictEqual(
      classifyLlmFailure(providerFailure({ status: 429, code: 'insufficient_quota', type: 'insufficient_quota' })),
      'LLM_QUOTA_EXCEEDED'
    );
  });

  await check('429 sin código de cuota sí es límite de tasa', () => {
    assert.strictEqual(
      classifyLlmFailure(providerFailure({ status: 429, code: 'rate_limit_exceeded' })),
      'RATE_LIMITED'
    );
  });

  await check('401 se reporta como credenciales inválidas', () => {
    assert.strictEqual(classifyLlmFailure(providerFailure({ status: 401 })), 'LLM_AUTH_FAILED');
  });

  await check('404 se reporta como modelo no disponible', () => {
    assert.strictEqual(classifyLlmFailure(providerFailure({ status: 404 })), 'LLM_MODEL_NOT_FOUND');
  });

  await check('un 500 del proveedor no se disfraza de problema de configuración', () => {
    assert.strictEqual(classifyLlmFailure(providerFailure({ status: 500 })), null);
  });

  console.log('\nLo que recibe la UI del asistente');

  await check('la cuota agotada llega como LLM_QUOTA_EXCEEDED 503, no como ASSISTANT_FAILED', async () => {
    const result = await codeForChatFailure(
      providerFailure({ status: 429, code: 'insufficient_quota', type: 'insufficient_quota' })
    );
    assert.strictEqual(result.code, 'LLM_QUOTA_EXCEEDED');
    assert.strictEqual(result.statusCode, 503);
  });

  await check('una credencial revocada llega como LLM_AUTH_FAILED', async () => {
    const result = await codeForChatFailure(providerFailure({ status: 401, code: 'invalid_api_key' }));
    assert.strictEqual(result.code, 'LLM_AUTH_FAILED');
  });

  await check('un fallo genuino del motor sigue siendo ASSISTANT_FAILED 502', async () => {
    const result = await codeForChatFailure(providerFailure({ status: 503 }));
    assert.strictEqual(result.code, 'ASSISTANT_FAILED');
    assert.strictEqual(result.statusCode, 502);
  });

  await check('ningún mensaje al médico filtra la key ni el endpoint', async () => {
    const error = providerFailure({ status: 429, code: 'insufficient_quota' });
    error.message = 'LLM request failed (429): {"key":"sk-secreta","url":"https://api.openai.com"}';
    let thrown;
    try {
      await assistantWithFailure(error).chat({ message: 'hola' });
    } catch (caught) {
      thrown = caught;
    }
    assert.ok(!/sk-secreta/.test(thrown.message), 'el mensaje no debe llevar la key');
    assert.ok(!/api\.openai\.com/.test(thrown.message), 'el mensaje no debe llevar el endpoint');
  });

  console.log('\nEnmascarado de la key en el panel');

  const MiracleAssistantProviderConfigService = require('../src/application/use-cases/MiracleAssistantProviderConfigService');

  await check('status() nunca devuelve la key completa al navegador', () => {
    const service = new MiracleAssistantProviderConfigService(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-proj-ABCDEFGHIJKLMNOP', hasApiKey: () => true, configSource: 'miracle_assistant-env', apiKeySource: 'generic' },
      { vercelEnvService: { status: () => ({ write_enabled: true }) } }
    );
    const payload = service.status();
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes('sk-proj-ABCDEFGHIJKLMNOP'), 'la key completa no puede viajar al cliente');
    assert.strictEqual(payload.status.api_key_masked, '…MNOP');
    assert.strictEqual(payload.status.api_key_env, 'MIRACLE_ASSISTANT_LLM_API_KEY');
  });

  console.log(`\n[verify-llm-provider-config] ${passed} verificaciones OK`);
}

main().catch((error) => {
  console.error(`\n[verify-llm-provider-config] FALLÓ: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
