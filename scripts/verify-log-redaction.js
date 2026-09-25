// Los logs no escriben el device_id completo — ni el del proxy de voz Live ni el
// que viaja en la URL de un request HTTP.
//
// Por qué importa: desde el cliente Android 0.51 el device_id es el UUID de
// telemetría, o sea el valor que AUTORIZA la voz Live (graph_app_users.device_id
// + realtime_allowed) y gasta el OpenAI de Live. `GET /api/android/users/<id>/logs`
// (panel de Provider Studio) lo lleva en el path, y el middleware `[HTTP]` de
// web/server.js escribía la URL entera de cada request en los logs de Vercel.
//
// Lo que se protege aquí:
//   1. redactUrlForLog: el valor de `device_id=` en la query sale enmascarado
//      (primeros 8 + …), y cualquier segmento de path con forma de UUID también;
//      el resto de la URL queda byte a byte igual.
//   2. web/server.js usa el helper en su línea `[HTTP]` (lectura de fuente, en el
//      estilo de verify-egress-gateway.js) y ninguna línea de log del árbol
//      interpola req.url / req.originalUrl sin pasar por él.
//
//   node scripts/verify-log-redaction.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { redactUrlForLog } = require('../web/api/logRedaction');

const ROOT = path.join(__dirname, '..');

// El enmascarado esperado se escribe a mano (8 + …), no se calcula con el
// helper que se verifica.
const UUID = '3f2b8c1e-9d4a-4e7b-a1c6-5d0e8f7a2b39';
const UUID_ENMASCARADO = '3f2b8c1e…';
const OTRO_UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTRO_ENMASCARADO = '0a1b2c3d…';

function testConQuery() {
  assert.strictEqual(
    redactUrlForLog(`/api/android/live/session?device_id=${UUID}`),
    `/api/android/live/session?device_id=${UUID_ENMASCARADO}`
  );
  // con otros parámetros antes y después: sólo cambia el valor de device_id
  assert.strictEqual(
    redactUrlForLog(`/api/x?a=1&device_id=${UUID}&limit=300`),
    `/api/x?a=1&device_id=${UUID_ENMASCARADO}&limit=300`
  );
  // repetido: se enmascaran todos
  assert.strictEqual(
    redactUrlForLog(`/api/x?device_id=${UUID}&device_id=${OTRO_UUID}`),
    `/api/x?device_id=${UUID_ENMASCARADO}&device_id=${OTRO_ENMASCARADO}`
  );
  // vacío: se dice igual que el log del proxy
  assert.strictEqual(redactUrlForLog('/api/x?device_id='), '/api/x?device_id=(vacío)');
  assert.strictEqual(redactUrlForLog('/api/x?device_id=&a=1'), '/api/x?device_id=(vacío)&a=1');
  // codificado en la URL: se enmascara el id real, no la forma codificada
  assert.strictEqual(
    redactUrlForLog(`/api/x?device_id=${encodeURIComponent(UUID)}`),
    `/api/x?device_id=${UUID_ENMASCARADO}`
  );
  // corto: nunca sale entero (misma regla que maskDeviceId)
  assert.strictEqual(redactUrlForLog('/api/x?device_id=abc'), '/api/x?device_id=a…');
  // una clave que sólo TERMINA en device_id no es device_id
  assert.strictEqual(redactUrlForLog('/api/x?old_device_id=abc'), '/api/x?old_device_id=abc');
  // el resto de la query no se toca, aunque lleve un UUID
  assert.strictEqual(redactUrlForLog(`/api/x?prompt=${UUID}`), `/api/x?prompt=${UUID}`);
  for (const url of [`/api/x?device_id=${UUID}`, `/api/x?a=1&device_id=${UUID}&b=2`]) {
    assert.ok(!redactUrlForLog(url).includes(UUID), `el id completo salió en: ${redactUrlForLog(url)}`);
  }
}

function testConUuidEnElPath() {
  // la ruta real del panel: GET /api/android/users/:deviceId/logs
  assert.strictEqual(
    redactUrlForLog(`/api/android/users/${UUID}/logs?limit=300`),
    `/api/android/users/${UUID_ENMASCARADO}/logs?limit=300`
  );
  // UUID como último segmento
  assert.strictEqual(
    redactUrlForLog(`/api/android/users/${UUID}`),
    `/api/android/users/${UUID_ENMASCARADO}`
  );
  // sin distinguir mayúsculas: se conservan los 8 primeros tal cual venían
  assert.strictEqual(
    redactUrlForLog(`/api/android/users/${UUID.toUpperCase()}/prompts`),
    `/api/android/users/${UUID_ENMASCARADO.toUpperCase()}/prompts`
  );
  // varios segmentos UUID seguidos
  assert.strictEqual(
    redactUrlForLog(`/a/${UUID}/${OTRO_UUID}/b`),
    `/a/${UUID_ENMASCARADO}/${OTRO_ENMASCARADO}/b`
  );
  assert.ok(!redactUrlForLog(`/api/android/users/${UUID}/logs`).includes(UUID));
}

function testConAmbos() {
  assert.strictEqual(
    redactUrlForLog(`/api/android/users/${UUID}/logs?limit=300&device_id=${OTRO_UUID}`),
    `/api/android/users/${UUID_ENMASCARADO}/logs?limit=300&device_id=${OTRO_ENMASCARADO}`
  );
}

function testSinNadaQueEnmascarar() {
  const intactas = [
    '',
    '/',
    '/api/android/users',
    '/api/v1/organizer/organize?limit=5&a=b',
    '/api/android/live/session',
    '/miracle/voice-lab',
    // casi UUID, pero no lo es: un carácter menos, un carácter no hex, o incrustado en otro token
    '/x/3f2b8c1e-9d4a-4e7b-a1c6-5d0e8f7a2b3',
    '/x/3f2b8c1e-9d4a-4e7b-a1c6-5d0e8f7a2b3g',
    `/x/prefijo-${UUID}`,
    `/x/${UUID}-sufijo`
  ];
  for (const url of intactas) {
    assert.strictEqual(redactUrlForLog(url), url, `«${url}» no tiene nada que enmascarar y debía salir idéntica`);
  }
  assert.strictEqual(redactUrlForLog(undefined), '');
  assert.strictEqual(redactUrlForLog(null), '');
}

// ---- web/server.js usa el helper (lectura de fuente) ----

function leerFuente(relativo) {
  return fs.readFileSync(path.join(ROOT, relativo), 'utf8');
}

function testServerUsaElHelperEnSuLineaHttp() {
  const fuente = leerFuente(path.join('web', 'server.js'));
  assert.match(
    fuente,
    /require\('\.\/api\/logRedaction'\)/,
    'web/server.js debía importar ./api/logRedaction'
  );
  const lineasHttp = fuente.split('\n').filter((linea) => linea.includes('[HTTP]'));
  assert.strictEqual(lineasHttp.length, 1, `esperaba una sola línea «[HTTP]» en server.js: ${JSON.stringify(lineasHttp)}`);
  assert.match(
    lineasHttp[0],
    /console\.log\(`\[HTTP\] \$\{req\.method\} \$\{redactUrlForLog\(req\.url\)\}`\)/,
    `la línea [HTTP] debía loguear redactUrlForLog(req.url): ${lineasHttp[0].trim()}`
  );
}

function archivosJs(relativo) {
  const absoluto = path.join(ROOT, relativo);
  if (!fs.existsSync(absoluto)) return [];
  const stat = fs.statSync(absoluto);
  if (stat.isFile()) return relativo.endsWith('.js') ? [relativo] : [];
  return fs.readdirSync(absoluto).flatMap((nombre) => (
    nombre === 'node_modules' || nombre === 'public' ? [] : archivosJs(path.join(relativo, nombre))
  ));
}

// Que otra ruta no reabra la fuga: ninguna línea que ESCRIBE un log interpola
// req.url / req.originalUrl sin pasar por redactUrlForLog. (Un redirect que
// arma un `next=` con la URL no es un log, y no entra.)
function testNingunLogInterpolaLaUrlSinRedactar() {
  const LOGGER = /console\.(log|info|warn|error|debug)\(|logError\(|logger\.[a-z]+\(/;
  const URL_CRUDA = /req\.(url|originalUrl)\b/;
  const arboles = [path.join('web', 'server.js'), path.join('web', 'api'), 'api', 'src'];
  const culpables = [];
  for (const archivo of arboles.flatMap(archivosJs)) {
    fuenteLineas(archivo).forEach((linea, i) => {
      if (LOGGER.test(linea) && URL_CRUDA.test(linea) && !linea.includes('redactUrlForLog')) {
        culpables.push(`${archivo}:${i + 1}: ${linea.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(culpables, [], `logs que interpolan la URL cruda:\n${culpables.join('\n')}`);
}

function fuenteLineas(relativo) {
  return leerFuente(relativo).split('\n');
}

function main() {
  const pruebas = [
    ['redactUrlForLog: device_id en la query', testConQuery],
    ['redactUrlForLog: UUID en el path', testConUuidEnElPath],
    ['redactUrlForLog: UUID en el path y device_id en la query', testConAmbos],
    ['redactUrlForLog: sin nada que enmascarar, la URL sale idéntica', testSinNadaQueEnmascarar],
    ['web/server.js: la línea [HTTP] loguea redactUrlForLog(req.url)', testServerUsaElHelperEnSuLineaHttp],
    ['árbol: ningún log interpola req.url / req.originalUrl sin redactar', testNingunLogInterpolaLaUrlSinRedactar]
  ];

  for (const [nombre, fn] of pruebas) {
    process.stdout.write(`- ${nombre} ... `);
    fn();
    console.log('OK');
  }
  console.log(`\n${pruebas.length} pruebas OK — redacción de ids en los logs.`);
}

try {
  main();
} catch (error) {
  console.error('\nFALLÓ:', error);
  process.exit(1);
}
