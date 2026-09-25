// Token efímero de voz Realtime (gpt-realtime) para Android: RealtimeSessionService.
//
// Lo que se protege aquí es lo que afirma la fila E13 de docs/privacy-egress-gateway.md:
//   1. A OpenAI sólo sale la configuración de la sesión (tipo y modelo): ni el
//      device_id, ni audio, ni texto.
//   2. Un dispositivo fuera de la whitelist no llega nunca a OpenAI.
//   3. El client_secret vuelve al celular y NO se escribe en ningún log —tampoco
//      cuando OpenAI contesta con una forma que Graph no reconoce: ahí el cuerpo
//      crudo puede llevar el secreto y no se loguea—, ni en el servicio ni en la ruta.
//   4. La key real del servidor no sale en ninguna respuesta ni en ningún log.
//
//   node scripts/verify-realtime-session.js
const assert = require('assert');

const RealtimeSessionService = require('../src/application/use-cases/RealtimeSessionService');
const registerRealtimeSessionRoutes = require('../web/api/registerRealtimeSessionRoutes');

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const KEY_DEL_SERVIDOR = 'sk-canario-de-servidor-0001';
const SECRETO_FELIZ = 'ek_secreto_de_prueba_feliz';
const CANARIO = 'ek_CANARIO_secreto_7f3a9c';
const DEVICE_ID = 'dispositivo-de-prueba-0123456789';

function fakeSupabase(rows) {
  const llamadas = [];
  return {
    llamadas,
    async select(table, query) {
      llamadas.push({ table, query });
      return rows;
    }
  };
}

function fakeFetch({ status = 200, body }) {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, async text() { return text; } };
  };
  fn.llamadas = llamadas;
  return fn;
}

function servicio({ rows = [{ device_id: DEVICE_ID, realtime_allowed: true }], fetchBody, fetchStatus }) {
  const fetch = fakeFetch({ status: fetchStatus, body: fetchBody });
  const supabase = fakeSupabase(rows);
  return { service: new RealtimeSessionService(supabase, { fetch }), fetch, supabase };
}

// Ejecuta `fn` con console.* capturado: devuelve todo lo que se escribió a un
// log, más el resultado o el error. La consola se restaura antes de afirmar nada.
async function conLogs(fn) {
  const lineas = [];
  const originales = {};
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug']) {
    originales[metodo] = console[metodo];
    console[metodo] = (...args) => {
      lineas.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    };
  }
  let resultado;
  let error;
  try {
    resultado = await fn();
  } catch (e) {
    error = e;
  } finally {
    for (const metodo of Object.keys(originales)) console[metodo] = originales[metodo];
  }
  return { lineas, resultado, error };
}

function sinEnLogs(lineas, prohibido, contexto) {
  for (const linea of lineas) {
    assert.ok(!linea.includes(prohibido), `${contexto}: «${prohibido}» salió en un log: ${linea}`);
  }
}

async function testAOpenAiSoloSaleLaConfigDeSesion() {
  const { service, fetch } = servicio({ fetchBody: { value: SECRETO_FELIZ, expires_at: 1234 } });
  const { resultado, error } = await conLogs(() => service.createSession(DEVICE_ID));
  assert.ifError(error);
  assert.deepStrictEqual(resultado, { client_secret: SECRETO_FELIZ, expires_at: 1234 });
  assert.strictEqual(fetch.llamadas.length, 1);
  const { url, init } = fetch.llamadas[0];
  assert.strictEqual(url, CLIENT_SECRETS_URL);
  assert.strictEqual(init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(init.body), { session: { type: 'realtime', model: 'gpt-realtime' } });
  assert.ok(!init.body.includes(DEVICE_ID), 'el device_id no viaja a OpenAI');
  assert.strictEqual(init.headers.Authorization, `Bearer ${KEY_DEL_SERVIDOR}`);
}

async function testFueraDeLaWhitelistNoLlegaAOpenAi() {
  for (const rows of [[], [{ device_id: DEVICE_ID, realtime_allowed: false }]]) {
    const { service, fetch } = servicio({ rows, fetchBody: { value: SECRETO_FELIZ } });
    const { error } = await conLogs(() => service.createSession(DEVICE_ID));
    assert.strictEqual(error && error.statusCode, 403);
    assert.strictEqual(fetch.llamadas.length, 0, 'sin autorización no hay llamada a OpenAI');
  }
  const { service, fetch } = servicio({ fetchBody: { value: SECRETO_FELIZ } });
  const { error } = await conLogs(() => service.createSession(''));
  assert.strictEqual(error && error.statusCode, 400);
  assert.strictEqual(fetch.llamadas.length, 0);
}

async function testElSecretoNoVaAlLogEnElCaminoFeliz() {
  const { service } = servicio({ fetchBody: { value: SECRETO_FELIZ, expires_at: 1234 } });
  const { lineas, error } = await conLogs(() => service.createSession(DEVICE_ID));
  assert.ifError(error);
  sinEnLogs(lineas, SECRETO_FELIZ, 'camino feliz');
  sinEnLogs(lineas, KEY_DEL_SERVIDOR, 'camino feliz');
}

// El caso que importa: OpenAI contesta 200 pero con una forma que Graph no sabe
// leer (el secreto viene bajo otra clave, o el cuerpo ni siquiera es JSON). Ahí
// se falla con 502 y el cuerpo crudo —que lleva el secreto— no puede ir al log.
async function testCuerpoDesconocidoNoSeLoguea() {
  const cuerpos = [
    ['secreto bajo una clave que Graph no conoce', { token_nuevo: CANARIO, expires_at: 1234 }],
    ['cuerpo que no es JSON', CANARIO]
  ];
  for (const [nombre, fetchBody] of cuerpos) {
    const { service } = servicio({ fetchBody });
    const { lineas, error } = await conLogs(() => service.createSession(DEVICE_ID));
    assert.strictEqual(error && error.statusCode, 502, nombre);
    assert.ok(!error.message.includes(CANARIO), `${nombre}: el error tampoco lo lleva`);
    sinEnLogs(lineas, CANARIO, nombre);
    sinEnLogs(lineas, KEY_DEL_SERVIDOR, nombre);
    assert.ok(
      lineas.some((linea) => linea.includes('client_secret') && linea.includes('200')),
      `${nombre}: el log sigue diciendo qué pasó (sin client_secret, status 200)`
    );
  }
}

async function testErrorDeOpenAiSeLogueaSinSecretosYSale502() {
  const { service } = servicio({
    fetchStatus: 401,
    fetchBody: { error: { message: 'Incorrect API key provided.' } }
  });
  const { lineas, error } = await conLogs(() => service.createSession(DEVICE_ID));
  assert.strictEqual(error && error.statusCode, 502);
  assert.strictEqual(error.message, 'Incorrect API key provided.');
  assert.ok(lineas.some((linea) => linea.includes('401') && linea.includes('Incorrect API key provided.')));
  sinEnLogs(lineas, KEY_DEL_SERVIDOR, 'error de OpenAI');
}

function montarRuta(service) {
  const rutas = {};
  registerRealtimeSessionRoutes({ post(path, handler) { rutas[path] = handler; } }, { realtimeSessionService: service });
  const handler = rutas['/api/android/realtime/session'];
  assert.ok(handler, 'la ruta pública del token está registrada');
  return async (body) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    await handler({ body }, res);
    return res;
  };
}

async function testLaRutaTampocoFiltraElSecreto() {
  const feliz = servicio({ fetchBody: { value: SECRETO_FELIZ, expires_at: 1234 } });
  const respuestaFeliz = await conLogs(() => montarRuta(feliz.service)({ device_id: DEVICE_ID }));
  assert.ifError(respuestaFeliz.error);
  assert.strictEqual(respuestaFeliz.resultado.statusCode, 200);
  assert.deepStrictEqual(respuestaFeliz.resultado.body, { client_secret: SECRETO_FELIZ, expires_at: 1234 });
  sinEnLogs(respuestaFeliz.lineas, SECRETO_FELIZ, 'ruta, camino feliz');
  sinEnLogs(respuestaFeliz.lineas, KEY_DEL_SERVIDOR, 'ruta, camino feliz');

  const raro = servicio({ fetchBody: { token_nuevo: CANARIO } });
  const respuestaRara = await conLogs(() => montarRuta(raro.service)({ device_id: DEVICE_ID }));
  assert.ifError(respuestaRara.error);
  assert.strictEqual(respuestaRara.resultado.statusCode, 502);
  assert.ok(!JSON.stringify(respuestaRara.resultado.body).includes(CANARIO), 'la respuesta al celular no lleva el cuerpo crudo');
  assert.ok(!JSON.stringify(respuestaRara.resultado.body).includes(KEY_DEL_SERVIDOR), 'la respuesta al celular no lleva la key del servidor');
  sinEnLogs(respuestaRara.lineas, CANARIO, 'ruta, cuerpo desconocido');
  sinEnLogs(respuestaRara.lineas, KEY_DEL_SERVIDOR, 'ruta, cuerpo desconocido');
}

async function main() {
  const pruebas = [
    ['a OpenAI sólo sale la config de sesión: sin device_id, con la key del servidor', testAOpenAiSoloSaleLaConfigDeSesion],
    ['fuera de la whitelist (o sin device_id) no hay llamada a OpenAI', testFueraDeLaWhitelistNoLlegaAOpenAi],
    ['el client_secret y la key del servidor no van a ningún log (camino feliz)', testElSecretoNoVaAlLogEnElCaminoFeliz],
    ['cuerpo que Graph no reconoce: 502 y el cuerpo crudo no va al log ni al error', testCuerpoDesconocidoNoSeLoguea],
    ['error de OpenAI: 502, se loguea el status y su mensaje, sin la key', testErrorDeOpenAiSeLogueaSinSecretosYSale502],
    ['la ruta: respuesta con el secreto solo al celular, ni un log lo lleva', testLaRutaTampocoFiltraElSecreto]
  ];

  const keyPrevia = process.env.OPENAI_REALTIME_KEY;
  process.env.OPENAI_REALTIME_KEY = KEY_DEL_SERVIDOR;
  try {
    for (const [nombre, fn] of pruebas) {
      process.stdout.write(`- ${nombre} ... `);
      await fn();
      console.log('OK');
    }
  } finally {
    if (keyPrevia === undefined) delete process.env.OPENAI_REALTIME_KEY;
    else process.env.OPENAI_REALTIME_KEY = keyPrevia;
  }
  console.log(`\n${pruebas.length} pruebas OK — token efímero de voz Realtime.`);
}

main().catch((error) => {
  console.error('\nFALLÓ:', error);
  process.exit(1);
});
