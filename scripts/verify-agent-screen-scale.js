#!/usr/bin/env node
// Reescalado de coordenadas imagen → pantalla en el turno Android, sin red ni keys.
//   node scripts/verify-agent-screen-scale.js
//
// La app Android achica la captura a 1080 px de ancho (conservando la proporción)
// antes de mandarla, y el modelo devuelve coordenadas en píxeles de ESA imagen.
// El contrato no cambia: las acciones vuelven en píxeles de pantalla. Para
// sesiones android Graph convierte con la pantalla que llega en state.width/height
// y el tamaño real de la imagen, leído de su cabecera PNG/JPEG. Sin datos, escala
// 1 como antes. Windows no se toca (y verify-agent-platform.js lo fija byte a byte).
//
// Se recorre la ruta REAL (registerWindowsAgentRoutes → AgentTurnService → cerebro
// OpenAI o Gemini) con `fetch` stubbeado con respuestas fijas del proveedor.
const assert = require('assert');
const registerWindowsAgentRoutes = require('../web/api/registerWindowsAgentRoutes');
const AgentTurnService = require('../src/application/use-cases/AgentTurnService');
const { decodeSession } = require('../src/domain/agent/session');

// ---- Imágenes: solo la cabecera importa -------------------------------------
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    length, Buffer.from('IHDR'), ihdr, Buffer.alloc(4),
    Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4)
  ]).toString('base64');
}

// JPEG con un APP1 (EXIF) delante del SOF0, como sale de muchas cámaras.
function jpeg(width, height) {
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0'), Buffer.alloc(8)]);
  const sof0 = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof0, Buffer.from([0xff, 0xd9])]).toString('base64');
}

const PNG_1080x2400 = png(1080, 2400);

// ---- Respuestas fijas del proveedor -----------------------------------------
// Coordenadas en píxeles de la imagen: centro, borde, fuera de la imagen, negativa,
// un arrastre de tres puntos (vale origen y destino) y un clic sin `y` (inválido).
const OPENAI_COMPUTER = {
  id: 'resp_scale',
  output: [{
    type: 'computer_call',
    call_id: 'c1',
    actions: [
      { type: 'click', x: 540, y: 1200 },
      { type: 'double_click', x: 10, y: 20 },
      { type: 'type', x: 1079, y: 2399, text: 'hola' },
      { type: 'drag', path: [{ x: 100, y: 200 }, { x: 500, y: 900 }, { x: 900, y: 2000 }] },
      { type: 'left_click', x: 2000, y: 5000 },
      { type: 'click', x: -10, y: 5 },
      { type: 'click', x: 50 },
      { type: 'scroll', x: 540, y: 1200, scroll_y: 300 }
    ]
  }]
};

const GEMINI_COMPUTER = {
  candidates: [{
    content: {
      role: 'model',
      parts: [
        { functionCall: { name: 'computer_tap', args: { x: 540, y: 1200 } } },
        { functionCall: { name: 'computer_tap', args: { x: 10, y: 20 } } },
        { functionCall: { name: 'computer_type', args: { x: 1079, y: 2399, text: 'hola' } } },
        { functionCall: { name: 'computer_swipe', args: { x1: 100, y1: 200, x2: 900, y2: 2000 } } },
        { functionCall: { name: 'computer_tap', args: { x: 2000, y: 5000 } } },
        { functionCall: { name: 'computer_tap', args: { x: -10, y: 5 } } },
        { functionCall: { name: 'computer_tap', args: { x: 50 } } },
        { functionCall: { name: 'computer_scroll', args: { direction: 'down' } } }
      ]
    }
  }]
};

// Lo que el cliente tiene que recibir, por proveedor, en el mismo orden.
function expected(provider, points) {
  const [center, corner, edge, drag0, drag1, outside, negative, halfX] = points;
  const tap = ([x, y]) => ({ kind: 'tap', x, y });
  return [
    tap(center),
    tap(corner),
    { kind: 'type', x: edge[0], y: edge[1], text: 'hola' },
    { kind: 'swipe', x1: drag0[0], y1: drag0[1], x2: drag1[0], y2: drag1[1], ms: 400 },
    tap(outside),
    tap(negative),
    tap([halfX, -1]),
    { kind: 'scroll', down: true }
  ];
}

const SCALED = [[720, 1600], [13, 27], [1439, 3199], [133, 267], [1200, 2667], [1439, 3199], [0, 7], 67];
const UNSCALED = [[540, 1200], [10, 20], [1079, 2399], [100, 200], [900, 2000], [2000, 5000], [-10, 5], 50];
const SAME_SIZE = [[540, 1200], [10, 20], [1079, 2399], [100, 200], [900, 2000], [1439, 3199], [0, 5], 50];

// ---- Arnés: la ruta real con fetch stubbeado -----------------------------------
const PROVIDER_ENVS = {
  openai: { MIRACLE_CONSCIOUS_LLM_PROVIDER: 'openai', MIRACLE_CONSCIOUS_LLM_API_KEY: 'verify-openai-key', MIRACLE_CONSCIOUS_LLM_MODEL: 'gpt-verify' },
  gemini: { MIRACLE_CONSCIOUS_LLM_PROVIDER: 'google', MIRACLE_CONSCIOUS_LLM_API_KEY: 'verify-gemini-key', MIRACLE_CONSCIOUS_LLM_MODEL: 'gemini-verify' }
};

function useProvider(provider) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MIRACLE_CONSCIOUS_') || ['OPENAI_API_KEY', 'OPENAI_MODEL', 'MODEL', 'EFFORT', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL'].includes(key)) {
      delete process.env[key];
    }
  }
  process.env.SESSION_SECRET = 'verify-agent-screen-scale-secret';
  Object.assign(process.env, PROVIDER_ENVS[provider]);
}

function mount() {
  const service = new AgentTurnService({
    memoryRepository: { forPrompt: async () => '' },
    learningStore: { learnedTools: async () => [], workflows: async () => [] }
  });
  let handler = null;
  const app = { post(path, fn) { if (path === '/api/v1/agent/turn') handler = fn; } };
  registerWindowsAgentRoutes(app, { agentTurnService: service, teachVideoService: {} });
  return handler;
}

/** Corre una conversación: `turns` = [{ state, canned }]. Devuelve la respuesta de cada turno. */
async function converse(provider, app, turns) {
  useProvider(provider);
  const handler = mount();
  const original = global.fetch;
  const out = [];
  let session = null;
  try {
    for (const turn of turns) {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(turn.canned) });
      const headers = app ? { 'x-miracle-app': app } : {};
      const body = session
        ? { session, state: turn.state, results: ['ok'] }
        : { goal: 'toca el botón', state: turn.state, results: [] };
      const req = { body, headers, get: (name) => headers[`${name}`.toLowerCase()] };
      const res = {
        statusCode: 0,
        payload: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
      };
      await handler(req, res);
      assert.strictEqual(res.statusCode, 200, JSON.stringify(res.payload));
      session = res.payload.session;
      out.push(res.payload);
    }
  } finally {
    global.fetch = original;
  }
  return out;
}

const state = (width, height, screenshot) => ({
  screen: 'com.android.settings · Ajustes', uiContext: 'botones: Wi-Fi', width, height, ...(screenshot ? { screenshot } : {})
});
const cannedFor = (provider) => (provider === 'openai' ? OPENAI_COMPUTER : GEMINI_COMPUTER);
const computerActions = (payload) => payload.actions.filter((action) => action.kind !== 'mcp');

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

async function main() {
  for (const provider of ['openai', 'gemini']) {
    await check(`(1) ${provider}: imagen PNG 1080×2400 sobre pantalla 1440×3200 → tap, doble tap, type y swipe (origen y destino) reescalados, redondeados y dentro de la pantalla`, async () => {
      const [turn] = await converse(provider, 'android_app', [{ state: state(1440, 3200, PNG_1080x2400), canned: cannedFor(provider) }]);
      assert.deepStrictEqual(computerActions(turn), expected(provider, SCALED));
    });

    await check(`(2) ${provider}: imagen igual a la pantalla (1440×3200) → escala 1, solo se acota lo que cae fuera`, async () => {
      const [turn] = await converse(provider, 'android_app', [{ state: state(1440, 3200, png(1440, 3200)), canned: cannedFor(provider) }]);
      assert.deepStrictEqual(computerActions(turn), expected(provider, SAME_SIZE));
    });

    await check(`(3) ${provider}: sin datos (sin captura, cabecera ilegible o pantalla 0) → escala 1 como antes, sin acotar`, async () => {
      for (const [label, st] of [
        ['sin captura', state(1440, 3200)],
        ['cabecera ilegible', state(1440, 3200, 'iVBORw0KGgo=')],
        ['pantalla sin tamaño', state(0, 0, PNG_1080x2400)]
      ]) {
        const [turn] = await converse(provider, 'android_app', [{ state: st, canned: cannedFor(provider) }]);
        assert.deepStrictEqual(computerActions(turn), expected(provider, UNSCALED), label);
      }
    });

    await check(`(4) ${provider}: Windows intacto aunque llegue una captura más chica que la pantalla (escala 1, sin campos nuevos en la sesión)`, async () => {
      for (const app of [null, 'windows_app']) {
        const [turn] = await converse(provider, app, [{ state: state(1440, 3200, PNG_1080x2400), canned: cannedFor(provider) }]);
        assert.deepStrictEqual(computerActions(turn), expected(provider, UNSCALED), `app ${app}`);
        const session = decodeSession(turn.session);
        assert.ok(!('imageSize' in session), 'la sesión de Windows ganó imageSize');
        assert.ok(!('platform' in session), 'la sesión de Windows ganó platform');
      }
    });

    await check(`(5) ${provider}: un turno sin captura reescala con la última imagen que vio el modelo (queda en la sesión Android)`, async () => {
      const [, second] = await converse(provider, 'android_app', [
        { state: state(1440, 3200, PNG_1080x2400), canned: provider === 'openai' ? { id: 'resp_0', output: [{ type: 'function_call', call_id: 'f1', name: 'go_home', arguments: '{}' }] } : { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'go_home', args: {} } }] } }] } },
        { state: state(1440, 3200), canned: cannedFor(provider) }
      ]);
      assert.deepStrictEqual(computerActions(second), expected(provider, SCALED));
      assert.deepStrictEqual(decodeSession(second.session).imageSize, { width: 1080, height: 2400 });
    });

    await check(`(6) ${provider}: pantalla reportada sin la barra de navegación (1440×3040) → la escala sale del lado entero (4/3), no se aplasta el eje y`, async () => {
      const [turn] = await converse(provider, 'android_app', [{ state: state(1440, 3040, PNG_1080x2400), canned: cannedFor(provider) }]);
      assert.deepStrictEqual(computerActions(turn), expected(provider, SCALED));
    });

    await check(`(7) ${provider}: la cabecera JPEG (con EXIF delante del SOF) también da el tamaño de la imagen`, async () => {
      const [turn] = await converse(provider, 'android_app', [{ state: state(1440, 3200, jpeg(1080, 2400)), canned: cannedFor(provider) }]);
      assert.deepStrictEqual(computerActions(turn), expected(provider, SCALED));
    });
  }

  console.log(`\nverify-agent-screen-scale: ${passed} checks ok, ${failed.length} fallidos`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
