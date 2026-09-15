#!/usr/bin/env node
// Plataforma del turno del agente (Windows / Android), sin red ni keys.
//   node scripts/verify-agent-platform.js
//
// La app Android consume el mismo POST /api/v1/agent/turn que el cliente
// Windows y se distingue por X-Miracle-App: android_app. Lo que se verifica:
//  (a) Windows —sin cabecera o con windows_app— queda IDÉNTICO byte a byte a
//      tests/fixtures/agent-platform/windows-snapshot.json, que se sacó con
//      scripts/lib/agentTurnCapture.js contra el código ANTERIOR a Android;
//  (b) android_app recibe el prompt de teléfono y el catálogo de Android;
//  (c) la plataforma queda congelada en la sesión firmada del primer turno;
//  (d) MIRACLE_CONSCIOUS_LLM_{MODEL,PROVIDER}_ANDROID_APP solo los lee Android;
//  (e) una app desconocida cae en Windows;
//  (f) la key del cerebro sigue al proveedor congelado en la sesión;
//  (g) con el proveedor deducido, la key general no viaja a ningún proveedor.
// Si (a) se pone rojo, lo que cambió es el contrato con U.exe: el snapshot NO se
// regenera para ponerlo verde.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { captureConversation, continueConversation, captureErrors, readSession, promptInputs, windowsPrompts, PROVIDER_ENVS } = require('./lib/agentTurnCapture');
const { baseCatalog } = require('../src/domain/agent/mcpCatalog');
const { goalPrompt } = require('../src/infrastructure/conscious-brain/prompt');
const UsageAttributionResolver = require('../src/application/use-cases/UsageAttributionResolver');

const SNAPSHOT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'tests', 'fixtures', 'agent-platform', 'windows-snapshot.json'), 'utf8'
));

// Lo que Android sabe ejecutar: Mcp.gestureTools + Mcp.systemTools de
// Android/core/src/commonMain/kotlin/graph/core/domain/Model.kt, en su orden.
const ANDROID_TOOLS = [
  'go_home', 'open_app_drawer', 'open_notifications', 'pan_home', 'scroll_menu',
  'launch_app', 'set_alarm', 'set_timer', 'show_alarms', 'create_event', 'dial', 'call',
  'send_sms', 'send_email', 'web_search', 'open_url', 'check_simit_fines', 'open_maps',
  'directions', 'open_camera', 'open_settings', 'share_text', 'set_clipboard', 'set_volume', 'adjust_volume'
];
const ANDROID_SETTINGS = ['general', 'wifi', 'bluetooth', 'data', 'display', 'sound', 'battery', 'location', 'apps'];
const ANDROID_STREAMS = ['media', 'ring', 'alarm', 'notification', 'call'];

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  not ok - ${name}\n      ${`${error.message}`.split('\n')[0].slice(0, 400)}`);
  }
}

// Comparación byte a byte del JSON serializado. Ante una diferencia muestra
// dónde empieza, en vez de volcar dos documentos de decenas de KB.
function sameBytes(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  let i = 0;
  while (i < a.length && a[i] === e[i]) i += 1;
  const around = (text) => text.slice(Math.max(0, i - 50), i + 50).replace(/\n/g, '\\n');
  throw new Error(`${label}: difiere en el carácter ${i}. esperado «${around(e)}» · llegó «${around(a)}»`);
}

// Lo que el proveedor recibió en un request, igual para OpenAI y Gemini.
function promptOf(request) {
  return request.kind === 'gemini'
    ? request.body.system_instruction.parts[0].text
    : request.body.instructions;
}

function declarationsOf(request) {
  return request.kind === 'gemini'
    ? request.body.tools[0].function_declarations
    : request.body.tools.filter((tool) => tool.type === 'function');
}

function stateTextOf(request) {
  return request.kind === 'gemini'
    ? request.body.contents[0].parts.map((part) => part.text || '').join('\n')
    : request.body.input[0].content[0].text;
}

function modelOf(request) {
  return request.kind === 'gemini'
    ? decodeURIComponent(/\/models\/([^:?/]+)/.exec(request.url)[1])
    : request.body.model;
}

function assertAndroidRequest(request) {
  const prompt = promptOf(request);
  assert.ok(prompt.includes('teléfono Android'), 'el prompt no dice que opera un teléfono Android');
  assert.ok(prompt.includes('AccessibilityService'), 'el prompt no nombra el AccessibilityService');
  assert.ok(prompt.includes('Intent'), 'el prompt no prefiere las acciones por Intent');
  assert.ok(/ATRÁS/.test(prompt), 'el prompt no explica la tecla atrás');
  assert.ok(prompt.includes('ask_user'), 'el prompt no dice cuándo preguntar');
  for (const windowsOnly of ['Windows', 'UIA', 'PowerShell', 'cmd', 'U.exe', 'menú Inicio', 'ratón']) {
    assert.ok(!prompt.includes(windowsOnly), `el prompt de Android menciona «${windowsOnly}»`);
  }
  const names = declarationsOf(request).map((tool) => tool.name);
  assert.ok(!names.includes('switch_window'), 'switch_window llegó a Android');
  assert.ok(!names.some((name) => name.startsWith('map_')), 'una herramienta map_* llegó a Android');
  for (const name of ANDROID_TOOLS) assert.ok(names.includes(name), `falta ${name}`);
  assert.ok(names.includes('workflow_wf_demo'), 'los workflows tienen que seguir llegando');
  assert.ok(names.includes('chat_whatsapp'), 'las herramientas aprendidas tienen que seguir llegando');
  const settings = declarationsOf(request).find((tool) => tool.name === 'open_settings');
  assert.deepStrictEqual(settings.parameters.properties.section.enum, ANDROID_SETTINGS);
}

async function main() {
  // --- (a) Windows idéntico al snapshot previo -----------------------------
  await check('(a) catálogo base de Windows idéntico al snapshot (sin plataforma y con "windows")', () => {
    sameBytes(baseCatalog(), SNAPSHOT.catalog, 'baseCatalog()');
    sameBytes(baseCatalog('windows'), SNAPSHOT.catalog, "baseCatalog('windows')");
  });

  await check('(a) prompt de Windows idéntico al snapshot (con memoria/aprendidas/workflows y sin nada)', () => {
    sameBytes(windowsPrompts(), SNAPSHOT.prompts, 'goalPrompt sin plataforma');
    const inputs = promptInputs(baseCatalog());
    sameBytes(goalPrompt({ ...inputs.full, platform: 'windows' }), SNAPSHOT.prompts.full, "goalPrompt platform 'windows'");
  });

  for (const provider of ['openai', 'gemini']) {
    for (const app of [null, 'windows_app']) {
      const label = app ? `X-Miracle-App: ${app}` : 'sin cabecera';
      await check(`(a) ${provider}, ${label}: los dos turnos (request al proveedor y respuesta al cliente) idénticos al snapshot`, async () => {
        const conversation = await captureConversation({ env: PROVIDER_ENVS[provider], firstApp: app, secondApp: app });
        sameBytes(conversation, SNAPSHOT.conversations[provider], `${provider} ${label}`);
      });
    }
  }

  await check('(a) matriz de errores y su precedencia idénticas al snapshot (sin cabecera y con windows_app)', async () => {
    sameBytes(await captureErrors(), SNAPSHOT.errors, 'errores sin cabecera');
    sameBytes(await captureErrors('windows_app'), SNAPSHOT.errors, 'errores windows_app');
  });

  // --- (b) Android ----------------------------------------------------------
  const androidByProvider = {};
  for (const provider of ['openai', 'gemini']) {
    androidByProvider[provider] = await captureConversation({ env: PROVIDER_ENVS[provider], firstApp: 'android_app', secondApp: 'android_app' });
    await check(`(b) ${provider}, android_app: prompt de teléfono y catálogo de Android sin switch_window ni map_*`, () => {
      const [first] = androidByProvider[provider];
      assert.strictEqual(first.response.status, 200, JSON.stringify(first.response.json));
      assert.strictEqual(first.requests.length, 1);
      assertAndroidRequest(first.requests[0]);
    });
    await check(`(b) ${provider}, android_app: el estado llega como árbol de accesibilidad, no como UIA de Windows`, () => {
      const text = stateTextOf(androidByProvider[provider][0].requests[0]);
      assert.ok(text.includes('árbol de accesibilidad de Android'), text.slice(0, 120));
      assert.ok(!text.includes('Windows'), text.slice(0, 120));
    });
  }

  await check("(b) baseCatalog('android') es el catálogo que Android ejecuta, con sus enums reales", () => {
    const catalog = baseCatalog('android');
    assert.deepStrictEqual(catalog.map((tool) => tool.name), ANDROID_TOOLS);
    const byName = Object.fromEntries(catalog.map((tool) => [tool.name, tool]));
    assert.deepStrictEqual(byName.open_settings.params[0].options, ANDROID_SETTINGS);
    assert.deepStrictEqual(byName.pan_home.params[0].options, ['left', 'right']);
    assert.deepStrictEqual(byName.set_volume.params.map((param) => param.name), ['stream', 'percent']);
    assert.deepStrictEqual(byName.set_volume.params[0].options, ANDROID_STREAMS);
    assert.deepStrictEqual(byName.adjust_volume.params.map((param) => param.name), ['stream', 'direction']);
    assert.deepStrictEqual(byName.adjust_volume.params[1].options, ['raise', 'lower', 'mute', 'unmute']);
    assert.ok(catalog.every((tool) => !/Windows|ms-settings|Alt\+Tab/.test(tool.description)), 'una descripción de Android habla de Windows');
  });

  // --- (c) Plataforma congelada en la sesión ---------------------------------
  await check('(c) la sesión firmada del primer turno guarda platform=android', async () => {
    const session = await readSession(androidByProvider.openai[0].response.json.session);
    assert.strictEqual(session.platform, 'android');
  });

  await check('(c) un segundo turno Android SIN cabecera sigue siendo Android (openai y gemini)', async () => {
    for (const provider of ['openai', 'gemini']) {
      const conversation = await captureConversation({ env: PROVIDER_ENVS[provider], firstApp: 'android_app', secondApp: null });
      assert.strictEqual(conversation[1].response.status, 200, JSON.stringify(conversation[1].response.json));
      assertAndroidRequest(conversation[1].requests[0]);
      assert.strictEqual((await readSession(conversation[1].response.json.session)).platform, 'android');
    }
  });

  await check('(c) una cabecera android_app a mitad de un hilo de Windows no lo cambia (idéntico al snapshot)', async () => {
    for (const provider of ['openai', 'gemini']) {
      const conversation = await captureConversation({ env: PROVIDER_ENVS[provider], firstApp: null, secondApp: 'android_app' });
      sameBytes(conversation, SNAPSHOT.conversations[provider], `${provider} windows→android_app`);
    }
  });

  // --- (d) Modelo por app ------------------------------------------------------
  await check('(d) sin MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP, Android usa el modelo general', () => {
    assert.strictEqual(modelOf(androidByProvider.openai[0].requests[0]), 'gpt-verify');
    assert.strictEqual(modelOf(androidByProvider.gemini[0].requests[0]), 'gemini-verify');
  });

  const lunaEnv = { ...PROVIDER_ENVS.openai, MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP: 'gpt-5.6-luna' };
  await check('(d) con MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP, el hilo Android usa ese modelo en los dos turnos', async () => {
    const conversation = await captureConversation({ env: lunaEnv, firstApp: 'android_app', secondApp: null });
    assert.strictEqual(modelOf(conversation[0].requests[0]), 'gpt-5.6-luna');
    assert.strictEqual(modelOf(conversation[1].requests[0]), 'gpt-5.6-luna');
  });

  await check('(d) el hilo Android congela modelo y proveedor: cambiar las variables *_ANDROID_APP entre turnos no lo mueve', async () => {
    const [withLuna] = await captureConversation({ env: lunaEnv, firstApp: 'android_app', secondApp: null });
    const lunaRemoved = await continueConversation({ env: PROVIDER_ENVS.openai, session: withLuna.response.json.session });
    assert.strictEqual(lunaRemoved.response.status, 200, JSON.stringify(lunaRemoved.response.json));
    assert.strictEqual(modelOf(lunaRemoved.requests[0]), 'gpt-5.6-luna', 'quitar la variable movió un hilo abierto con luna');

    const [withoutLuna] = await captureConversation({ env: PROVIDER_ENVS.openai, firstApp: 'android_app', secondApp: null });
    const lunaAdded = await continueConversation({ env: lunaEnv, session: withoutLuna.response.json.session });
    assert.strictEqual(lunaAdded.response.status, 200, JSON.stringify(lunaAdded.response.json));
    assert.strictEqual(modelOf(lunaAdded.requests[0]), 'gpt-verify', 'definir la variable movió un hilo abierto sin ella');

    const [onGemini] = await captureConversation({ env: PROVIDER_ENVS.gemini, firstApp: 'android_app', secondApp: null });
    // GEMINI_API_KEY: sin ella el hilo (congelado en gemini) no puede seguir con
    // el proveedor de ESTE turno recién puesto a openai — y no debe, porque la
    // key de openai no es de gemini (ver check (f)).
    const toOpenai = {
      ...PROVIDER_ENVS.gemini,
      MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY: 'verify-openai-android-key',
      MIRACLE_CONSCIOUS_LLM_PROVIDER_ANDROID_APP: 'openai',
      MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP: 'gpt-5.6-luna',
      GEMINI_API_KEY: 'verify-gemini-frozen-key'
    };
    const switched = await continueConversation({ env: toOpenai, session: onGemini.response.json.session });
    assert.strictEqual(switched.response.status, 200, JSON.stringify(switched.response.json));
    assert.strictEqual(switched.requests[0].kind, 'gemini', 'cambiar PROVIDER_ANDROID_APP movió de proveedor un hilo abierto');
    assert.strictEqual(modelOf(switched.requests[0]), 'gemini-verify');
    const switchedUrl = new URL(switched.requests[0].url);
    assert.strictEqual(switchedUrl.searchParams.get('key'), 'verify-gemini-frozen-key', 'la key de openai viajó al hilo congelado en gemini');
  });

  await check('(d) con MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP definida, Windows no la lee (idéntico al snapshot)', async () => {
    for (const app of [null, 'windows_app']) {
      const conversation = await captureConversation({ env: lunaEnv, firstApp: app, secondApp: app });
      sameBytes(conversation, SNAPSHOT.conversations.openai, `windows con variable Android (${app || 'sin cabecera'})`);
    }
    const geminiLuna = { ...PROVIDER_ENVS.gemini, MIRACLE_CONSCIOUS_LLM_PROVIDER_ANDROID_APP: 'openai', MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP: 'gpt-5.6-luna' };
    sameBytes(await captureConversation({ env: geminiLuna }), SNAPSHOT.conversations.gemini, 'windows gemini con variables Android');
  });

  await check('(d) PROVIDER_ANDROID_APP=openai sobre un cerebro Gemini: Android va a OpenAI con la key de OpenAI, nunca con la activa de Gemini', async () => {
    const env = {
      ...PROVIDER_ENVS.gemini,
      MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY: 'verify-openai-android-key',
      MIRACLE_CONSCIOUS_LLM_PROVIDER_ANDROID_APP: 'openai',
      MIRACLE_CONSCIOUS_LLM_MODEL_ANDROID_APP: 'gpt-5.6-luna'
    };
    const conversation = await captureConversation({ env, firstApp: 'android_app', secondApp: null });
    for (const turn of conversation) {
      assert.strictEqual(turn.response.status, 200, JSON.stringify(turn.response.json));
      assert.strictEqual(turn.requests[0].kind, 'openai');
      assert.strictEqual(turn.requests[0].authorization, 'Bearer verify-openai-android-key');
      assert.strictEqual(modelOf(turn.requests[0]), 'gpt-5.6-luna');
    }
  });

  // --- (f) La key del cerebro sigue al proveedor CONGELADO, nunca al activo ---
  await check('(f) un hilo Windows abierto en gemini nunca manda la key de openai si el proveedor cambia a mitad de hilo', async () => {
    const [first] = await captureConversation({ env: PROVIDER_ENVS.gemini });
    const swapped = await continueConversation({
      env: { MIRACLE_CONSCIOUS_LLM_PROVIDER: 'openai', MIRACLE_CONSCIOUS_LLM_API_KEY: 'key-de-openai-que-no-debe-viajar', MIRACLE_CONSCIOUS_LLM_MODEL: 'gpt-verify' },
      session: first.response.json.session
    });
    assert.strictEqual(swapped.requests.length, 0, 'llamó al proveedor sin key del proveedor congelado');
    assert.strictEqual(swapped.response.status, 500, JSON.stringify(swapped.response.json));
    assert.ok(/GEMINI_API_KEY/.test(swapped.response.json.error), swapped.response.json.error);
  });

  await check('(f) el mismo hilo sigue en gemini con SU key propia si hay una key específica de gemini, nunca con la de openai', async () => {
    const [first] = await captureConversation({ env: PROVIDER_ENVS.gemini });
    const swapped = await continueConversation({
      env: {
        MIRACLE_CONSCIOUS_LLM_PROVIDER: 'openai',
        MIRACLE_CONSCIOUS_LLM_API_KEY: 'key-de-openai-que-no-debe-viajar',
        MIRACLE_CONSCIOUS_LLM_MODEL: 'gpt-verify',
        GEMINI_API_KEY: 'key-de-gemini-de-respaldo'
      },
      session: first.response.json.session
    });
    assert.strictEqual(swapped.response.status, 200, JSON.stringify(swapped.response.json));
    assert.strictEqual(swapped.requests[0].kind, 'gemini', 'el hilo cambió de proveedor a mitad de camino');
    const url = new URL(swapped.requests[0].url);
    assert.strictEqual(url.searchParams.get('key'), 'key-de-gemini-de-respaldo', 'no usó la key del proveedor congelado');
  });

  // --- (g) Proveedor DEDUCIDO: la key general no viaja a ningún proveedor -----------
  // MIRACLE_CONSCIOUS_LLM_API_KEY es la key del proveedor escrito en
  // MIRACLE_CONSCIOUS_LLM_PROVIDER. Si esa variable falta o no es válida («gemni»
  // se normaliza a ''), el proveedor se deduce de las keys globales y la key sale
  // SOLO de las variables de ese proveedor: la general puede ser de otro.
  await check('(g) proveedor vacío o inválido: el deducido usa solo sus keys propias, nunca la general (Windows y Android, openai y gemini)', async () => {
    const GENERAL = 'key-general-de-otro-proveedor';
    const cases = [
      { label: 'PROVIDER=gemni', env: { MIRACLE_CONSCIOUS_LLM_PROVIDER: 'gemni', MIRACLE_CONSCIOUS_LLM_API_KEY: GENERAL, GEMINI_API_KEY: 'key-gemini-propia' }, kind: 'gemini', key: 'key-gemini-propia' },
      { label: 'PROVIDER vacío', env: { MIRACLE_CONSCIOUS_LLM_PROVIDER: '', MIRACLE_CONSCIOUS_LLM_API_KEY: GENERAL, GOOGLE_API_KEY: 'key-google-propia' }, kind: 'gemini', key: 'key-google-propia' },
      { label: 'sin PROVIDER, key específica de gemini', env: { MIRACLE_CONSCIOUS_LLM_API_KEY: GENERAL, MIRACLE_CONSCIOUS_LLM_GOOGLE_API_KEY: 'key-gemini-especifica', GEMINI_API_KEY: 'key-gemini-global' }, kind: 'gemini', key: 'key-gemini-especifica' },
      { label: 'sin PROVIDER, openai', env: { MIRACLE_CONSCIOUS_LLM_API_KEY: GENERAL, OPENAI_API_KEY: 'key-openai-propia' }, kind: 'openai', key: 'key-openai-propia' },
      { label: 'PROVIDER=gemni, key específica de openai', env: { MIRACLE_CONSCIOUS_LLM_PROVIDER: 'gemni', MIRACLE_CONSCIOUS_LLM_API_KEY: GENERAL, MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY: 'key-openai-especifica', OPENAI_API_KEY: 'key-openai-global' }, kind: 'openai', key: 'key-openai-especifica' }
    ];
    for (const { label, env, kind, key } of cases) {
      for (const app of [null, 'android_app']) {
        const where = `${label} (${app || 'Windows'})`;
        const conversation = await captureConversation({ env, firstApp: app, secondApp: app });
        for (const turn of conversation) {
          assert.strictEqual(turn.response.status, 200, `${where}: ${JSON.stringify(turn.response.json)}`);
          assert.strictEqual(turn.requests.length, 1, `${where}: requests`);
          const [request] = turn.requests;
          assert.strictEqual(request.kind, kind, `${where}: proveedor`);
          const sent = kind === 'gemini' ? new URL(request.url).searchParams.get('key') : request.authorization;
          assert.strictEqual(sent, kind === 'gemini' ? key : `Bearer ${key}`, `${where}: key enviada`);
          assert.ok(!JSON.stringify(request).includes(GENERAL), `${where}: la key general viajó al proveedor deducido`);
        }
      }
    }

    // Con el proveedor explícito y válido, la key general sigue siendo LA key.
    const explicit = await captureConversation({ env: { ...PROVIDER_ENVS.gemini, GEMINI_API_KEY: 'key-gemini-global' } });
    assert.strictEqual(new URL(explicit[0].requests[0].url).searchParams.get('key'), 'verify-gemini-key', 'con PROVIDER explícito dejó de usarse la key general');
  });

  // --- (e) App desconocida ----------------------------------------------------------
  for (const app of ['ios_app', 'chrome_extension', 'web_app', '']) {
    await check(`(e) X-Miracle-App «${app}» cae en Windows (idéntico al snapshot)`, async () => {
      const conversation = await captureConversation({ env: PROVIDER_ENVS.openai, firstApp: app, secondApp: app });
      sameBytes(conversation, SNAPSHOT.conversations.openai, `app ${app}`);
    });
  }

  await check('(e) la cabecera se normaliza igual que UsageAttributionResolver (« ANDROID_APP » es Android)', async () => {
    const resolver = new UsageAttributionResolver();
    const header = ' ANDROID_APP ';
    const req = { get: (name) => (`${name}`.toLowerCase() === 'x-miracle-app' ? header : undefined) };
    assert.strictEqual(resolver.resolveApp(req, 'api_key'), 'android_app');
    const conversation = await captureConversation({ env: PROVIDER_ENVS.openai, firstApp: header, secondApp: null });
    assertAndroidRequest(conversation[0].requests[0]);
  });

  console.log(`\nverify-agent-platform: ${passed} checks ok, ${failed.length} fallidos`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
