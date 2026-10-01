// El cerebro sobre OPENAI: computer-use nativo en la Responses API + las
// herramientas MCP. Port 1:1 de Android/backend/src/brain/openai.ts.
//
// No usa el LLMProvider compartido de Graph a propósito: el protocolo del
// engine necesita la Responses API nativa (computer_call / function_call /
// previous_response_id), no Chat Completions. Ver config.js para el porqué.
//
// Protocolo (developers.openai.com/api/docs/guides/tools-computer-use):
//  - POST /v1/responses con Authorization: Bearer <key> y tool {type:"computer"}.
//  - La conversación la mantiene el servidor de OpenAI vía previous_response_id;
//    cada turno reenvía computer_call_output (screenshot) y/o function_call_output.
//  - Las acciones vienen en PÍXELES ABSOLUTOS del screenshot enviado; el cliente
//    Windows captura a resolución real, así que la escala es 1 (el Mac, un píxel
//    por punto: también 1). Android manda la captura achicada y el turno trae la
//    escala (domain/agent/screenScale).
//  - Cada salida pendiente se contesta con el resultado de SU acción: los clientes
//    devuelven un resultado por acción, no por llamada (ver actionIndex en parseTurn).

const { goalPrompt, describeState, promptVersionFor, PROMPT_VERSION } = require('./prompt');
const { PLATFORMS, platformOfSession } = require('../../domain/agent/platform');
const { profileOfSession } = require('../../domain/agent/profile');
const { toScreen } = require('../../domain/agent/screenScale');
const { ASSISTANT_TOOLS } = require('./tools');
const LLMProvider = require('../LLMProvider');
const { fromOpenAiCompatible, toRecorderUsage } = require('../../domain/usage/providerUsage');
const { API_FAMILIES, FEATURES } = require('../../domain/usage/vocabulary');

const OA_BASE = 'https://api.openai.com';

/** PNG (base64 sin prefijo) → data-uri para la Responses API. */
function dataUri(b64) {
  return `data:image/png;base64,${b64}`;
}

/**
 * Declaración de función (Responses API) desde una McpTool, con enum en las opciones. Un parámetro
 * `optional` no va en `required`: el cliente lo tolera ausente, y declararlo obligatorio empuja al
 * modelo a inventar un valor.
 */
function mcpFn(tool) {
  const properties = {};
  for (const param of tool.params) {
    properties[param.name] = {
      type: 'string',
      description: param.description,
      ...(param.options && param.options.length ? { enum: param.options } : {})
    };
  }
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: { type: 'object', properties, required: tool.params.filter((param) => !param.optional).map((param) => param.name) }
  };
}

/** Herramientas propias de Ü (tools.js), en el formato de la Responses API. */
function assistantFn(tool) {
  const properties = {};
  for (const param of tool.params) {
    properties[param.name] = { type: 'string', description: param.description };
  }
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: { type: 'object', properties, required: tool.params.map((param) => param.name) }
  };
}

/**
 * Las tools de un turno en la Responses API: computer-use nativo, el catálogo MCP del turno y las
 * propias de Ü, en ese orden. Exportada para scripts/probe-luna-computer.js: la sonda tiene que
 * declarar exactamente lo mismo que el cerebro.
 */
function toolDeclarations(tools) {
  const toolDecls = [{ type: 'computer' }];
  for (const tool of tools) toolDecls.push(mcpFn(tool));
  for (const tool of ASSISTANT_TOOLS) toolDecls.push(assistantFn(tool));
  return toolDecls;
}

function transient(code) {
  return code === 429 || (code >= 500 && code <= 599);
}

// Reintento con backoff para 429/5xx: un bache de demanda no debe tirar el turno.
//
// Cada intento se registra por separado y con su número: un reintento que llega
// al modelo SÍ es consumo facturable, así que colapsarlos en un solo evento
// subestimaría el costo. Los 429 no gastan tokens y quedan como evento de error
// sin consumo, que es exactamente lo que pasó.
async function oaHttp(url, apiKey, body, promptVersion = PROMPT_VERSION) {
  let wait = 800;
  for (let attempt = 1; ; attempt++) {
    const startedAt = Date.now();
    const occurredAt = new Date().toISOString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    const text = await res.text();

    recordBrainUsage({
      provider: 'openai',
      apiFamily: API_FAMILIES.COMPUTER_USE,
      feature: FEATURES.CONSCIOUS_BRIDGE,
      requestedModel: body?.model || '',
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

// El cerebro no comparte el LLMProvider, así que tampoco comparte su
// instrumentación: se anota aquí, contra el mismo grabador.
function recordBrainUsage(input) {
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
    provider: input.provider,
    apiFamily: input.apiFamily,
    feature: input.feature,
    requestedModel: input.requestedModel,
    attempt: input.attempt,
    occurredAt: input.occurredAt,
    latencyMs: input.latencyMs,
    status: ok ? 'ok' : 'error',
    errorCode: ok ? '' : `http_${input.statusCode}`,
    metadata: { httpStatus: input.statusCode, attempt: input.attempt, promptVersion: input.promptVersion || PROMPT_VERSION },
    ...toRecorderUsage(fromOpenAiCompatible(parsed))
  });
}

const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asObj = (v) => (v && typeof v === 'object' ? v : {});
const asArr = (v) => (Array.isArray(v) ? v : []);

/** Ejecuta un turno del cerebro. Devuelve la sesión actualizada + el BrainTurn a mandar al cliente. */
async function runOpenAiTurn(inp) {
  const s = JSON.parse(JSON.stringify(inp.session)); // copia mutable
  const { tools, mcpNames, memory, apps, state, results, apiKey } = inp;
  const platform = platformOfSession(s);
  const profile = profileOfSession(s);

  const stateText = describeState(state, platform, inp.clock || null);
  const input = [];

  const userMessage = (text) => {
    const content = [{ type: 'input_text', text }];
    if (state.screenshot) content.push({ type: 'input_image', image_url: dataUri(state.screenshot), detail: 'original' });
    input.push({ type: 'message', role: 'user', content });
  };

  // El prompt del sistema va en `instructions` en CADA request: la Responses
  // API no lo hereda por previous_response_id. Antes iba como primer mensaje
  // de usuario, con lo que las reglas tenían el mismo rango que un "hola".
  const instructions = goalPrompt({ goal: s.goal, tools, memory, platform, profile });

  if (!s.previousId) {
    userMessage(stateText);
  } else if (s.pending.length === 0) {
    userMessage(`${s.continuationMessage || s.informText || 'Continúa.'}\n${stateText}`);
    s.continuationMessage = '';
    s.informText = '';
  } else {
    s.pending.forEach((call, i) => {
      if (call.isComputer) {
        const out = {
          type: 'computer_screenshot',
          image_url: state.screenshot ? dataUri(state.screenshot) : '',
          detail: 'original'
        };
        const fields = { type: 'computer_call_output', call_id: call.id, output: out };
        if (call.safety && call.safety.length) fields.acknowledged_safety_checks = call.safety;
        input.push(fields);
      } else if (call.name === 'ask_user') {
        input.push(functionOutput(call.id, s.informText || '(sin respuesta)'));
      } else if (call.internalOutput != null) {
        input.push(functionOutput(call.id, call.internalOutput));
      } else if (call.name === 'speak') {
        input.push(functionOutput(call.id, 'ok'));
      } else if (Number.isInteger(call.actionIndex)) {
        input.push(functionOutput(call.id, results[call.actionIndex] ?? 'ok'));
      } else {
        // Sesión emitida antes de actionIndex: el índice de la llamada, como siempre.
        input.push(functionOutput(call.id, results[i] ?? 'ok'));
      }
    });
    s.informText = '';
    // La pantalla de ESTE turno, también cuando el anterior terminó en funciones:
    // el prompt promete que cada turno trae <pantalla>, y sin esto, con OpenAI, el
    // modelo solo veía la lectura vieja de la herramienta (en el Mac, con ids que
    // ya no existen) y la captura que pidió map_look no le llegaba nunca. Si hubo
    // una computer_call, la captura ya va en su salida: aquí va solo el texto.
    const screenshotSent = s.pending.some((call) => call.isComputer);
    const content = [{ type: 'input_text', text: stateText }];
    if (state.screenshot && !screenshotSent) {
      content.push({ type: 'input_image', image_url: dataUri(state.screenshot), detail: 'original' });
    }
    input.push({ type: 'message', role: 'user', content });
  }

  const reqBody = {
    model: s.model,
    instructions,
    input,
    tools: toolDeclarations(tools),
    truncation: 'auto',
    reasoning: { effort: s.effort }
  };
  if (s.previousId) reqBody.previous_response_id = s.previousId;

  const res = await oaHttp(`${OA_BASE}/v1/responses`, apiKey, reqBody, promptVersionFor(platform));
  if (res.code >= 300) {
    // Si el hilo previo expiró y aún no hicimos nada este turno, abre ventana nueva y reintenta una vez.
    if (s.startId && s.previousId === s.startId) {
      s.previousId = '';
      s.startId = '';
      s.continuationMessage = '';
      return runOpenAiTurn({ ...inp, session: s });
    }
    throw new Error(`OpenAI HTTP ${res.code}: ${res.body.slice(0, 200)}`);
  }

  return parseTurn(JSON.parse(res.body), s, state, mcpNames, apps, inp.screenScale || null, platform);
}

function functionOutput(callId, output) {
  return { type: 'function_call_output', call_id: callId, output };
}

/**
 * Traduce la respuesta de la Responses API a un BrainTurn + la sesión actualizada.
 *
 * `platform` cambia SOLO el Mac, que sabe más que los otros dos clientes: un `type` sin punto
 * teclea en el foco (sin x ni y), un atajo llega entero («cmd+l») y el doble clic y el clic derecho
 * se conservan. Windows y Android reciben lo de siempre (su contrato con el cliente no cambia).
 */
function parseTurn(body, s, state, mcpNames, apps, scale = null, platform = PLATFORMS.WINDOWS) {
  const isMac = platform === PLATFORMS.MAC;
  s.previousId = asStr(body.id) || s.previousId;
  const items = asArr(body.output ?? body.outputs).map(asObj);

  // Reescalado screenshot→pantalla: OpenAI da píxeles del screenshot enviado.
  // El cliente Windows captura a la resolución real de pantalla (scale null:
  // escala 1). Android manda la captura achicada y el turno trae la escala.
  const at = (a, key, axis) => toScreen(a[key], scale, axis);
  const px = (a, key) => toScreen(a[key], null, 'x');

  const actions = [];
  const pending = [];
  const intents = [];
  let question = null;
  let speech = null;
  let text = '';

  const addAction = (a) => {
    switch (asStr(a.type)) {
      case 'click':
      case 'double_click':
      case 'left_click': {
        const x = at(a, 'x', 'x');
        const y = at(a, 'y', 'y');
        if (isMac && asStr(a.type) === 'double_click') actions.push({ kind: 'double_click', x, y });
        else if (isMac && asStr(a.button).toLowerCase() === 'right') actions.push({ kind: 'right_click', x, y });
        else actions.push({ kind: 'tap', x, y });
        break;
      }
      case 'type': {
        const x = at(a, 'x', 'x');
        const y = at(a, 'y', 'y');
        // El `type` de computer-use no lleva punto: en Mac se teclea donde está el foco.
        if (isMac && (x < 0 || y < 0)) actions.push({ kind: 'type', text: asStr(a.text) });
        else actions.push({ kind: 'type', x, y, text: asStr(a.text) });
        break;
      }
      case 'keypress':
      case 'key': {
        const keys = asArr(a.keys).map(asStr).filter(Boolean);
        const single = asStr(a.key);
        const pressed = keys.length ? keys : single ? [single] : [];
        actions.push({ kind: 'key', key: isMac ? macKey(pressed) : mapKey(pressed) });
        break;
      }
      case 'scroll': {
        // El contrato no lleva punto en scroll (solo dirección): no hay coordenada que reescalar.
        const dy = px(a, 'scroll_y');
        const dyAlt = px(a, 'delta_y');
        const v = dy !== -1 ? dy : dyAlt !== -1 ? dyAlt : 1;
        actions.push({ kind: 'scroll', down: v >= 0 });
        break;
      }
      case 'drag':
      case 'swipe': {
        const path = asArr(a.path).map(asObj);
        const p0 = path[0] ?? {};
        const p1 = path[path.length - 1] ?? p0;
        actions.push({ kind: 'swipe', x1: at(p0, 'x', 'x'), y1: at(p0, 'y', 'y'), x2: at(p1, 'x', 'x'), y2: at(p1, 'y', 'y'), ms: 400 });
        break;
      }
      case 'wait':
        actions.push({ kind: 'wait', ms: Number(px(a, 'ms') > 0 ? px(a, 'ms') : 1000) });
        break;
      default:
        break; // move / screenshot: no aplican (el screenshot ya viaja en cada output)
    }
  };

  for (const item of items) {
    switch (asStr(item.type)) {
      case 'message':
        text += extractMessage(item);
        break;
      case 'output_text':
        text += asStr(item.text);
        break;
      case 'computer_call': {
        const id = asStr(item.call_id) || asStr(item.id) || `call_${pending.length}`;
        const safety = asArr(item.pending_safety_checks);
        pending.push({ id, name: 'computer', isComputer: true, safety });
        const acts = asArr(item.actions).map(asObj);
        if (acts.length) acts.forEach(addAction);
        else if (item.action) addAction(asObj(item.action));
        break;
      }
      case 'function_call': {
        const name = asStr(item.name);
        const id = asStr(item.call_id) || asStr(item.id) || `call_${pending.length}`;
        const safety = asArr(item.pending_safety_checks);
        let args = {};
        try {
          args = asObj(JSON.parse(asStr(item.arguments)));
        } catch (error) {
          args = asObj(item.arguments);
        }
        const call = { id, name, isComputer: false, safety };
        // `intent` ya no se pide en el prompt; se sigue leyendo si llega (es inocuo y
        // mantiene igual lo que el cliente recibe).
        if (name !== 'ask_user' && name !== 'speak') intents.push(asStr(args.intent));
        if (mcpNames.has(name)) {
          const cleanArgs = {};
          for (const [k, v] of Object.entries(args)) if (k !== 'intent') cleanArgs[k] = asStr(v);
          // El cliente devuelve un resultado POR ACCIÓN; esta llamada se contesta con el de la suya.
          call.actionIndex = actions.length;
          actions.push({ kind: 'mcp', tool: name, args: cleanArgs });
        } else if (name === 'list_apps') {
          call.internalOutput = JSON.stringify({ apps });
        } else if (name === 'ask_user') {
          question = asStr(args.question);
        } else if (name === 'speak') {
          speech = asStr(args.text);
        } else {
          // Una función que no está declarada: no hay acción ni resultado que darle.
          call.internalOutput = `No existe la herramienta «${name}». Usa solo las que tienes declaradas.`;
        }
        pending.push(call);
        break;
      }
      default:
        break;
    }
  }

  s.pending = pending;
  const needsScreenshot = pending.some((call) => call.isComputer)
    || actions.some((action) => action.kind === 'tap' || action.kind === 'type');

  const turn = {
    actions,
    question,
    done: pending.length === 0,
    text,
    needsScreenshot,
    narration: intents.find((intent) => intent) ?? '',
    speech,
    intents
  };
  return { session: s, turn };
}

const ARROWS = Object.freeze({ ARROWLEFT: 'left', ARROWRIGHT: 'right', ARROWUP: 'up', ARROWDOWN: 'down' });

/**
 * Une los keys de un keypress a lo que espera el ejecutor de Windows y Android: UNA tecla
 * (enter/back/tab/flechas…), o la primera. Esos clientes no tienen atajos; el prompt lo dice.
 */
function mapKey(keys) {
  const up = keys.map((key) => key.toUpperCase());
  if (up.includes('ENTER') || up.includes('RETURN')) return 'enter';
  if (up.includes('ESC') || up.includes('ESCAPE')) return 'back';
  const first = (keys[0] ?? '').toUpperCase();
  return ARROWS[first] || first.toLowerCase();
}

// Nombres de computer-use → los del ejecutor del Mac (apps/mac/Sources/UMac/InputDriver.swift).
const MAC_KEYS = Object.freeze({
  META: 'cmd', CMD: 'cmd', COMMAND: 'cmd', SUPER: 'cmd', WIN: 'cmd',
  CTRL: 'ctrl', CONTROL: 'ctrl',
  ALT: 'alt', OPTION: 'alt',
  SHIFT: 'shift',
  ENTER: 'enter', RETURN: 'enter',
  ESC: 'esc', ESCAPE: 'esc',
  BACKSPACE: 'backspace', DELETE: 'delete', DEL: 'delete',
  TAB: 'tab', SPACE: 'space',
  HOME: 'home', END: 'end', PAGEUP: 'pageup', PAGEDOWN: 'pagedown',
  ...ARROWS
});

/** Un keypress de computer-use → un atajo entero para el Mac: ["CMD","L"] → "cmd+l". */
function macKey(keys) {
  return keys
    .map((key) => {
      const up = `${key}`.trim().toUpperCase();
      return MAC_KEYS[up] || up.toLowerCase();
    })
    .filter(Boolean)
    .join('+');
}

function extractMessage(item) {
  const content = item.content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      const o = asObj(part);
      return asStr(o.text) || asStr(o.output_text);
    }).join('');
  }
  if (typeof content === 'string') return content;
  return asStr(item.text);
}

module.exports = { runOpenAiTurn, toolDeclarations, parseTurn };
