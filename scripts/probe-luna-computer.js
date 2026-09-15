#!/usr/bin/env node
// Sonda REAL contra OpenAI (gasta tokens): ¿acepta gpt-5.6-luna la herramienta
// `computer` tal como la declara el cerebro OpenAI en un turno Android?
//   node --env-file=<.env.local | .env> scripts/probe-luna-computer.js
//
// Un solo POST /v1/responses, sin reintentos, con las tools EXACTAS de
// openaiBrain (toolDeclarations sobre el catálogo base de Android) y el prompt de
// teléfono. La key sale de resolveConsciousConfig con las variables *_ANDROID_APP
// de la decisión A puestas en este proceso: es la misma key que usaría el turno
// Android en producción con esas variables.
//
// Imprime solo el status HTTP y el tipo y mensaje del error, o «aceptado» con el
// tipo del primer output. Nunca imprime la key ni variables de entorno.
const { toolDeclarations } = require('../src/infrastructure/conscious-brain/openaiBrain');
const { goalPrompt, describeState } = require('../src/infrastructure/conscious-brain/prompt');
const { resolveConsciousConfig } = require('../src/infrastructure/conscious-brain/config');
const { baseCatalog } = require('../src/domain/agent/mcpCatalog');
const { PLATFORMS } = require('../src/domain/agent/platform');

const MODEL = 'gpt-5.6-luna';
const ENDPOINT = 'https://api.openai.com/v1/responses';

// Un mensaje de error de auth puede traer la key enmascarada: se tapa entera.
function redact(text, apiKey) {
  let out = `${text || ''}`;
  if (apiKey) out = out.split(apiKey).join('[key]');
  return out.replace(/sk-[A-Za-z0-9_*.-]+/g, '[key]');
}

async function main() {
  process.env.MIRACLE_CONSCIOUS_LLM_PROVIDER_ANDROID_APP = 'openai';
  process.env.MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP = MODEL;
  const config = resolveConsciousConfig({ platform: PLATFORMS.ANDROID });
  if (!config.configured || config.provider !== 'openai') {
    console.log('sin key de OpenAI en el entorno: no se llamó a la API');
    process.exit(2);
  }

  const tools = baseCatalog(PLATFORMS.ANDROID);
  const state = { screen: 'com.miui.home · Inicio', uiContext: 'paquete: com.miui.home\ntipo: launcher de Android (home o cajón de apps)\netiquetas visibles: Ajustes · Cámara · Reloj' };
  const body = {
    model: config.model,
    instructions: goalPrompt({ goal: 'Abre los ajustes de Wi-Fi.', tools, memory: '', stateBlock: '', platform: PLATFORMS.ANDROID }),
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: describeState(state, PLATFORMS.ANDROID) }] }],
    tools: toolDeclarations(tools),
    truncation: 'auto',
    reasoning: { effort: config.effort }
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parsed = {};
  }

  if (res.ok) {
    const first = Array.isArray(parsed.output) && parsed.output[0] ? parsed.output[0].type : '(sin output)';
    console.log(`HTTP ${res.status} · aceptado · modelo ${parsed.model || MODEL} · primer output: ${first}`);
    return;
  }
  const error = parsed.error || {};
  console.log(`HTTP ${res.status} · ${error.type || error.code || 'error'} · ${redact(error.message || text.slice(0, 300), config.apiKey)}`);
  process.exit(1);
}

main().catch((error) => {
  console.log(`la sonda no llegó a OpenAI: ${error.name}`);
  process.exit(1);
});
