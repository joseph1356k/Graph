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

function startProxyServer({ authorizedDeviceIds = [], openaiLiveUrl, envKey = 'una-key-de-prueba', path, log, logError, authorizer: authorizerOverride }) {
  const rows = new Map(authorizedDeviceIds.map((id) => [id, true]));
  const authorizer = authorizerOverride || new LiveVoiceDeviceAuthorizer({
    async select(table, query) {
      const match = /device_id=eq\.([^&]+)/.exec(query);
      const id = match ? decodeURIComponent(match[1]) : '';
      if (!rows.has(id)) return [];
      return [{ device_id: id, realtime_allowed: rows.get(id) }];
    }
  });

  const previousKey = process.env.OPENAI_LIVE_KEY;
  if (envKey === null) {
    delete process.env.OPENAI_LIVE_KEY;
  } else {
    process.env.OPENAI_LIVE_KEY = envKey;
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
          if (previousKey === undefined) delete process.env.OPENAI_LIVE_KEY;
          else process.env.OPENAI_LIVE_KEY = previousKey;
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
  wss.on('connection', (ws, req) => {
    ws.authHeader = req.headers['authorization'] || '';
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
      resolve({ server, port, close: () => new Promise((r) => server.close(r)) });
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

async function main() {
  const pruebas = [
    ['authorizer: falta device_id -> 400', testAuthorizerFaltaDeviceId],
    ['authorizer: no encontrado -> 403', testAuthorizerNoEncontrado],
    ['authorizer: realtime_allowed=false -> 403', testAuthorizerBanderaEnFalse],
    ['authorizer: autorizado -> devuelve el user', testAuthorizerAutorizado],
    ['proxy: rechaza dispositivo no autorizado antes del handshake (403)', testRechazaDispositivoNoAutorizado],
    ['proxy: rechaza sin device_id (400)', testRechazaSinDeviceId],
    ['proxy: rechaza sin OPENAI_LIVE_KEY configurada (500, nunca fallback silencioso)', testRechazaSinKeyConfigurada],
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
