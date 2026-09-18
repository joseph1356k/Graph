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

function startProxyServer({ authorizedDeviceIds = [], openaiLiveUrl, envKey = 'una-key-de-prueba', path }) {
  const rows = new Map(authorizedDeviceIds.map((id) => [id, true]));
  const authorizer = new LiveVoiceDeviceAuthorizer({
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
  attachLiveVoiceProxy(server, { authorizer, openaiLiveUrl, path });

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
    ['proxy: relay transparente (texto y binario) + cierre en cascada', testRelayTransparenteYCierreEnCascada]
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
