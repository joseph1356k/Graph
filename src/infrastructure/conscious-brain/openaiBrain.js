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
//    Windows captura a resolución real, así que la escala es 1.

const { goalPrompt, browserGoalPrompt } = require('./prompt');

const OA_BASE = 'https://api.openai.com';

/** PNG (base64 sin prefijo) → data-uri para la Responses API. */
function dataUri(b64) {
  return `data:image/png;base64,${b64}`;
}

/** Declaración de función (Responses API) desde una McpTool, con enum en las opciones. */
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
    parameters: { type: 'object', properties, required: tool.params.map((param) => param.name) }
  };
}

function customFn(name, description, arg) {
  return {
    type: 'function',
    name,
    description,
    parameters: { type: 'object', properties: { [arg]: { type: 'string' } }, required: [arg] }
  };
}

function transient(code) {
  return code === 429 || (code >= 500 && code <= 599);
}

// Reintento con backoff para 429/5xx: un bache de demanda no debe tirar el turno.
async function oaHttp(url, apiKey, body) {
  let wait = 800;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!transient(res.status) || attempt >= 4) return { code: res.status, body: text };
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, 8000);
  }
}

const asStr = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asObj = (v) => (v && typeof v === 'object' ? v : {});
const asArr = (v) => (Array.isArray(v) ? v : []);

/** Ejecuta un turno del cerebro. Devuelve la sesión actualizada + el BrainTurn a mandar al cliente. */
async function runOpenAiTurn(inp) {
  const s = JSON.parse(JSON.stringify(inp.session)); // copia mutable
  const { tools, mcpNames, memory, apps, state, results, apiKey } = inp;

  // Modo Computer Use VISUAL de navegador: sin árbol de UI (UIA), solo screenshot.
  const visual = s.mode === 'browser-visual';
  const stateBlock = visual
    ? `Contexto: estás en un navegador. Página/URL actual: ${state.screen || '(desconocida)'}`
    : `Pantalla actual: ${state.screen}\nDónde estás (árbol de UI de Windows):\n${state.uiContext}`;
  const input = [];

  const userMessage = (text) => {
    const content = [{ type: 'input_text', text }];
    if (state.screenshot) content.push({ type: 'input_image', image_url: dataUri(state.screenshot), detail: 'original' });
    input.push({ type: 'message', role: 'user', content });
  };

  if (!s.previousId) {
    userMessage(visual
      ? browserGoalPrompt({ goal: s.goal, stateBlock })
      : goalPrompt({ goal: s.goal, tools, memory, stateBlock }));
  } else if (s.pending.length === 0) {
    userMessage(`${s.continuationMessage || s.informText || 'Continúa.'}\n${stateBlock}`);
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
      } else {
        input.push(functionOutput(call.id, results[i] ?? 'ok'));
      }
    });
    s.informText = '';
    // Modo visual: garantiza que el modelo SIEMPRE vea el frame actual, aun cuando
    // el turno previo fue navigate/ask_user (sin computer_call que cargue la captura).
    // Sin esto, tras navegar el modelo decidiría a ciegas.
    if (visual && !s.pending.some((call) => call.isComputer) && state.screenshot) {
      input.push({
        type: 'message', role: 'user', content: [
          { type: 'input_text', text: 'Captura actual de la página:' },
          { type: 'input_image', image_url: dataUri(state.screenshot), detail: 'original' }
        ]
      });
    }
  }

  // En modo visual, el tool computer lleva las dimensiones del screenshot y el
  // entorno 'browser' (lo que espera computer-use para páginas web). En Windows se
  // conserva EXACTAMENTE `{type:'computer'}` como estaba (no tocar el cliente).
  const computerTool = visual
    ? { type: 'computer', display_width: Number(state.width) || 1280, display_height: Number(state.height) || 800, environment: 'browser' }
    : { type: 'computer' };
  const toolDecls = [computerTool];
  for (const tool of tools) toolDecls.push(mcpFn(tool));
  toolDecls.push(customFn('ask_user', 'Pregunta al usuario cuando tengas una duda real e importante. Responde con texto o voz.', 'question'));
  toolDecls.push(customFn('speak', 'Di algo en voz alta con tu personalidad. Solo para lo importante; no narres cada paso.', 'text'));
  // list_apps es específico de Windows; en modo visual de navegador no aplica.
  if (!visual) toolDecls.push(customFn('list_apps', 'Lista las aplicaciones instaladas para elegir cuál abrir.', 'reason'));

  const reqBody = {
    model: s.model,
    input,
    tools: toolDecls,
    truncation: 'auto',
    reasoning: { effort: s.effort }
  };
  if (s.previousId) reqBody.previous_response_id = s.previousId;

  const res = await oaHttp(`${OA_BASE}/v1/responses`, apiKey, reqBody);
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

  return parseTurn(JSON.parse(res.body), s, state, mcpNames, apps);
}

function functionOutput(callId, output) {
  return { type: 'function_call_output', call_id: callId, output };
}

/** Traduce la respuesta de la Responses API a un BrainTurn + la sesión actualizada. */
function parseTurn(body, s, state, mcpNames, apps) {
  s.previousId = asStr(body.id) || s.previousId;
  const items = asArr(body.output ?? body.outputs).map(asObj);

  // Reescalado screenshot→pantalla: OpenAI da píxeles del screenshot enviado.
  // El cliente Windows captura a la resolución real de pantalla, así que
  // screenshot y pantalla coinciden (escala 1).
  const sx = 1;
  const sy = 1;
  const px = (a, key, scale) => {
    const raw = a[key];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
    return Number.isFinite(n) ? Math.round(n * scale) : -1;
  };

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
      case 'left_click':
        actions.push({ kind: 'tap', x: px(a, 'x', sx), y: px(a, 'y', sy) });
        break;
      case 'type':
        actions.push({ kind: 'type', x: px(a, 'x', sx), y: px(a, 'y', sy), text: asStr(a.text) });
        break;
      case 'keypress':
      case 'key': {
        const keys = asArr(a.keys).map(asStr).filter(Boolean);
        const single = asStr(a.key);
        actions.push({ kind: 'key', key: mapKey(keys.length ? keys : single ? [single] : []) });
        break;
      }
      case 'scroll': {
        const dy = px(a, 'scroll_y', 1);
        const dyAlt = px(a, 'delta_y', 1);
        const v = dy !== -1 ? dy : dyAlt !== -1 ? dyAlt : 1;
        actions.push({ kind: 'scroll', down: v >= 0 });
        break;
      }
      case 'drag':
      case 'swipe': {
        const path = asArr(a.path).map(asObj);
        const p0 = path[0] ?? {};
        const p1 = path[path.length - 1] ?? p0;
        actions.push({ kind: 'swipe', x1: px(p0, 'x', sx), y1: px(p0, 'y', sy), x2: px(p1, 'x', sx), y2: px(p1, 'y', sy), ms: 400 });
        break;
      }
      case 'wait':
        actions.push({ kind: 'wait', ms: Number(px(a, 'ms', 1) > 0 ? px(a, 'ms', 1) : 1000) });
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
        if (name !== 'ask_user' && name !== 'speak') intents.push(asStr(args.intent));
        if (mcpNames.has(name)) {
          const cleanArgs = {};
          for (const [k, v] of Object.entries(args)) if (k !== 'intent') cleanArgs[k] = asStr(v);
          actions.push({ kind: 'mcp', tool: name, args: cleanArgs });
        } else if (name === 'list_apps') {
          call.internalOutput = JSON.stringify({ apps });
        } else if (name === 'ask_user') {
          question = asStr(args.question);
        } else if (name === 'speak') {
          speech = asStr(args.text);
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

/** Une los keys de un keypress a lo que espera el ejecutor del cliente (enter/back/…), o el primero. */
function mapKey(keys) {
  const up = keys.map((key) => key.toUpperCase());
  if (up.includes('ENTER') || up.includes('RETURN')) return 'enter';
  if (up.includes('ESC') || up.includes('ESCAPE')) return 'back';
  return (keys[0] ?? '').toLowerCase();
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

module.exports = { runOpenAiTurn };
