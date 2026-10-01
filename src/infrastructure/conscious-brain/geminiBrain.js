// El cerebro sobre GEMINI (Google, API nativa generateContent). Port 1:1 de
// Android/backend/src/brain/gemini.ts. Intercambiable con OpenAI sin que el
// cliente Windows cambie: sigue recibiendo el mismo `Action[]`.
//
// Diferencias de protocolo frente a OpenAI, encapsuladas aquí:
//  - La API de Gemini es STATELESS: no hay previous_response_id. Acarreamos el
//    historial (`contents`) dentro de la sesión firmada, ACOTADO: las imágenes y
//    las pantallas de turnos pasados se reemplazan por un marcador (solo la
//    actual viaja entera). Un árbol de UI pesa 10-50 KB y un hilo puede llegar a
//    40 turnos: sin esto el blob se acerca al límite de cuerpo de Vercel.
//  - Computer-use se declara como FUNCIONES (computer_tap/type/scroll/swipe/key/
//    wait) + `look` para pedir ver la pantalla; el modelo pasa coordenadas en
//    píxeles del screenshot (a resolución real).
//  - Las herramientas MCP, ask_user, speak y list_apps se declaran igual que en OpenAI.

const { goalPrompt, describeState, geminiComputerUse, promptVersionFor, PROMPT_VERSION } = require('./prompt');
const { PLATFORMS, platformOfSession } = require('../../domain/agent/platform');
const { profileOfSession } = require('../../domain/agent/profile');
const { toScreen } = require('../../domain/agent/screenScale');
const { ASSISTANT_TOOLS } = require('./tools');
const LLMProvider = require('../LLMProvider');
const { fromGemini, toRecorderUsage } = require('../../domain/usage/providerUsage');
const { API_FAMILIES, FEATURES } = require('../../domain/usage/vocabulary');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const COMPUTER_FNS = new Set([
  'computer_tap', 'computer_type', 'computer_scroll', 'computer_swipe', 'computer_key', 'computer_wait'
]);

const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asObj = (v) => (v && typeof v === 'object' ? v : {});
const asArr = (v) => (Array.isArray(v) ? v : []);
const asInt = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : -1;
};

function transient(code) {
  return code === 429 || (code >= 500 && code <= 599);
}

// Igual que en el cerebro de OpenAI: un evento por intento, con su número.
// El modelo se saca de la URL porque Gemini lo lleva en la ruta
// (/v1beta/models/<modelo>:generateContent), no en el cuerpo.
async function gemHttp(url, body, promptVersion = PROMPT_VERSION) {
  let wait = 800;
  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    const occurredAt = new Date().toISOString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();

    recordGeminiBrainUsage({
      requestedModel: modelFromGeminiUrl(url),
      promptVersion,
      attempt,
      statusCode: res.status,
      latencyMs: Date.now() - startedAt,
      occurredAt,
      rawBody: text
    });

    if (!transient(res.status) || attempt >= 4) return { code: res.status, body: text };
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, 8000);
  }
}

function modelFromGeminiUrl(url = '') {
  const match = /\/models\/([^:?/]+)/.exec(`${url}`);
  return match ? match[1] : '';
}

function recordGeminiBrainUsage(input) {
  const recorder = LLMProvider.getUsageRecorder();
  if (!recorder) return;
  let parsed = {};
  try {
    parsed = input.rawBody ? JSON.parse(input.rawBody) : {};
  } catch (error) {
    parsed = {};
  }
  const ok = input.statusCode >= 200 && input.statusCode < 300;
  recorder.record({
    provider: 'google',
    apiFamily: API_FAMILIES.COMPUTER_USE,
    feature: FEATURES.CONSCIOUS_BRIDGE,
    requestedModel: input.requestedModel,
    attempt: input.attempt,
    occurredAt: input.occurredAt,
    latencyMs: input.latencyMs,
    status: ok ? 'ok' : 'error',
    errorCode: ok ? '' : `http_${input.statusCode}`,
    metadata: { httpStatus: input.statusCode, attempt: input.attempt, promptVersion: input.promptVersion || PROMPT_VERSION },
    ...toRecorderUsage(fromGemini(parsed))
  });
}

/**
 * Declaración de una función Gemini a partir de una McpTool (params STRING, enum en opciones). Los
 * parámetros `optional` no van en `required` (ver el mismo comentario en openaiBrain.js).
 */
function mcpFn(tool) {
  const properties = {};
  for (const param of tool.params) {
    properties[param.name] = {
      type: 'STRING',
      description: param.description,
      ...(param.options && param.options.length ? { enum: param.options } : {})
    };
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: 'OBJECT', properties, required: tool.params.filter((param) => !param.optional).map((param) => param.name) }
  };
}

function fn(name, description, props, required) {
  return { name, description, parameters: { type: 'OBJECT', properties: props, required } };
}

// Las teclas que computer_key declara. El teléfono solo sabe ENTER y BACK
// (GraphAccessibilityService.pressKey busca «back» y «home» dentro del nombre):
// declararle 'backspace' sería salir de la pantalla en vez de borrar una letra, y
// el prompt de Android ya dice que esas son las únicas.
const DESKTOP_KEYS = Object.freeze(['enter', 'back', 'tab', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'space']);
const ANDROID_KEYS = Object.freeze(['enter', 'back']);

/** Las funciones de computer-use + utilitarias que solo existen en el provider Gemini. */
function builtinFns(platform) {
  const INT = { type: 'INTEGER' };
  const keys = platform === PLATFORMS.ANDROID ? ANDROID_KEYS : DESKTOP_KEYS;
  return [
    fn('look', 'Toma una captura de la pantalla para VERLA antes de decidir dónde tocar. Úsala cuando necesites mirar.', {}, []),
    fn('computer_tap', 'Haz clic en un punto de la pantalla (píxeles de la imagen actual).', { x: INT, y: INT }, ['x', 'y']),
    fn('computer_type', 'Haz clic en un punto y escribe texto ahí.', { x: INT, y: INT, text: { type: 'STRING' } }, ['x', 'y', 'text']),
    fn('computer_scroll', 'Desliza la rueda del ratón.', { direction: { type: 'STRING', enum: ['up', 'down'] } }, ['direction']),
    fn('computer_swipe', 'Arrastra de un punto a otro.', { x1: INT, y1: INT, x2: INT, y2: INT }, ['x1', 'y1', 'x2', 'y2']),
    fn('computer_key', 'Pulsa una tecla especial.', { key: { type: 'STRING', enum: [...keys] } }, ['key']),
    fn('computer_wait', 'Espera unos milisegundos a que la pantalla reaccione.', { ms: INT }, ['ms']),
    // ask_user / speak / list_apps: misma declaración que en OpenAI (tools.js).
    ...ASSISTANT_TOOLS.map((tool) => fn(
      tool.name,
      tool.description,
      Object.fromEntries(tool.params.map((param) => [param.name, { type: 'STRING', description: param.description }])),
      tool.params.map((param) => param.name)
    ))
  ];
}

function systemPrompt(goal, tools, memory, width, height, platform, profile) {
  const base = goalPrompt({ goal, tools, memory, platform, profile }).trim();
  const addendum = geminiComputerUse({ width, height, platform });
  return `${base}\n\n${addendum}`;
}

/**
 * Convierte una functionCall de computer-use a una acción del contrato. Las coordenadas vienen en
 * píxeles de la imagen; `scale` (Android, domain/agent/screenScale) las pasa a píxeles de pantalla.
 * Sin escala (Windows, o Android sin datos) quedan redondeadas como siempre.
 */
function toAction(name, args, scale = null) {
  const x = (key) => toScreen(args[key], scale, 'x');
  const y = (key) => toScreen(args[key], scale, 'y');
  switch (name) {
    case 'computer_tap': return { kind: 'tap', x: x('x'), y: y('y') };
    case 'computer_type': return { kind: 'type', x: x('x'), y: y('y'), text: asStr(args.text) };
    case 'computer_scroll': return { kind: 'scroll', down: asStr(args.direction) !== 'up' };
    case 'computer_swipe': return { kind: 'swipe', x1: x('x1'), y1: y('y1'), x2: x('x2'), y2: y('y2'), ms: 400 };
    case 'computer_key': return { kind: 'key', key: asStr(args.key) };
    case 'computer_wait': return { kind: 'wait', ms: Math.max(0, asInt(args.ms)) };
    default: return null;
  }
}

async function runGeminiTurn(inp) {
  const s = JSON.parse(JSON.stringify(inp.session));
  if (!s.gemini) s.gemini = { history: [], pending: [] };
  const g = s.gemini;
  const { tools, mcpNames, memory, apps, state, results, apiKey } = inp;
  const platform = platformOfSession(s);
  const profile = profileOfSession(s);

  const stateText = describeState(state, platform, inp.clock || null);

  // 1) Construye el nuevo turno de usuario: respuestas a las funciones pendientes + estado + imagen.
  //    Cada función que produjo una acción se contesta con el resultado de SU acción (actionIndex);
  //    una que no existe, con un error en vez de con el resultado de la siguiente.
  const parts = [];
  let actionIdx = 0;
  for (const p of g.pending) {
    let response;
    if (p.name === 'list_apps') response = { apps };
    else if (p.name === 'ask_user') response = { result: s.informText || '(sin respuesta)' };
    else if (p.name === 'speak' || p.name === 'look') response = { result: 'ok' };
    else if (Number.isInteger(p.actionIndex)) response = { result: results[p.actionIndex] ?? 'ok' };
    else if (p.unknown) response = { error: `No existe la herramienta «${p.name}». Usa solo las que tienes declaradas.` };
    else response = { result: results[actionIdx++] ?? 'ok' }; // sesión emitida antes de actionIndex
    parts.push({ functionResponse: { name: p.name, response } });
  }
  s.informText = '';
  parts.push({ text: g.history.length === 0 ? stateText : `Resultado aplicado. ${stateText}` });
  if (state.screenshot) parts.push({ inlineData: { mimeType: 'image/png', data: state.screenshot } });
  g.history.push({ role: 'user', parts });

  // 2) Llama a Gemini.
  const body = {
    system_instruction: { parts: [{ text: systemPrompt(s.goal, tools, memory, state.width, state.height, platform, profile) }] },
    contents: g.history,
    tools: [{ function_declarations: [...tools.map(mcpFn), ...builtinFns(platform)] }],
    tool_config: { function_calling_config: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.6 }
  };
  const url = `${BASE}/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await gemHttp(url, body, promptVersionFor(platform));
  if (res.code >= 300) throw new Error(`Gemini HTTP ${res.code}: ${res.body.slice(0, 300)}`);

  // 3) Parsea la respuesta del modelo.
  const parsed = JSON.parse(res.body);
  const modelContent = asObj(asObj(asArr(parsed.candidates)[0]).content);
  const modelParts = asArr(modelContent.parts).map(asObj);
  g.history.push({ role: 'model', parts: modelParts });

  const actions = [];
  const pending = [];
  const intents = [];
  let question = null;
  let speech = null;
  let text = '';

  for (const part of modelParts) {
    if (typeof part.text === 'string' && part.text.trim()) {
      text += part.text;
      continue;
    }
    const fc = asObj(part.functionCall);
    const name = asStr(fc.name);
    if (!name) continue;
    const args = asObj(fc.args);
    const call = { name, argsJson: JSON.stringify(args), actionIndex: null };
    pending.push(call);

    if (mcpNames.has(name)) {
      const clean = {};
      for (const [k, v] of Object.entries(args)) if (k !== 'intent') clean[k] = asStr(v);
      call.actionIndex = actions.length;
      actions.push({ kind: 'mcp', tool: name, args: clean });
      if (args.intent) intents.push(asStr(args.intent));
    } else if (COMPUTER_FNS.has(name)) {
      const action = toAction(name, args, inp.screenScale || null);
      if (action) {
        call.actionIndex = actions.length;
        actions.push(action);
      }
    } else if (name === 'ask_user') {
      question = asStr(args.question);
    } else if (name === 'speak') {
      speech = asStr(args.text);
    } else if (name !== 'list_apps' && name !== 'look') {
      call.unknown = true;
    }
    // list_apps / look: sin acción de cliente; se resuelven en el próximo turno.
  }

  g.pending = pending;

  // 4) Acota el tamaño de la sesión: quita las imágenes y las pantallas de todo el
  //    historial (la del próximo turno viaja fresca).
  stripImages(g.history);
  stripScreens(g.history);

  const needsScreenshot = pending.some((p) => COMPUTER_FNS.has(p.name) || p.name === 'look');
  const turn = {
    actions,
    question,
    done: pending.length === 0,
    // El texto es la respuesta final y solo vale en el turno que termina: un «Mandé el correo»
    // escrito junto a la llamada que apenas abre el borrador no le llega al cliente, que lo
    // guardaba como resumen y lo podía decir al final aunque nunca se comprobara.
    text: pending.length === 0 ? text : '',
    needsScreenshot,
    narration: intents.find((intent) => intent) ?? (text && actions.length ? text : ''),
    speech,
    intents
  };
  return { session: s, turn };
}

/** Reemplaza las partes de imagen del historial por un marcador de texto (para no reenviar screenshots). */
function stripImages(history) {
  for (const content of history) {
    const parts = asArr(asObj(content).parts);
    for (let i = 0; i < parts.length; i++) {
      if (asObj(parts[i]).inlineData) parts[i] = { text: '[captura previa omitida]' };
    }
  }
}

// El texto de estado que pone runGeminiTurn (describeState), con o sin «Resultado aplicado.».
const STATE_TEXT = /^(Resultado aplicado\. )?Pantalla actual/;
const OLD_SCREEN = '[pantalla anterior omitida]';

/**
 * Reemplaza las pantallas de los turnos de usuario pasados por un marcador. Los pares
 * functionCall/functionResponse se quedan: son el hilo de lo que se hizo y lo que salió.
 */
function stripScreens(history) {
  for (const content of history) {
    if (asObj(content).role !== 'user') continue;
    const parts = asArr(asObj(content).parts);
    for (let i = 0; i < parts.length; i++) {
      const text = asObj(parts[i]).text;
      if (typeof text === 'string' && STATE_TEXT.test(text)) {
        parts[i] = { text: text.startsWith('Resultado aplicado.') ? `Resultado aplicado. ${OLD_SCREEN}` : OLD_SCREEN };
      }
    }
  }
}

module.exports = { runGeminiTurn };
