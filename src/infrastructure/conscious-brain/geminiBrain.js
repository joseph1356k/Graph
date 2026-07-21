// El cerebro sobre GEMINI (Google, API nativa generateContent). Port 1:1 de
// Android/backend/src/brain/gemini.ts. Intercambiable con OpenAI sin que el
// cliente Windows cambie: sigue recibiendo el mismo `Action[]`.
//
// Diferencias de protocolo frente a OpenAI, encapsuladas aquí:
//  - La API de Gemini es STATELESS: no hay previous_response_id. Acarreamos el
//    historial (`contents`) dentro de la sesión (imágenes de turnos pasados
//    eliminadas para no reenviar screenshots).
//  - Computer-use se declara como FUNCIONES (computer_tap/type/scroll/swipe/key/
//    wait) + `look` para pedir ver la pantalla; el modelo pasa coordenadas en
//    píxeles del screenshot (a resolución real).
//  - Las herramientas MCP, ask_user, speak y list_apps se declaran igual que en OpenAI.

const { goalPrompt } = require('./prompt');

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

async function gemHttp(url, body) {
  let wait = 800;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!transient(res.status) || attempt >= 4) return { code: res.status, body: text };
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, 8000);
  }
}

/** Declaración de una función Gemini a partir de una McpTool (params STRING, enum en opciones). */
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
    parameters: { type: 'OBJECT', properties, required: tool.params.map((param) => param.name) }
  };
}

function fn(name, description, props, required) {
  return { name, description, parameters: { type: 'OBJECT', properties: props, required } };
}

/** Las funciones de computer-use + utilitarias que solo existen en el provider Gemini. */
function builtinFns() {
  const INT = { type: 'INTEGER' };
  return [
    fn('look', 'Toma una captura de la pantalla para VERLA antes de decidir dónde tocar. Úsala cuando necesites mirar.', {}, []),
    fn('computer_tap', 'Haz clic en un punto de la pantalla (píxeles de la imagen actual).', { x: INT, y: INT }, ['x', 'y']),
    fn('computer_type', 'Haz clic en un punto y escribe texto ahí.', { x: INT, y: INT, text: { type: 'STRING' } }, ['x', 'y', 'text']),
    fn('computer_scroll', 'Desliza la rueda del ratón.', { direction: { type: 'STRING', enum: ['up', 'down'] } }, ['direction']),
    fn('computer_swipe', 'Arrastra de un punto a otro.', { x1: INT, y1: INT, x2: INT, y2: INT }, ['x1', 'y1', 'x2', 'y2']),
    fn('computer_key', 'Pulsa una tecla especial.', { key: { type: 'STRING', enum: ['enter', 'back', 'tab', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'space'] } }, ['key']),
    fn('computer_wait', 'Espera unos milisegundos a que la pantalla reaccione.', { ms: INT }, ['ms']),
    fn('ask_user', 'Pregunta al usuario cuando tengas una duda real e importante.', { question: { type: 'STRING' } }, ['question']),
    fn('speak', 'Di algo en voz alta con tu personalidad. Solo para lo importante.', { text: { type: 'STRING' } }, ['text']),
    fn('list_apps', 'Lista las aplicaciones instaladas para elegir cuál abrir.', {}, [])
  ];
}

function systemPrompt(goal, tools, memory, width, height) {
  const base = goalPrompt({ goal, tools, memory, stateBlock: '' }).trim();
  const addendum = `
        COMPUTER-USE EN GEMINI: para tocar algo visual, primero llama a look() para ver la pantalla; luego
        usa computer_tap / computer_type / computer_scroll / computer_swipe / computer_key con coordenadas
        en PÍXELES sobre la imagen (la captura está a resolución REAL de pantalla: ${width}x${height}). Para
        tareas de sistema (abrir apps, buscar, ajustes…) prefiere SIEMPRE las herramientas MCP, no el ratón.
        Cuando el objetivo esté cumplido, responde SOLO con texto (sin llamar funciones).`.trim();
  return `${base}\n\n${addendum}`;
}

/** Convierte una functionCall de computer-use a una acción del contrato. */
function toAction(name, args) {
  switch (name) {
    case 'computer_tap': return { kind: 'tap', x: asInt(args.x), y: asInt(args.y) };
    case 'computer_type': return { kind: 'type', x: asInt(args.x), y: asInt(args.y), text: asStr(args.text) };
    case 'computer_scroll': return { kind: 'scroll', down: asStr(args.direction) !== 'up' };
    case 'computer_swipe': return { kind: 'swipe', x1: asInt(args.x1), y1: asInt(args.y1), x2: asInt(args.x2), y2: asInt(args.y2), ms: 400 };
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

  const stateBlock = `Pantalla actual: ${state.screen}\nDónde estás (árbol de UI de Windows):\n${state.uiContext}`;

  // 1) Construye el nuevo turno de usuario: respuestas a las funciones pendientes + estado + imagen.
  const parts = [];
  let actionIdx = 0;
  for (const p of g.pending) {
    let response;
    if (p.name === 'list_apps') response = { apps };
    else if (p.name === 'ask_user') response = { result: s.informText || '(sin respuesta)' };
    else if (p.name === 'speak' || p.name === 'look') response = { result: 'ok' };
    else response = { result: results[actionIdx++] ?? 'ok' }; // computer_* o MCP
    parts.push({ functionResponse: { name: p.name, response } });
  }
  s.informText = '';
  parts.push({ text: g.history.length === 0 ? stateBlock : `Resultado aplicado. ${stateBlock}` });
  if (state.screenshot) parts.push({ inlineData: { mimeType: 'image/png', data: state.screenshot } });
  g.history.push({ role: 'user', parts });

  // 2) Llama a Gemini.
  const body = {
    system_instruction: { parts: [{ text: systemPrompt(s.goal, tools, memory, state.width, state.height) }] },
    contents: g.history,
    tools: [{ function_declarations: [...tools.map(mcpFn), ...builtinFns()] }],
    tool_config: { function_calling_config: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.6 }
  };
  const url = `${BASE}/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await gemHttp(url, body);
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
    pending.push({ name, argsJson: JSON.stringify(args) });

    if (mcpNames.has(name)) {
      const clean = {};
      for (const [k, v] of Object.entries(args)) if (k !== 'intent') clean[k] = asStr(v);
      actions.push({ kind: 'mcp', tool: name, args: clean });
      if (args.intent) intents.push(asStr(args.intent));
    } else if (COMPUTER_FNS.has(name)) {
      const action = toAction(name, args);
      if (action) actions.push(action);
    } else if (name === 'ask_user') {
      question = asStr(args.question);
    } else if (name === 'speak') {
      speech = asStr(args.text);
    }
    // list_apps / look: sin acción de cliente; se resuelven en el próximo turno.
  }

  g.pending = pending;

  // 4) Acota el tamaño de la sesión: quita las imágenes de todo el historial
  //    (solo la actual viaja fresca).
  stripImages(g.history);

  const needsScreenshot = pending.some((p) => COMPUTER_FNS.has(p.name) || p.name === 'look');
  const turn = {
    actions,
    question,
    done: pending.length === 0,
    text,
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

module.exports = { runGeminiTurn };
