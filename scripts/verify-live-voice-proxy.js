// Proxy de voz Live (gpt-live-1) para Android: whitelist + relay WebSocket.
//
// Lo que se protege aquí:
//   1. LiveVoiceDeviceAuthorizer lee la MISMA whitelist que RealtimeSessionService
//      (graph_app_users.realtime_allowed) y rechaza sin device_id / no encontrado /
//      bandera en false.
//   2. attachLiveVoiceProxy rechaza el upgrade ANTES del handshake si el
//      dispositivo no está autorizado (el cliente ve un rechazo HTTP, no un
//      WebSocket abierto y cerrado después).
//   3. Con un dispositivo autorizado y un upstream falso (no pega a OpenAI de
//      verdad), el relay es transparente en las dos direcciones y cierra los
//      dos lados cuando cualquiera de los dos se cae.
//
//   node scripts/verify-live-voice-proxy.js
const assert = require('assert');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const LiveVoiceDeviceAuthorizer = require('../src/application/use-cases/LiveVoiceDeviceAuthorizer');
const attachLiveVoiceProxy = require('../web/api/liveVoiceProxy');

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

async function testAuthorizerFaltaDeviceId() {
  const authorizer = new LiveVoiceDeviceAuthorizer(fakeSupabase([]));
  await assert.rejects(
    () => authorizer.requireAuthorizedDevice(''),
    (error) => error.statusCode === 400
  );
}

async function testAuthorizerNoEncontrado() {
  const authorizer = new LiveVoiceDeviceAuthorizer(fakeSupabase([]));
  await assert.rejects(
    () => authorizer.requireAuthorizedDevice('dispositivo-1'),
    (error) => error.statusCode === 403
  );
}

async function testAuthorizerBanderaEnFalse() {
  const authorizer = new LiveVoiceDeviceAuthorizer(
    fakeSupabase([{ device_id: 'dispositivo-1', realtime_allowed: false }])
  );
  await assert.rejects(
    () => authorizer.requireAuthorizedDevice('dispositivo-1'),
    (error) => error.statusCode === 403
  );
}

async function testAuthorizerAutorizado() {
  const rest = fakeSupabase([{ device_id: 'dispositivo-1', realtime_allowed: true }]);
  const authorizer = new LiveVoiceDeviceAuthorizer(rest);
  const user = await authorizer.requireAuthorizedDevice('dispositivo-1');
  assert.strictEqual(user.realtime_allowed, true);
  assert.strictEqual(rest.llamadas.length, 1);
  assert.strictEqual(rest.llamadas[0].table, 'graph_app_users');
}

// ---- Helpers para levantar un server HTTP efímero con el proxy montado ----

// `envKey` es el valor de OPENAI_LIVE_KEY y `envKeyLower` el de openai_live_key
// (como se llama en el proyecto de Vercel); null = sin definir. Los dos se
// guardan y se restauran al cerrar, para que ninguna prueba dependa del entorno
// de quien la corre.
function startProxyServer({ authorizedDeviceIds = [], openaiLiveUrl, envKey = 'una-key-de-prueba', envKeyLower = null, path, log, logError, authorizer: authorizerOverride }) {
  const rows = new Map(authorizedDeviceIds.map((id) => [id, true]));
  const authorizer = authorizerOverride || new LiveVoiceDeviceAuthorizer({
    async select(table, query) {
      const match = /device_id=eq\.([^&]+)/.exec(query);
      const id = match ? decodeURIComponent(match[1]) : '';
      if (!rows.has(id)) return [];
      return [{ device_id: id, realtime_allowed: rows.get(id) }];
    }
  });

  const nombresDeKey = { OPENAI_LIVE_KEY: envKey, openai_live_key: envKeyLower };
  const previous = {};
  for (const nombre of Object.keys(nombresDeKey)) previous[nombre] = process.env[nombre];
  // Se borran los dos antes de escribir: en Windows process.env no distingue
  // mayúsculas y un delete posterior pisaría al otro nombre.
  for (const nombre of Object.keys(nombresDeKey)) delete process.env[nombre];
  for (const [nombre, valor] of Object.entries(nombresDeKey)) {
    if (valor !== null) process.env[nombre] = valor;
  }

  const server = http.createServer((req, res) => {
    res.writeHead(400).end('esperaba un WebSocket');
  });
  attachLiveVoiceProxy(server, { authorizer, openaiLiveUrl, path, log, logError });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => new Promise((r) => {
          for (const nombre of Object.keys(previous)) delete process.env[nombre];
          for (const [nombre, valor] of Object.entries(previous)) {
            if (valor !== undefined) process.env[nombre] = valor;
          }
          server.close(r);
        })
      });
    });
  });
}

// Servidor WS mínimo que hace de "OpenAI" en la prueba: eco transparente de
// lo que reciba, para verificar el relay en las dos direcciones.
function startFakeOpenAi() {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const authHeaders = []; // lo que OpenAI (falso) vio en cada conexión entrante
  wss.on('connection', (ws, req) => {
    ws.authHeader = req.headers['authorization'] || '';
    authHeaders.push(ws.authHeader);
    ws.on('message', (data, isBinary) => {
      if (data.toString() === 'HOLA_DESDE_ANDROID') {
        ws.send('HOLA_DESDE_OPENAI');
        return;
      }
      ws.send(data, { binary: isBinary });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, authHeaders, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function testRechazaDispositivoNoAutorizado() {
  const proxy = await startProxyServer({ authorizedDeviceIds: [] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=fantasma`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {}); // 'unexpected-response' ya cubre el rechazo; evita un throw no manejado
    });
    assert.strictEqual(resultado.rejected, true, 'el upgrade debía rechazarse antes del handshake');
    assert.strictEqual(resultado.statusCode, 403);
  } finally {
    await proxy.close();
  }
}

async function testRechazaSinDeviceId() {
  const proxy = await startProxyServer({ authorizedDeviceIds: [] });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {});
    });
    assert.strictEqual(resultado.rejected, true);
    assert.strictEqual(resultado.statusCode, 400);
  } finally {
    await proxy.close();
  }
}

async function testRechazaSinKeyConfigurada() {
  const proxy = await startProxyServer({ authorizedDeviceIds: ['dispositivo-1'], envKey: null });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=dispositivo-1`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {});
    });
    assert.strictEqual(resultado.rejected, true, 'sin OPENAI_LIVE_KEY no debe completar el handshake (nunca fallback silencioso)');
    assert.strictEqual(resultado.statusCode, 500);
  } finally {
    await proxy.close();
  }
}

// Regresión: en Vercel, la función que recibe el upgrade ve el path de
// DESTINO del rewrite (/api/android-live-session), no el que pidió el
// celular (/api/android/live/session) — mismo motivo por el que
// api/index.js reconstruye a mano el path original desde ?path=. Si
// attachLiveVoiceProxy no recibe el path explícito, compara contra su
// default (el de origen) y rechaza con 404 todo upgrade legítimo.
async function testAceptaConPathDeDestinoExplicito() {
  const openai = await startFakeOpenAi();
  const proxy = await startProxyServer({
    authorizedDeviceIds: ['dispositivo-1'],
    openaiLiveUrl: `ws://127.0.0.1:${openai.port}`,
    path: '/api/android-live-session' // el mismo override que usa api/android-live-session.js
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android-live-session?device_id=dispositivo-1`);
    const resultado = await new Promise((resolve, reject) => {
      ws.on('open', () => resolve({ opened: true }));
      ws.on('unexpected-response', (req, res) => resolve({ opened: false, statusCode: res.statusCode }));
      ws.on('error', reject);
    });
    assert.strictEqual(resultado.opened, true, 'con el path de destino configurado, el upgrade debía aceptarse');
    ws.close(1000, 'fin de prueba');
  } finally {
    await proxy.close();
    await openai.close();
  }
}

async function testAceptaAmbosPathsCuandoSePasaUnArray() {
  // Escenario real de producción (2026-09-18): un WebSocket upgrade real
  // contra Vercel no llegó con el path de destino del rewrite como se
  // asumía -- api/android-live-session.js ahora pasa los dos paths
  // posibles (origen y destino) en vez de apostar a uno solo.
  const openai = await startFakeOpenAi();
  const proxy = await startProxyServer({
    authorizedDeviceIds: ['dispositivo-1'],
    openaiLiveUrl: `ws://127.0.0.1:${openai.port}`,
    path: ['/api/android/live/session', '/api/android-live-session']
  });
  try {
    for (const ruta of ['/api/android/live/session', '/api/android-live-session']) {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}${ruta}?device_id=dispositivo-1`);
      const resultado = await new Promise((resolve, reject) => {
        ws.on('open', () => resolve({ opened: true }));
        ws.on('unexpected-response', (req, res) => resolve({ opened: false, statusCode: res.statusCode }));
        ws.on('error', reject);
      });
      assert.strictEqual(resultado.opened, true, `con un array de paths, «${ruta}» debía aceptarse`);
      ws.close(1000, 'fin de prueba');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Una ruta que NO está en el array sigue rechazándose.
    const wsAjeno = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/otra/cosa?device_id=dispositivo-1`);
    const resultadoAjeno = await new Promise((resolve, reject) => {
      wsAjeno.on('open', () => resolve({ opened: true }));
      wsAjeno.on('unexpected-response', (req, res) => resolve({ opened: false, statusCode: res.statusCode }));
      wsAjeno.on('error', reject);
    });
    assert.strictEqual(resultadoAjeno.opened, false, 'una ruta fuera del array debía rechazarse');
    assert.strictEqual(resultadoAjeno.statusCode, 404);
  } finally {
    await proxy.close();
    await openai.close();
  }
}

async function testRelayTransparenteYCierreEnCascada() {
  const openai = await startFakeOpenAi();
  const proxy = await startProxyServer({
    authorizedDeviceIds: ['dispositivo-1'],
    openaiLiveUrl: `ws://127.0.0.1:${openai.port}`
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=dispositivo-1`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const eco = new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
    ws.send('HOLA_DESDE_ANDROID');
    assert.strictEqual(await eco, 'HOLA_DESDE_OPENAI');

    // El backend nunca ve la key: sólo la usa al hablar con OpenAI. Verificamos
    // que SÍ llegó a OpenAI (no se perdió en el camino), sin loguearla.
    const binaryEco = new Promise((resolve) => ws.once('message', (data) => resolve(data)));
    const binario = Buffer.from([1, 2, 3, 4]);
    ws.send(binario);
    const recibidoBinario = await binaryEco;
    assert.ok(Buffer.compare(Buffer.from(recibidoBinario), binario) === 0, 'el binario debía volver intacto (tubería, no interpretación)');

    // Cierre en cascada: si el celular cierra, el lado de OpenAI también debe caer.
    const upstreamCerrado = new Promise((resolve) => {
      openai.server.on('close', () => {}); // noop, sólo referencia
    });
    ws.close(1000, 'fin de prueba');
    await new Promise((resolve) => setTimeout(resolve, 200));
    void upstreamCerrado;
  } finally {
    await proxy.close();
    await openai.close();
  }
}

// ---- El device_id no se escribe en claro en los logs ----

// UUID de telemetría del cliente Android 0.51+: 36 caracteres, es lo que
// autoriza la voz. El enmascarado esperado se escribe a mano (8 + …) para que
// la prueba no dependa del helper que verifica.
const DEVICE_ID_LARGO = '3f2b8c1e-9d4a-4e7b-a1c6-5d0e8f7a2b39';
const DEVICE_ID_ENMASCARADO = '3f2b8c1e…';

function capturarLogs() {
  const lineas = [];
  return {
    lineas,
    log: (...args) => lineas.push(args.join(' ')),
    logError: (...args) => lineas.push(args.join(' '))
  };
}

function assertSinIdCompleto(lineas, mensaje) {
  assert.ok(lineas.length > 0, `${mensaje}: no se capturó ninguna línea de log`);
  for (const linea of lineas) {
    assert.ok(!linea.includes(DEVICE_ID_LARGO), `${mensaje}: el device_id completo apareció en el log: ${linea}`);
  }
  assert.ok(
    lineas.some((linea) => linea.includes(DEVICE_ID_ENMASCARADO)),
    `${mensaje}: ninguna línea trae el id enmascarado «${DEVICE_ID_ENMASCARADO}»: ${JSON.stringify(lineas)}`
  );
}

async function testLogDeRechazoNoLlevaElIdCompleto() {
  const capturado = capturarLogs();
  const proxy = await startProxyServer({ authorizedDeviceIds: [], log: capturado.log, logError: capturado.logError });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=${DEVICE_ID_LARGO}`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {});
    });
    assert.strictEqual(resultado.rejected, true);
    assert.strictEqual(resultado.statusCode, 403, 'enmascarar el log no cambia el código que ve el cliente');
    assertSinIdCompleto(capturado.lineas, 'camino rechazado (403)');
  } finally {
    await proxy.close();
  }
}

async function testLogDeRechazoScrubbeaUnMensajeQueRepiteElId() {
  // Defensa en profundidad: si algún día un mensaje de error del authorizer o
  // de Supabase repite el id («dispositivo X no autorizado»), el log no lo filtra.
  const capturado = capturarLogs();
  const authorizer = {
    async requireAuthorizedDevice(deviceId) {
      const error = new Error(`el dispositivo ${deviceId} no está autorizado`);
      error.statusCode = 403;
      throw error;
    }
  };
  const proxy = await startProxyServer({ authorizer, log: capturado.log, logError: capturado.logError });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=${DEVICE_ID_LARGO}`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {});
    });
    assert.strictEqual(resultado.statusCode, 403);
    assertSinIdCompleto(capturado.lineas, 'mensaje de error que repite el id');
  } finally {
    await proxy.close();
  }
}

async function testLogDeRechazoSinDeviceIdDiceVacio() {
  const capturado = capturarLogs();
  const proxy = await startProxyServer({ authorizedDeviceIds: [], log: capturado.log, logError: capturado.logError });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session`);
    const resultado = await new Promise((resolve) => {
      ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
      ws.on('open', () => resolve({ rejected: false }));
      ws.on('error', () => {});
    });
    assert.strictEqual(resultado.statusCode, 400);
    assert.ok(
      capturado.lineas.some((linea) => linea.includes('device_id=(vacío)')),
      `sin device_id el log debía seguir diciendo (vacío): ${JSON.stringify(capturado.lineas)}`
    );
    // El mensaje sale INTACTO: sin el guard de scrubDeviceId, un id vacío hace
    // text.split('') y el log quedaría «F(vacío)a(vacío)l(vacío)…».
    assert.deepStrictEqual(
      capturado.lineas,
      ['[Live Voice Proxy] upgrade rechazado (device_id=(vacío)): Falta device_id.'],
      'con device_id vacío el mensaje «Falta device_id.» debía salir intacto'
    );
  } finally {
    await proxy.close();
  }
}

// Un device_id corto (3 a 7 caracteres) no es un id real, y si aparece DENTRO
// del mensaje de error no se toca el mensaje: sin el guard de scrubDeviceId,
// «dispo» dentro de «dispositivo no autorizado…» se reemplazaría por su
// enmascarado y el log quedaría ilegible. El enmascarado esperado se escribe a
// mano (mitad del id, máx. 8) para no depender del helper.
async function testLogDeRechazoConIdCortoNoDestrozaElMensaje() {
  const MENSAJE = 'dispositivo no autorizado para voz Live';
  const casos = [
    ['dis', 'd…'],
    ['disp', 'di…'],
    ['dispo', 'di…'],
    ['dispos', 'dis…'],
    ['disposi', 'dis…']
  ];
  for (const [idCorto, enmascarado] of casos) {
    const capturado = capturarLogs();
    const proxy = await startProxyServer({ authorizedDeviceIds: [], log: capturado.log, logError: capturado.logError });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=${idCorto}`);
      const resultado = await new Promise((resolve) => {
        ws.on('unexpected-response', (req, res) => resolve({ rejected: true, statusCode: res.statusCode }));
        ws.on('open', () => resolve({ rejected: false }));
        ws.on('error', () => {});
      });
      assert.strictEqual(resultado.statusCode, 403);
      assert.deepStrictEqual(
        capturado.lineas,
        [`[Live Voice Proxy] upgrade rechazado (device_id=${enmascarado}): ${MENSAJE}`],
        `id corto «${idCorto}»: el mensaje de error debía salir intacto`
      );
    } finally {
      await proxy.close();
    }
  }
}

async function testLogDelRelayNoLlevaElIdCompleto() {
  const capturado = capturarLogs();
  const openai = await startFakeOpenAi();
  const proxy = await startProxyServer({
    authorizedDeviceIds: [DEVICE_ID_LARGO],
    openaiLiveUrl: `ws://127.0.0.1:${openai.port}`,
    log: capturado.log,
    logError: capturado.logError
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/android/live/session?device_id=${DEVICE_ID_LARGO}`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('unexpected-response', (req, res) => reject(new Error(`el upgrade debía aceptarse (HTTP ${res.statusCode})`)));
      ws.on('error', reject);
    });
    const eco = new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
    ws.send('HOLA_DESDE_ANDROID');
    assert.strictEqual(await eco, 'HOLA_DESDE_OPENAI', 'enmascarar el log no cambia el relay');
    ws.close(1000, 'fin de prueba');

    // El log del relay se escribe al cerrar la sesión: se espera a que salga.
    const limite = Date.now() + 2000;
    while (capturado.lineas.length === 0 && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assertSinIdCompleto(capturado.lineas, 'camino autorizado (relay)');
  } finally {
    await proxy.close();
    await openai.close();
  }
}

async function testMaskDeviceId() {
  const { maskDeviceId } = attachLiveVoiceProxy;
  assert.strictEqual(typeof maskDeviceId, 'function', 'liveVoiceProxy debe exportar maskDeviceId');
  // vacío / ausente / sólo espacios -> (vacío), igual que el log de antes
  assert.strictEqual(maskDeviceId(''), '(vacío)');
  assert.strictEqual(maskDeviceId(undefined), '(vacío)');
  assert.strictEqual(maskDeviceId(null), '(vacío)');
  assert.strictEqual(maskDeviceId('   '), '(vacío)');
  // largo (UUID de 36): primeros 8 + …
  assert.strictEqual(maskDeviceId(DEVICE_ID_LARGO), DEVICE_ID_ENMASCARADO);
  assert.strictEqual(maskDeviceId(`  ${DEVICE_ID_LARGO}  `), DEVICE_ID_ENMASCARADO, 'mismo trim que el authorizer');
  // exactamente 8: mostrar «los primeros 8» sería el id completo -> nunca se muestra entero
  assert.strictEqual(maskDeviceId('12345678'), '1234…');
  // corto: como mucho la mitad, jamás el id entero
  assert.strictEqual(maskDeviceId('abcdef'), 'abc…');
  assert.strictEqual(maskDeviceId('ab'), 'a…');
  assert.strictEqual(maskDeviceId('a'), '…');
  for (const corto of ['a', 'ab', 'abc', 'dispositivo-1', 'fantasma', '0123456789abcdef']) {
    assert.ok(!maskDeviceId(corto).includes(corto), `«${corto}» no puede salir entero`);
  }
}

// ---- La key se lee de OPENAI_LIVE_KEY u openai_live_key ----
//
// En el proyecto de Vercel la variable está cargada como `openai_live_key`
// (minúsculas, tipo sensible: Vercel no deja renombrarla) y en Vercel los
// nombres distinguen mayúsculas. El proxy acepta los dos; si están los dos gana
// OPENAI_LIVE_KEY. La key es un secreto: nunca sale en un log ni en una respuesta.

// Valores canarios: si cualquiera aparece en un log, un header o un cuerpo, la
// prueba falla. Uno por nombre, para que una fuga de cualquiera de los dos se vea.
const CANARIO_MAYUS = 'sk-canario-MAYUS-4f9a1c7e2b';
const CANARIO_MINUS = 'sk-canario-minus-8d2e7b5a90';
const MENSAJE_SIN_KEY = '[Live Voice Proxy] OPENAI_LIVE_KEY u openai_live_key no configurada';

function assertSinCanario(vistos, mensaje) {
  assert.ok(vistos.length > 0, `${mensaje}: no se capturó nada que revisar (la prueba sería vacía)`);
  for (const visto of vistos) {
    for (const canario of [CANARIO_MAYUS, CANARIO_MINUS]) {
      assert.ok(!visto.includes(canario), `${mensaje}: el valor de la key apareció en: ${visto}`);
    }
  }
}

// Abre un upgrade y devuelve todo lo que el cliente pudo ver del proxy: estado,
// headers, cuerpo y (si el handshake se completa) el eco de un mensaje.
function observarUpgrade(port, ruta) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${ruta}`);
  const visto = { abrio: false, statusCode: null, headers: {}, cuerpo: '', recibidos: [] };
  return new Promise((resolve, reject) => {
    const guardia = setTimeout(() => reject(new Error(`el upgrade a ${ruta} no terminó en 3 s`)), 3000);
    const listo = () => { clearTimeout(guardia); resolve(visto); };
    ws.on('upgrade', (res) => { visto.headers = res.headers; });
    ws.on('open', () => {
      visto.abrio = true;
      ws.once('message', (data) => {
        visto.recibidos.push(data.toString());
        ws.close(1000, 'fin de prueba');
      });
      ws.send('HOLA_DESDE_ANDROID');
    });
    ws.on('close', listo);
    ws.on('unexpected-response', (req, res) => {
      visto.statusCode = res.statusCode;
      visto.headers = res.headers;
      res.on('data', (trozo) => { visto.cuerpo += trozo.toString(); });
      res.on('end', listo);
      res.on('close', listo);
      res.on('error', listo);
    });
    ws.on('error', () => {}); // el rechazo ya llega por 'unexpected-response'
  });
}

async function esperarLineas(capturado) {
  const limite = Date.now() + 2000;
  while (capturado.lineas.length === 0 && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function testReadLiveKey() {
  const { readLiveKey } = attachLiveVoiceProxy;
  assert.strictEqual(typeof readLiveKey, 'function', 'liveVoiceProxy debe exportar readLiveKey');
  assert.strictEqual(readLiveKey({}), '', 'sin ninguna: vacío');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: 'MAYUS' }), 'MAYUS', 'solo mayúsculas');
  assert.strictEqual(readLiveKey({ openai_live_key: 'minus' }), 'minus', 'solo minúsculas (el caso de Vercel)');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: 'MAYUS', openai_live_key: 'minus' }), 'MAYUS', 'ambas: gana la de mayúsculas');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: '   ', openai_live_key: 'minus' }), 'minus', 'mayúsculas solo espacios: cae a minúsculas');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: '', openai_live_key: 'minus' }), 'minus', 'mayúsculas vacía: cae a minúsculas');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: undefined, openai_live_key: 'minus' }), 'minus', 'mayúsculas ausente: cae a minúsculas');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: '  ', openai_live_key: '\t\n' }), '', 'las dos solo espacios: vacío');
  assert.strictEqual(readLiveKey({ OPENAI_LIVE_KEY: ' MAYUS \n' }), 'MAYUS', 'se recorta (mayúsculas)');
  assert.strictEqual(readLiveKey({ openai_live_key: '\tminus ' }), 'minus', 'se recorta (minúsculas)');
}

// Cada caso pasa por el upgrade completo: lo que cuenta es la key con la que el
// proxy le habla a OpenAI (el fake anota el Authorization que recibe).
async function testUsaLaKeyDelNombreQueCorresponde() {
  const casos = [
    ['solo OPENAI_LIVE_KEY', { upper: CANARIO_MAYUS, lower: null }, CANARIO_MAYUS],
    ['solo openai_live_key (como está en Vercel)', { upper: null, lower: CANARIO_MINUS }, CANARIO_MINUS],
    ['ambas: gana OPENAI_LIVE_KEY', { upper: CANARIO_MAYUS, lower: CANARIO_MINUS }, CANARIO_MAYUS],
    ['OPENAI_LIVE_KEY solo espacios + openai_live_key', { upper: '   ', lower: CANARIO_MINUS }, CANARIO_MINUS],
    ['OPENAI_LIVE_KEY vacía + openai_live_key', { upper: '', lower: CANARIO_MINUS }, CANARIO_MINUS],
    ['la key se recorta antes de mandarla', { upper: `  ${CANARIO_MAYUS}\n`, lower: null }, CANARIO_MAYUS]
  ];
  for (const [nombre, { upper, lower }, esperada] of casos) {
    // En Windows process.env no distingue mayúsculas: dos nombres a la vez no
    // se pueden representar. Esos casos los cubre testReadLiveKey con objetos planos.
    if (process.platform === 'win32' && upper !== null && lower !== null) continue;
    const capturado = capturarLogs();
    const openai = await startFakeOpenAi();
    const proxy = await startProxyServer({
      authorizedDeviceIds: ['dispositivo-1'],
      openaiLiveUrl: `ws://127.0.0.1:${openai.port}`,
      envKey: upper,
      envKeyLower: lower,
      log: capturado.log,
      logError: capturado.logError
    });
    try {
      const visto = await observarUpgrade(proxy.port, '/api/android/live/session?device_id=dispositivo-1');
      assert.strictEqual(visto.abrio, true, `${nombre}: el upgrade debía aceptarse (HTTP ${visto.statusCode})`);
      assert.deepStrictEqual(visto.recibidos, ['HOLA_DESDE_OPENAI'], `${nombre}: el relay debía funcionar`);
      assert.deepStrictEqual(openai.authHeaders, [`Bearer ${esperada}`], `${nombre}: key equivocada hacia OpenAI`);
      await esperarLineas(capturado); // el log del relay sale al cerrar
      assertSinCanario(
        [...capturado.lineas, JSON.stringify(visto.headers), ...visto.recibidos],
        `${nombre} (camino autorizado)`
      );
    } finally {
      await proxy.close();
      await openai.close();
    }
  }
}

async function testSinKeyOSoloEspaciosDa500ConLogSinValor() {
  const casos = [
    ['ninguna', null, null],
    ['OPENAI_LIVE_KEY solo espacios', '   \t ', null],
    ['openai_live_key solo espacios', null, ' \n '],
    ['las dos solo espacios', '  ', '\t'],
    ['las dos vacías', '', '']
  ];
  for (const [nombre, upper, lower] of casos) {
    if (process.platform === 'win32' && upper !== null && lower !== null) continue; // ver arriba
    const capturado = capturarLogs();
    const openai = await startFakeOpenAi();
    const proxy = await startProxyServer({
      authorizedDeviceIds: ['dispositivo-1'],
      openaiLiveUrl: `ws://127.0.0.1:${openai.port}`,
      envKey: upper,
      envKeyLower: lower,
      log: capturado.log,
      logError: capturado.logError
    });
    try {
      const visto = await observarUpgrade(proxy.port, '/api/android/live/session?device_id=dispositivo-1');
      assert.strictEqual(visto.abrio, false, `${nombre}: sin key no debe completar el handshake`);
      assert.strictEqual(visto.statusCode, 500, `${nombre}: el código que ve el cliente no cambia`);
      assert.strictEqual(visto.cuerpo, '', `${nombre}: la respuesta no lleva cuerpo`);
      assert.deepStrictEqual(openai.authHeaders, [], `${nombre}: no debe conectarse a OpenAI sin key`);
      // La línea entera, palabra por palabra: nombra los dos nombres y no lleva
      // ningún valor (ni siquiera los espacios de una variable «vacía»).
      assert.deepStrictEqual(capturado.lineas, [MENSAJE_SIN_KEY], `${nombre}: el log debía nombrar ambos nombres y nada más`);
    } finally {
      await proxy.close();
      await openai.close();
    }
  }
}

async function testElValorDeLaKeyNoSaleEnElCaminoRechazado() {
  // Con las dos keys cargadas y un dispositivo NO autorizado, el proxy rechaza
  // (403) sin tocar la key: ni el log ni la respuesta pueden llevar su valor.
  const capturado = capturarLogs();
  const proxy = await startProxyServer({
    authorizedDeviceIds: [],
    envKey: CANARIO_MAYUS,
    envKeyLower: CANARIO_MINUS,
    log: capturado.log,
    logError: capturado.logError
  });
  try {
    const visto = await observarUpgrade(proxy.port, '/api/android/live/session?device_id=fantasma');
    assert.strictEqual(visto.statusCode, 403);
    assertSinCanario(
      [...capturado.lineas, JSON.stringify(visto.headers), visto.cuerpo || '(sin cuerpo)'],
      'camino rechazado (403)'
    );
  } finally {
    await proxy.close();
  }
}

async function main() {
  const pruebas = [
    ['authorizer: falta device_id -> 400', testAuthorizerFaltaDeviceId],
    ['authorizer: no encontrado -> 403', testAuthorizerNoEncontrado],
    ['authorizer: realtime_allowed=false -> 403', testAuthorizerBanderaEnFalse],
    ['authorizer: autorizado -> devuelve el user', testAuthorizerAutorizado],
    ['proxy: rechaza dispositivo no autorizado antes del handshake (403)', testRechazaDispositivoNoAutorizado],
    ['proxy: rechaza sin device_id (400)', testRechazaSinDeviceId],
    ['proxy: rechaza sin OPENAI_LIVE_KEY configurada (500, nunca fallback silencioso)', testRechazaSinKeyConfigurada],
    ['readLiveKey: mayúsculas, minúsculas, ambas, vacías y espacios', testReadLiveKey],
    ['proxy: usa OPENAI_LIVE_KEY u openai_live_key (gana la de mayúsculas) y la manda a OpenAI', testUsaLaKeyDelNombreQueCorresponde],
    ['proxy: sin key (o solo espacios) -> 500 y el log nombra ambos nombres, sin valor', testSinKeyOSoloEspaciosDa500ConLogSinValor],
    ['proxy: el valor de la key no sale en logs ni respuesta (camino rechazado)', testElValorDeLaKeyNoSaleEnElCaminoRechazado],
    ['proxy: acepta con el path de destino de Vercel (regresión rewrite)', testAceptaConPathDeDestinoExplicito],
    ['proxy: acepta ambos paths cuando se pasa un array (regresión producción)', testAceptaAmbosPathsCuandoSePasaUnArray],
    ['proxy: relay transparente (texto y binario) + cierre en cascada', testRelayTransparenteYCierreEnCascada],
    ['log: el rechazo (403) no lleva el device_id completo, sí el enmascarado', testLogDeRechazoNoLlevaElIdCompleto],
    ['log: un mensaje de error que repite el id tampoco lo filtra', testLogDeRechazoScrubbeaUnMensajeQueRepiteElId],
    ['log: sin device_id el rechazo sigue diciendo (vacío) y el mensaje sale intacto', testLogDeRechazoSinDeviceIdDiceVacio],
    ['log: un id corto (3-7) dentro del mensaje de error no lo destroza', testLogDeRechazoConIdCortoNoDestrozaElMensaje],
    ['log: el cierre del relay autorizado no lleva el device_id completo', testLogDelRelayNoLlevaElIdCompleto],
    ['maskDeviceId: vacío, corto y largo', testMaskDeviceId]
  ];

  for (const [nombre, fn] of pruebas) {
    process.stdout.write(`- ${nombre} ... `);
    await fn();
    console.log('OK');
  }
  console.log(`\n${pruebas.length} pruebas OK — proxy de voz Live.`);
}

main().catch((error) => {
  console.error('\nFALLÓ:', error);
  process.exit(1);
});
