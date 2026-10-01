// El juez de docs/specs/003-el-sondeo-de-exportes-no-gasta-logs.md.
//   node scripts/verify-sondeo-de-exportes.js
//
// El servicio y el repositorio de exportes reales sobre la base falsa de exportes (la misma del
// juez del flujo, tests/helpers/fakeNoteExportSupabase.js), contando cuántas preguntas llegan a la
// RPC del claim, con un reloj que el juez mueve. El registro de Windows, sobre scripts/lib/fakeSupabase.js.
const assert = require('assert');
const { promesa, cerrar } = require('./lib/promesas');
const createFakeSupabaseSimple = require('./lib/fakeSupabase');
const { createFakeSupabase } = require('../tests/helpers/fakeNoteExportSupabase');
const SupabaseNoteExportRepository = require('../src/infrastructure/repositories/SupabaseNoteExportRepository');
const NoteExportService = require('../src/application/use-cases/NoteExportService');
const WindowsTelemetryService = require('../src/application/use-cases/WindowsTelemetryService');
const { computeSignatureHash } = require('../src/application/use-cases/NoteSignatureHash');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const PATIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EJECUTOR = 'windows-u@PC-CONSULTORIO-1';
const SEGUNDO = 1000;

function consultaFirmada(id) {
  const note = [{ id: 's1', titulo: 'Motivo de consulta', kind: 'texto', texto: 'Dolor lumbar de 3 días.' }];
  const resumen = 'Lumbalgia mecánica.';
  const codigos = [{ id: 'c1', sistema: 'CIE-10', codigo: 'M54.5', descripcion: 'Lumbago', estado: 'aceptado' }];
  return {
    id, organization_id: ORG, medico_id: DOCTOR, patient_id: PATIENT, estado: 'aprobada',
    note, resumen, codigos, especialidad: 'Medicina general', servicio: 'Consulta externa',
    fecha: '2026-10-01T10:00:00.000Z',
    firma: { por: 'Dra. Ruiz', fecha: '2026-10-01T10:05:00.000Z', hash: computeSignatureHash({ note, resumen, codigos }) }
  };
}

// Una instancia de Graph con su cola de exportes, contando las preguntas que llegan a la base.
function graph({ consultas = 3 } = {}) {
  const base = createFakeSupabase();
  let t = Date.parse('2026-10-01T15:00:00.000Z');
  let preguntas = 0;
  let falla = false;
  const rpc = base.rpc;
  base.rpc = async (fn, args) => {
    if (fn === 'graph_claim_next_note_export') {
      preguntas += 1;
      if (falla) { falla = false; throw new Error('la base no contesta'); }
    }
    return rpc(fn, args);
  };
  base.tables.profiles.push({ id: DOCTOR, organization_id: ORG, role: 'medico', full_name: 'Dra. Ruiz', email: 'medico@x' });
  const ids = [];
  for (let i = 1; i <= consultas; i += 1) {
    const id = `dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`;
    base.tables.consultations.push(consultaFirmada(id));
    ids.push(id);
  }
  const servicio = new NoteExportService({
    repository: new SupabaseNoteExportRepository(base),
    defaultWorkflowId: 'wf-sap-hc',
    now: () => t
  });
  return {
    base, servicio, ids,
    preguntas: () => preguntas,
    fallarLaProxima: () => { falla = true; },
    avanzar: (ms) => { t += ms; },
    preguntar: () => servicio.claimNext({ claimedBy: EJECUTOR }),
    pedir: (id) => servicio.createExport({ consultationId: id, requester: { id: DOCTOR, email: 'medico@x' } })
  };
}

async function main() {
  await promesa(301, 'Mientras no hay exportes pendientes, las preguntas de los ejecutores llegan a la base como mucho una vez cada 15 segundos', async () => {
    const g = graph();
    // Dos PCs preguntando cada 3 s durante un minuto: 40 preguntas.
    for (let i = 0; i < 20; i += 1) {
      await g.preguntar();
      await g.preguntar();
      g.avanzar(3 * SEGUNDO);
    }
    assert.ok(g.preguntas() <= 4, `en un minuto sin trabajo llegaron ${g.preguntas()} preguntas a la base (como mucho 4)`);
  });

  await promesa(302, 'Un exporte pedido en Graph se entrega en la siguiente pregunta de un ejecutor', async () => {
    const g = graph();
    await g.preguntar(); // la cola está vacía: queda recordado
    g.avanzar(2 * SEGUNDO);
    await g.pedir(g.ids[0]);
    const r = await g.preguntar();
    assert.ok(r.export, 'la nota recién pedida no se entregó en la siguiente pregunta');
    assert.strictEqual(r.export.consultation_id, g.ids[0]);
  });

  await promesa(303, 'Un exporte reintentado en Graph se entrega en la siguiente pregunta de un ejecutor', async () => {
    const g = graph();
    const { export: pedido } = await g.pedir(g.ids[0]);
    await g.servicio.cancelExport({ exportId: pedido.id, requester: { id: DOCTOR } });
    await g.preguntar(); // cancelado: la cola queda vacía y recordada
    g.avanzar(2 * SEGUNDO);
    await g.servicio.retryExport({ exportId: pedido.id, requester: { id: DOCTOR } });
    const r = await g.preguntar();
    assert.ok(r.export, 'el exporte reintentado no se entregó en la siguiente pregunta');
    assert.strictEqual(r.export.id, pedido.id);
  });

  await promesa(304, 'Después de entregar un exporte, la siguiente pregunta vuelve a ir a la base', async () => {
    const g = graph();
    await g.pedir(g.ids[0]);
    await g.pedir(g.ids[1]);
    const primero = await g.preguntar();
    g.avanzar(3 * SEGUNDO);
    const segundo = await g.preguntar();
    assert.ok(primero.export && segundo.export, 'con dos exportes en la cola, la segunda pregunta no entregó el segundo');
    assert.notStrictEqual(primero.export.id, segundo.export.id);
  });

  await promesa(305, 'Si la base falla al responder una pregunta, la siguiente pregunta vuelve a ir a la base', async () => {
    const g = graph();
    g.fallarLaProxima();
    await assert.rejects(() => g.preguntar(), /la base no contesta/, 'el fallo de la base llega al ejecutor como fallo');
    g.avanzar(3 * SEGUNDO);
    const antes = g.preguntas();
    await g.preguntar();
    assert.strictEqual(g.preguntas(), antes + 1, 'tras un fallo, la siguiente pregunta no fue a la base: el fallo se recordó como cola vacía');
  });

  await promesa(306, 'Un exporte que entra a la cola por otro camino se entrega como mucho 15 segundos después', async () => {
    const g = graph();
    await g.preguntar(); // vacía y recordada
    // Otra instancia de Graph lo pide: esta no se entera.
    const otra = new NoteExportService({ repository: new SupabaseNoteExportRepository(g.base), defaultWorkflowId: 'wf-sap-hc' });
    await otra.createExport({ consultationId: g.ids[0], requester: { id: DOCTOR, email: 'medico@x' } });
    let entregado = null;
    let espera = 0;
    while (!entregado && espera <= 30 * SEGUNDO) {
      g.avanzar(3 * SEGUNDO);
      espera += 3 * SEGUNDO;
      entregado = (await g.preguntar()).export;
    }
    assert.ok(entregado, 'el exporte pedido en otra instancia no se entregó en 30 s');
    assert.ok(espera <= 15 * SEGUNDO, `el exporte pedido en otra instancia tardó ${espera / SEGUNDO} s en entregarse`);
  });

  const registro = async () => {
    const db = createFakeSupabaseSimple();
    const llamadas = [];
    for (const metodo of ['select', 'insert', 'update', 'upsert', 'delete', 'rpc']) {
      const real = db[metodo];
      if (typeof real !== 'function') continue;
      db[metodo] = async (...args) => { llamadas.push(`${metodo} ${args[0]}`); return real(...args); };
    }
    return { db, llamadas, servicio: new WindowsTelemetryService(db) };
  };

  await promesa(307, 'El registro de un usuario de Windows es una sola petición a la base', async () => {
    const r = await registro();
    await r.servicio.register({ email: 'ana@hospital.co', displayName: 'Ana' });
    const antes = r.llamadas.length;
    await r.servicio.register({ email: 'ana@hospital.co', displayName: 'Ana', appVersion: '2.4.0' });
    const hechas = r.llamadas.slice(antes);
    assert.strictEqual(hechas.length, 1, `registrarse hizo ${hechas.length} peticiones: ${hechas.join(', ')}`);
    const usuarios = r.db.table('graph_windows_users');
    assert.strictEqual(usuarios.length, 1, 'registrarse dos veces dejó más de un usuario');
    assert.strictEqual(usuarios[0].app_version, '2.4.0', 'el segundo registro no actualizó la versión');
  });

  await promesa(308, 'Registrarse otra vez no cambia cuándo se vio por primera vez a ese usuario', async () => {
    const r = await registro();
    await r.servicio.register({ email: 'ana@hospital.co', displayName: 'Ana' });
    const [usuario] = r.db.table('graph_windows_users');
    usuario.first_seen_at = '2026-08-01T12:00:00.000Z';
    usuario.created_at = '2026-08-01T12:00:00.000Z';
    await r.servicio.register({ email: 'ana@hospital.co', displayName: 'Ana' });
    const [despues] = r.db.table('graph_windows_users');
    assert.strictEqual(despues.first_seen_at, '2026-08-01T12:00:00.000Z', 'el segundo registro movió first_seen_at');
    assert.strictEqual(despues.created_at, '2026-08-01T12:00:00.000Z', 'el segundo registro movió created_at');
  });

  cerrar('verify-sondeo-de-exportes');
}

main().catch((error) => {
  for (let e = error; e; e = e.cause) console.error(e.stack || e);
  process.exit(1);
});
