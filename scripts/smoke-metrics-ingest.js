// Smoke test del MetricsIngestService con un Supabase falso. Corre en Linux/CI sin
// base de datos: prueba lo que el servicio PROMETE, no PostgREST.
//   - el org sale del device, no del payload (aunque el payload mienta);
//   - una fila envenenada va a rejected[] sin tumbar el resto del lote;
//   - el detail se saneia (segunda valla de PHI): claves fuera de lista fuera;
//   - una superficie con forma de título se rechaza;
//   - los uid son deterministas (idempotencia): mismo seq → mismo uid.
//
// Uso: node scripts/smoke-metrics-ingest.js   (exit 0 = ok)

const assert = require('assert');
const MetricsIngestService = require('../src/application/use-cases/MetricsIngestService');

// Supabase falso: registra lo insertado y responde a las RPCs mínimas.
function fakeDb() {
  const insertado = { metrics_events: [], metrics_samples: [], metrics_sap_visits: [] };
  const shifts = [];
  return {
    insertado, shifts,
    async select(table, query) {
      if (table === 'metrics_devices') {
        // El device dice org REAL; el payload intentará mentir con otra.
        return [{ id: '22222222-2222-2222-2222-222222222222', organization_id: 'org-REAL', status: 'active', config_version: 3, hmac_version: 1 }];
      }
      return [];
    },
    async rpc(fn, args) {
      if (fn === 'metrics_upsert_shift') { shifts.push(args); return null; }
      return null;
    },
    async update() { return {}; },
    async request(path, init) {
      const tabla = path.replace('/', '');
      const filas = JSON.parse(init.body);
      insertado[tabla] = (insertado[tabla] || []).concat(filas);
      return null;
    },
  };
}

const dev = '22222222-2222-2222-2222-222222222222';
const shift = '33333333-3333-3333-3333-333333333333';

async function main() {
  const db = fakeDb();
  const svc = new MetricsIngestService(db);

  const resp = await svc.ingestBatch({
    device_id: dev,
    client_now: new Date().toISOString(),
    organization_id: 'org-FALSA-del-payload', // debe ignorarse
    shifts: [{ seq: 0, shift_id: shift, doctor_id: null, started_at: '2026-09-01T13:00:00Z', phase: 'baseline' }],
    samples: [
      { seq: 1, shift_id: shift, bucket_start: '2026-09-01T13:00:00Z', seq_bucket: 0, app: 'sap', surface: 'sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100', foreground_ms: 1000, encounter_key: 'a'.repeat(32) },
      { seq: 2, shift_id: shift, bucket_start: '2026-09-01T13:00:15Z', app: 'chrome', surface: 'Historia clínica — Juan Pérez', foreground_ms: 1000 }, // veneno: surface es un título
      { seq: 3, shift_id: shift, bucket_start: '2026-09-01T13:00:30Z', app: 'sap', surface: 'sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST', foreground_ms: 500, encounter_key: 'no-es-hex' }, // veneno: encounter mal formado
    ],
    events: [
      { seq: 10, shift_id: shift, occurred_at: '2026-09-01T13:00:05Z', kind: 'encounter_enter', encounter_key: 'a'.repeat(32), detail: { rule: 'nv2000', paciente: 'Juan Pérez', documento: '123' } },
      { seq: 11, shift_id: shift, occurred_at: '2026-09-01T13:00:06Z', kind: 'kind_inventado', detail: {} }, // veneno: kind desconocido
    ],
    sap_visits: [
      { seq: 20, shift_id: shift, sid: 'QAS', tcode: 'NWP1', dynpro: '0100', surface: 'sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100', entered_at: '2026-09-01T13:00:00Z', dwell_ms: 25000, ready_ms: null },
    ],
  });

  // 1) org del device, no del payload
  const muestraBuena = db.insertado.metrics_samples[0];
  assert.strictEqual(muestraBuena.organization_id, 'org-REAL', 'la org sale del device, no del payload');
  assert.strictEqual(db.shifts[0].p_org, 'org-REAL', 'el turno también toma la org del device');

  // 2) venenos aislados, resto persiste
  assert.strictEqual(resp.accepted.samples, 1, 'solo la muestra buena entra');
  assert.strictEqual(resp.accepted.events, 1, 'solo el evento con kind válido entra');
  assert.strictEqual(resp.accepted.sap_visits, 1, 'la visita entra');
  const rechazos = resp.rejected.map((r) => `${r.col}:${r.seq}`);
  assert.ok(rechazos.includes('samples:2'), 'la surface-título se rechaza');
  assert.ok(rechazos.includes('samples:3'), 'el encounter mal formado se rechaza');
  assert.ok(rechazos.includes('events:11'), 'el kind inventado se rechaza');

  // 3) PHI saneada en el detail: sobrevive 'rule', mueren 'paciente' y 'documento'
  const evento = db.insertado.metrics_events[0];
  assert.strictEqual(evento.detail.rule, 'nv2000', 'la clave de lista blanca sobrevive');
  assert.ok(!('paciente' in evento.detail), 'el nombre del paciente NO entra al detail');
  assert.ok(!('documento' in evento.detail), 'el documento NO entra al detail');

  // 4) el título-veneno nunca tocó la base
  const dump = JSON.stringify(db.insertado);
  assert.ok(!dump.includes('Juan'), 'ningún fragmento del título llega a persistirse');

  // 5) uid determinista (idempotencia): mismo device+colección+seq → mismo uid
  assert.strictEqual(svc.uid(dev, 'eventos', 10), `22222222-2222-2222-2222-222222222222:eventos:10`, 'uid determinista');
  assert.strictEqual(evento.event_uid, `22222222-2222-2222-2222-222222222222:eventos:10`, 'el evento lleva su uid idempotente');

  // 6) el skew de reloj se mide
  assert.ok(typeof resp.clock_skew_ms === 'number', 'el desfase de reloj se devuelve');
  assert.strictEqual(resp.config_version, 3, 'la config_version sale del device');

  console.log('SMOKE METRICS INGEST: OK — org del device, venenos aislados, PHI saneada, uid idempotente.');
}

main().catch((e) => { console.error('SMOKE FALLÓ:', e.message); process.exit(1); });
