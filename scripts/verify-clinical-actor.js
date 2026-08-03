// El carril clínico para aparatos: un token per-install con vínculo médico
// aprobado actúa EN NOMBRE del médico en /api/clinical/*, y las rutas no se
// enteran (resolveDoctorId lee req.clinicalUser.id, que aquí es el médico).
//   node scripts/verify-clinical-actor.js
//
// Levanta el middleware REAL (requireClinicalActor → delega en el
// requireClinicalAuth original para el carril del navegador), las rutas REALES
// y los servicios/repositorios REALES. Lo único falso es la base de datos y el
// LLM (apagado: generate-note no se ejercita aquí).
//
// Es, además, la demo de la fase en forma ejecutable: plantilla → consulta →
// dictado → nota guardada → espejo refrescado → listado del historial, todo con
// el token del aparato y sin una línea de C#.
const assert = require('assert');
const express = require('express');
const http = require('http');

// El carril Bearer delega en requireClinicalAuth: sin este delete, un entorno
// con el escape de dev activo convertiría "sin credencial" en el doctor de dev
// y la prueba de regresión no probaría nada.
delete process.env.TEMPORARY_DISABLE_AUTH;

const WindowsDeviceService = require('../src/application/use-cases/WindowsDeviceService');
const ConsultationMirrorService = require('../src/application/use-cases/ConsultationMirrorService');
const ConsultationQueryService = require('../src/application/use-cases/ConsultationQueryService');
const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');
const ClinicalEncounterService = require('../src/application/use-cases/ClinicalEncounterService');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const SupabaseClinicalTemplateRepository = require('../src/infrastructure/repositories/SupabaseClinicalTemplateRepository');
const SupabaseClinicalEncounterRepository = require('../src/infrastructure/repositories/SupabaseClinicalEncounterRepository');
const createRequireClinicalActor = require('../web/api/requireClinicalActor');
const requireClinicalAuth = require('../web/api/requireClinicalAuth');
const registerClinicalRoutes = require('../web/api/registerClinicalRoutes');
const { createFakeClinicalSupabase } = require('../tests/helpers/fakeClinicalSupabase');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCTOR = '22222222-2222-4222-8222-222222222222';

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

function noteJson(motivo, plan, summary) {
  return {
    summary,
    sections: [
      { key: 'motivo_de_consulta', label: 'Motivo de consulta', content: motivo },
      { key: 'plan', label: 'Plan', content: plan }
    ]
  };
}

// Como jsonb: mismo contenido, otro orden de claves. El CAS del refresh tiene
// que reconocerlo como "sin cambios" (Postgres no conserva el orden).
function scrambleKeys(sections) {
  return sections.map(({ texto, kind, titulo, id }) => ({ texto, kind, titulo, id }));
}

async function main() {
  const fake = createFakeClinicalSupabase({
    profiles: [
      { id: DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dra. Ruiz', email: 'medico@x' },
      { id: OTHER_DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dr. Otro', email: 'otro@x' }
    ],
    consultations: [],
    audit_events: []
  });

  const windowsDeviceService = new WindowsDeviceService(fake);
  const consultationMirrorService = new ConsultationMirrorService(fake);
  const consultationQueryService = new ConsultationQueryService(fake);
  const templateService = new ClinicalTemplateService(new SupabaseClinicalTemplateRepository(fake));
  const encounterService = new ClinicalEncounterService(new SupabaseClinicalEncounterRepository(fake), templateService);

  const app = express();
  app.use(express.json({ limit: '16mb' }));
  const requireClinicalActor = createRequireClinicalActor({ windowsDeviceService });
  // El MISMO montaje partido de server.js: actor clínico vs. solo-médico.
  ['/api/clinical/templates', '/api/clinical/encounters', '/api/clinical/assistant', '/api/clinical/consultations']
    .forEach((prefix) => app.use(prefix, requireClinicalActor));
  ['/api/clinical/exports', '/api/clinical/devices']
    .forEach((prefix) => app.use(prefix, requireClinicalAuth));
  // Sonda tras la puerta solo-médico: si el middleware dejara pasar un aparato,
  // esta ruta contestaría 200 y la prueba lo cazaría.
  app.post('/api/clinical/exports', (req, res) => res.json({ reached: true }));

  registerClinicalRoutes(app, {
    diagnosisSuggestionService: { suggest: async () => ({ suggestions: [] }) },
    templateService,
    encounterService,
    noteGeneratorService: { generate: async () => { throw new Error('LLM apagado en esta prueba'); } },
    noteValidationService: new ClinicalNoteValidationService(),
    consultationQueryService,
    consultationMirrorService
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, apiKey, bearer } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  console.log('Carril clínico para aparatos:');

  // --- regresión: el carril del navegador es EXACTAMENTE el original ---------
  let r = await call('GET', '/api/clinical/consultations');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.error.message, 'Falta el token de acceso de Supabase.');
  check('sin credencial → el 401 literal del requireClinicalAuth original (delegación intacta)');

  // --- credenciales de aparato -----------------------------------------------
  r = await call('GET', '/api/clinical/consultations', { apiKey: 'uwd_token-inventado' });
  assert.strictEqual(r.status, 401);
  check('token de aparato desconocido → 401');

  const enrolled = await windowsDeviceService.enroll({ deviceId: 'maquina-1', label: 'Consultorio 3' });
  const deviceToken = enrolled.token;

  r = await call('GET', '/api/clinical/consultations', { apiKey: deviceToken });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error.code, 'DEVICE_NOT_PAIRED');
  check('enrolado pero sin médico → 403 DEVICE_NOT_PAIRED (la señal de "muestra el código")');

  const { code } = await windowsDeviceService.createPairingCode({ id: enrolled.device.id });
  await windowsDeviceService.claimPairing({ code, doctor: { id: DOCTOR } });

  // --- la cadena completa con el token del aparato ---------------------------
  r = await call('POST', '/api/clinical/templates', {
    apiKey: deviceToken,
    body: { name: 'Consulta general HGM', specialty: 'medicina_general', sections: ['Motivo de consulta', 'Plan'] }
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.template.owner_user_id, DOCTOR,
    'la plantilla queda a nombre del MÉDICO vinculado, no de un id de aparato');
  const templateId = r.body.template.id;
  check('crear plantilla como aparato → dueña: la médica vinculada');

  r = await call('POST', '/api/clinical/encounters', {
    apiKey: deviceToken,
    body: { consultation_type: 'presencial', template_id: templateId }
  });
  assert.strictEqual(r.status, 201);
  const encounterId = r.body.encounter_id;
  assert.ok(encounterId);
  assert.strictEqual(
    fake.tables.clinical_encounters.find((row) => row.id === encounterId).doctor_id,
    DOCTOR
  );
  check('crear consulta como aparato → doctor_id = la médica vinculada');

  r = await call('POST', `/api/clinical/encounters/${encounterId}/transcript`, {
    apiKey: deviceToken,
    body: { transcript: 'Paciente refiere dolor lumbar de tres días, sin fiebre.' }
  });
  assert.strictEqual(r.status, 200);
  check('guardar dictado como aparato');

  r = await call('GET', `/api/clinical/encounters/${encounterId}`, { apiKey: deviceToken });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.encounter.status, 'transcript_ready');
  check('leer la consulta como aparato (ownership vía vínculo)');

  // --- espejo: refresh con CAS de contenido ----------------------------------
  // Estado del mundo tras un generate-note (que aquí no corre porque el LLM
  // está apagado): nota en el taller + fila publicada en el historial, con el
  // orden de claves revuelto como lo devolvería jsonb.
  const NOTE_V1 = noteJson('Dolor lumbar de 3 días.', 'Analgésico y control.', 'Lumbalgia mecánica.');
  fake.tables.clinical_encounters.find((row) => row.id === encounterId).note_json = NOTE_V1;
  fake.tables.consultations.push({
    id: encounterId,
    organization_id: ORG,
    medico_id: DOCTOR,
    estado: 'borrador',
    note: scrambleKeys(ConsultationMirrorService.noteJsonToSections(NOTE_V1)),
    resumen: NOTE_V1.summary,
    motivo: 'Dolor lumbar de 3 días.',
    fecha: '2026-08-03T09:00:00.000Z',
    servicio: 'Consulta externa',
    especialidad: 'Medicina general',
    plantilla: 'Consulta general HGM',
    deleted_at: null
  });

  const NOTE_V2 = noteJson('Dolor lumbar de 3 días, EVA 6/10.', 'Analgésico, pausas activas, control en 7 días.', 'Lumbalgia mecánica, manejo conservador.');
  r = await call('PUT', `/api/clinical/encounters/${encounterId}/note`, {
    apiKey: deviceToken,
    body: { note_json: NOTE_V2 }
  });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.mirror, { refreshed: true },
    `el espejo debió refrescarse: ${JSON.stringify(r.body.mirror)}`);
  let mirrorRow = fake.tables.consultations.find((row) => row.id === encounterId);
  assert.ok(mirrorRow.note.some((section) => section.texto.includes('EVA 6/10')));
  assert.strictEqual(mirrorRow.resumen, NOTE_V2.summary);
  check('editar la nota como aparato refresca el historial (CAS pasa aunque jsonb revuelva claves)');

  const audit = fake.tables.audit_events.find((row) => row.accion === 'Nota actualizada con Miracle');
  assert.ok(audit && audit.detalle.includes('Consultorio 3'), 'la atribución nombra al equipo');
  check('el refresh queda auditado con el nombre del equipo');

  // La web editó en paralelo: el último que manda es el médico.
  mirrorRow.note = mirrorRow.note.map((section, index) => (index === 0
    ? { ...section, texto: 'El médico reescribió el motivo a mano.' }
    : section));
  const NOTE_V3 = noteJson('Otra edición del taller.', 'Plan v3.', 'Resumen v3.');
  r = await call('PUT', `/api/clinical/encounters/${encounterId}/note`, {
    apiKey: deviceToken,
    body: { note_json: NOTE_V3 }
  });
  assert.strictEqual(r.status, 200, 'el guardado del taller NUNCA se bloquea por el espejo');
  assert.strictEqual(r.body.mirror.refreshed, false);
  assert.strictEqual(r.body.mirror.reason, 'web_edito');
  mirrorRow = fake.tables.consultations.find((row) => row.id === encounterId);
  assert.ok(mirrorRow.note[0].texto.includes('reescribió'), 'la edición del médico quedó intacta');
  check('si la web divergió, el refresh NO pisa al médico (web_edito) y el taller guarda igual');

  // Firmada: intocable, sin importar el contenido.
  mirrorRow.estado = 'aprobada';
  r = await call('PUT', `/api/clinical/encounters/${encounterId}/note`, {
    apiKey: deviceToken,
    body: { note_json: noteJson('v4', 'v4', 'v4') }
  });
  assert.strictEqual(r.body.mirror.reason, 'estado_no_borrador');
  check('nota firmada → el refresh ni la mira (estado_no_borrador)');

  // Nunca publicada (p. ej. médico sin org al generar): el refresh publica.
  r = await call('POST', '/api/clinical/encounters', {
    apiKey: deviceToken,
    body: { consultation_type: 'presencial', template_id: templateId }
  });
  const encounter2 = r.body.encounter_id;
  fake.tables.clinical_encounters.find((row) => row.id === encounter2).note_json = NOTE_V1;
  r = await call('PUT', `/api/clinical/encounters/${encounter2}/note`, {
    apiKey: deviceToken,
    body: { note_json: NOTE_V2 }
  });
  assert.strictEqual(r.body.mirror.refreshed, true);
  assert.strictEqual(r.body.mirror.reason, 'publicada');
  assert.ok(fake.tables.consultations.find((row) => row.id === encounter2));
  check('sin fila en el historial → el refresh publica (red de seguridad)');

  // --- listado magro con scoping ---------------------------------------------
  fake.tables.consultations.push(
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', organization_id: OTHER_ORG, medico_id: DOCTOR, estado: 'borrador', fecha: '2026-08-03T10:00:00.000Z', motivo: 'de otra organización', deleted_at: null },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02', organization_id: ORG, medico_id: OTHER_DOCTOR, estado: 'borrador', fecha: '2026-08-03T10:00:00.000Z', motivo: 'de otro médico', deleted_at: null },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc03', organization_id: ORG, medico_id: DOCTOR, estado: 'borrador', fecha: '2026-08-03T10:00:00.000Z', motivo: 'borrada', deleted_at: '2026-08-03T11:00:00.000Z' }
  );
  r = await call('GET', '/api/clinical/consultations', { apiKey: deviceToken });
  assert.strictEqual(r.status, 200);
  const ids = r.body.consultations.map((row) => row.id);
  assert.ok(ids.includes(encounterId) && ids.includes(encounter2));
  assert.ok(!ids.includes('cccccccc-cccc-4ccc-8ccc-cccccccccc01'), 'otra organización: invisible');
  assert.ok(!ids.includes('cccccccc-cccc-4ccc-8ccc-cccccccccc02'), 'otro médico: invisible');
  assert.ok(!ids.includes('cccccccc-cccc-4ccc-8ccc-cccccccccc03'), 'borrada: invisible');
  assert.ok(!('note' in (r.body.consultations[0] || {})), 'listado magro: sin cuerpo de nota');
  check('listado: solo lo del médico vinculado en su organización, sin PHI de más');

  r = await call('GET', '/api/clinical/consultations?estado=aprobada', { apiKey: deviceToken });
  assert.deepStrictEqual(r.body.consultations.map((row) => row.id), [encounterId]);
  check('filtro por estado');

  r = await call('GET', '/api/clinical/consultations?estado=inventado', { apiKey: deviceToken });
  assert.strictEqual(r.status, 400);
  check('estado inválido → 400');

  // --- lo que un aparato JAMÁS alcanza ---------------------------------------
  r = await call('POST', '/api/clinical/exports', { apiKey: deviceToken, body: {} });
  assert.strictEqual(r.status, 401);
  assert.notStrictEqual(r.body?.reached, true);
  check('exportar con token de aparato → 401: «no se envían consultas hasta que el médico le da enviar a HC»');

  r = await call('GET', '/api/clinical/devices', { apiKey: deviceToken });
  assert.strictEqual(r.status, 401);
  check('gestionar vínculos con token de aparato → 401 (solo el médico)');

  server.close();
  console.log(`\n${checks} comprobaciones pasaron.`);
}

main().catch((error) => {
  console.error(`\nFALLO: ${error.message}`);
  process.exit(1);
});
