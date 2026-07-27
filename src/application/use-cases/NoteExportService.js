// Exportación de una nota clínica firmada a la historia clínica del HIS.
//
// Reparto de responsabilidades:
//   · Miracle Notes  — el médico firma y pulsa "Exportar a HC". NO marca nada
//                      como exportado: solo pide el trabajo y muestra su estado.
//   · Graph (aquí)   — valida, congela el snapshot y encola el trabajo. Sirve la
//                      cola al ejecutor y registra el desenlace.
//   · Operations     — un ejecutor (hoy el simulador, mañana el cliente Windows)
//                      reclama el trabajo, lo escribe en el HIS y reporta.
//
// Regla que gobierna todo el diseño: la consulta pasa a 'exportada' ÚNICAMENTE
// cuando el ejecutor confirma un éxito real. Encolar no es exportar; reclamar no
// es exportar; "no falló" no es exportar.
const { clinicalError } = require('./ClinicalErrors');
const { computeSignatureHash, signatureHashMatches } = require('./NoteSignatureHash');
const { buildNoteExportPayload } = require('./NoteExportSnapshot');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mismo valor que usa Miracle Notes (lib/demo.ts) para marcar notas de
// demostración generadas por IA. Una nota demo nunca llega al HIS real.
const DEMO_AUDIT_ACCION = 'Nota de demostración generada por IA';

const DEFAULT_LEASE_SECONDS = 600;   // 10 min: llenar un formulario dura minutos.
const DEFAULT_MAX_ATTEMPTS = 3;
const ROLES_THAT_EXPORT_ANY_CONSULTATION = new Set(['admin', 'supervisor']);
const VALID_OUTCOMES = new Set(['ok', 'needs_doctor', 'error']);

// Estados desde los que el médico puede reintentar. 'completed' no está: ya se
// escribió en el HIS y repetir crearía un duplicado clínico.
const RETRYABLE = new Set(['failed', 'needs_doctor', 'cancelled']);

// Códigos que devuelven las RPCs y su traducción a error de API.
const RPC_ERROR_CODES = {
  EXPORT_NOT_FOUND: 'EXPORT_NOT_FOUND',
  EXPORT_NOT_CLAIMED: 'EXPORT_NOT_CLAIMED',
  EXPORT_NOT_OWNED: 'EXPORT_NOT_OWNED',
  EXPORT_LEASE_EXPIRED: 'EXPORT_LEASE_EXPIRED',
  EXPORT_NOT_RETRYABLE: 'EXPORT_NOT_RETRYABLE',
  EXPORT_NOT_CANCELLABLE: 'EXPORT_NOT_CANCELLABLE',
  CONSULTATION_NOT_APPROVED: 'CONSULTATION_NOT_APPROVED'
};

/**
 * Vista pública de un trabajo. SIN `payload`: la UI no necesita el contenido
 * clínico para pintar un badge de estado, y menos PHI en tránsito es mejor.
 */
function toPublicExport(row) {
  if (!row) return null;
  const result = row.result && typeof row.result === 'object' ? row.result : null;
  return {
    id: `${row.id || ''}`,
    consultation_id: `${row.consultation_id || ''}`,
    status: `${row.status || 'pending'}`,
    attempts: Number(row.attempts || 0),
    workflow_id: `${row.workflow_id || ''}`,
    error_code: row.error_code || null,
    hash_source: `${row.hash_source || 'firma'}`,
    // Resumen del resultado, sin contenido clínico: folio y etiquetas de campos
    // que quedaron sin llenar (una etiqueta de formulario no es PHI).
    result_summary: result
      ? {
        outcome: result.outcome || null,
        folio: result.folio || null,
        unresolved_fields: Array.isArray(result.unresolved_fields) ? result.unresolved_fields : [],
        detail_code: result.detail_code || null
      }
      : null,
    claimed_by: row.claimed_by || null,
    lease_expires_at: row.lease_expires_at || null,
    created_at: row.created_at || null,
    claimed_at: row.claimed_at || null,
    finished_at: row.finished_at || null,
    updated_at: row.updated_at || null,
    // Historial de intentos y errores (sin PHI): lo que permite explicar al
    // médico qué pasó, y auditar después.
    attempt_history: Array.isArray(row.attempt_history) ? row.attempt_history : []
  };
}

class NoteExportService {
  /**
   * @param {object} deps
   * @param {object} deps.repository  SupabaseNoteExportRepository
   * @param {function} [deps.resolveWorkflowId] (consultation, requester) => string
   * @param {function} [deps.resolvePlan] (workflowId, {context, exportId}) => {steps,unresolved_fields}
   *   Opcional a propósito. Si se inyecta, el plan de automatización se resuelve
   *   en el claim (el ejecutor queda "tonto" y un campo sin resolver aflora sin
   *   viaje al cliente). Si NO se inyecta, el claim entrega solo el payload y el
   *   ejecutor pide el plan por su cuenta — el contrato del ejecutor no cambia,
   *   así que esto se puede activar después sin tocar el frontend.
   */
  constructor(deps = {}) {
    if (!deps.repository) {
      throw new Error('NoteExportService requires a repository');
    }
    this.repository = deps.repository;
    this.resolveWorkflowId = deps.resolveWorkflowId || null;
    this.resolvePlan = deps.resolvePlan || null;
    this.demoAuditAccion = deps.demoAuditAccion || DEMO_AUDIT_ACCION;
    this.defaultWorkflowId = `${deps.defaultWorkflowId || process.env.GRAPH_NOTE_EXPORT_WORKFLOW_ID || ''}`.trim();
    this.leaseSeconds = Number(deps.leaseSeconds || process.env.GRAPH_NOTE_EXPORT_LEASE_SECONDS || DEFAULT_LEASE_SECONDS);
    this.maxAttempts = Number(deps.maxAttempts || process.env.GRAPH_NOTE_EXPORT_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
    this.logger = deps.logger || console;
  }

  // -------------------------------------------------------------------------
  // Validaciones compartidas
  // -------------------------------------------------------------------------

  static assertUuid(value, field) {
    const raw = `${value || ''}`.trim();
    if (!UUID_PATTERN.test(raw)) {
      throw clinicalError('EXPORT_INVALID', `${field} debe ser un uuid válido.`);
    }
    return raw.toLowerCase();
  }

  /**
   * Graph lee `consultations` con service-role, que SALTA el RLS de Notes. Por
   * eso la autorización se comprueba aquí explícitamente: sin esto, cualquier
   * médico autenticado podría exportar la nota de cualquier otro.
   */
  async assertRequesterCanExport(consultation, requester) {
    const requesterId = NoteExportService.assertUuid(requester?.id, 'requester_id');
    const profile = await this.repository.getProfile(requesterId);
    if (!profile) {
      throw clinicalError('EXPORT_FORBIDDEN', 'Tu perfil no está disponible para exportar notas.');
    }
    if (`${profile.organization_id || ''}` !== `${consultation.organization_id || ''}`) {
      throw clinicalError('EXPORT_FORBIDDEN', 'Esta consulta no pertenece a tu organización.');
    }
    const isOwner = `${consultation.medico_id || ''}` === requesterId;
    if (!isOwner && !ROLES_THAT_EXPORT_ANY_CONSULTATION.has(`${profile.role || ''}`)) {
      throw clinicalError('EXPORT_FORBIDDEN', 'Solo el médico tratante o un administrador puede exportar esta nota.');
    }
    return { requesterId, profile };
  }

  async loadConsultationOrThrow(consultationId) {
    const consultation = await this.repository.getConsultation(consultationId);
    if (!consultation) {
      throw clinicalError('CONSULTATION_NOT_FOUND', 'No se encontró la consulta.');
    }
    return consultation;
  }

  /**
   * Verifica que la nota esté aprobada, firmada, no sea demo, y que su contenido
   * siga siendo EXACTAMENTE el que se firmó.
   *
   * Se lee la versión firmada desde `consultations` (que es donde vive la firma),
   * no desde el encounter ni desde nada que el cliente mande.
   */
  async validateSignedConsultation(consultation) {
    const estado = `${consultation.estado || ''}`;
    if (estado === 'exportada') {
      throw clinicalError('CONSULTATION_ALREADY_EXPORTED', 'Esta consulta ya está exportada a la historia clínica.');
    }
    if (estado !== 'aprobada') {
      throw clinicalError(
        'CONSULTATION_NOT_APPROVED',
        'La nota tiene que estar aprobada y firmada antes de exportarla.'
      );
    }

    const firma = consultation.firma && typeof consultation.firma === 'object' ? consultation.firma : null;
    if (!firma || !`${firma.por || ''}`.trim() || !`${firma.fecha || ''}`.trim()) {
      throw clinicalError('CONSULTATION_NOT_SIGNED', 'La nota no tiene una firma válida.');
    }

    const demoCount = await this.repository.countDemoAuditEvents(consultation.id, this.demoAuditAccion);
    if (demoCount > 0) {
      throw clinicalError(
        'CONSULTATION_IS_DEMO',
        'Esta es una consulta de demostración y no puede exportarse a la historia clínica.'
      );
    }

    // Contenido firmado: las tres columnas que cubre el hash, tal como están hoy
    // en la base de datos.
    const signedContent = {
      note: consultation.note,
      resumen: consultation.resumen,
      codigos: consultation.codigos
    };
    const computedHash = computeSignatureHash(signedContent);
    const storedHash = `${firma.hash || ''}`.trim();

    if (storedHash) {
      if (!signatureHashMatches(signedContent, storedHash)) {
        // La nota cambió después de firmarse (o la firma es de otra versión).
        // Nunca se manda al HIS: sería escribir algo que nadie firmó.
        throw clinicalError(
          'SIGNATURE_HASH_MISMATCH',
          'El contenido de la nota no coincide con su firma. No se puede exportar; revisa la nota y vuelve a firmarla.'
        );
      }
      return { payloadHash: computedHash, hashSource: 'firma' };
    }

    // Notas históricas firmadas antes de que la firma incluyera el hash: no hay
    // nada contra qué verificar. Se exporta, pero queda registrado que el hash
    // se calculó al exportar y NO hubo re-verificación.
    return { payloadHash: computedHash, hashSource: 'computed_at_export' };
  }

  workflowIdFor(consultation, requester) {
    if (this.resolveWorkflowId) {
      const resolved = `${this.resolveWorkflowId(consultation, requester) || ''}`.trim();
      if (resolved) return resolved;
    }
    if (this.defaultWorkflowId) return this.defaultWorkflowId;
    throw clinicalError(
      'WORKFLOW_NOT_CONFIGURED',
      'La automatización de historia clínica no está configurada en el servidor.'
    );
  }

  // -------------------------------------------------------------------------
  // Carril Miracle Notes (JWT del médico)
  // -------------------------------------------------------------------------

  /**
   * Crea el trabajo de exportación. NO espera al ejecutor y NO marca nada como
   * exportado: devuelve el trabajo en 'pending'.
   *
   * Idempotente: si ya existe un trabajo para la consulta, devuelve ese mismo
   * (con `duplicate: true`) en vez de crear otro. Es lo que hace que un doble
   * clic, dos pestañas o un reintento de red no dupliquen la escritura en el HIS.
   */
  async createExport({ consultationId, requester }) {
    const id = NoteExportService.assertUuid(consultationId, 'consultation_id');
    const consultation = await this.loadConsultationOrThrow(id);
    const { requesterId } = await this.assertRequesterCanExport(consultation, requester);

    // Atajo de idempotencia: si ya hay trabajo, no se revalida ni se reconstruye
    // el snapshot (el trabajo existente ya congeló la versión firmada).
    const existing = await this.repository.getExportByConsultationId(id);
    if (existing) {
      return { duplicate: true, export: toPublicExport(existing) };
    }

    const { payloadHash, hashSource } = await this.validateSignedConsultation(consultation);
    const workflowId = this.workflowIdFor(consultation, requester);

    const inserted = await this.repository.insertExport({
      kind: 'note_export',
      consultation_id: id,
      organization_id: consultation.organization_id,
      doctor_id: consultation.medico_id,
      requested_by: requesterId,
      workflow_id: workflowId,
      status: 'pending',
      payload: buildNoteExportPayload(consultation),
      payload_hash: payloadHash,
      hash_source: hashSource
    });

    if (!inserted.export) {
      // Carrera perdida contra otra petición y la fila no se pudo leer.
      throw clinicalError('EXPORT_ALREADY_EXISTS', 'Ya existe una exportación para esta consulta.');
    }
    return { duplicate: !inserted.created, export: toPublicExport(inserted.export) };
  }

  /** Estado actual del trabajo de una consulta (carga inicial y polling). */
  async getExportForConsultation({ consultationId, requester }) {
    const id = NoteExportService.assertUuid(consultationId, 'consultation_id');
    const consultation = await this.loadConsultationOrThrow(id);
    await this.assertRequesterCanExport(consultation, requester);

    const row = await this.repository.getExportByConsultationId(id);
    return {
      export: toPublicExport(row),
      consultation_estado: `${consultation.estado || ''}`
    };
  }

  async loadExportForRequester(exportId, requester) {
    const id = NoteExportService.assertUuid(exportId, 'export_id');
    const row = await this.repository.getExportById(id);
    if (!row) {
      throw clinicalError('EXPORT_NOT_FOUND', 'No se encontró la exportación.');
    }
    const consultation = await this.loadConsultationOrThrow(row.consultation_id);
    await this.assertRequesterCanExport(consultation, requester);
    return { row, consultation };
  }

  /**
   * Reintenta la MISMA fila. `attempts` se conserva como historia; el techo se
   * aplica en el claim, así que reintentar explícitamente sube el techo para
   * este trabajo (es una decisión humana, no un bucle automático).
   */
  async retryExport({ exportId, requester }) {
    const { row } = await this.loadExportForRequester(exportId, requester);
    if (!RETRYABLE.has(`${row.status}`) && `${row.status}` !== 'pending') {
      throw clinicalError(
        'EXPORT_NOT_RETRYABLE',
        row.status === 'completed'
          ? 'Esta nota ya se exportó a la historia clínica.'
          : 'La exportación está en curso: espera a que el asistente termine.'
      );
    }

    const rpc = await this.repository.retryExport(row.id, requester?.id || null);
    this.assertRpcOk(rpc, 'EXPORT_NOT_RETRYABLE');
    const fresh = await this.repository.getExportById(row.id);
    return { export: toPublicExport(fresh), idempotent: Boolean(rpc?.idempotent) };
  }

  /** Cancelar solo tiene sentido mientras nadie haya tomado el trabajo. */
  async cancelExport({ exportId, requester }) {
    const { row } = await this.loadExportForRequester(exportId, requester);
    const rpc = await this.repository.cancelExport(row.id, requester?.id || null);
    this.assertRpcOk(rpc, 'EXPORT_NOT_CANCELLABLE');
    const fresh = await this.repository.getExportById(row.id);
    return { export: toPublicExport(fresh), idempotent: Boolean(rpc?.idempotent) };
  }

  assertRpcOk(rpc, fallbackCode) {
    if (rpc && rpc.ok === false) {
      const code = RPC_ERROR_CODES[`${rpc.code || ''}`] || fallbackCode;
      throw clinicalError(code, NoteExportService.messageForRpcCode(`${rpc.code || ''}`, rpc));
    }
  }

  static messageForRpcCode(code, rpc = {}) {
    switch (code) {
      case 'EXPORT_NOT_FOUND':
        return 'No se encontró la exportación.';
      case 'EXPORT_NOT_CLAIMED':
        return 'Este trabajo no está asignado a ningún ejecutor.';
      case 'EXPORT_NOT_OWNED':
        return 'Este trabajo lo tiene otro ejecutor.';
      case 'EXPORT_LEASE_EXPIRED':
        return 'El plazo de este trabajo venció y ya puede reclamarlo otro ejecutor.';
      case 'EXPORT_NOT_RETRYABLE':
        return `No se puede reintentar desde el estado "${rpc.status || 'desconocido'}".`;
      case 'EXPORT_NOT_CANCELLABLE':
        return 'La exportación ya está en curso o terminada: no se puede cancelar.';
      case 'CONSULTATION_NOT_APPROVED':
        return 'La consulta ya no está aprobada; no hay nada que reintentar.';
      default:
        return 'No se pudo completar la operación sobre la exportación.';
    }
  }

  // -------------------------------------------------------------------------
  // Carril Operations (X-API-Key, pull)
  // -------------------------------------------------------------------------

  /**
   * El ejecutor reclama el siguiente trabajo. `null` = no hay nada que hacer
   * (la ruta responde 204).
   *
   * Si hay un resolutor de plan inyectado y el plan no se puede resolver por
   * falta de datos, el trabajo pasa a `needs_doctor` AQUÍ: el médico se entera
   * sin que el ejecutor haga un viaje inútil al HIS.
   */
  async claimNext({ claimedBy }) {
    const identity = `${claimedBy || ''}`.trim();
    if (!identity) {
      throw clinicalError('EXPORT_INVALID', 'El ejecutor debe identificarse (device).');
    }

    const row = await this.repository.claimNext(identity, {
      leaseSeconds: this.leaseSeconds,
      maxAttempts: this.maxAttempts
    });
    if (!row) return { export: null };

    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};

    if (!this.resolvePlan) {
      // Sin resolución server-side: el ejecutor recibe el payload y pide el plan
      // por su cuenta. El contrato del claim no cambia cuando se active.
      return { export: toPublicExport(row), payload, plan: null };
    }

    let plan = null;
    try {
      plan = await this.resolvePlan(row.workflow_id, {
        context: payload.context || payload.rendered_text || '',
        exportId: row.id
      });
    } catch (error) {
      this.logger.error?.(`[note-export] no se pudo resolver el plan del workflow ${row.workflow_id}: ${error.message}`);
      await this.repository.reportResult({
        exportId: row.id,
        claimedBy: identity,
        outcome: 'error',
        result: { outcome: 'error', detail_code: 'PLAN_RESOLUTION_FAILED' },
        errorCode: 'PLAN_RESOLUTION_FAILED'
      });
      return { export: null };
    }

    const unresolved = Array.isArray(plan?.unresolved_fields) ? plan.unresolved_fields : [];
    if (unresolved.length) {
      // Faltan datos que el workflow necesita: es trabajo para el médico, no un
      // fallo del ejecutor. Las etiquetas de campo no son PHI.
      await this.repository.reportResult({
        exportId: row.id,
        claimedBy: identity,
        outcome: 'needs_doctor',
        result: { outcome: 'needs_doctor', unresolved_fields: unresolved },
        errorCode: 'PLAN_UNRESOLVED_FIELDS'
      });
      return { export: null };
    }

    return { export: toPublicExport(row), payload, plan };
  }

  /**
   * El ejecutor reporta el desenlace. Un 'ok' es lo ÚNICO que mueve la consulta
   * a 'exportada', y solo si el ejecutor sigue siendo el dueño del trabajo con
   * lease vigente.
   *
   * Idempotente: el cliente debe reintentar hasta recibir ack, así que reenviar
   * el mismo resultado devuelve ack sin re-transicionar.
   */
  async reportResult({ exportId, claimedBy, outcome, folio, unresolvedFields, errorCode, detailCode }) {
    const id = NoteExportService.assertUuid(exportId, 'export_id');
    const normalizedOutcome = `${outcome || ''}`.trim();
    if (!VALID_OUTCOMES.has(normalizedOutcome)) {
      throw clinicalError('EXPORT_INVALID', "outcome debe ser 'ok', 'needs_doctor' o 'error'.");
    }
    const identity = `${claimedBy || ''}`.trim();
    if (!identity) {
      throw clinicalError('EXPORT_INVALID', 'El ejecutor debe identificarse (device).');
    }

    const result = { outcome: normalizedOutcome };
    const cleanFolio = `${folio || ''}`.trim();
    if (cleanFolio) result.folio = cleanFolio;
    if (Array.isArray(unresolvedFields) && unresolvedFields.length) {
      result.unresolved_fields = unresolvedFields.map((field) => `${field}`).slice(0, 50);
    }
    const cleanDetail = `${detailCode || ''}`.trim();
    if (cleanDetail) result.detail_code = cleanDetail;

    const rpc = await this.repository.reportResult({
      exportId: id,
      claimedBy: identity,
      outcome: normalizedOutcome,
      result,
      errorCode: normalizedOutcome === 'ok' ? null : (`${errorCode || ''}`.trim() || 'EXECUTOR_ERROR')
    });

    if (rpc && rpc.ok === false) {
      const code = RPC_ERROR_CODES[`${rpc.code || ''}`] || 'EXPORT_INVALID';
      throw clinicalError(code, NoteExportService.messageForRpcCode(`${rpc.code || ''}`, rpc));
    }

    const fresh = await this.repository.getExportById(id);
    return {
      acknowledged: true,
      idempotent: Boolean(rpc?.idempotent),
      status: `${rpc?.status || fresh?.status || ''}`,
      consultation_exported: Boolean(rpc?.consultation_exported),
      export: toPublicExport(fresh)
    };
  }
}

NoteExportService.toPublicExport = toPublicExport;
NoteExportService.DEMO_AUDIT_ACCION = DEMO_AUDIT_ACCION;
NoteExportService.RETRYABLE = RETRYABLE;
NoteExportService.DEFAULT_LEASE_SECONDS = DEFAULT_LEASE_SECONDS;
NoteExportService.DEFAULT_MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;

module.exports = NoteExportService;
