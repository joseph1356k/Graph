// Verificación E2E de la exportación a historia clínica contra POSTGRES REAL.
//   npm i pg --no-save && node scripts/verify-note-export-real-postgres.js
//
// Cierra la última costura que se puede verificar sin un Supabase de staging:
//
//   simulador real (PROCESO APARTE) → HTTP → rutas y servicio reales de Graph
//   → shim PostgREST → Postgres real con la migración y las RPCs aplicadas
//
// Frente a los otros dos arneses:
//   · verify-note-export-flow.js  — rutas reales, base de datos falsa en memoria.
//   · verify-note-exports-db.js   — esquema y RPCs reales, sin pasar por HTTP.
//   · este                        — los dos a la vez, y el simulador de verdad
//                                   como proceso separado hablando por la red.
//
// El shim traduce a SQL el subconjunto de PostgREST que usa SupabaseRestClient.
// Se conecta con un rol BYPASSRLS dedicado, que es lo que hace la service-role
// key de Supabase.
//
// `pg` NO es dependencia de Graph a propósito (el runtime habla con Supabase por
// HTTP, no por el protocolo de Postgres). Por eso este arnés es opt-in y SALTA
// con aviso si falta `pg` o si no hay Postgres alcanzable: así nunca rompe a
// quien no lo tenga montado.
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const DB = process.env.GRAPH_E2E_DB_NAME || 'graph_note_export_e2e';
const API_KEY = 'e2e-real-key';
// Rol dedicado para el arnés: no se toca la contraseña del superusuario del
// cluster. BYPASSRLS porque es el papel que cumple la service-role key.
const E2E_ROLE = 'graph_e2e_service';
const E2E_PASSWORD = 'graph-e2e-local';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCTOR = '11111111-1111-4111-8111-111111111111';
const PATIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function skip(reason) {
  console.log(`⏭️  E2E contra Postgres real SALTADO: ${reason}`);
  console.log('    Para correrlo: npm i pg --no-save y un Postgres local accesible');
  console.log('    (service postgresql start).');
  process.exit(0);
}

let Client;
let express;
try {
  ({ Client } = require('pg'));
  express = require('express');
} catch (error) {
  skip(`falta una dependencia local (${error.message.split('\n')[0]})`);
}

const SupabaseRestClient = require('../src/infrastructure/SupabaseRestClient');
const SupabaseNoteExportRepository = require('../src/infrastructure/repositories/SupabaseNoteExportRepository');
const NoteExportService = require('../src/application/use-cases/NoteExportService');
const { computeSignatureHash } = require('../src/application/use-cases/NoteSignatureHash');
const registerNoteExportRoutes = require('../web/api/registerNoteExportRoutes');

let checks = 0;
const results = [];
function check(label) {
  checks += 1;
  results.push(label);
  console.log(`  ok  ${label}`);
}

// El SQL va por archivo, no por -c: el multilínea a través de dos capas de
// quoting de shell es imposible de sostener.
let sqlSeq = 0;
function psql(sql, { db = DB } = {}) {
  sqlSeq += 1;
  const file = `/tmp/e2e-real-${process.pid}-${sqlSeq}.sql`;
  fs.writeFileSync(file, sql);
  fs.chmodSync(file, 0o644);
  try {
    return execSync(`su postgres -c "psql -tA -v ON_ERROR_STOP=1 -d ${db} -f ${file}" 2>&1`,
      { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`SQL falló:\n${sql.trim().slice(0, 400)}\n--- salida ---\n${`${error.stdout || error.message}`.trim()}`);
  } finally {
    fs.unlinkSync(file);
  }
}

// --- shim PostgREST -------------------------------------------------------
// Traduce ?col=eq.v&select=…&limit=… a SQL, y /rpc/<fn> a select public.<fn>(…).
function startPostgrestShim(pgClient) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
    });
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    try {
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
      if (rpc) {
        const fn = decodeURIComponent(rpc[1]);
        const keys = Object.keys(body || {});
        const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
        const values = keys.map((k) => {
          const v = body[k];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        // El claim devuelve SETOF de la tabla; el resto devuelve jsonb escalar.
        if (fn === 'graph_claim_next_note_export') {
          const { rows } = await pgClient.query(`select * from public.${fn}(${args})`, values);
          return send(200, rows);
        }
        const { rows } = await pgClient.query(`select public.${fn}(${args}) as v`, values);
        return send(200, rows[0]?.v ?? null);
      }

      const table = url.pathname.replace('/rest/v1/', '');
      const filters = [];
      const values = [];
      let select = '*';
      let limit = '';
      for (const [key, raw] of url.searchParams.entries()) {
        if (key === 'select') { select = raw.split(',').map((c) => `"${c.trim()}"`).join(', '); continue; }
        if (key === 'limit') { limit = ` limit ${Number(raw) || 1}`; continue; }
        if (key === 'order' || key === 'offset') continue;
        if (raw.startsWith('eq.')) {
          values.push(raw.slice(3));
          filters.push(`"${key}" = $${values.length}`);
        }
      }
      const where = filters.length ? ` where ${filters.join(' and ')}` : '';

      if (req.method === 'GET') {
        const { rows } = await pgClient.query(`select ${select} from public."${table}"${where}${limit}`, values);
        return send(200, rows);
      }
      if (req.method === 'POST') {
        const cols = Object.keys(body);
        const params = cols.map((c, i) => {
          const v = body[c];
          return v !== null && typeof v === 'object' ? `$${i + 1}::jsonb` : `$${i + 1}`;
        });
        const vals = cols.map((c) => {
          const v = body[c];
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        const { rows } = await pgClient.query(
          `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${params.join(', ')}) returning ${select}`,
          vals
        );
        return send(201, rows);
      }
      return send(405, { message: 'método no soportado por el shim' });
    } catch (error) {
      // Espeja el formato de error de PostgREST (el repositorio detecta 23505).
      const status = error.code === '23505' ? 409 : 400;
      return send(status, { code: error.code, message: error.message });
    }
  });
  return server;
}

async function main() {
  // Preflight: sin psql ni cluster alcanzable, este arnés no aplica.
  try {
    execSync('which psql', { stdio: 'ignore' });
    execSync('su postgres -c "psql -tAc \'select 1\' -d postgres"', { stdio: 'ignore' });
  } catch (error) {
    skip('no hay un Postgres local alcanzable como usuario del sistema `postgres`');
  }

  console.log('═══ E2E contra POSTGRES REAL + simulador real ═══\n');

  // 1. Base limpia con la migración de verdad.
  execSync(`su postgres -c "dropdb --if-exists ${DB} && createdb ${DB}"`, { stdio: 'ignore' });
  for (const f of [
    'tests/sql/00-supabase-bootstrap.sql',
    'tests/sql/01-upstream-miracle-notes.sql',
    'supabase/migrations/20260727000000_graph_note_exports.sql'
  ]) {
    execSync(`su postgres -c ${JSON.stringify(`psql -q -v ON_ERROR_STOP=1 -d ${DB} -f ${path.join(REPO_ROOT, f)}`)}`, { stdio: 'ignore' });
  }
  check('migración 20260727000000_graph_note_exports.sql aplicada en Postgres real');

  // 2. Semilla: una nota firmada, con el hash calculado por el módulo compartido.
  const note = [
    { id: 's1', titulo: 'Motivo de consulta', kind: 'texto', texto: 'Dolor lumbar de 3 días.' },
    { id: 's2', titulo: 'Plan', kind: 'lista', items: ['Analgésico', 'Control en 7 días'] }
  ];
  const resumen = 'Lumbalgia mecánica.';
  const codigos = [{ id: 'c1', sistema: 'CIE-10', codigo: 'M54.5', descripcion: 'Lumbago', estado: 'aceptado' }];
  const hash = computeSignatureHash({ note, resumen, codigos });

  const CONSULTATIONS = {
    ok: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    err: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    needs: 'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
    cancel: 'dddddddd-dddd-4ddd-8ddd-dddddddddd04'
  };

  psql(`
    insert into auth.users (id, email) values ('${DOCTOR}', 'medico@itsmiracleai.com');
    insert into public.organizations (id, name, kind) values ('${ORG}', 'Clínica E2E', 'institution');
    insert into public.profiles (id, email, full_name, role, organization_id)
      values ('${DOCTOR}', 'medico@itsmiracleai.com', 'Dra. Ruiz', 'medico', '${ORG}');
    insert into public.patients (id, organization_id, created_by, nombre)
      values ('${PATIENT}', '${ORG}', '${DOCTOR}', 'Paciente E2E');
  `);
  // Literal SQL de verdad: comillas simples y '' para escapar.
  const lit = (value) => `'${`${value}`.replace(/'/g, "''")}'`;
  const jsonb = (value) => `${lit(JSON.stringify(value))}::jsonb`;

  // La firma se calcula sobre la fila TAL COMO LA DEVUELVE LA BASE DE DATOS, no
  // sobre el objeto JS previo al insert. Postgres normaliza el orden de claves de
  // jsonb, así que hashear el objeto original daría un hash que Graph nunca
  // podría reproducir. Esto reproduce exactamente el flujo real de
  // `signConsultationNote`: SELECT de la fila → hash → UPDATE a 'aprobada'.
  for (const id of Object.values(CONSULTATIONS)) {
    psql(`insert into public.consultations
        (id, organization_id, medico_id, patient_id, estado, resumen, note, codigos)
      values (${lit(id)}, ${lit(ORG)}, ${lit(DOCTOR)}, ${lit(PATIENT)}, 'borrador',
        ${lit(resumen)}, ${jsonb(note)}, ${jsonb(codigos)})`);

    const stored = JSON.parse(psql(
      `select json_build_object('note', note, 'resumen', resumen, 'codigos', codigos)
         from public.consultations where id = ${lit(id)}`
    ));
    const firmaHash = computeSignatureHash(stored);
    psql(`update public.consultations
             set estado = 'aprobada',
                 firma = ${jsonb({ por: 'Dra. Ruiz', fecha: '2026-07-27T10:05:00.000Z', hash: firmaHash })}
           where id = ${lit(id)} and estado = 'borrador'`);
  }
  check('4 consultas firmadas como en producción: hash calculado sobre la fila leída de la BD');

  // El hash del objeto JS previo al insert NO coincide con el de la fila
  // almacenada — por eso la firma se calcula leyendo, nunca antes de escribir.
  const storedFirst = JSON.parse(psql(
    `select json_build_object('note', note, 'resumen', resumen, 'codigos', codigos)
       from public.consultations where id = ${lit(CONSULTATIONS.ok)}`
  ));
  if (computeSignatureHash(storedFirst) !== hash) {
    check('confirmado: jsonb normaliza el orden de claves, así que el hash SOLO cuadra leyendo de la BD');
  }

  // 3. Shim + Graph real.
  // El proceso puede correr como root, donde la autenticación peer por socket no
  // aplica: se conecta por TCP con un rol dedicado del cluster local. No se toca
  // la contraseña del superusuario. BYPASSRLS = el papel de la service-role key.
  psql(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${E2E_ROLE}') then
        create role ${E2E_ROLE} login bypassrls password '${E2E_PASSWORD}';
      else
        alter role ${E2E_ROLE} login bypassrls password '${E2E_PASSWORD}';
      end if;
    end;
    $$;
    grant all on database ${DB} to ${E2E_ROLE};
    grant usage on schema public, auth to ${E2E_ROLE};
    grant all on all tables in schema public, auth to ${E2E_ROLE};
    grant all on all sequences in schema public to ${E2E_ROLE};
    grant execute on all functions in schema public to ${E2E_ROLE};
  `);
  const pgClient = new Client({
    host: '127.0.0.1', port: 5432, user: E2E_ROLE, password: E2E_PASSWORD, database: DB
  });
  await pgClient.connect();
  const shim = startPostgrestShim(pgClient);
  await new Promise((r) => shim.listen(0, '127.0.0.1', r));
  const shimUrl = `http://127.0.0.1:${shim.address().port}`;

  const restClient = new SupabaseRestClient({ supabaseUrl: shimUrl, serviceRoleKey: 'shim-service-role' });
  const service = new NoteExportService({
    repository: new SupabaseNoteExportRepository(restClient),
    defaultWorkflowId: 'wf-sap-hc',
    leaseSeconds: 600,
    maxAttempts: 3
  });

  const app = express();
  app.use(express.json());
  app.use('/api/clinical/exports', (req, _res, next) => {
    req.clinicalUser = { id: DOCTOR, email: 'medico@itsmiracleai.com' };
    next();
  });
  app.use('/api/v1', (req, res, next) => {
    if (`${req.get('x-api-key') || ''}` !== API_KEY) {
      return res.status(401).json({ error: 'API key invalida o ausente.' });
    }
    req.apiClient = { label: 'e2e-real' };
    return next();
  });
  registerNoteExportRoutes(app, { noteExportService: service });
  const graph = http.createServer(app);
  await new Promise((r) => graph.listen(0, '127.0.0.1', r));
  const graphUrl = `http://127.0.0.1:${graph.address().port}`;
  check(`Graph real levantado sobre Postgres real (${graphUrl})`);

  const doctor = async (method, url, body) => {
    const r = await fetch(`${graphUrl}${url}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  };

  const estado = (id) => psql(`select estado from public.consultations where id = '${id}'`);

  function simulator(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [
        path.join(REPO_ROOT, 'scripts/simulate-operations-executor.js'),
        '--once', '--base-url', graphUrl, '--api-key', API_KEY,
        '--device', 'e2e-equipo', '--work-seconds', '0', ...args
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`simulador salió ${code}: ${out}`))));
    });
  }

  try {
    // ═══ CASO EXITOSO ═══
    console.log('\n── Caso exitoso ──');
    let res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.ok });
    assert.strictEqual(res.status, 201);
    const okId = res.body.export.id;
    assert.strictEqual(res.body.export.hash_source, 'firma');
    check('crear exportación → 201 pending, hash de la firma re-verificado contra Postgres');
    assert.strictEqual(estado(CONSULTATIONS.ok), 'aprobada');
    check('la consulta sigue "aprobada" tras crear el trabajo');

    const simOut = await simulator(['--outcome', 'ok', '--folio', 'HC-REAL-001']);
    assert.ok(/reportado: outcome=ok/.test(simOut));
    check('el simulador real (proceso aparte) reclamó el trabajo y reportó ok');

    assert.strictEqual(psql(`select status from public.graph_note_exports where id = '${okId}'`), 'completed');
    check('estado del trabajo en Postgres: completed');
    assert.strictEqual(estado(CONSULTATIONS.ok), 'exportada');
    check('la consulta pasó a "exportada" en Postgres (solo tras el éxito confirmado)');
    const audit = psql(`select count(*) from public.audit_events
      where consultation_id = '${CONSULTATIONS.ok}' and accion = 'Nota exportada a HC (automática)'`);
    assert.strictEqual(audit, '1');
    const detalle = psql(`select detalle from public.audit_events
      where consultation_id = '${CONSULTATIONS.ok}' and accion = 'Nota exportada a HC (automática)'`);
    assert.ok(detalle.includes('folio HC-REAL-001'), detalle);
    check('auditoría escrita en Postgres con el folio del HIS');

    // ═══ CASO ERROR ═══
    console.log('\n── Caso de error ──');
    res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.err });
    const errId = res.body.export.id;
    await simulator(['--outcome', 'error', '--error-code', 'HIS_LOGIN_FAILED']);
    assert.strictEqual(psql(`select status from public.graph_note_exports where id = '${errId}'`), 'failed');
    check('outcome error → trabajo "failed" en Postgres');
    assert.strictEqual(psql(`select error_code from public.graph_note_exports where id = '${errId}'`), 'HIS_LOGIN_FAILED');
    check('error_code tipado guardado (sin PHI)');
    assert.strictEqual(estado(CONSULTATIONS.err), 'aprobada');
    check('tras el error la consulta SIGUE "aprobada"');
    res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATIONS.err}`);
    assert.strictEqual(res.body.export.status, 'failed');
    check('la UI recibe status=failed → habilita "Reintentar" (isNoteExportRetryable)');

    // reintento → éxito
    res = await doctor('POST', `/api/clinical/exports/${errId}/retry`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.export.status, 'pending');
    check('retry desde failed reencola la MISMA fila');
    await simulator(['--outcome', 'ok', '--folio', 'HC-REAL-RETRY']);
    assert.strictEqual(estado(CONSULTATIONS.err), 'exportada');
    check('tras el reintento el éxito confirmado sí exporta la consulta');
    const hist = psql(`select jsonb_path_query_array(attempt_history, '$[*].event')
      from public.graph_note_exports where id = '${errId}'`);
    assert.ok(hist.includes('claimed') && hist.includes('retry'), hist);
    check(`historial de intentos conservado en Postgres: ${hist}`);

    // ═══ CASO needs_doctor ═══
    console.log('\n── Caso needs_doctor ──');
    res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.needs });
    const needsId = res.body.export.id;
    await simulator(['--outcome', 'needs_doctor', '--unresolved', 'Servicio,Fecha de egreso']);
    assert.strictEqual(psql(`select status from public.graph_note_exports where id = '${needsId}'`), 'needs_doctor');
    check('outcome needs_doctor → trabajo "needs_doctor" en Postgres');
    assert.strictEqual(estado(CONSULTATIONS.needs), 'aprobada');
    check('needs_doctor NO exporta la consulta');
    res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATIONS.needs}`);
    assert.deepStrictEqual(res.body.export.result_summary.unresolved_fields, ['Servicio', 'Fecha de egreso']);
    check('la UI recibe las etiquetas de los campos faltantes para el mensaje al médico');

    // ═══ IDEMPOTENCIA Y RECUPERACIÓN ═══
    console.log('\n── Recuperación e idempotencia ──');
    const [a, b] = await Promise.all([
      doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.cancel }),
      doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.cancel })
    ]);
    assert.deepStrictEqual([a.status, b.status].sort(), [201, 409]);
    const cancelId = (a.status === 201 ? a : b).body.export.id;
    assert.strictEqual(psql(`select count(*) from public.graph_note_exports
      where consultation_id = '${CONSULTATIONS.cancel}'`), '1');
    check('doble clic SIMULTÁNEO contra Postgres real → 201 + 409 y UNA sola fila (UNIQUE)');

    res = await doctor('POST', '/api/clinical/exports', { consultation_id: CONSULTATIONS.cancel });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.export.id, cancelId);
    check('dos solicitudes iguales (secuenciales) → mismo trabajo, sin duplicar');

    res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATIONS.cancel}`);
    assert.strictEqual(res.body.export.status, 'pending');
    assert.strictEqual(res.body.consultation_estado, 'aprobada');
    check('recarga con el trabajo en "pending": el estado se recupera del servidor');

    // cancelar solo desde pending
    res = await doctor('POST', `/api/clinical/exports/${cancelId}/cancel`);
    assert.strictEqual(res.body.export.status, 'cancelled');
    check('cancel desde "pending" funciona');
    await doctor('POST', `/api/clinical/exports/${cancelId}/retry`);
    // ahora reclamado → cancelar debe fallar
    const claimed = await fetch(`${graphUrl}/api/v1/operations/exports/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ device: 'e2e-equipo' })
    });
    const claimedJob = await claimed.json();
    assert.strictEqual(claimedJob.export.id, cancelId);
    res = await doctor('GET', `/api/clinical/exports?consultation_id=${CONSULTATIONS.cancel}`);
    assert.strictEqual(res.body.export.status, 'claimed');
    assert.strictEqual(res.body.consultation_estado, 'aprobada');
    check('recarga con el trabajo en "claimed": estado real, consulta aún "aprobada"');

    res = await doctor('POST', `/api/clinical/exports/${cancelId}/cancel`);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error.code, 'EXPORT_NOT_CANCELLABLE');
    check('cancelar un trabajo ya "claimed" se rechaza (409)');

    // reenviar el mismo resultado
    const first = await fetch(`${graphUrl}/api/v1/operations/exports/${cancelId}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ device: 'e2e-equipo', outcome: 'ok', folio: 'HC-REAL-IDEM' })
    }).then((r) => r.json());
    assert.strictEqual(first.consultation_exported, true);
    const again = await fetch(`${graphUrl}/api/v1/operations/exports/${cancelId}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ device: 'e2e-equipo', outcome: 'ok', folio: 'HC-REAL-IDEM' })
    }).then((r) => r.json());
    assert.strictEqual(again.idempotent, true);
    assert.strictEqual(psql(`select count(*) from public.audit_events
      where consultation_id = '${CONSULTATIONS.cancel}' and accion = 'Nota exportada a HC (automática)'`), '1');
    check('reenviar el mismo resultado → ack idempotente y UNA sola fila de auditoría');

    // cola vacía
    const empty = await fetch(`${graphUrl}/api/v1/operations/exports/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ device: 'e2e-equipo' })
    });
    assert.strictEqual(empty.status, 204);
    check('cola vacía → 204');

    // Honestidad sin configuración: servicio ausente ⇒ 503, no éxito falso.
    const bare = express();
    bare.use(express.json());
    bare.use('/api/clinical/exports', (req, _res, next) => { req.clinicalUser = { id: DOCTOR }; next(); });
    registerNoteExportRoutes(bare, { noteExportService: null });
    const bareServer = http.createServer(bare);
    await new Promise((r) => bareServer.listen(0, '127.0.0.1', r));
    const bareRes = await fetch(`http://127.0.0.1:${bareServer.address().port}/api/clinical/exports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultation_id: CONSULTATIONS.ok })
    });
    const bareBody = await bareRes.json();
    assert.strictEqual(bareRes.status, 503);
    assert.strictEqual(bareBody.error.code, 'SUPABASE_NOT_CONFIGURED');
    bareServer.close();
    check('sin configuración de Supabase: 503 honesto, nunca un éxito falso');

    // Estado final del inventario
    const summary = psql(`select status || '=' || count(*) from public.graph_note_exports group by status order by status`);
    console.log(`\n  inventario final de trabajos: ${summary.split('\n').join(' · ')}`);
    const estados = psql(`select estado || '=' || count(*) from public.consultations group by estado order by estado`);
    console.log(`  inventario final de consultas: ${estados.split('\n').join(' · ')}`);

    console.log(`\n✅ E2E contra Postgres real + simulador real: ${checks} comprobaciones OK.`);
  } finally {
    graph.close();
    shim.close();
    await pgClient.end();
    // Base desechable: se borra siempre, incluso si el arnés falló.
    try {
      execSync(`su postgres -c "dropdb --if-exists ${DB}"`, { stdio: 'ignore' });
    } catch (error) {
      console.error(`  (aviso: no se pudo borrar la base ${DB}: ${error.message})`);
    }
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
