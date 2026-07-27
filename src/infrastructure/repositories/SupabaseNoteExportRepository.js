// Persistencia de los trabajos de exportación de nota a historia clínica.
//
// Habla con Supabase (PostgREST) usando la service-role key: Graph es el ÚNICO
// que escribe en public.graph_note_exports y el único que puede mover una
// consulta a 'exportada' (vía RPC). Ver la migración
// supabase/migrations/20260727000000_graph_note_exports.sql.
//
// Las transiciones de estado NO se hacen con UPDATE suelto sino con RPCs: son
// atómicas y llevan la lógica de concurrencia (SKIP LOCKED, lease, idempotencia)
// dentro de la base de datos, donde no hay carreras entre procesos.
const TABLE = 'graph_note_exports';

const EXPORT_COLUMNS = [
  'id',
  'kind',
  'consultation_id',
  'organization_id',
  'doctor_id',
  'requested_by',
  'workflow_id',
  'status',
  'attempts',
  'claimed_by',
  'lease_expires_at',
  'payload',
  'payload_hash',
  'hash_source',
  'result',
  'error_code',
  'attempt_history',
  'created_at',
  'claimed_at',
  'finished_at',
  'updated_at',
  'purged_at'
].join(',');

// Columnas de `consultations` necesarias para validar y construir el snapshot.
// `note`, `resumen` y `codigos` son EXACTAMENTE las tres que cubre la firma.
const CONSULTATION_COLUMNS = [
  'id',
  'organization_id',
  'medico_id',
  'patient_id',
  'estado',
  'firma',
  'note',
  'resumen',
  'codigos',
  'especialidad',
  'servicio',
  'fecha'
].join(',');

function eq(value) {
  return `eq.${encodeURIComponent(`${value == null ? '' : value}`)}`;
}

class SupabaseNoteExportRepository {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('SupabaseNoteExportRepository requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  isConfigured() {
    return this.restClient.isConfigured();
  }

  // --- lecturas de Miracle Notes (solo lectura, nunca escritura directa) ----

  async getConsultation(consultationId) {
    const rows = await this.restClient.select('consultations', [
      `id=${eq(consultationId)}`,
      `select=${CONSULTATION_COLUMNS}`,
      'limit=1'
    ].join('&'));
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  // Perfil del solicitante: su organización y rol deciden si puede exportar
  // esta consulta. Graph lee con service-role (salta RLS), así que esta
  // comprobación es la que sustituye a las policies.
  async getProfile(userId) {
    const rows = await this.restClient.select('profiles', [
      `id=${eq(userId)}`,
      'select=id,organization_id,role,full_name,email',
      'limit=1'
    ].join('&'));
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  // Una nota de demostración no se exporta a una historia clínica real. Se
  // detecta igual que al firmar: por su evento de auditoría.
  async countDemoAuditEvents(consultationId, demoAccion) {
    const rows = await this.restClient.select('audit_events', [
      `consultation_id=${eq(consultationId)}`,
      `accion=${eq(demoAccion)}`,
      'select=id',
      'limit=1'
    ].join('&'));
    return Array.isArray(rows) ? rows.length : 0;
  }

  // --- trabajos de exportación --------------------------------------------

  /**
   * Inserta el trabajo. Si ya existe uno para la consulta, la restricción
   * UNIQUE(consultation_id) lo rechaza: eso ES la idempotencia. Devuelve
   * `{ created: false }` en vez de lanzar, para que la capa de arriba responda
   * 409 con el estado del trabajo que ya existe.
   */
  async insertExport(row) {
    try {
      const created = await this.restClient.insert(TABLE, row, `select=${EXPORT_COLUMNS}`);
      return { created: true, export: created };
    } catch (error) {
      const isDuplicate = error.supabaseCode === '23505'
        || error.statusCode === 409
        || /duplicate key|already exists/i.test(`${error.message || ''}`);
      if (!isDuplicate) throw error;
      const existing = await this.getExportByConsultationId(row.consultation_id);
      return { created: false, export: existing };
    }
  }

  async getExportById(exportId) {
    const rows = await this.restClient.select(TABLE, [
      `id=${eq(exportId)}`,
      `select=${EXPORT_COLUMNS}`,
      'limit=1'
    ].join('&'));
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  async getExportByConsultationId(consultationId) {
    const rows = await this.restClient.select(TABLE, [
      `consultation_id=${eq(consultationId)}`,
      `select=${EXPORT_COLUMNS}`,
      'limit=1'
    ].join('&'));
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }

  // --- transiciones atómicas (RPC) ----------------------------------------

  /** Reclama el siguiente trabajo de la cola. `null` si no hay nada que hacer. */
  async claimNext(claimedBy, { leaseSeconds = 600, maxAttempts = 3 } = {}) {
    const rows = await this.restClient.rpc('graph_claim_next_note_export', {
      p_claimed_by: claimedBy,
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts
    });
    if (Array.isArray(rows)) return rows[0] || null;
    return rows || null;
  }

  /**
   * Registra el desenlace reportado por el ejecutor. Es la ÚNICA vía por la que
   * una consulta llega a 'exportada'.
   */
  async reportResult({ exportId, claimedBy, outcome, result, errorCode }) {
    return this.restClient.rpc('graph_report_note_export_result', {
      p_export_id: exportId,
      p_claimed_by: claimedBy || '',
      p_outcome: outcome,
      p_result: result || {},
      p_error_code: errorCode || null
    });
  }

  async retryExport(exportId, requestedBy) {
    return this.restClient.rpc('graph_retry_note_export', {
      p_export_id: exportId,
      p_requested_by: requestedBy || null
    });
  }

  async cancelExport(exportId, requestedBy) {
    return this.restClient.rpc('graph_cancel_note_export', {
      p_export_id: exportId,
      p_requested_by: requestedBy || null
    });
  }
}

SupabaseNoteExportRepository.EXPORT_COLUMNS = EXPORT_COLUMNS;
SupabaseNoteExportRepository.CONSULTATION_COLUMNS = CONSULTATION_COLUMNS;

module.exports = SupabaseNoteExportRepository;
