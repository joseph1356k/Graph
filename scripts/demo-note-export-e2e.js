#!/usr/bin/env node
// DEMO end-to-end del flujo completo de exportación a historia clínica.
//   node scripts/demo-note-export-e2e.js
//   node scripts/demo-note-export-e2e.js --outcome error
//   node scripts/demo-note-export-e2e.js --outcome needs_doctor
//
// A diferencia de `verify-note-export-flow.js` (que llama a los endpoints desde
// el propio proceso), esta demo levanta un servidor de verdad y lanza el
// SIMULADOR REAL como proceso aparte — el mismo script, por HTTP, con su API
// key. Es la prueba de que el contrato claim/result funciona entre procesos
// distintos, que es como funcionará con el ejecutor de Operations.
//
// Recorre los 9 pasos del flujo:
//   1. el médico tiene la nota firmada
//   2. pulsa "Exportar a HC"
//   3. Miracle Notes pide la exportación a Graph
//   4. Graph valida (hash de la firma incluido) y persiste el trabajo
//   5. el ejecutor simulado reclama el trabajo
//   6. el simulador reporta éxito o fallo
//   7. Graph actualiza el estado real
//   8. Miracle Notes recupera y muestra ese estado
//   9. la consulta pasa a 'exportada' SOLO tras el éxito confirmado
//
// Lo único falso es la base de datos (PostgREST en memoria). El esquema y las
// RPCs se prueban contra Postgres real en `verify-note-exports-db.js`.
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const SupabaseNoteExportRepository = require('../src/infrastructure/repositories/SupabaseNoteExportRepository');
const NoteExportService = require('../src/application/use-cases/NoteExportService');
const { computeSignatureHash } = require('../src/application/use-cases/NoteSignatureHash');
const registerNoteExportRoutes = require('../web/api/registerNoteExportRoutes');
const { createFakeSupabase } = require('../tests/helpers/fakeNoteExportSupabase');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const PATIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONSULTATION = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const API_KEY = 'demo-executor-key';

const outcome = (() => {
  const i = process.argv.indexOf('--outcome');
  const value = i > 0 ? `${process.argv[i + 1] || ''}`.trim() : 'ok';
  if (!['ok', 'needs_doctor', 'error'].includes(value)) {
    console.error(`--outcome inválido: ${value} (ok | needs_doctor | error)`);
    process.exit(2);
  }
  return value;
})();

let step = 0;
function say(text) {
  step += 1;
  console.log(`\n${step}. ${text}`);
}

function runSimulator(baseUrl, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'simulate-operations-executor.js'),
      '--once',
      '--base-url', baseUrl,
      '--api-key', API_KEY,
      '--device', 'demo-equipo-consultorio',
      '--work-seconds', '0',
      '--outcome', outcome,
      ...extraArgs
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      for (const line of out.split('\n')) if (line.trim()) console.log(`   │ ${line}`);
      // 3 = no había trabajo en la cola; para la demo eso es un fallo.
      if (code === 0) resolve(out);
      else reject(new Error(`el simulador terminó con código ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const fake = createFakeSupabase();
  const noteExportService = new NoteExportService({
    repository: new SupabaseNoteExportRepository(fake),
    defaultWorkflowId: 'wf-sap-historia-clinica',
    leaseSeconds: 600,
    maxAttempts: 3
  });

  // --- estado inicial: una nota FIRMADA por el médico ----------------------
  const note = [
    { id: 's1', titulo: 'Motivo de consulta', kind: 'texto', texto: 'Dolor lumbar de 3 días de evolución.' },
    { id: 's2', titulo: 'Impresión diagnóstica', kind: 'texto', texto: 'Lumbalgia mecánica.' },
    { id: 's3', titulo: 'Plan', kind: 'lista', items: ['Analgésico cada 8 h', 'Control en 7 días'] }
  ];
  const resumen = 'Paciente con lumbalgia mecánica; manejo analgésico y control en 7 días.';
  const codigos = [
    { id: 'c1', sistema: 'CIE-10', codigo: 'M54.5', descripcion: 'Lumbago no especificado', estado: 'aceptado' }
  ];

  fake.tables.profiles.push({
    id: DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dra. Ruiz', email: 'medico@itsmiracleai.com'
  });
  fake.tables.consultations.push({
    id: CONSULTATION,
    organization_id: ORG,
    medico_id: DOCTOR,
    patient_id: PATIENT,
    estado: 'aprobada',
    note,
    resumen,
    codigos,
    especialidad: 'Medicina general',
    servicio: 'Consulta externa',
    fecha: '2026-07-27T10:00:00.000Z',
    // El hash lo calculó Miracle Notes al firmar, con la serialización compartida.
    firma: {
      por: 'Dra. Ruiz',
      fecha: '2026-07-27T10:05:00.000Z',
      hash: computeSignatureHash({ note, resumen, codigos })
    }
  });

  // --- servidor: los dos carriles de auth, como en producción --------------
  const app = express();
  app.use(express.json({ limit: '16mb' }));
  app.use('/api/clinical/exports', (req, _res, next) => {
    req.clinicalUser = { id: DOCTOR, email: 'medico@itsmiracleai.com' };
    next();
  });
  app.use('/api/v1', (req, res, next) => {
    if (`${req.get('x-api-key') || ''}` !== API_KEY) {
      return res.status(401).json({ error: 'API key invalida o ausente.' });
    }
    req.apiClient = { label: 'demo-executor' };
    return next();
  });
  registerNoteExportRoutes(app, { noteExportService });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const doctor = async (method, url, body) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const estado = () => fake.tables.consultations.find((c) => c.id === CONSULTATION).estado;

  try {
    console.log('═══ DEMO: exportar una nota firmada a la historia clínica ═══');
    console.log(`    servidor Graph: ${baseUrl}`);
    console.log(`    desenlace que reportará el ejecutor: ${outcome}`);

    say('El médico revisó y FIRMÓ la nota.');
    console.log(`   consulta ${CONSULTATION} · estado="${estado()}" · firmada por Dra. Ruiz`);
    assert.strictEqual(estado(), 'aprobada');

    say('Pulsa "Exportar a HC" → Miracle Notes pide la exportación a Graph.');
    let res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATION });
    assert.strictEqual(res.status, 201, `esperaba 201, fue ${res.status}`);
    const exportId = res.body.export.id;
    console.log(`   HTTP 201 · trabajo ${exportId} · status="${res.body.export.status}"`);
    console.log(`   hash de la firma re-verificado (hash_source=${res.body.export.hash_source})`);

    say('La UI NO dice "exportada": la consulta sigue aprobada.');
    console.log(`   estado de la consulta: "${estado()}"  ← todavía no se escribió nada en el HIS`);
    assert.strictEqual(estado(), 'aprobada');

    say('Doble clic del médico: la segunda petición NO crea otro trabajo.');
    res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATION });
    console.log(`   HTTP ${res.status} · ${res.body.error.code} · apunta al mismo trabajo ${res.body.export.id}`);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.export.id, exportId);
    assert.strictEqual(fake.tables.graph_note_exports.length, 1, 'debe haber UN solo trabajo');

    say('El ejecutor simulado de Operations reclama el trabajo (proceso aparte, por HTTP).');
    await runSimulator(baseUrl);

    say('Graph actualizó el estado real; Miracle Notes lo recupera (como tras recargar la página).');
    res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATION}`);
    const job = res.body.export;
    console.log(`   trabajo: status="${job.status}" · intentos=${job.attempts} · ejecutor=${job.claimed_by}`);
    if (job.result_summary?.folio) console.log(`   folio devuelto por el HIS: ${job.result_summary.folio}`);
    if (job.error_code) console.log(`   error_code: ${job.error_code}`);
    if (job.result_summary?.unresolved_fields?.length) {
      console.log(`   campos sin resolver: ${job.result_summary.unresolved_fields.join(', ')}`);
    }
    console.log(`   historial: ${job.attempt_history.map((h) => h.event).join(' → ')}`);

    say('Estado final de la consulta.');
    if (outcome === 'ok') {
      assert.strictEqual(job.status, 'completed');
      assert.strictEqual(res.body.consultation_estado, 'exportada');
      assert.strictEqual(estado(), 'exportada');
      console.log('   ✅ estado="exportada" — y solo porque el ejecutor CONFIRMÓ el éxito');
    } else {
      const esperado = outcome === 'needs_doctor' ? 'needs_doctor' : 'failed';
      assert.strictEqual(job.status, esperado);
      assert.strictEqual(res.body.consultation_estado, 'aprobada');
      assert.strictEqual(estado(), 'aprobada');
      console.log(`   ⚠ trabajo="${esperado}" y la consulta SIGUE en "aprobada": sin éxito no hay exportación`);

      say('El médico reintenta y esta vez el ejecutor confirma el éxito.');
      res = await doctor('POST', `/api/clinical/exports/${exportId}/retry`);
      assert.strictEqual(res.status, 200);
      console.log(`   trabajo de vuelta en "${res.body.export.status}" (intentos previos: ${res.body.export.attempts})`);

      // Segundo pase del simulador, ahora con éxito.
      const child = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [
          path.join(__dirname, 'simulate-operations-executor.js'),
          '--once', '--base-url', baseUrl, '--api-key', API_KEY,
          '--device', 'demo-equipo-consultorio', '--work-seconds', '0',
          '--outcome', 'ok', '--folio', 'HC-DEMO-RETRY'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', (c) => { out += c; });
        proc.stderr.on('data', (c) => { out += c; });
        proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`simulador salió ${code}`))));
        proc.on('error', reject);
      });
      for (const line of child.split('\n')) if (line.trim()) console.log(`   │ ${line}`);

      res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATION}`);
      assert.strictEqual(res.body.export.status, 'completed');
      assert.strictEqual(estado(), 'exportada');
      console.log(`   ✅ tras el reintento: estado="exportada" · folio ${res.body.export.result_summary.folio}`);
      console.log(`   historial completo: ${res.body.export.attempt_history.map((h) => h.event).join(' → ')}`);
    }

    say('La cola queda vacía: el ejecutor no tiene nada más que hacer.');
    const claim = await fetch(`${baseUrl}/api/v1/operations/exports/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ device: 'demo-equipo-consultorio' })
    });
    console.log(`   POST /claim → HTTP ${claim.status} (204 = sin trabajos)`);
    assert.strictEqual(claim.status, 204);

    console.log('\n═══ DEMO COMPLETA: el flujo funcionó de extremo a extremo ═══');
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`\n❌ La demo falló: ${error.message}`);
  process.exit(1);
});
