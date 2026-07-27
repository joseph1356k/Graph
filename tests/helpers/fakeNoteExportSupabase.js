// Base de datos falsa para las pruebas de exportación de nota a historia clínica.
//
// Implementa el subconjunto de PostgREST que usa SupabaseNoteExportRepository y
// las RPCs de la migración `20260727000000_graph_note_exports.sql`, en memoria,
// para que las pruebas y la demo corran sin credenciales ni red.
//
// OJO: la semántica AUTORITATIVA de esas RPCs se prueba contra Postgres de
// verdad en `scripts/verify-note-exports-db.js` (incluido FOR UPDATE SKIP
// LOCKED, RLS y el trigger de inmutabilidad, que aquí no se pueden reproducir).
// Este fake existe para probar rutas, auth, validaciones y códigos HTTP.
function createFakeSupabase() {
  const tables = {
    consultations: [],
    profiles: [],
    audit_events: [],
    graph_note_exports: []
  };
  let sequence = 0;

  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const uuid = (prefix) => {
    sequence += 1;
    return `${prefix}${`${sequence}`.padStart(12, '0')}`.slice(0, 36);
  };

  function parseFilters(query) {
    return `${query || ''}`.split('&').filter(Boolean).reduce((acc, pair) => {
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const raw = decodeURIComponent(pair.slice(eq + 1));
      if (['select', 'limit', 'order', 'offset'].includes(name)) return acc;
      if (raw.startsWith('eq.')) acc.push([name, raw.slice(3)]);
      return acc;
    }, []);
  }

  function select(table, query) {
    const rows = tables[table] || [];
    const filters = parseFilters(query);
    return clone(rows.filter((row) => filters.every(([col, value]) => `${row[col] ?? ''}` === `${value}`)));
  }

  function insert(table, row) {
    if (table === 'graph_note_exports') {
      const duplicate = tables.graph_note_exports
        .some((existing) => existing.consultation_id === row.consultation_id);
      if (duplicate) {
        // Espeja la restricción UNIQUE(consultation_id): ESTA es la idempotencia.
        const error = new Error('duplicate key value violates unique constraint '
          + '"graph_note_exports_consultation_unique"');
        error.statusCode = 409;
        error.supabaseCode = '23505';
        throw error;
      }
    }
    const now = new Date().toISOString();
    const created = {
      id: uuid('eeeeeeee-eeee-4eee-8eee-'),
      kind: 'note_export',
      attempts: 0,
      claimed_by: null,
      lease_expires_at: null,
      result: null,
      error_code: null,
      attempt_history: [],
      created_at: now,
      claimed_at: null,
      finished_at: null,
      updated_at: now,
      purged_at: null,
      ...row
    };
    (tables[table] = tables[table] || []).push(created);
    return clone(created);
  }

  const rpcs = {
    graph_claim_next_note_export({ p_claimed_by, p_lease_seconds = 600, p_max_attempts = 3 }) {
      const now = Date.now();
      const eligible = tables.graph_note_exports
        .filter((row) => row.kind === 'note_export'
          && row.attempts < p_max_attempts
          && (row.status === 'pending'
            || (row.status === 'claimed' && row.lease_expires_at && Date.parse(row.lease_expires_at) < now)))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const job = eligible[0];
      if (!job) return [];

      const previous = job.status;
      job.status = 'claimed';
      job.claimed_by = p_claimed_by;
      job.claimed_at = new Date().toISOString();
      job.lease_expires_at = new Date(now + p_lease_seconds * 1000).toISOString();
      job.attempts += 1;
      job.updated_at = new Date().toISOString();
      job.attempt_history.push({
        event: 'claimed', at: job.claimed_at, attempt: job.attempts,
        claimed_by: p_claimed_by, previous_status: previous
      });
      return [clone(job)];
    },

    graph_report_note_export_result({ p_export_id, p_claimed_by, p_outcome, p_result, p_error_code }) {
      if (!['ok', 'needs_doctor', 'error'].includes(p_outcome)) {
        throw new Error('GRAPH_RESULT_INVALID_OUTCOME');
      }
      const job = tables.graph_note_exports.find((row) => row.id === p_export_id);
      if (!job) return { ok: false, code: 'EXPORT_NOT_FOUND' };

      if (['completed', 'needs_doctor', 'failed', 'cancelled'].includes(job.status)) {
        return {
          ok: true, code: 'ALREADY_TERMINAL', idempotent: true,
          status: job.status, export_id: job.id, consultation_exported: false
        };
      }
      if (job.status !== 'claimed') return { ok: false, code: 'EXPORT_NOT_CLAIMED', status: job.status };
      if (`${p_claimed_by || ''}` && job.claimed_by !== p_claimed_by) {
        return { ok: false, code: 'EXPORT_NOT_OWNED', status: job.status };
      }
      if (job.lease_expires_at && Date.parse(job.lease_expires_at) < Date.now()) {
        return { ok: false, code: 'EXPORT_LEASE_EXPIRED', status: job.status };
      }

      const status = p_outcome === 'ok' ? 'completed' : (p_outcome === 'needs_doctor' ? 'needs_doctor' : 'failed');
      const folio = `${p_result?.folio || ''}`.trim() || null;
      job.status = status;
      job.result = clone(p_result || {});
      job.error_code = p_outcome === 'ok' ? null : (`${p_error_code || ''}`.trim() || null);
      job.finished_at = new Date().toISOString();
      job.lease_expires_at = null;
      job.updated_at = job.finished_at;
      job.attempt_history.push({
        event: 'result', at: job.finished_at, attempt: job.attempts,
        outcome: p_outcome, status, claimed_by: job.claimed_by,
        error_code: job.error_code, folio
      });

      let consultationExported = false;
      if (p_outcome === 'ok') {
        const consultation = tables.consultations.find((row) => row.id === job.consultation_id);
        if (consultation && consultation.estado === 'aprobada') {
          consultation.estado = 'exportada';
          consultationExported = true;
        }
        tables.audit_events.push({
          id: uuid('ffffffff-ffff-4fff-8fff-'),
          organization_id: job.organization_id,
          consultation_id: job.consultation_id,
          actor_name: job.claimed_by || 'Asistente de escritorio',
          accion: 'Nota exportada a HC (automática)',
          detalle: `export ${job.id} · intento ${job.attempts}${folio ? ` · folio ${folio}` : ''}`,
          fecha: new Date().toISOString()
        });
      }
      return {
        ok: true, code: 'RESULT_APPLIED', idempotent: false,
        status, export_id: job.id, consultation_exported: consultationExported
      };
    },

    graph_retry_note_export({ p_export_id, p_requested_by }) {
      const job = tables.graph_note_exports.find((row) => row.id === p_export_id);
      if (!job) return { ok: false, code: 'EXPORT_NOT_FOUND' };
      if (job.status === 'pending') {
        return { ok: true, code: 'ALREADY_PENDING', idempotent: true, status: 'pending', export_id: job.id };
      }
      if (!['failed', 'needs_doctor', 'cancelled'].includes(job.status)) {
        return { ok: false, code: 'EXPORT_NOT_RETRYABLE', status: job.status };
      }
      const consultation = tables.consultations.find((row) => row.id === job.consultation_id);
      if (!consultation || consultation.estado !== 'aprobada') {
        return { ok: false, code: 'CONSULTATION_NOT_APPROVED', consultation_estado: consultation?.estado || null };
      }
      const from = job.status;
      job.status = 'pending';
      job.claimed_by = null;
      job.claimed_at = null;
      job.lease_expires_at = null;
      job.finished_at = null;
      job.error_code = null;
      job.result = null;
      job.updated_at = new Date().toISOString();
      job.attempt_history.push({
        event: 'retry', at: job.updated_at, from_status: from,
        attempts_so_far: job.attempts, requested_by: p_requested_by || null
      });
      return { ok: true, code: 'RETRY_QUEUED', idempotent: false, status: 'pending', export_id: job.id };
    },

    graph_cancel_note_export({ p_export_id, p_requested_by }) {
      const job = tables.graph_note_exports.find((row) => row.id === p_export_id);
      if (!job) return { ok: false, code: 'EXPORT_NOT_FOUND' };
      if (job.status === 'cancelled') {
        return { ok: true, code: 'ALREADY_CANCELLED', idempotent: true, status: 'cancelled', export_id: job.id };
      }
      if (job.status !== 'pending') {
        return { ok: false, code: 'EXPORT_NOT_CANCELLABLE', status: job.status };
      }
      job.status = 'cancelled';
      job.finished_at = new Date().toISOString();
      job.lease_expires_at = null;
      job.updated_at = job.finished_at;
      job.attempt_history.push({
        event: 'cancelled', at: job.finished_at, requested_by: p_requested_by || null
      });
      return { ok: true, code: 'CANCELLED', idempotent: false, status: 'cancelled', export_id: job.id };
    }
  };

  return {
    tables,
    isConfigured: () => true,
    select: async (table, query) => select(table, query),
    insert: async (table, row) => insert(table, row),
    update: async () => { throw new Error('las transiciones van por RPC, no por UPDATE suelto'); },
    rpc: async (fn, args) => {
      if (!rpcs[fn]) throw new Error(`RPC no implementada en el fake: ${fn}`);
      return rpcs[fn](args || {});
    }
  };
}

module.exports = { createFakeSupabase };
