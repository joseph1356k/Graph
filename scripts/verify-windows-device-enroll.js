// Enrolamiento por instalación: la key embebida solo enrola, el token per-install
// es la credencial real de /api/v1, y una key de env JAMÁS es un dispositivo.
//   node scripts/verify-windows-device-enroll.js
//
// Levanta las rutas REALES (registerDeviceRoutes) y el requireApiKey REAL con su
// doble fuente (env + tokens de BD). Lo único falso es la base de datos.
const assert = require('assert');
const express = require('express');
const http = require('http');

// La doble fuente de requireApiKey lee MIRACLE_API_KEYS de env en cada request:
// se fija ANTES de requerir el módulo para que la prueba controle el entorno.
process.env.MIRACLE_API_KEYS = 'fleet:env-fleet-key';

const WindowsDeviceService = require('../src/application/use-cases/WindowsDeviceService');
const registerDeviceRoutes = require('../web/api/registerDeviceRoutes');
const { requireApiKey, setWindowsDeviceService } = require('../web/api/requireAuth');
const { createFakeClinicalSupabase } = require('../tests/helpers/fakeClinicalSupabase');

const ENROLL_KEY = 'enroll-key-de-prueba';

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const fake = createFakeClinicalSupabase();
  const windowsDeviceService = new WindowsDeviceService(fake);
  setWindowsDeviceService(windowsDeviceService);

  const app = express();
  app.use(express.json());
  // El requireApiKey REAL protege /api/v1, como en producción; la sonda expone
  // lo que el middleware resolvió para poder afirmarlo.
  app.use('/api/v1', (req, res, next) => {
    if (req.path === '/enroll') return next(); // el enroll trae su propia puerta
    return requireApiKey(req, res, next);
  });
  app.get('/api/v1/probe', (req, res) => res.json({ apiClient: req.apiClient, userId: req.user?.id }));
  registerDeviceRoutes(app, { windowsDeviceService, enrollKeys: ENROLL_KEY });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, apiKey } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  console.log('Enrolamiento y doble fuente de credenciales:');

  // --- la key de enrolamiento es la única puerta del enroll ------------------
  let r = await call('POST', '/api/v1/enroll', { body: { device_id: 'maquina-1' } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.error.code, 'ENROLL_FORBIDDEN');
  check('enroll sin key → 401 ENROLL_FORBIDDEN');

  r = await call('POST', '/api/v1/enroll', { body: { device_id: 'maquina-1' }, apiKey: 'key-mala' });
  assert.strictEqual(r.status, 401);
  check('enroll con key equivocada → 401');

  r = await call('POST', '/api/v1/enroll', { body: {}, apiKey: ENROLL_KEY });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'DEVICE_INVALID');
  check('enroll sin device_id → 400 DEVICE_INVALID');

  // --- enroll feliz: token una vez, solo hash en la base ---------------------
  r = await call('POST', '/api/v1/enroll', {
    body: { device_id: 'maquina-1', label: 'Consultorio 3' },
    apiKey: ENROLL_KEY
  });
  assert.strictEqual(r.status, 201);
  const token1 = r.body.token;
  assert.ok(token1.startsWith('uwd_'), 'el token lleva el prefijo identificable');
  assert.strictEqual(r.body.device.label, 'Consultorio 3');
  assert.strictEqual(fake.tables.graph_windows_devices.length, 1);
  const stored = fake.tables.graph_windows_devices[0];
  assert.notStrictEqual(stored.token_hash, token1, 'la base guarda el hash, no el token');
  assert.strictEqual(stored.token_hash, WindowsDeviceService.hashToken(token1));
  check('enroll → 201 con token uwd_ una sola vez; en la base solo vive el sha256');

  // --- el token es credencial de /api/v1; la key de env sigue viva -----------
  r = await call('GET', '/api/v1/probe', { apiKey: token1 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.apiClient.deviceId, 'maquina-1');
  assert.strictEqual(r.body.apiClient.label, 'Consultorio 3');
  assert.strictEqual(r.body.apiClient.clinicalLink, null);
  check('token per-install autentica /api/v1 (deviceId presente, sin vínculo clínico)');

  assert.strictEqual(r.body.userId, 'api-client:fleet',
    'el owner de workflows es el de la flota: lo aprendido no se esconde al migrar de key a token');
  check('identidad de workflows = flota (ownerId estable entre key compartida y tokens)');

  r = await call('GET', '/api/v1/probe', { apiKey: 'env-fleet-key' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.apiClient.label, 'fleet');
  assert.strictEqual(r.body.apiClient.deviceId, null);
  assert.strictEqual(r.body.apiClient.clinicalLink, null);
  check('la key de env sigue autenticando /api/v1 (sin identidad de dispositivo)');

  r = await call('GET', '/api/v1/probe', { apiKey: 'no-existe' });
  assert.strictEqual(r.status, 401);
  check('credencial desconocida → 401');

  // --- una key de env NO es un dispositivo -----------------------------------
  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: 'env-fleet-key' });
  assert.strictEqual(r.status, 401);
  check('pair-code con key de env → 401 (solo dispositivos reales piden códigos)');

  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: token1 });
  assert.strictEqual(r.status, 201);
  assert.match(r.body.code, /^[A-HJ-NP-Z2-9]{8}$/);
  check('pair-code con token de dispositivo → 201 con código de 8 caracteres');

  // --- re-enrolar rota el token, no duplica el dispositivo -------------------
  r = await call('POST', '/api/v1/enroll', { body: { device_id: 'maquina-1' }, apiKey: ENROLL_KEY });
  assert.strictEqual(r.status, 201);
  const token2 = r.body.token;
  assert.notStrictEqual(token2, token1);
  assert.strictEqual(fake.tables.graph_windows_devices.length, 1, 'sin dispositivos fantasma');
  check('re-enroll del mismo device_id → token nuevo, un solo registro');

  r = await call('GET', '/api/v1/probe', { apiKey: token1 });
  assert.strictEqual(r.status, 401);
  check('el token anterior murió al rotar');

  r = await call('GET', '/api/v1/probe', { apiKey: token2 });
  assert.strictEqual(r.status, 200);
  check('el token nuevo funciona');

  // --- revocación por dispositivo --------------------------------------------
  fake.tables.graph_windows_devices[0].revoked_at = new Date().toISOString();
  r = await call('GET', '/api/v1/probe', { apiKey: token2 });
  assert.strictEqual(r.status, 401);
  check('dispositivo revocado → su token deja de autenticar');

  // Re-enrolar un dispositivo revocado lo revive con token nuevo, pero la
  // delegación clínica NO renace sola (se prueba en verify-device-pairing.js).
  r = await call('POST', '/api/v1/enroll', { body: { device_id: 'maquina-1' }, apiKey: ENROLL_KEY });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(fake.tables.graph_windows_devices[0].revoked_at, null);
  check('re-enroll tras revocación revive la credencial (los vínculos no: eso es del médico)');

  server.close();
  console.log(`\n${checks} comprobaciones pasaron.`);
}

main().catch((error) => {
  console.error(`\nFALLO: ${error.message}`);
  process.exit(1);
});
