// Persists clinical encounters in Supabase (public.clinical_encounters).
const TABLE = 'clinical_encounters';

const SELECT_COLUMNS = [
  'id',
  'doctor_id',
  'patient_id',
  'consultation_type',
  'template_id',
  'template_snapshot',
  'status',
  'transcript',
  'note_json',
  'created_at',
  'updated_at'
].join(',');

function toDomain(row) {
  if (!row) {
    return null;
  }
  return {
    id: `${row.id || ''}`,
    doctor_id: row.doctor_id || null,
    patient_id: row.patient_id || null,
    consultation_type: `${row.consultation_type || ''}`,
    template_id: row.template_id || null,
    template_snapshot: row.template_snapshot && typeof row.template_snapshot === 'object'
      ? row.template_snapshot
      : {},
    status: `${row.status || 'created'}`,
    transcript: typeof row.transcript === 'string' ? row.transcript : '',
    note_json: row.note_json && typeof row.note_json === 'object' ? row.note_json : null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

class SupabaseClinicalEncounterRepository {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('SupabaseClinicalEncounterRepository requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  async create(encounter) {
    const row = await this.restClient.insert(TABLE, {
      doctor_id: encounter.doctor_id || null,
      patient_id: encounter.patient_id || null,
      consultation_type: encounter.consultation_type,
      template_id: encounter.template_id || null,
      template_snapshot: encounter.template_snapshot,
      status: encounter.status || 'created',
      transcript: encounter.transcript || ''
    }, `select=${SELECT_COLUMNS}`);
    return toDomain(row);
  }

  async getById(encounterId) {
    const query = [
      `id=eq.${encodeURIComponent(`${encounterId || ''}`)}`,
      `select=${SELECT_COLUMNS}`,
      'limit=1'
    ].join('&');
    const rows = await this.restClient.select(TABLE, query);
    return toDomain(Array.isArray(rows) ? rows[0] : null);
  }

  async update(encounterId, patch) {
    const fields = {};
    if (typeof patch.status !== 'undefined') fields.status = patch.status;
    if (typeof patch.transcript !== 'undefined') fields.transcript = patch.transcript;
    if (typeof patch.note_json !== 'undefined') fields.note_json = patch.note_json;

    const row = await this.restClient.update(
      TABLE,
      `id=eq.${encodeURIComponent(`${encounterId || ''}`)}&select=${SELECT_COLUMNS}`,
      fields
    );
    return toDomain(row);
  }
}

SupabaseClinicalEncounterRepository.toDomain = toDomain;

module.exports = SupabaseClinicalEncounterRepository;
