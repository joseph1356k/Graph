// Flujo END-TO-END de exportación de nota a historia clínica.
//   node scripts/verify-note-export-flow.js
//
// Levanta las rutas REALES de Express (los dos carriles de auth), el servicio y
// el repositorio reales, y recorre el camino completo:
//
//   médico firma → "Exportar a HC" → Graph valida y encola → el ejecutor reclama
//   → reporta → Graph actualiza el estado real → la consulta queda 'exportada'
//   SOLO tras el éxito confirmado.
//
// Lo único falso es la base de datos (un subconjunto de PostgREST en memoria),
// para que la prueba corra sin credenciales. La semántica de las RPCs se prueba
// de verdad, contra Postgres, en `scripts/verify-note-exports-db.js`; aquí se
// prueba lo que esa otra no ve: rutas, auth, validaciones, códigos HTTP,
// idempotencia del doble clic y el contrato con el ejecutor.
const assert = require('assert');
const express = require('express');
const http = require('http');

const SupabaseNoteExportRepository = require('../src/infrastructure/repositories/SupabaseNoteExportRepository');
const NoteExportService = require('../src/application/use-cases/NoteExportService');
const { computeSignatureHash } = require('../src/application/use-cases/NoteSignatureHash');
const registerNoteExportRoutes = require('../web/api/registerNoteExportRoutes');
// Base de datos falsa (subconjunto de PostgREST + las RPCs de la migración).
// Compartida con la demo end-to-end: una sola implementación que mantener.
const { createFakeSupabase } = require('../tests/helpers/fakeNoteExportSupabase');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCTOR = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';
const PATIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEMO_ACCION = 'Nota de demostración generada por IA';

let checks = 0;
function check(label) {
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ---------------------------------------------------------------------------
// Datos base
// ---------------------------------------------------------------------------
function signedConsultation(overrides = {}) {
  const note = overrides.note ?? [
    { id: 's1', titulo: 'Motivo de consulta', kind: 'texto', texto: 'Dolor lumbar de 3 días.' },
    { id: 's2', titulo: 'Plan', kind: 'lista', items: ['Analgésico', 'Control en 7 días'] }
  ];
  const resumen = overrides.resumen ?? 'Lumbalgia mecánica; manejo analgésico.';
  const codigos = overrides.codigos ?? [
    { id: 'c1', sistema: 'CIE-10', codigo: 'M54.5', descripcion: 'Lumbago no especificado', estado: 'aceptado' },
    { id: 'c2', sistema: 'CIE-10', codigo: 'Z00.0', descripcion: 'Sugerido, no aceptado', estado: 'sugerido' }
  ];
  const base = {
    id: overrides.id,
    organization_id: overrides.organization_id ?? ORG,
    medico_id: overrides.medico_id ?? DOCTOR,
    patient_id: overrides.patient_id ?? PATIENT,
    estado: overrides.estado ?? 'aprobada',
    note,
    resumen,
    codigos,
    especialidad: 'Medicina general',
    servicio: 'Consulta externa',
    fecha: '2026-07-27T10:00:00.000Z'
  };
  const hash = overrides.firmaHash === null
    ? ''
    : (overrides.firmaHash ?? computeSignatureHash({ note, resumen, codigos }));
  base.firma = overrides.firma === null ? null : {
    por: 'Dra. Ruiz',
    fecha: '2026-07-27T10:05:00.000Z',
    ...(hash ? { hash } : {})
  };
  return base;
}

async function main() {
  const fake = createFakeSupabase();
  const repository = new SupabaseNoteExportRepository(fake);
  const noteExportService = new NoteExportService({
    repository,
    defaultWorkflowId: 'wf-sap-hc',
    leaseSeconds: 600,
    maxAttempts: 3
  });

  fake.tables.profiles.push(
    { id: DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dra. Ruiz', email: 'medico@x' },
    { id: OTHER_DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dr. Otro', email: 'otro@x' },
    { id: ADMIN, organization_id: ORG, role: 'admin', full_name: 'Admin', email: 'admin@x' },
    { id: OUTSIDER, organization_id: OTHER_ORG, role: 'medico', full_name: 'Ajeno', email: 'ajeno@x' }
  );

  const C = {
    happy: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    failing: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    draft: 'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
    tampered: 'dddddddd-dddd-4ddd-8ddd-dddddddddd04',
    demo: 'dddddddd-dddd-4ddd-8ddd-dddddddddd05',
    legacy: 'dddddddd-dddd-4ddd-8ddd-dddddddddd06',
    unsigned: 'dddddddd-dddd-4ddd-8ddd-dddddddddd07',
    cancelme: 'dddddddd-dddd-4ddd-8ddd-dddddddddd08',
    needsdoc: 'dddddddd-dddd-4ddd-8ddd-dddddddddd09'
  };
  fake.tables.consultations.push(
    signedConsultation({ id: C.happy }),
    signedConsultation({ id: C.failing }),
    signedConsultation({ id: C.draft, estado: 'borrador' }),
    // Firmada y luego editada: el hash guardado ya no corresponde al contenido.
    signedConsultation({ id: C.tampered, firmaHash: 'a'.repeat(64) }),
    signedConsultation({ id: C.demo }),
    // Nota histórica: firmada antes de que la firma llevara hash.
    signedConsultation({ id: C.legacy, firmaHash: null }),
    signedConsultation({ id: C.unsigned, firma: null }),
    signedConsultation({ id: C.cancelme }),
    signedConsultation({ id: C.needsdoc })
  );
  fake.tables.audit_events.push({
    id: 'demo-audit', organization_id: ORG, consultation_id: C.demo,
    actor_name: 'IA', accion: DEMO_ACCION, detalle: '', fecha: '2026-07-27T09:00:00.000Z'
  });

  // --- servidor con los DOS carriles de auth, como en producción -----------
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  let currentUser = { id: DOCTOR, email: 'medico@x' };
  // Stand-in de requireClinicalAuth (JWT de Supabase -> req.clinicalUser).
  app.use('/api/clinical/exports', (req, res, next) => {
    if (!currentUser) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Falta el token.' } });
    }
    req.clinicalUser = { ...currentUser };
    return next();
  });
  // Stand-in de requireApiKey (X-API-Key -> req.apiClient).
  app.use('/api/v1', (req, res, next) => {
    if (`${req.get('x-api-key') || ''}` !== 'test-executor-key') {
      return res.status(401).json({ error: 'API key invalida o ausente.' });
    }
    req.apiClient = { label: 'executor-test' };
    return next();
  });
  registerNoteExportRoutes(app, { noteExportService });

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

  const asDoctor = (method, path, body) => call(method, path, { body });
  const asExecutor = (method, path, body) => call(method, path, { body, apiKey: 'test-executor-key' });

  // El claim es FIFO GLOBAL: si queda trabajo vivo de un escenario anterior, se
  // lo lleva ese y no el que el escenario siguiente acaba de crear. Los
  // escenarios que afirman "el claim me devuelve MI trabajo" vacían antes la cola.
  function drainQueue() {
    for (const job of fake.tables.graph_note_exports) {
      if (['pending', 'claimed'].includes(job.status)) {
        job.status = 'completed';
        job.lease_expires_at = null;
      }
    }
  }

  try {
    console.log('Carril Miracle Notes — pedir la exportación');

    // 1. Camino feliz: pedir la exportación NO exporta nada todavía.
    let res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.happy });
    assert.strictEqual(res.status, 201, `esperaba 201, fue ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.export.status, 'pending');
    assert.strictEqual(res.body.export.attempts, 0);
    assert.strictEqual(res.body.export.workflow_id, 'wf-sap-hc');
    assert.strictEqual(res.body.export.hash_source, 'firma', 'el hash de la firma debe haberse re-verificado');
    check('POST /exports crea el trabajo en pending y re-verifica el hash de la firma');

    const happyExportId = res.body.export.id;
    assert.strictEqual(
      fake.tables.consultations.find((c) => c.id === C.happy).estado,
      'aprobada',
      'pedir la exportación NO puede marcar la consulta como exportada'
    );
    check('la consulta sigue en aprobada: pedir la exportación no es exportar');

    // 2. Doble clic: dos peticiones EN PARALELO -> un solo trabajo.
    const [a, b] = await Promise.all([
      asDoctor('POST', '/api/clinical/exports', { consultation_id: C.failing }),
      asDoctor('POST', '/api/clinical/exports', { consultation_id: C.failing })
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepStrictEqual(statuses, [201, 409], `esperaba 201 y 409, fueron ${statuses}`);
    const created = a.status === 201 ? a : b;
    const duplicate = a.status === 409 ? a : b;
    assert.strictEqual(duplicate.body.error.code, 'EXPORT_ALREADY_EXISTS');
    assert.ok(duplicate.body.export, 'el 409 debe traer el estado del trabajo existente');
    assert.strictEqual(duplicate.body.export.id, created.body.export.id,
      'el duplicado debe apuntar al MISMO trabajo');
    assert.strictEqual(
      fake.tables.graph_note_exports.filter((e) => e.consultation_id === C.failing).length,
      1,
      'un doble clic no puede crear dos trabajos'
    );
    check('doble clic simultáneo: 201 + 409 con el MISMO trabajo, nunca dos');

    // 3. Un tercer clic más tarde sigue devolviendo el mismo trabajo.
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.failing });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.export.id, created.body.export.id);
    check('un clic posterior también es idempotente (mismo trabajo, sin duplicar)');

    // 4. Recargar la página: el estado se recupera del servidor.
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.happy}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.id, happyExportId);
    assert.strictEqual(res.body.export.status, 'pending');
    assert.strictEqual(res.body.consultation_estado, 'aprobada');
    check('GET /exports recupera el estado tras recargar (nada vive en memoria del navegador)');

    // 5. Validaciones que impiden exportar.
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.draft });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'CONSULTATION_NOT_APPROVED');
    check('una nota en borrador no se exporta');

    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.unsigned });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'CONSULTATION_NOT_SIGNED');
    check('una nota sin firma válida no se exporta');

    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.tampered });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'SIGNATURE_HASH_MISMATCH');
    assert.strictEqual(
      fake.tables.graph_note_exports.filter((e) => e.consultation_id === C.tampered).length, 0,
      'un hash que no cuadra no puede dejar trabajo encolado'
    );
    check('contenido que no coincide con la firma: 422 y NO se encola nada');

    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.demo });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'CONSULTATION_IS_DEMO');
    check('una nota de demostración nunca llega a la historia clínica real');

    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.legacy });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.export.hash_source, 'computed_at_export');
    check('nota histórica sin hash en la firma: se exporta con hash_source=computed_at_export');

    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: 'no-es-uuid' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EXPORT_INVALID');
    check('un consultation_id inválido se rechaza con 400');

    // 6. Autorización: Graph lee con service-role, así que la comprueba él.
    currentUser = { id: OUTSIDER, email: 'ajeno@x' };
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.cancelme });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'EXPORT_FORBIDDEN');
    check('un médico de otra organización no puede exportar (403)');

    currentUser = { id: OTHER_DOCTOR, email: 'otro@x' };
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.happy}`);
    assert.strictEqual(res.status, 403);
    check('otro médico de la misma organización tampoco ve la exportación ajena (403)');

    currentUser = { id: ADMIN, email: 'admin@x' };
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.happy}`);
    assert.strictEqual(res.status, 200);
    check('un admin de la organización sí puede consultarla');

    currentUser = { id: DOCTOR, email: 'medico@x' };

    console.log('Carril Operations — reclamar y reportar');

    // 7. El ejecutor necesita su API key.
    res = await call('POST', '/api/v1/operations/exports/claim', { body: { device: 'sim' } });
    assert.strictEqual(res.status, 401);
    check('el carril del ejecutor exige X-API-Key (401 sin ella)');

    // 8. Claim: FIFO, con payload.
    res = await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-01' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.id, happyExportId, 'el claim debe respetar FIFO');
    assert.strictEqual(res.body.export.attempts, 1);
    assert.ok(res.body.export.lease_expires_at, 'el claim debe entregar el lease');
    assert.ok(res.body.payload.rendered_text.includes('MOTIVO DE CONSULTA:'),
      `rendered_text inesperado: ${res.body.payload.rendered_text}`);
    assert.ok(res.body.payload.rendered_text.includes('- Analgésico'), 'las listas deben renderizarse');
    assert.ok(res.body.payload.rendered_text.includes('M54.5'), 'los códigos aceptados deben ir en el texto');
    assert.ok(!res.body.payload.rendered_text.includes('Z00.0'),
      'los códigos NO aceptados no van a la historia clínica');
    assert.strictEqual(res.body.payload.context, res.body.payload.rendered_text);
    check('claim entrega el trabajo con el texto listo para el HIS (solo códigos aceptados)');

    // PHI: el payload no puede llevar identidad del paciente.
    const payloadText = JSON.stringify(res.body.payload);
    assert.ok(!/nombre|documento/i.test(payloadText),
      'el payload no puede llevar nombre ni documento del paciente');
    assert.strictEqual(res.body.payload.patient_ref, PATIENT);
    check('el payload lleva solo patient_ref: nunca nombre ni documento');

    // 9. Mientras el ejecutor trabaja, la consulta NO está exportada.
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.happy}`);
    assert.strictEqual(res.body.export.status, 'claimed');
    assert.strictEqual(res.body.consultation_estado, 'aprobada');
    check('con el trabajo en claimed la consulta sigue aprobada (la UI dice "en proceso")');

    // 10. Resultado de un ejecutor que no es el dueño.
    res = await asExecutor('POST', `/api/v1/operations/exports/${happyExportId}/result`,
      { device: 'sim-impostor', outcome: 'ok', folio: 'HC-FALSO' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'EXPORT_NOT_OWNED');
    assert.strictEqual(fake.tables.consultations.find((c) => c.id === C.happy).estado, 'aprobada');
    check('un ejecutor que no tiene el trabajo no puede marcarlo exportado');

    // 11. outcome inválido.
    res = await asExecutor('POST', `/api/v1/operations/exports/${happyExportId}/result`,
      { device: 'sim-01', outcome: 'casi' });
    assert.strictEqual(res.status, 400);
    check('un outcome fuera del contrato se rechaza con 400');

    // 12. EL momento: éxito confirmado -> la consulta queda exportada.
    res = await asExecutor('POST', `/api/v1/operations/exports/${happyExportId}/result`,
      { device: 'sim-01', outcome: 'ok', folio: 'HC-2026-001' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.acknowledged, true);
    assert.strictEqual(res.body.status, 'completed');
    assert.strictEqual(res.body.consultation_exported, true);
    assert.strictEqual(fake.tables.consultations.find((c) => c.id === C.happy).estado, 'exportada');
    check('outcome ok confirmado ⇒ la consulta pasa a exportada (y solo aquí)');

    const audits = fake.tables.audit_events
      .filter((e) => e.consultation_id === C.happy && e.accion === 'Nota exportada a HC (automática)');
    assert.strictEqual(audits.length, 1);
    assert.ok(audits[0].detalle.includes('folio HC-2026-001'));
    check('la exportación queda auditada con su folio');

    // 13. El médico ve el estado final y el folio.
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.happy}`);
    assert.strictEqual(res.body.export.status, 'completed');
    assert.strictEqual(res.body.export.result_summary.folio, 'HC-2026-001');
    assert.strictEqual(res.body.consultation_estado, 'exportada');
    check('la UI recupera estado completed + folio tras recargar');

    // 14. Reenvío del mismo resultado (el ejecutor DEBE reintentar hasta el ack).
    res = await asExecutor('POST', `/api/v1/operations/exports/${happyExportId}/result`,
      { device: 'sim-01', outcome: 'ok', folio: 'HC-2026-001' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.acknowledged, true);
    assert.strictEqual(res.body.idempotent, true);
    assert.strictEqual(
      fake.tables.audit_events.filter((e) => e.consultation_id === C.happy
        && e.accion === 'Nota exportada a HC (automática)').length,
      1,
      'un reenvío no puede duplicar la auditoría'
    );
    check('reenviar el resultado devuelve ack idempotente sin duplicar nada');

    // 15. Ya exportada: no se puede volver a pedir.
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.happy });
    assert.strictEqual(res.status, 409);
    check('una consulta ya exportada no admite una exportación nueva');

    // 16. No se puede reintentar algo que ya se escribió en el HIS.
    res = await asDoctor('POST', `/api/clinical/exports/${happyExportId}/retry`);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'EXPORT_NOT_RETRYABLE');
    check('un trabajo completado no se reintenta (evita duplicar la nota en el HIS)');

    console.log('Errores y reintentos');

    // 17. Fallo del ejecutor -> failed, consulta intacta.
    const failingExportId = created.body.export.id;
    res = await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-01' });
    assert.strictEqual(res.body.export.id, failingExportId);
    res = await asExecutor('POST', `/api/v1/operations/exports/${failingExportId}/result`,
      { device: 'sim-01', outcome: 'error', error_code: 'HIS_LOGIN_FAILED' });
    assert.strictEqual(res.body.status, 'failed');
    assert.strictEqual(res.body.consultation_exported, false);
    assert.strictEqual(fake.tables.consultations.find((c) => c.id === C.failing).estado, 'aprobada');
    check('un fallo del ejecutor deja failed y la consulta en aprobada');

    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.failing}`);
    assert.strictEqual(res.body.export.status, 'failed');
    assert.strictEqual(res.body.export.error_code, 'HIS_LOGIN_FAILED');
    check('la UI puede explicar el error con un error_code tipado (sin PHI)');

    // 18. Reintento del médico -> vuelve a la cola y esta vez sale bien.
    res = await asDoctor('POST', `/api/clinical/exports/${failingExportId}/retry`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.status, 'pending');
    assert.strictEqual(res.body.export.attempts, 1, 'attempts se conserva como historia');
    check('retry reencola la MISMA fila y conserva el historial de intentos');

    res = await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-02' });
    assert.strictEqual(res.body.export.id, failingExportId);
    assert.strictEqual(res.body.export.attempts, 2);
    res = await asExecutor('POST', `/api/v1/operations/exports/${failingExportId}/result`,
      { device: 'sim-02', outcome: 'ok', folio: 'HC-2026-002' });
    assert.strictEqual(res.body.consultation_exported, true);
    assert.strictEqual(fake.tables.consultations.find((c) => c.id === C.failing).estado, 'exportada');
    check('tras el reintento, el éxito confirmado sí exporta la consulta');

    const history = fake.tables.graph_note_exports.find((e) => e.id === failingExportId).attempt_history;
    assert.deepStrictEqual(history.map((h) => h.event), ['claimed', 'result', 'retry', 'claimed', 'result']);
    check('el historial conserva la secuencia completa de intentos y errores');

    // 19. needs_doctor: ni éxito ni fallo del sistema — acción del médico.
    drainQueue();
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.needsdoc });
    const needsDocId = res.body.export.id;
    await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-01' });
    res = await asExecutor('POST', `/api/v1/operations/exports/${needsDocId}/result`, {
      device: 'sim-01',
      outcome: 'needs_doctor',
      unresolved_fields: ['Servicio', 'Fecha de egreso']
    });
    assert.strictEqual(res.body.status, 'needs_doctor');
    assert.strictEqual(res.body.consultation_exported, false);
    assert.strictEqual(fake.tables.consultations.find((c) => c.id === C.needsdoc).estado, 'aprobada');
    res = await asDoctor('GET', `/api/clinical/exports?consultation_id=${C.needsdoc}`);
    assert.deepStrictEqual(res.body.export.result_summary.unresolved_fields, ['Servicio', 'Fecha de egreso']);
    check('needs_doctor informa qué campos faltaron y deja la consulta en aprobada');

    res = await asDoctor('POST', `/api/clinical/exports/${needsDocId}/retry`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.status, 'pending');
    check('desde needs_doctor el médico puede reintentar');

    // 20. Cancelar solo mientras nadie lo tomó.
    drainQueue();
    res = await asDoctor('POST', '/api/clinical/exports', { consultation_id: C.cancelme });
    const cancelId = res.body.export.id;
    res = await asDoctor('POST', `/api/clinical/exports/${cancelId}/cancel`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.status, 'cancelled');
    check('cancel funciona mientras el trabajo está en cola');

    res = await asDoctor('POST', `/api/clinical/exports/${cancelId}/retry`);
    assert.strictEqual(res.body.export.status, 'pending');
    await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-01' });
    res = await asDoctor('POST', `/api/clinical/exports/${cancelId}/cancel`);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'EXPORT_NOT_CANCELLABLE');
    check('un trabajo ya reclamado no se puede cancelar (nada de botones placebo)');

    // 21. Cola vacía -> 204.
    for (const job of fake.tables.graph_note_exports) {
      if (['pending', 'claimed'].includes(job.status)) job.status = 'completed';
    }
    res = await asExecutor('POST', '/api/v1/operations/exports/claim', { device: 'sim-01' });
    assert.strictEqual(res.status, 204);
    check('cola vacía ⇒ 204: el ejecutor sabe que no hay nada que hacer');

    // 22. Nunca hay un trabajo sin dueño de consulta.
    const orphans = fake.tables.graph_note_exports.filter((e) => !e.doctor_id || !e.organization_id);
    assert.strictEqual(orphans.length, 0);
    check('todo trabajo lleva doctor_id y organization_id (base de la política de lectura)');

    console.log(`\n✅ Flujo de exportación end-to-end: ${checks} comprobaciones OK.`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
