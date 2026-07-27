// Pruebas de integración de graph_note_exports contra un Postgres REAL.
//   node scripts/verify-note-exports-db.js
//
// Aplica, sobre una base limpia y desechable:
//   tests/sql/00-supabase-bootstrap.sql      (emulación de la plataforma Supabase)
//   tests/sql/01-upstream-miracle-notes.sql  (consultations/audit_events de Notes)
//   supabase/migrations/20260727000000_graph_note_exports.sql
//   tests/sql/02-note-exports-tests.sql      (aserciones)
// y luego una prueba de CONCURRENCIA real con varios claims en paralelo, que es
// lo único que demuestra de verdad el FOR UPDATE SKIP LOCKED.
//
// Conexión: $GRAPH_TEST_DATABASE_URL si está definida; si no, el cluster local
// por socket (como root, a través del usuario del sistema `postgres`).
// Sin Postgres alcanzable el script SALTA con aviso y código 0: es una prueba de
// integración, no debe romper `npm test` en una máquina sin base de datos.
const { execFileSync, execSync, exec } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DB_NAME = process.env.GRAPH_TEST_DB_NAME || 'graph_note_exports_it';
const DATABASE_URL = `${process.env.GRAPH_TEST_DATABASE_URL || ''}`.trim();

function skip(reason) {
  console.log(`⏭️  Pruebas de integración de graph_note_exports SALTADAS: ${reason}`);
  console.log('    Para correrlas: arranca Postgres (service postgresql start) o define GRAPH_TEST_DATABASE_URL.');
  process.exit(0);
}

function shellQuote(value) {
  return `'${`${value}`.replace(/'/g, "'\\''")}'`;
}

// psql, o vía `su postgres` cuando corremos como root contra el cluster local.
// Siempre con 2>&1: los RAISE NOTICE de las aserciones salen por stderr y son
// justamente la salida que queremos mostrar.
function psqlCommand(args, { database = DB_NAME, maintenance = false } = {}) {
  const quoted = args.map(shellQuote).join(' ');
  if (DATABASE_URL) {
    const url = maintenance ? DATABASE_URL.replace(/\/[^/?]*(\?|$)/, '/postgres$1') : DATABASE_URL;
    return `psql ${shellQuote(url)} ${quoted} 2>&1`;
  }
  const target = maintenance ? 'postgres' : database;
  return `su postgres -c ${shellQuote(`psql -d ${target} ${quoted}`)} 2>&1`;
}

function runPsql(args, options = {}) {
  return execSync(psqlCommand(args, options), { encoding: 'utf8' });
}

function runPsqlAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    exec(psqlCommand(args, options), { encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(Object.assign(error, { stdout }));
      else resolve(stdout);
    });
  });
}

// --- preflight -------------------------------------------------------------
try {
  execFileSync('which', ['psql'], { stdio: 'ignore' });
} catch (error) {
  skip('no hay cliente psql instalado');
}
try {
  runPsql(['-tAc', 'select 1'], { maintenance: true });
} catch (error) {
  skip(`no se pudo conectar a Postgres (${`${error.stderr || error.message}`.trim().split('\n')[0]})`);
}

console.log('Preparando base de datos desechable…');
runPsql(['-tAc', `drop database if exists ${DB_NAME}`], { maintenance: true });
runPsql(['-tAc', `create database ${DB_NAME}`], { maintenance: true });

const steps = [
  ['emulación de Supabase', 'tests/sql/00-supabase-bootstrap.sql'],
  ['esquema upstream de Miracle Notes', 'tests/sql/01-upstream-miracle-notes.sql'],
  ['migración graph_note_exports', 'supabase/migrations/20260727000000_graph_note_exports.sql'],
  ['aserciones de graph_note_exports', 'tests/sql/02-note-exports-tests.sql']
];

let checks = 0;
for (const [label, relative] of steps) {
  let output;
  try {
    output = runPsql(['-v', 'ON_ERROR_STOP=1', '-f', path.join(REPO_ROOT, relative)]);
  } catch (error) {
    const detail = `${error.stdout || error.message}`;
    console.error(`\n❌ Falló: ${label} (${relative})\n`);
    console.error(detail.split('\n').filter((l) => /ERROR|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n') || detail);
    process.exit(1);
  }
  // Las aserciones se anuncian con RAISE NOTICE 'ok  …'; psql las prefija con
  // "<archivo>:<línea>: NOTICE:  ".
  const oks = `${output}`
    .split('\n')
    .map((line) => line.replace(/^.*?NOTICE:\s{2}/, ''))
    .filter((line) => /^ok\s{2}/.test(line));
  for (const line of oks) {
    console.log(`  ${line.trim()}`);
    checks += 1;
  }
  if (!oks.length) console.log(`  ok  ${label} aplicado`);
}

// ---------------------------------------------------------------------------
// Concurrencia real: varios ejecutores reclamando a la vez. Es la prueba de que
// FOR UPDATE SKIP LOCKED impide que dos ejecutores se lleven el MISMO trabajo
// (que en producción significaría escribir la nota dos veces en el HIS).
// ---------------------------------------------------------------------------
async function verifyConcurrentClaims() {
  const EXECUTORS = 8;

  // Cola limpia con 8 trabajos pendientes, uno por consulta.
  runPsql(['-v', 'ON_ERROR_STOP=1', '-c', `
    delete from public.graph_note_exports;
    delete from public.consultations;
    insert into public.consultations (id, organization_id, medico_id, estado, resumen, note, codigos, firma)
    select
      ('eeeeeeee-eeee-4eee-8eee-' || lpad(g::text, 12, '0'))::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'aprobada', 'Concurrencia ' || g, '[]'::jsonb, '[]'::jsonb, '{"hash":"h"}'::jsonb
    from generate_series(1, ${EXECUTORS}) g;
    insert into public.graph_note_exports
      (consultation_id, organization_id, doctor_id, requested_by, workflow_id, payload, payload_hash)
    select c.id, c.organization_id, c.medico_id, c.medico_id, 'wf-sap-hc', '{}'::jsonb, 'h'
      from public.consultations c;
  `]);

  const claims = await Promise.all(
    Array.from({ length: EXECUTORS }, (_, i) =>
      runPsqlAsync(['-tA', '-c', `select id from public.graph_claim_next_note_export('exec-par-${i + 1}')`])
        .then((out) => {
          const uuid = `${out}`.split('\n').map((l) => l.trim())
            .find((l) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l));
          return uuid || '';
        })
        .catch(() => ''))
  );

  const ids = claims.filter(Boolean);
  const unique = new Set(ids);
  if (ids.length !== EXECUTORS) {
    throw new Error(`se esperaban ${EXECUTORS} claims con trabajo, hubo ${ids.length}`);
  }
  if (unique.size !== EXECUTORS) {
    throw new Error(`DOS EJECUTORES SE LLEVARON EL MISMO TRABAJO: ${ids.length - unique.size} duplicado(s)`);
  }
  console.log(`  ok  ${EXECUTORS} ejecutores en paralelo reclaman ${EXECUTORS} trabajos DISTINTOS (SKIP LOCKED)`);
  checks += 1;

  const remaining = runPsql(['-tAc', "select count(*) from public.graph_note_exports where status = 'pending'"]).trim();
  if (remaining !== '0') throw new Error(`la cola debió quedar vacía, quedan ${remaining} pendientes`);
  console.log('  ok  la cola queda vacía: ningún trabajo se perdió ni se entregó dos veces');
  checks += 1;
}

verifyConcurrentClaims()
  .then(() => {
    runPsql(['-tAc', `drop database if exists ${DB_NAME}`], { maintenance: true });
    console.log(`\n✅ graph_note_exports contra Postgres real: ${checks} comprobaciones OK.`);
  })
  .catch((error) => {
    console.error(`\n❌ Concurrencia: ${error.message}`);
    process.exit(1);
  });
