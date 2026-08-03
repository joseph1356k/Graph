// Emparejamiento médico↔equipo: el equipo muestra un código, el médico lo
// canjea en Miracle Notes, y desde entonces el equipo actúa en su nombre.
//   node scripts/verify-device-pairing.js
//
// Rutas REALES (registerDeviceRoutes) con un stand-in de requireClinicalAuth
// (como verify-note-export-flow.js). Lo único falso es la base de datos.
const assert = require('assert');
const express = require('express');
const http = require('http');

const WindowsDeviceService = require('../src/application/use-cases/WindowsDeviceService');
const registerDeviceRoutes = require('../web/api/registerDeviceRoutes');
const { createFakeClinicalSupabase } = require('../tests/helpers/fakeClinicalSupabase');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCTOR = '22222222-2222-4222-8222-222222222222';
const NO_ORG_DOCTOR = '33333333-3333-4333-8333-333333333333';
const ENROLL_KEY = 'enroll-key-de-prueba';

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const fake = createFakeClinicalSupabase({
    profiles: [
      { id: DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dra. Ruiz', email: 'medico@x' },
      { id: OTHER_DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dr. Otro', email: 'otro@x' },
      { id: NO_ORG_DOCTOR, organization_id: null, role: 'medico', full_name: 'Sin Org', email: 'sinorg@x' }
    ]
  });
  const windowsDeviceService = new WindowsDeviceService(fake);

  const app = express();
  app.use(express.json());
  let currentUser = { id: DOCTOR, email: 'medico@x' };
  // Stand-in de requireClinicalAuth (JWT de Supabase → req.clinicalUser).
  app.use('/api/clinical/devices', (req, res, next) => {
    if (!currentUser) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Falta el token.' } });
    }
    req.clinicalUser = { ...currentUser };
    return next();
  });
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

  console.log('Emparejamiento médico↔equipo:');

  // --- alta del equipo -------------------------------------------------------
  let r = await call('POST', '/api/v1/enroll', {
    body: { device_id: 'maquina-1', label: 'Consultorio 3' },
    apiKey: ENROLL_KEY
  });
  const deviceToken = r.body.token;

  // --- un código vivo por equipo ---------------------------------------------
  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: deviceToken });
  assert.strictEqual(r.status, 201);
  const staleCode = r.body.code;
  const expiresInMs = new Date(r.body.expires_at).getTime() - Date.now();
  assert.ok(expiresInMs > 9 * 60 * 1000 && expiresInMs <= 10 * 60 * 1000, 'TTL ≈ 10 minutos');
  check('pair-code → código con TTL de 10 minutos');

  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: deviceToken });
  const code = r.body.code;
  const pendings = fake.tables.graph_device_doctor_links.filter(
    (row) => !row.approved_at && !row.revoked_at
  );
  assert.strictEqual(pendings.length, 1, 'solo un código pendiente vivo');
  assert.strictEqual(pendings[0].pairing_code, code);
  check('pedir otro código mata el anterior (un código vivo por equipo)');

  // --- canjes que NO deben pasar ---------------------------------------------
  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: staleCode } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.error.code, 'PAIRING_CODE_INVALID');
  check('el código anulado no se canjea');

  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: 'XX' } });
  assert.strictEqual(r.status, 404);
  check('formato inválido → la misma respuesta única (anti-oráculo)');

  currentUser = { id: NO_ORG_DOCTOR, email: 'sinorg@x' };
  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code } });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error.code, 'DOCTOR_WITHOUT_ORGANIZATION');
  check('médico sin organización → 409, y el código sigue canjeable por otro');

  // --- canje feliz ------------------------------------------------------------
  currentUser = { id: DOCTOR, email: 'medico@x' };
  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: ` ${code.toLowerCase()} ` } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.link_id);
  assert.strictEqual(r.body.device.label, 'Consultorio 3');
  check('canje feliz (normaliza mayúsculas/espacios) → vínculo aprobado');

  const link = fake.tables.graph_device_doctor_links.find((row) => row.id === r.body.link_id);
  assert.strictEqual(link.doctor_id, DOCTOR);
  assert.strictEqual(link.organization_id, ORG);
  assert.strictEqual(link.pairing_code, null, 'el código se anula al canjear: un solo uso');
  check('el vínculo congela doctor y organización; el código muere');

  const audit = fake.tables.audit_events.find((row) => row.accion === 'equipo_vinculado');
  assert.ok(audit, 'auditoría del canje');
  assert.strictEqual(audit.organization_id, ORG);
  check('el canje queda en audit_events');

  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code } });
  assert.strictEqual(r.status, 404);
  check('re-canjear el mismo código → invalid (un solo uso)');

  // --- resolveClinicalActor: el corazón del carril clínico -------------------
  let actor = await windowsDeviceService.resolveClinicalActor(deviceToken);
  assert.strictEqual(actor.doctor.id, DOCTOR);
  assert.strictEqual(actor.doctor.fullName, 'Dra. Ruiz');
  assert.strictEqual(actor.organizationId, ORG);
  check('resolveClinicalActor: token → médico vinculado con su organización');

  // --- código caducado --------------------------------------------------------
  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: deviceToken });
  const expiredCode = r.body.code;
  fake.tables.graph_device_doctor_links.find((row) => row.pairing_code === expiredCode)
    .code_expires_at = new Date(Date.now() - 1000).toISOString();
  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: expiredCode } });
  assert.strictEqual(r.status, 404);
  check('código caducado → invalid');

  // --- re-emparejar reemplaza (v1: un médico por equipo) ---------------------
  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: deviceToken });
  currentUser = { id: OTHER_DOCTOR, email: 'otro@x' };
  r = await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: r.body.code } });
  assert.strictEqual(r.status, 200);
  const activeLinks = fake.tables.graph_device_doctor_links.filter(
    (row) => row.approved_at && !row.revoked_at
  );
  assert.strictEqual(activeLinks.length, 1, 'un solo vínculo activo por equipo');
  assert.strictEqual(activeLinks[0].doctor_id, OTHER_DOCTOR);
  check('re-emparejar con otro médico revoca el vínculo anterior');

  actor = await windowsDeviceService.resolveClinicalActor(deviceToken);
  assert.strictEqual(actor.doctor.id, OTHER_DOCTOR);
  check('el actor clínico ahora es el médico nuevo');

  // --- panel del médico: listar y revocar ------------------------------------
  r = await call('GET', '/api/clinical/devices');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.devices.length, 1);
  assert.strictEqual(r.body.devices[0].label, 'Consultorio 3');
  const linkId = r.body.devices[0].link_id;
  check('el médico ve sus equipos vinculados');

  currentUser = { id: DOCTOR, email: 'medico@x' };
  r = await call('GET', '/api/clinical/devices');
  assert.strictEqual(r.body.devices.length, 0);
  check('el médico anterior ya no ve el equipo (el vínculo es del médico nuevo)');

  r = await call('POST', `/api/clinical/devices/${linkId}/revoke`);
  assert.strictEqual(r.status, 404);
  check('revocar un vínculo ajeno → 404 (el filtro es la autorización)');

  currentUser = { id: OTHER_DOCTOR, email: 'otro@x' };
  r = await call('POST', `/api/clinical/devices/${linkId}/revoke`);
  assert.strictEqual(r.status, 200);
  actor = await windowsDeviceService.resolveClinicalActor(deviceToken);
  assert.strictEqual(actor.link, null, 'el equipo queda enrolado pero sin médico');
  check('el médico revoca su vínculo: el equipo pierde la delegación, no la credencial');

  // --- re-enrolar NO revive vínculos ------------------------------------------
  r = await call('POST', '/api/v1/devices/pair-code', { apiKey: deviceToken });
  currentUser = { id: DOCTOR, email: 'medico@x' };
  await call('POST', '/api/clinical/devices/claim-pairing', { body: { code: r.body.code } });
  fake.tables.graph_windows_devices[0].revoked_at = new Date().toISOString();
  r = await call('POST', '/api/v1/enroll', { body: { device_id: 'maquina-1' }, apiKey: ENROLL_KEY });
  assert.strictEqual(r.status, 201);
  actor = await windowsDeviceService.resolveClinicalActor(r.body.token);
  assert.strictEqual(actor.link, null,
    're-enrolar un dispositivo revocado revive la credencial pero NUNCA la delegación clínica');
  check('revocar dispositivo + re-enroll → sin vínculo: hay que volver a emparejar');

  server.close();
  console.log(`\n${checks} comprobaciones pasaron.`);
}

main().catch((error) => {
  console.error(`\nFALLO: ${error.message}`);
  process.exit(1);
});
