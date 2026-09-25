#!/usr/bin/env node
// El decisor Jev para Android (POST /api/v1/agent/decidir), sin red ni keys.
//   node scripts/verify-agent-decisor.js
//
// Graph hace de proxy entre el teléfono y TypeSafe (Jev): el teléfono manda el
// paquete de la app, el objetivo y las puertas numeradas; Graph arma SIEMPRE el
// cuerpo de TypeSafe, pone la key y devuelve solo la elección y números. Lo que
// se juzga aquí (D1-D10), todo con `fetch` falso y un Supabase falso debajo del
// autorizador REAL (LiveVoiceDeviceAuthorizer):
//  D1  apagado por defecto (kill switch) y sin key: 503 sin llamar a TypeSafe;
//  D2  sin device_id 400; dispositivo ausente o sin realtime_allowed 403;
//  D3  el cuerpo a TypeSafe lo arma Graph; la key solo en Authorization;
//  D4  límites estrictos: 400 sin llamar a TypeSafe;
//  D5  429/529 se reintentan dentro del plazo; 401/422 no;
//  D6  cada fallo de TypeSafe sale con su código estable;
//  D7  la respuesta lleva solo lo prometido y la elección es de las enviadas;
//  D8  una línea de log por llamada, sin objetivo, etiquetas, elección ni key;
//  D9  30/min por dispositivo (y tope global de Android): 429 limite_de_uso;
//  D10 el turno del agente (/api/v1/agent/turn) sigue como antes.
// Los sabotajes (cada D con su rojo) se aplican de a uno desde fuera de este
// archivo: ver docs de la spec 012 del diseño Jev.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const express = require('express');

const LiveVoiceDeviceAuthorizer = require('../src/application/use-cases/LiveVoiceDeviceAuthorizer');
const DecisorService = require('../src/application/use-cases/DecisorService');
const registerAgentDecisorRoutes = require('../web/api/registerAgentDecisorRoutes');
const registerWindowsAgentRoutes = require('../web/api/registerWindowsAgentRoutes');
const dominio = require('../src/domain/decisor/peticionSystemOne');
const { FEATURES } = require('../src/domain/usage/vocabulary');

const ROOT = path.join(__dirname, '..');
const RUTA = '/api/v1/agent/decidir';
const URL_TYPESAFE = 'https://api.typesafe.ai/v1/systemone';

// Una key FALSA con forma reconocible: sirve de canario para probar que no sale
// por ningún lado. No es ninguna credencial real.
const CLAVE_FALSA = 'CLAVE-FALSA-CANARIO-7f3a9c1e-no-es-una-credencial';
const CLAVE_ANDROID_FALSA = 'CLAVE-FALSA-ANDROID-CANARIO-5b2d8e40-no-es-una-credencial';

const DEVICE = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const DEVICE_2 = 'cccccccc-1111-4222-8333-dddddddddddd';
const PUERTAS = ['1) Chats (Tab)', '2) Nuevo chat (ImageButton)', '3) Buscar (ImageButton)'];
const OBJETIVO = 'abrir el chat nuevo';
// «1) » + etiqueta + « (Button)» = 12 caracteres fijos.
const puertaDe = (largo) => `1) ${'y'.repeat(largo - 12)} (Button)`;
const cuerpoBueno = (extra = {}) => ({ device_id: DEVICE, pantalla: 'com.whatsapp', objetivo: OBJETIVO, puertas: [...PUERTAS], ...extra });

const RESPUESTA_TYPESAFE = () => ({
  model: 'jev-1.13.0',
  answers: {
    puerta: { type: 'choice', choice: '2) Nuevo chat (ImageButton)', probabilities: { '1) Chats (Tab)': 0.05, '2) Nuevo chat (ImageButton)': 0.93, '3) Buscar (ImageButton)': 0.02 }, confidence: 0.91 },
    cumplido: { noul: 0.02 },
    peligro: { noul: 0.05 }
  },
  usage: { input_tokens: 312, output_tokens: 0 }
});

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

// ---- fakes ----------------------------------------------------------------

function respuestaTypeSafe(status, cuerpo, { texto } = {}) {
  const t = texto !== undefined ? texto : JSON.stringify(cuerpo);
  return { ok: status >= 200 && status < 300, status, async text() { return t; }, async json() { return JSON.parse(t); } };
}

// fetch falso: `guion` es una lista de respuestas (o funciones) que se consumen
// en orden; la última se repite. Registra cada llamada.
function fetchFalso(guion, reloj) {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url, init, cuerpo: init && typeof init.body === 'string' ? JSON.parse(init.body) : null });
    const paso = guion[Math.min(llamadas.length - 1, guion.length - 1)];
    if (reloj && paso && paso.costoMs) reloj.t += paso.costoMs;
    if (typeof paso === 'function') return paso(url, init);
    if (paso && paso.lanza) throw paso.lanza;
    return paso.respuesta || paso;
  };
  fn.llamadas = llamadas;
  return fn;
}
// TypeSafe falso que elige siempre la primera puerta que se le ofrece.
const eligeLaPrimera = (url, init) => {
  const primera = Object.keys(JSON.parse(init.body).questions.puerta.criteria)[0];
  const j = RESPUESTA_TYPESAFE();
  j.answers.puerta = { type: 'choice', choice: primera, confidence: 0.8 };
  return respuestaTypeSafe(200, j);
};
const cuelga = () => (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

function relojFalso() {
  const reloj = { t: 0, esperas: [] };
  reloj.now = () => reloj.t;
  reloj.sleep = async (ms) => { reloj.esperas.push(ms); reloj.t += ms; };
  return reloj;
}

// Supabase falso debajo del autorizador REAL.
function supabaseFalso(filas) {
  const llamadas = [];
  return {
    llamadas,
    async select(table, query) {
      llamadas.push({ table, query });
      const m = /device_id=eq\.([^&]+)/.exec(query);
      const id = m ? decodeURIComponent(m[1]) : '';
      return filas.has(id) ? [{ device_id: id, realtime_allowed: filas.get(id) }] : [];
    }
  };
}

const header = (init, nombre) => {
  const clave = Object.keys(init.headers || {}).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return clave ? init.headers[clave] : undefined;
};

// Levanta una app express con la ruta del decisor y devuelve cómo llamarla.
async function levantar(opciones = {}) {
  const {
    env = { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY: CLAVE_FALSA },
    guion = [{ respuesta: respuestaTypeSafe(200, RESPUESTA_TYPESAFE()) }],
    filas = new Map([[DEVICE, true], [DEVICE_2, true]]),
    plazoMs,
    limites = {},
    authorizer,
    usageRecorder,
    servicioFalso,
    montarTurno = false
  } = opciones;
  const reloj = opciones.reloj || relojFalso();
  const fetchImpl = opciones.fetchImpl || fetchFalso(guion, reloj);
  const supabase = supabaseFalso(filas);
  const lineas = [];
  const logger = { log: (l) => lineas.push(`${l}`), warn: (l) => lineas.push(`${l}`), error: (l) => lineas.push(`${l}`) };
  const servicio = servicioFalso || new DecisorService({
    authorizer: authorizer || new LiveVoiceDeviceAuthorizer(supabase),
    fetchImpl,
    env,
    now: reloj.now,
    sleep: reloj.sleep,
    plazoMs,
    usageRecorder
  });
  const app = express();
  app.use(express.json());
  registerAgentDecisorRoutes(app, { decisorService: servicio, logger, ...limites });
  const turnos = [];
  if (montarTurno) {
    registerWindowsAgentRoutes(app, {
      agentTurnService: { async handleTurn(body, ctx) { turnos.push({ body, ctx }); return { status: 200, json: { session: 'S', done: true } }; } },
      teachVideoService: {}
    });
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puerto = server.address().port;
  const post = async (cuerpo, cabeceras = {}) => {
    const r = await fetch(`http://127.0.0.1:${puerto}${RUTA}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabeceras },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no JSON */ }
    return { status: r.status, json, texto, cabeceras: r.headers };
  };
  const postTurno = async (cuerpo) => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/v1/agent/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, json: await r.json() };
  };
  return { post, postTurno, fetchImpl, supabase, lineas, reloj, servicio, turnos, cerrar: () => new Promise((resolve) => server.close(resolve)) };
}

async function con(opciones, fn) {
  const h = await levantar(opciones);
  try { return await fn(h); } finally { await h.cerrar(); }
}

// ---- D1 · apagado por defecto ---------------------------------------------

async function d1() {
  const casos = [
    ['sin ANDROID_DECISOR_ENABLED', { TYPESAFE_API_KEY: CLAVE_FALSA }],
    ['ANDROID_DECISOR_ENABLED=0', { ANDROID_DECISOR_ENABLED: '0', TYPESAFE_API_KEY: CLAVE_FALSA }],
    ['ANDROID_DECISOR_ENABLED con basura', { ANDROID_DECISOR_ENABLED: 'quizas', TYPESAFE_API_KEY: CLAVE_FALSA }],
    ['encendido (1) pero sin ninguna key', { ANDROID_DECISOR_ENABLED: '1' }],
    ['encendido (1) con la key vacía', { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY: '   ', TYPESAFE_API_KEY_ANDROID: '' }]
  ];
  for (const [nombre, env] of casos) {
    await con({ env }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 503, `${nombre}: estado ${r.status}`);
      assert.strictEqual(r.json.code, 'decisor_apagado', nombre);
      assert.strictEqual(h.fetchImpl.llamadas.length, 0, `${nombre}: no debe llamar a TypeSafe`);
      assert.strictEqual(h.supabase.llamadas.length, 0, `${nombre}: no debe ni leer la whitelist`);
    });
  }
  // Encendido con key: sí decide (una sola llamada).
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200);
    assert.strictEqual(h.fetchImpl.llamadas.length, 1);
  });
  // Modo simulado: regla fija, sin red y sin key; la whitelist sigue mandando.
  await con({ env: { ANDROID_DECISOR_ENABLED: 'simulado' }, fetchImpl: () => { throw new Error('el modo simulado no debe usar la red'); } }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200, `simulado: ${r.texto}`);
    assert.strictEqual(r.json.modelo, 'simulado');
    assert.strictEqual(r.json.eleccion, '2) Nuevo chat (ImageButton)', 'la regla fija elige la puerta que comparte más palabras con el objetivo');
    const otro = await h.post(cuerpoBueno({ device_id: 'zzzzzzzz-9999-4999-8999-zzzzzzzzzzzz' }));
    assert.strictEqual(otro.status, 403, 'simulado no se salta la whitelist');
  });
  // Cuál key manda: la de Android si existe.
  await con({ env: { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY: CLAVE_FALSA, TYPESAFE_API_KEY_ANDROID: CLAVE_ANDROID_FALSA } }, async (h) => {
    await h.post(cuerpoBueno());
    assert.strictEqual(header(h.fetchImpl.llamadas[0].init, 'authorization'), `Bearer ${CLAVE_ANDROID_FALSA}`);
  });
  await con({ env: { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY_ANDROID: CLAVE_ANDROID_FALSA } }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200, 'la key de Android sola basta');
  });
}

// ---- D2 · whitelist --------------------------------------------------------

async function d2() {
  await con({}, async (h) => {
    for (const [nombre, cuerpo] of [
      ['sin device_id', (() => { const c = cuerpoBueno(); delete c.device_id; return c; })()],
      ['device_id vacío', cuerpoBueno({ device_id: '   ' })],
      ['device_id que no es texto', cuerpoBueno({ device_id: 12345 })]
    ]) {
      const r = await h.post(cuerpo);
      assert.strictEqual(r.status, 400, `${nombre}: estado ${r.status}`);
      assert.strictEqual(r.json.code, 'cuerpo_invalido', nombre);
    }
    assert.strictEqual(h.fetchImpl.llamadas.length, 0, 'sin device_id no se llama a TypeSafe');
  });
  for (const [nombre, filas] of [
    ['dispositivo ausente', new Map()],
    ['realtime_allowed en false', new Map([[DEVICE, false]])],
    ['realtime_allowed que no es true (texto)', new Map([[DEVICE, 'true']])],
    ['realtime_allowed nulo', new Map([[DEVICE, null]])]
  ]) {
    await con({ filas }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 403, `${nombre}: estado ${r.status}`);
      assert.strictEqual(r.json.code, 'device_no_autorizado', nombre);
      assert.strictEqual(h.fetchImpl.llamadas.length, 0, `${nombre}: no se llama a TypeSafe`);
    });
  }
  // Supabase caído: falla cerrado, sin llamar a TypeSafe.
  const authorizer = { async requireAuthorizedDevice() { throw new Error('supabase caído'); } };
  await con({ authorizer }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.code, 'autorizacion_no_disponible');
    assert.strictEqual(h.fetchImpl.llamadas.length, 0);
    assert.ok(!r.texto.includes('supabase caído'), 'no se filtra el mensaje interno');
  });
  // Un fallo de PostgREST trae su propio statusCode (403 por service-role mala o RLS, 400 por consulta
  // rota...). NO es «dispositivo no autorizado» ni «cuerpo inválido»: solo lo son los errores PROPIOS del
  // autorizador. Cualquier otro es 503 autorizacion_no_disponible, para que el teléfono no pause Jev
  // creyendo que no está en la lista ni lo dé por mal armado.
  for (const codigoHttp of [400, 401, 403, 404, 500, 503]) {
    const supabase = { async select() { throw Object.assign(new Error(`PostgREST ${codigoHttp} con texto propio`), { statusCode: codigoHttp, supabaseCode: 'PGRST301' }); } };
    await con({ authorizer: new LiveVoiceDeviceAuthorizer(supabase) }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 503, `PostgREST ${codigoHttp}: estado ${r.status} ${r.texto.slice(0, 120)}`);
      assert.strictEqual(r.json.code, 'autorizacion_no_disponible', `PostgREST ${codigoHttp}`);
      assert.strictEqual(h.fetchImpl.llamadas.length, 0, `PostgREST ${codigoHttp}: no se llama a TypeSafe`);
      assert.ok(!r.texto.includes('texto propio'), `PostgREST ${codigoHttp}: no se filtra el mensaje interno`);
    });
  }
  // Y lo propio del autorizador sigue mapeándose a lo suyo.
  await con({ filas: new Map() }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.json.code, 'device_no_autorizado');
  });
  // Autorizado: pasa, y la lectura es la de la whitelist compartida.
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200);
    assert.strictEqual(h.supabase.llamadas.length, 1);
    assert.strictEqual(h.supabase.llamadas[0].table, 'graph_app_users');
  });
}

// ---- D3 · el cuerpo a TypeSafe lo arma Graph -------------------------------

async function d3() {
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200, r.texto);
    const llamada = h.fetchImpl.llamadas[0];
    assert.strictEqual(llamada.url, URL_TYPESAFE);
    assert.strictEqual(llamada.init.method, 'POST');
    assert.strictEqual(header(llamada.init, 'authorization'), `Bearer ${CLAVE_FALSA}`);
    assert.strictEqual(header(llamada.init, 'content-type'), 'application/json');
    const cuerpo = llamada.cuerpo;
    assert.deepStrictEqual(Object.keys(cuerpo), ['state', 'model', 'questions']);
    assert.strictEqual(cuerpo.model, 'jev-latest');
    assert.strictEqual(cuerpo.state,
      'Pantalla actual: com.whatsapp\n'
      + 'Lo que se quiere conseguir: abrir el chat nuevo\n'
      + 'Puertas accionables en esta pantalla, en orden de lectura:\n'
      + '  - 1) Chats (Tab)\n  - 2) Nuevo chat (ImageButton)\n  - 3) Buscar (ImageButton)\n');
    assert.deepStrictEqual(Object.keys(cuerpo.questions), ['puerta', 'cumplido', 'peligro']);
    const { puerta, cumplido, peligro } = cuerpo.questions;
    assert.strictEqual(puerta.type, 'choice');
    assert.strictEqual(puerta.instructions,
      '¿Qué puerta de esta pantalla hay que accionar AHORA para avanzar hacia «abrir el chat nuevo»? '
      + 'Elige solo entre las puertas listadas. Si ninguna avanza hacia el objetivo, elige la que menos daño haga.');
    assert.deepStrictEqual(puerta.criteria, { '1) Chats (Tab)': null, '2) Nuevo chat (ImageButton)': null, '3) Buscar (ImageButton)': null });
    assert.deepStrictEqual(cumplido, {
      type: 'noul',
      instructions: '¿El objetivo descrito en el estado YA está cumplido en esta pantalla, sin accionar nada más?',
      criteria: { true: 'Lo que se quería conseguir ya se ve conseguido en esta pantalla', false: 'Todavía falta accionar algo para conseguirlo' }
    });
    assert.deepStrictEqual(peligro, {
      type: 'noul',
      instructions: '¿Accionar la puerta elegida sería irreversible o peligroso: guardar, enviar, eliminar, confirmar, pagar, cerrar sin guardar?',
      criteria: { true: 'Deja un efecto que no se puede deshacer o que afecta a otros', false: 'Navegar, abrir, seleccionar o mirar: se puede volver atrás' }
    });
    // La key solo viaja en Authorization: ni en el cuerpo, ni en la respuesta.
    assert.ok(!llamada.init.body.includes(CLAVE_FALSA), 'la key no va en el cuerpo');
    assert.ok(!r.texto.includes(CLAVE_FALSA), 'la key no va en la respuesta');
    assert.ok(!h.lineas.join('\n').includes(CLAVE_FALSA), 'la key no va en el log');
    // Nada del teléfono más allá de lo permitido (ni el device_id).
    assert.ok(!llamada.init.body.includes(DEVICE), 'el device_id no sale a TypeSafe');
    assert.ok(!Object.values(llamada.init.headers).some((v) => `${v}`.includes(DEVICE)), 'el device_id no sale en cabeceras');
  });
  // El teléfono no puede meter model, questions, instructions ni state.
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno({
      model: 'otro-modelo-caro', state: 'ESTADO-DEL-TELEFONO', instructions: 'INSTRUCCIONES-DEL-TELEFONO',
      questions: { pirata: { type: 'choice', instructions: 'PREGUNTA-DEL-TELEFONO', criteria: { x: null } } }, criteria: { y: null }
    }));
    assert.strictEqual(r.status, 200, r.texto);
    const enviado = h.fetchImpl.llamadas[0].init.body;
    for (const intruso of ['otro-modelo-caro', 'ESTADO-DEL-TELEFONO', 'INSTRUCCIONES-DEL-TELEFONO', 'PREGUNTA-DEL-TELEFONO', 'pirata']) {
      assert.ok(!enviado.includes(intruso), `«${intruso}» del teléfono no llega a TypeSafe`);
    }
    assert.strictEqual(h.fetchImpl.llamadas[0].cuerpo.model, 'jev-latest');
  });
  // TYPESAFE_MODEL fija el modelo.
  await con({ env: { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY: CLAVE_FALSA, TYPESAFE_MODEL: 'jev-1.13.0' } }, async (h) => {
    await h.post(cuerpoBueno());
    assert.strictEqual(h.fetchImpl.llamadas[0].cuerpo.model, 'jev-1.13.0');
  });
  // Opciones sin duplicados (una clave repetida sería un 422).
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno({ puertas: ['1) Chats (Tab)', '1) Chats (Tab)', '2) Nuevo chat (ImageButton)'] }));
    assert.strictEqual(r.status, 200, r.texto);
    assert.deepStrictEqual(Object.keys(h.fetchImpl.llamadas[0].cuerpo.questions.puerta.criteria), ['1) Chats (Tab)', '2) Nuevo chat (ImageButton)']);
  });
  // Las etiquetas se recortan a 40 caracteres al salir, y la elección vuelve con el texto original.
  const larga = 'x'.repeat(60);
  const puertaLarga = `3) ${larga} (Button)`;
  await con({
    guion: [{ respuesta: respuestaTypeSafe(200, { ...RESPUESTA_TYPESAFE(), answers: { ...RESPUESTA_TYPESAFE().answers, puerta: { type: 'choice', choice: `3) ${'x'.repeat(40)} (Button)`, confidence: 0.8 } } }) }]
  }, async (h) => {
    const r = await h.post(cuerpoBueno({ puertas: ['1) Chats (Tab)', '2) Nuevo chat (ImageButton)', puertaLarga] }));
    assert.strictEqual(r.status, 200, r.texto);
    const ids = Object.keys(h.fetchImpl.llamadas[0].cuerpo.questions.puerta.criteria);
    assert.ok(ids.every((id) => !id.includes('x'.repeat(41))), 'ninguna etiqueta sale con más de 40 caracteres');
    assert.strictEqual(r.json.eleccion, puertaLarga, 'la elección vuelve con el texto original del teléfono');
  });
}

// ---- D3c · un redirect no reenvía la petición a otro origen ------------------

// Servidor local real que anota lo que le llega.
function servidorLocal(manejador) {
  const recibidas = [];
  const server = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (t) => { cuerpo += t; });
    req.on('end', () => {
      recibidas.push({ url: req.url, cabeceras: req.headers, cuerpo });
      manejador(req, res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    recibidas, puerto: server.address().port, cerrar: () => new Promise((r) => server.close(r))
  })));
}

async function d3c() {
  // Con dos servidores locales reales: A contesta 307 hacia B. Un 307 conserva método y cuerpo, así que
  //    seguirlo mandaría a B el objetivo y las etiquetas (y en la sonda, la X-API-Key).
  const B = await servidorLocal((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const A = await servidorLocal((req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${B.puerto}/desviado` }); res.end(); });
  try {
    const servicio = new DecisorService({
      authorizer: { async requireAuthorizedDevice() { return {}; } },
      env: { ANDROID_DECISOR_ENABLED: '1', TYPESAFE_API_KEY: CLAVE_FALSA },
      apiUrl: `http://127.0.0.1:${A.puerto}/v1/systemone`
    });
    const r = await servicio.decidir(cuerpoBueno());
    assert.strictEqual(A.recibidas.length, 1, 'A recibió la petición');
    assert.strictEqual(B.recibidas.length, 0, `B no debe recibir nada del servicio: ${JSON.stringify(B.recibidas.map((x) => x.cuerpo)).slice(0, 120)}`);
    assert.strictEqual(r.status, 502);
    assert.strictEqual(r.json.code, 'upstream_inalcanzable');

    // La sonda (--endpoint): la X-API-Key no puede llegar a B por un redirect de A.
    const { consultarEndpoint } = require('./sonda-del-decisor-android');
    const antes = { k: process.env.SONDA_GRAPH_API_KEY, d: process.env.SONDA_DEVICE_ID };
    process.env.SONDA_GRAPH_API_KEY = CLAVE_FALSA;
    process.env.SONDA_DEVICE_ID = 'sonda-12345678';
    try {
      const consultar = await consultarEndpoint(`http://127.0.0.1:${A.puerto}/api/v1/agent/decidir`);
      await assert.rejects(() => consultar({ pantalla: 'com.ejemplo', objetivo: 'abrir algo', puertas: ['1) Uno (Button)'] }), 'la sonda falla ante un redirect');
    } finally {
      for (const [nombre, valor] of [['SONDA_GRAPH_API_KEY', antes.k], ['SONDA_DEVICE_ID', antes.d]]) {
        if (valor === undefined) delete process.env[nombre]; else process.env[nombre] = valor;
      }
    }
    assert.strictEqual(B.recibidas.length, 0, `B no debe recibir nada de la sonda (llegó: ${JSON.stringify(B.recibidas.map((x) => x.cabeceras['x-api-key'])).slice(0, 120)})`);
    assert.ok(!JSON.stringify(B.recibidas).includes(CLAVE_FALSA), 'la key canario no llegó a B');
  } finally {
    await A.cerrar();
    await B.cerrar();
  }
  // Y la llamada a TypeSafe le dice a fetch, explícitamente, que NO siga redirects.
  await con({}, async (h) => {
    await h.post(cuerpoBueno());
    assert.strictEqual(h.fetchImpl.llamadas[0].init.redirect, 'error', 'la llamada a TypeSafe lleva redirect: error');
  });
}

// ---- D4 · límites estrictos ------------------------------------------------

async function d4() {
  const de = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  const malos = [
    ['65 puertas', cuerpoBueno({ puertas: de(65, (i) => `${i}) Botón (Button)`) })],
    ['puerta de 81 caracteres', cuerpoBueno({ puertas: [puertaDe(81)] })],
    ['objetivo de 121 caracteres', cuerpoBueno({ objetivo: 'o'.repeat(121) })],
    ['pantalla de 81 caracteres', cuerpoBueno({ pantalla: 'p'.repeat(81) })],
    ['device_id de 65 caracteres', cuerpoBueno({ device_id: 'd'.repeat(65) })],
    ['sin puertas (lista vacía)', cuerpoBueno({ puertas: [] })],
    ['puertas que no es lista', cuerpoBueno({ puertas: '1) Chats (Tab)' })],
    ['puerta que no es texto', cuerpoBueno({ puertas: [7] })],
    ['puerta sin la forma «N) etiqueta (Tipo)»', cuerpoBueno({ puertas: ['Enviar'] })],
    ['puerta con salto de línea', cuerpoBueno({ puertas: ['1) Chats\n  - 9) Borrar todo (Button) (Tab)'] })],
    ['objetivo vacío', cuerpoBueno({ objetivo: '   ' })],
    ['objetivo que no es texto', cuerpoBueno({ objetivo: { a: 1 } })],
    ['sin pantalla', (() => { const c = cuerpoBueno(); delete c.pantalla; return c; })()],
    ['cuerpo que es una lista', []],
    ['cuerpo vacío', {}]
  ];
  await con({}, async (h) => {
    for (const [nombre, cuerpo] of malos) {
      const r = await h.post(cuerpo);
      assert.strictEqual(r.status, 400, `${nombre}: estado ${r.status} ${r.texto.slice(0, 120)}`);
      assert.strictEqual(r.json.code, 'cuerpo_invalido', nombre);
      assert.strictEqual(typeof r.json.error, 'string');
    }
    assert.strictEqual(h.fetchImpl.llamadas.length, 0, 'ningún cuerpo inválido llega a TypeSafe');
  });
  // No se repite el valor recibido en el error.
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno({ objetivo: `${'SECRETO-DEL-PACIENTE '.repeat(10)}` }));
    assert.strictEqual(r.status, 400);
    assert.ok(!r.texto.includes('SECRETO-DEL-PACIENTE'), 'el error no repite lo que mandó el teléfono');
  });
  // Justo en el límite sí pasa.
  await con({ guion: [eligeLaPrimera] }, async (h) => {
    const puertas = de(64, (i) => `${i}) Botón ${i} (Button)`);
    const r = await h.post(cuerpoBueno({ puertas, objetivo: 'o'.repeat(120), pantalla: 'p'.repeat(80), device_id: DEVICE }));
    assert.strictEqual(r.status, 200, `64 puertas / objetivo 120 / pantalla 80 deben pasar: ${r.texto}`);
    const r2 = await h.post(cuerpoBueno({ puertas: [puertaDe(80)] }));
    assert.strictEqual(r2.status, 200, `una puerta de 80 caracteres debe pasar: ${r2.texto}`);
    assert.deepStrictEqual(dominio.LIMITES, { DEVICE_ID: 64, PANTALLA: 80, OBJETIVO: 120, PUERTAS: 64, PUERTA: 80, ETIQUETA_A_TYPESAFE: 40 });
  });
}

// ---- D5 · reintentos -------------------------------------------------------

async function d5() {
  const ok = { respuesta: respuestaTypeSafe(200, RESPUESTA_TYPESAFE()) };
  const e = (n) => ({ respuesta: respuestaTypeSafe(n, { error: 'x' }) });
  assert.strictEqual(dominio.PLAZO_MS, 1800);
  assert.strictEqual(dominio.INTENTOS_MAXIMOS, 3);
  assert.deepStrictEqual([0, 1, 2].map(dominio.esperaMs), [200, 400, 800]);
  // 429, 429, 200: tres llamadas, esperas 200 y 400.
  await con({ guion: [e(429), e(429), ok] }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200, r.texto);
    assert.strictEqual(h.fetchImpl.llamadas.length, 3);
    assert.deepStrictEqual(h.reloj.esperas, [200, 400]);
  });
  // 529 se reintenta igual.
  await con({ guion: [e(529), ok] }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200);
    assert.strictEqual(h.fetchImpl.llamadas.length, 2);
    assert.deepStrictEqual(h.reloj.esperas, [200]);
  });
  // Nunca más de 3 intentos.
  await con({ guion: [e(429)] }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 503);
    assert.strictEqual(h.fetchImpl.llamadas.length, 3, 'tres intentos en total y no más');
    assert.deepStrictEqual(h.reloj.esperas, [200, 400]);
  });
  // 401 y 422 no se reintentan (mismo cuerpo + misma key = mismo resultado, y gasta cupo).
  for (const codigo of [401, 422]) {
    await con({ guion: [e(codigo), ok] }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 502, `${codigo}`);
      assert.strictEqual(h.fetchImpl.llamadas.length, 1, `${codigo} no se reintenta`);
      assert.deepStrictEqual(h.reloj.esperas, []);
    });
  }
  // Un 5xx cualquiera tampoco se reintenta (no es cupo ni sobrecarga: no se insiste sin saber por qué).
  await con({ guion: [e(500), ok] }, async (h) => {
    await h.post(cuerpoBueno());
    assert.strictEqual(h.fetchImpl.llamadas.length, 1);
  });
  // Si la espera no cabe en lo que queda del plazo, se devuelve el turno.
  const reloj = relojFalso();
  await con({ reloj, guion: [{ ...e(429), costoMs: 1700 }, ok] }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.code, 'upstream_saturado');
    assert.strictEqual(h.fetchImpl.llamadas.length, 1, 'con 1.700 ms gastados la espera de 200 ms ya no cabe en 1.800');
    assert.deepStrictEqual(h.reloj.esperas, []);
  });
}

// ---- D6 · fallos de TypeSafe con su código estable -------------------------

async function d6() {
  const casos = [
    ['401 → 502 upstream_rechazo', { guion: [{ respuesta: respuestaTypeSafe(401, { detail: 'ECO-DEL-CUERPO-abrir-el-chat' }) }] }, 502, 'upstream_rechazo'],
    ['422 → 502 upstream_rechazo', { guion: [{ respuesta: respuestaTypeSafe(422, { detail: 'ECO-DEL-CUERPO-abrir-el-chat' }) }] }, 502, 'upstream_rechazo'],
    ['429 agotado → 503 upstream_saturado', { guion: [{ respuesta: respuestaTypeSafe(429, {}) }] }, 503, 'upstream_saturado'],
    ['529 agotado → 503 upstream_saturado', { guion: [{ respuesta: respuestaTypeSafe(529, {}) }] }, 503, 'upstream_saturado'],
    ['sin respuesta a tiempo → 504 upstream_timeout', { plazoMs: 40, fetchImpl: cuelga() }, 504, 'upstream_timeout'],
    ['red caída → 502 upstream_inalcanzable', { guion: [{ lanza: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }] }, 502, 'upstream_inalcanzable'],
    ['500 de TypeSafe → 502 upstream_inalcanzable', { guion: [{ respuesta: respuestaTypeSafe(500, {}) }] }, 502, 'upstream_inalcanzable'],
    ['200 que no es JSON → 502 upstream_ilegible', { guion: [{ respuesta: respuestaTypeSafe(200, null, { texto: '<html>hola</html>' }) }] }, 502, 'upstream_ilegible'],
    ['200 sin answers.puerta.choice → 502 upstream_ilegible', { guion: [{ respuesta: respuestaTypeSafe(200, { model: 'm', answers: { puerta: {} } }) }] }, 502, 'upstream_ilegible'],
    ['200 con un número que no es número → 502 upstream_ilegible', { guion: [{ respuesta: respuestaTypeSafe(200, (() => { const j = RESPUESTA_TYPESAFE(); j.answers.peligro.noul = 'alto'; return j; })()) }] }, 502, 'upstream_ilegible'],
    ['200 con un número fuera de 0 a 1 → 502 upstream_ilegible', { guion: [{ respuesta: respuestaTypeSafe(200, (() => { const j = RESPUESTA_TYPESAFE(); j.answers.puerta.confidence = 1.7; return j; })()) }] }, 502, 'upstream_ilegible'],
    ['200 sin cumplido → 502 upstream_ilegible', { guion: [{ respuesta: respuestaTypeSafe(200, (() => { const j = RESPUESTA_TYPESAFE(); delete j.answers.cumplido; return j; })()) }] }, 502, 'upstream_ilegible']
  ];
  for (const [nombre, opciones, estado, codigo] of casos) {
    await con(opciones, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, estado, `${nombre}: estado ${r.status} ${r.texto.slice(0, 160)}`);
      assert.strictEqual(r.json.code, codigo, nombre);
      assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0, `${nombre}: error legible`);
      assert.ok(!r.texto.includes('ECO-DEL-CUERPO'), `${nombre}: no se copia el detalle de TypeSafe`);
      assert.ok(!r.texto.includes(CLAVE_FALSA), `${nombre}: la key no sale`);
      if (codigo === 'upstream_saturado') {
        assert.ok(r.cabeceras.get('retry-after'), `${nombre}: lleva Retry-After`);
      }
    });
  }
}

// ---- D7 · la respuesta -----------------------------------------------------

async function d7() {
  await con({}, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(Object.keys(r.json).sort(), ['cumplido', 'confianza', 'eleccion', 'modelo', 'ms', 'peligro', 'probabilidades'].sort());
    assert.strictEqual(r.json.modelo, 'jev-1.13.0');
    assert.strictEqual(r.json.eleccion, '2) Nuevo chat (ImageButton)');
    assert.strictEqual(r.json.confianza, 0.91);
    assert.strictEqual(r.json.cumplido, 0.02);
    assert.strictEqual(r.json.peligro, 0.05);
    assert.deepStrictEqual(r.json.probabilidades, { '1) Chats (Tab)': 0.05, '2) Nuevo chat (ImageButton)': 0.93, '3) Buscar (ImageButton)': 0.02 });
    assert.strictEqual(typeof r.json.ms, 'number');
    assert.ok(!('usage' in r.json) && !('answers' in r.json) && !('model' in r.json));
  });
  // Una elección que no es de las enviadas: 502 upstream_ilegible.
  for (const intrusa of ['9) Borrar cuenta (Button)', '2) nuevo chat (imagebutton)', '']) {
    const j = RESPUESTA_TYPESAFE();
    j.answers.puerta.choice = intrusa;
    await con({ guion: [{ respuesta: respuestaTypeSafe(200, j) }] }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 502, `«${intrusa}» no es una de las enviadas`);
      assert.strictEqual(r.json.code, 'upstream_ilegible');
      assert.ok(!r.texto.includes('Borrar cuenta'), 'no se devuelve lo que inventó el proveedor');
    });
  }
  // Probabilidades de puertas que no se enviaron no se reenvían.
  {
    const j = RESPUESTA_TYPESAFE();
    j.answers.puerta.probabilities['9) Borrar cuenta (Button)'] = 0.4;
    await con({ guion: [{ respuesta: respuestaTypeSafe(200, j) }] }, async (h) => {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 200);
      assert.ok(!('9) Borrar cuenta (Button)' in r.json.probabilidades));
    });
  }
  // El consumo se anota (mejor esfuerzo) con la funcionalidad «decisor» y sin fallar si el grabador revienta.
  const anotados = [];
  await con({ usageRecorder: { record: (e) => { anotados.push(e); return Promise.resolve({ ok: true }); } } }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200);
    assert.strictEqual(anotados.length, 1);
    assert.strictEqual(anotados[0].feature, FEATURES.DECISOR);
    assert.strictEqual(FEATURES.DECISOR, 'decisor');
    assert.strictEqual(anotados[0].inputTokens, 312);
    assert.ok(!JSON.stringify(anotados[0]).includes(OBJETIVO), 'el objetivo no va al ledger');
  });
  await con({ usageRecorder: { record: () => { throw new Error('ledger caído'); } } }, async (h) => {
    const r = await h.post(cuerpoBueno());
    assert.strictEqual(r.status, 200, 'un ledger caído no tumba la decisión');
  });
}

// ---- D8 · el log -----------------------------------------------------------

async function d8() {
  const prohibidos = [OBJETIVO, 'Nuevo chat', 'Chats', 'Buscar', 'ImageButton', 'com.whatsapp', CLAVE_FALSA, DEVICE, 'ECO-DEL-CUERPO', 'SECRETO-DEL-PACIENTE'];
  const escenarios = [
    ['éxito', {}, cuerpoBueno()],
    ['400', {}, cuerpoBueno({ objetivo: 'SECRETO-DEL-PACIENTE'.repeat(10) })],
    ['403', { filas: new Map() }, cuerpoBueno()],
    ['apagado', { env: {} }, cuerpoBueno()],
    ['upstream 422 con eco', { guion: [{ respuesta: respuestaTypeSafe(422, { detail: `ECO-DEL-CUERPO ${OBJETIVO} Nuevo chat` }) }] }, cuerpoBueno()],
    ['timeout', { plazoMs: 30, fetchImpl: cuelga() }, cuerpoBueno()],
    ['red caída con la key en el mensaje del error', { guion: [{ lanza: Object.assign(new TypeError(`fetch failed Bearer ${CLAVE_FALSA} ${OBJETIVO}`), { cause: { code: 'ECONNRESET', message: CLAVE_FALSA } }) }] }, cuerpoBueno()]
  ];
  for (const [nombre, opciones, cuerpo] of escenarios) {
    await con(opciones, async (h) => {
      await h.post(cuerpo);
      assert.strictEqual(h.lineas.length, 1, `${nombre}: exactamente una línea de log por llamada (hubo ${h.lineas.length})`);
      const linea = h.lineas[0];
      assert.ok(linea.startsWith('[agent/decidir]'), `${nombre}: prefijo ${linea}`);
      assert.ok(!/[\r\n]/.test(linea), `${nombre}: una sola línea`);
      for (const prohibido of prohibidos) {
        assert.ok(!linea.includes(prohibido), `${nombre}: el log no debe contener «${prohibido}»: ${linea}`);
      }
      if (nombre !== 'apagado') {
        assert.ok(linea.includes('device=aaaaaaaa…'), `${nombre}: device_id enmascarado (8 caracteres + …): ${linea}`);
      }
      assert.ok(/code=\w+/.test(linea) && /ms=\d+/.test(linea), `${nombre}: lleva code y ms: ${linea}`);
    });
  }
  // El éxito lleva puertas y cifras.
  await con({}, async (h) => {
    await h.post(cuerpoBueno());
    const linea = h.lineas[0];
    assert.ok(linea.includes('puertas=3'), linea);
    assert.ok(linea.includes('estado=200'), linea);
    assert.ok(linea.includes('confianza=0.91') && linea.includes('cumplido=0.02') && linea.includes('peligro=0.05'), linea);
  });
  // Un device_id con saltos de línea no parte el log ni se cuela entero.
  await con({}, async (h) => {
    await h.post(cuerpoBueno({ device_id: 'x\n[agent/decidir] FALSA-LINEA' }));
    assert.strictEqual(h.lineas.length, 1);
    assert.ok(!/[\r\n]/.test(h.lineas[0]) && !h.lineas[0].includes('FALSA-LINEA'), h.lineas[0]);
  });
  // La línea de log solo escribe nombres de causa conocidos y números: cualquier otra cosa sale como «otro»,
  // aunque el servicio (por un fallo o una mutación) le pase un valor crudo.
  {
    const { lineaDeLog } = registerAgentDecisorRoutes;
    const hostil = lineaDeLog(DEVICE, { estado: 502, code: CLAVE_FALSA, ms: 3, puertas: 3, upstream: CLAVE_FALSA, motivo: OBJETIVO, confianza: CLAVE_FALSA });
    for (const canario of [CLAVE_FALSA, OBJETIVO, DEVICE]) assert.ok(!hostil.includes(canario), `la línea no debe traer «${canario}»: ${hostil}`);
    assert.ok(hostil.includes('upstream=otro') && hostil.includes('motivo=otro') && hostil.includes('code=otro'), hostil);
    const normal = lineaDeLog(DEVICE, { estado: 502, code: 'upstream_rechazo', ms: 3, puertas: 3, upstream: 422, motivo: 'puertas_demasiadas' });
    assert.ok(normal.includes('upstream=422') && normal.includes('motivo=puertas_demasiadas') && normal.includes('code=upstream_rechazo'), normal);
    // Los nombres que el servicio puede emitir están todos en la lista blanca.
    for (const codigo of Object.keys(DecisorService.ESTADOS)) assert.ok(dominio.CODIGOS.includes(codigo), `código «${codigo}» fuera de la lista blanca`);
    assert.ok(dominio.CODIGOS.includes('ok') && dominio.CODIGOS.includes('limite_de_uso') && dominio.CODIGOS.includes('error_interno'));
    for (const cuerpo of [cuerpoBueno({ puertas: [] }), cuerpoBueno({ objetivo: 'o'.repeat(121) }), cuerpoBueno({ pantalla: '' }), cuerpoBueno({ puertas: ['Enviar'] }), cuerpoBueno({ puertas: Array.from({ length: 65 }, (_, i) => `${i + 1}) B (Button)`) }), {}, cuerpoBueno({ device_id: 'a b' })]) {
      const v = dominio.validarPeticion(cuerpo);
      assert.ok(!v.ok && dominio.MOTIVOS.includes(v.motivo), `motivo «${v.motivo}» fuera de la lista blanca`);
    }
  }
  // Y de punta a punta por la ruta: un servicio que devuelve una traza hostil no la escribe en el log.
  const servicioHostil = { modo: () => 'real', async decidir() { return { status: 502, json: { error: 'x', code: 'upstream_inalcanzable' }, traza: { estado: 502, code: 'upstream_inalcanzable', ms: 3, puertas: 3, upstream: CLAVE_FALSA, motivo: OBJETIVO } }; } };
  await con({ servicioFalso: servicioHostil }, async (h) => {
    await h.post(cuerpoBueno());
    assert.strictEqual(h.lineas.length, 1);
    assert.ok(!h.lineas[0].includes(CLAVE_FALSA) && !h.lineas[0].includes(OBJETIVO), `la traza hostil llegó al log: ${h.lineas[0]}`);
  });
  // El enmascarado, tal cual lo pide el contrato.
  assert.strictEqual(registerAgentDecisorRoutes.enmascararDeviceId(DEVICE), 'aaaaaaaa…');
  assert.strictEqual(registerAgentDecisorRoutes.enmascararDeviceId(''), '(vacío)');
  assert.ok(!registerAgentDecisorRoutes.enmascararDeviceId('abc').includes('abc'), 'un id corto no se muestra entero');
}

// ---- D9 · limitadores ------------------------------------------------------

async function d9() {
  assert.strictEqual(registerAgentDecisorRoutes.LIMITE_POR_DISPOSITIVO, 30);
  assert.strictEqual(registerAgentDecisorRoutes.LIMITE_GLOBAL, 300);
  await con({}, async (h) => {
    for (let i = 1; i <= 30; i += 1) {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 200, `la llamada ${i} debe pasar`);
    }
    const r31 = await h.post(cuerpoBueno());
    assert.strictEqual(r31.status, 429);
    assert.strictEqual(r31.json.code, 'limite_de_uso');
    assert.strictEqual(h.fetchImpl.llamadas.length, 30, 'la 31 no llega a TypeSafe');
    const otro = await h.post(cuerpoBueno({ device_id: DEVICE_2 }));
    assert.strictEqual(otro.status, 200, 'otro dispositivo no paga el límite del primero');
  });
  // La cuenta va por el device_id NORMALIZADO (el mismo trim con el que valida el cuerpo y autoriza el
  // autorizador): rellenarlo con espacios, tabuladores o espacios duros no abre una cuenta nueva.
  await con({}, async (h) => {
    const relleno = [' ', '\t', '\u00a0', ' \t '];
    const estados = [];
    for (let i = 0; i < 40; i += 1) {
      const pad = relleno[i % relleno.length].repeat(i % 7 + 1);
      estados.push((await h.post(cuerpoBueno({ device_id: i % 2 ? `${pad}${DEVICE}` : `${DEVICE}${pad}` }))).status);
    }
    assert.deepStrictEqual(estados.slice(0, 30), Array(30).fill(200), 'las 30 primeras pasan');
    assert.deepStrictEqual(estados.slice(30), Array(10).fill(429), `la 31 y siguientes dan 429 aunque cambie el relleno: ${estados.join(',')}`);
    assert.strictEqual(h.fetchImpl.llamadas.length, 30, 'solo 30 llegan a TypeSafe');
  });
  // La clave del limitador tiene tope de largo: el limitador corre ANTES de la validación, así que un id de
  // 200 caracteres (válido por alfabeto, 400 después) no puede acabar como una clave de 200 caracteres.
  {
    const { claveDeDispositivo } = registerAgentDecisorRoutes;
    assert.strictEqual(claveDeDispositivo('a'.repeat(200)).length, dominio.LIMITES.DEVICE_ID, 'la clave nunca supera 64 caracteres');
    assert.strictEqual(claveDeDispositivo(`\t ${DEVICE} \u00a0`), DEVICE, 'la clave es el id recortado');
    assert.strictEqual(claveDeDispositivo(undefined), '');
    assert.strictEqual(claveDeDispositivo(12345), '');
    // Por la ruta: ids distintos de 200 caracteres que comparten los 64 primeros cuentan en la MISMA clave.
    await con({}, async (h) => {
      const estados = [];
      for (let i = 0; i < 40; i += 1) {
        const id = `${'a'.repeat(64)}${String(i).padStart(136, 'b')}`;
        assert.strictEqual(id.length, 200);
        estados.push((await h.post(cuerpoBueno({ device_id: id }))).status);
      }
      assert.deepStrictEqual(estados.slice(0, 30), Array(30).fill(400), 'las 30 primeras llegan a la validación (id demasiado largo)');
      assert.deepStrictEqual(estados.slice(30), Array(10).fill(429), `las siguientes las corta el limitador: ${estados.join(',')}`);
      assert.strictEqual(h.fetchImpl.llamadas.length, 0);
    });
  }
  // Tope global de Android: repartido entre dispositivos también corta.
  await con({ limites: { limiteGlobal: 4 } }, async (h) => {
    const estados = [];
    for (let i = 0; i < 6; i += 1) estados.push((await h.post(cuerpoBueno({ device_id: i % 2 ? DEVICE : DEVICE_2 }))).status);
    assert.deepStrictEqual(estados, [200, 200, 200, 200, 429, 429]);
  });
  // Apagado no cuenta: 40 llamadas contestan 503, ninguna 429.
  await con({ env: {} }, async (h) => {
    for (let i = 0; i < 40; i += 1) {
      const r = await h.post(cuerpoBueno());
      assert.strictEqual(r.status, 503, `apagado: la llamada ${i + 1} contesta ${r.status}`);
    }
  });
}

// ---- D10 · el turno del agente sigue como antes ----------------------------

async function d10() {
  // El módulo solo registra su propia ruta.
  const registradas = [];
  const appFalsa = { post: (ruta) => registradas.push(`POST ${ruta}`), get: (ruta) => registradas.push(`GET ${ruta}`), use: (ruta) => registradas.push(`USE ${typeof ruta === 'string' ? ruta : '(fn)'}`) };
  registerAgentDecisorRoutes(appFalsa, { decisorService: { modo: () => 'apagado', async decidir() { return { status: 503, json: {} }; } }, logger: { log() {} } });
  assert.deepStrictEqual(registradas, [`POST ${RUTA}`], `el decisor solo registra su ruta: ${registradas.join(' | ')}`);
  // Con las dos rutas montadas, el turno llega a su servicio con lo mismo de siempre.
  await con({ montarTurno: true }, async (h) => {
    const r = await h.postTurno({ goal: 'g', state: {} });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { session: 'S', done: true });
    assert.strictEqual(h.turnos.length, 1);
    assert.deepStrictEqual(h.turnos[0].body, { goal: 'g', state: {} });
  });
  // En el servidor real la ruta va DETRÁS de X-API-Key y se registra una sola vez.
  const server = fs.readFileSync(path.join(ROOT, 'web', 'server.js'), 'utf8');
  // Sin comentar: la línea tiene que estar viva (empezar en columna 0).
  const auth = server.search(/^app\.use\('\/api\/v1', requireApiKey\);/m);
  const registro = server.search(/^registerAgentDecisorRoutes\(app,/m);
  assert.ok(auth > 0, 'server.js protege /api/v1 con requireApiKey');
  assert.ok(registro > auth, 'registerAgentDecisorRoutes va después de requireApiKey');
  assert.strictEqual((server.match(/^registerAgentDecisorRoutes\(app,/gm) || []).length, 1, 'se registra una sola vez');
  // Y el contrato del turno (snapshot de Windows, plataforma Android) sigue verde por sí mismo.
  const corrida = spawnSync(process.execPath, [path.join(__dirname, 'verify-agent-platform.js')], { encoding: 'utf8' });
  assert.strictEqual(corrida.status, 0, `verify-agent-platform debe seguir verde:\n${`${corrida.stdout}${corrida.stderr}`.split('\n').slice(-6).join('\n')}`);
}

// ---- D3b · la excepción E11 dice la verdad de lo que sale --------------------

async function d3b() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'privacy-egress-gateway.md'), 'utf8');
  const fila = doc.split('\n').find((linea) => linea.startsWith('| **E11**'));
  assert.ok(fila, 'la fila E11 existe en docs/privacy-egress-gateway.md');
  const minusculas = fila.toLowerCase();
  // Lo que Graph NO puede afirmar: que las etiquetas no lleven nombres o asuntos.
  for (const [frase, porQue] of [
    ['nombrar personas', 'dice que las etiquetas PUEDEN nombrar personas o asuntos'],
    ['contactos', 'da ejemplos: contactos'],
    ['asuntos de correo', 'da ejemplos: asuntos de correo'],
    ['el teléfono es quien excluye', 'dice que el teléfono es quien excluye campos y apps sensibles'],
    ['no puede verificar', 'admite que Graph no puede verificarlo'],
    ['fuera del escudo', 'dice que va fuera del escudo de privacidad'],
    ['retención', 'dice que TypeSafe no publica política de retención'],
    ['apagado por defecto', 'dice que está apagado por defecto'],
    ['no se loguea', 'dice que no se loguea ningún valor']
  ]) {
    assert.ok(minusculas.includes(frase), `la fila E11 ${porQue} (falta «${frase}»)`);
  }
  // La promesa falsa de antes: Graph no puede garantizar que salgan «sin contenido».
  assert.ok(!minusculas.includes('sin campos de texto, sin contenido'), 'la fila E11 no promete «sin campos de texto, sin contenido»');
  // El comentario del código no puede prometer lo que la fila retiró.
  const codigo = fs.readFileSync(path.join(ROOT, 'src', 'domain', 'decisor', 'peticionSystemOne.js'), 'utf8').replace(/\s*\n\/\/\s*/g, ' ').toLowerCase();
  assert.ok(!codigo.includes('ni el título de una ventana') && !codigo.includes('contenido de un campo ni'), 'peticionSystemOne.js no promete «nunca el contenido de un campo ni el título de una ventana»');
  for (const frase of ['pueden nombrar personas o asuntos', 'el teléfono es quien excluye', 'no puede verificar el contenido']) {
    assert.ok(codigo.includes(frase), `el comentario PRIVACIDAD de peticionSystemOne.js dice «${frase}»`);
  }
}

// ---- Sonda · el guard del endpoint no deja la X-API-Key en claro ------------

async function guardDeLaSonda() {
  const { endpointSeguro } = require('./sonda-del-decisor-android');
  assert.strictEqual(typeof endpointSeguro, 'function', 'la sonda exporta endpointSeguro');
  for (const bueno of [
    'https://graph.example.com/api/v1/agent/decidir', 'https://graph.example.com', 'http://localhost:3000/api/v1/agent/decidir',
    'http://localhost', 'http://localhost/x', 'http://127.0.0.1:8080/x', 'http://[::1]:3000/x'
  ]) assert.strictEqual(endpointSeguro(bueno), true, `debe aceptar ${bueno}`);
  for (const malo of [
    'http://localhost.evil.com/x', 'http://127.0.0.1.evil.com/x', 'http://localhostx/', 'http://localhost@evil.com/x',
    'http://localhost:80@evil.com/', 'http://127.0.0.1:8080@evil.com/x', 'http://evil.com/localhost', 'http://evil.com/?h=127.0.0.1',
    'http://example.com/api', 'ftp://localhost/x', 'https://usuario:clave@graph.example.com/', 'localhost:3000', '', 'https://', 'javascript:alert(1)'
  ]) assert.strictEqual(endpointSeguro(malo), false, `debe rechazar ${malo}`);
}

async function main() {
  await check('D1 · apagado por defecto: sin ANDROID_DECISOR_ENABLED o sin key contesta 503 decisor_apagado sin llamar a TypeSafe', d1);
  await check('D2 · sin device_id 400; ausente o sin realtime_allowed 403; nunca se llama a TypeSafe', d2);
  await check('D3 · Graph arma el cuerpo de TypeSafe (3 preguntas, jev-latest, sin duplicados); la key solo en Authorization', d3);
  await check('D3b · la fila E11 del registro de excepciones dice lo que de verdad sale hacia TypeSafe', d3b);
  await check('D3c · un redirect de TypeSafe o del endpoint no reenvía la petición ni la key a otro origen (servicio y sonda)', d3c);
  await check('D4 · más de 64 puertas, puerta de más de 80, objetivo de más de 120 o cuerpo sin forma: 400 sin llamar a TypeSafe', d4);
  await check('D5 · 429 y 529 se reintentan (200/400 ms, 3 intentos, dentro de 1.800 ms); 401 y 422 no', d5);
  await check('D6 · los fallos de TypeSafe salen con su código estable', d6);
  await check('D7 · la respuesta lleva solo lo prometido y la elección es una de las enviadas', d7);
  await check('D8 · una línea por llamada con device_id enmascarado y cifras; nunca objetivo, etiquetas, elección ni key', d8);
  await check('D9 · 30 por minuto por dispositivo y tope global de Android: 429 limite_de_uso', d9);
  await check('D10 · /api/v1/agent/turn y verify-agent-platform siguen como antes', d10);
  await check('Sonda · el guard de --endpoint no acepta hosts que solo empiezan como localhost', guardDeLaSonda);
  console.log(`\nverify-agent-decisor: ${passed} checks ok, ${failed.length} fallidos`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
