// Lectura mínima de identidad para sembrar el escudo de privacidad: el
// paciente registrado, el nombre del médico y la identidad que la web dejó en
// `consultations`. Solo SELECT, solo las columnas que hacen falta, y todo con
// comprobación de organización: Graph lee con service-role, que salta el RLS
// de la web, así que la autorización se hace aquí explícita (misma regla que
// NoteExportService).
//
// Es la primera vez que Graph lee `patients` (2026-09-07); queda anotado en la
// decisión D20 del portal.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(`${value ?? ''}`.trim());
}

class SupabasePatientSeedRepository {
  constructor(restClient, { logger = console } = {}) {
    this.restClient = restClient || null;
    this.logger = logger;
  }

  isConfigured() {
    return Boolean(this.restClient && (typeof this.restClient.isConfigured !== 'function' || this.restClient.isConfigured()));
  }

  async selectOne(table, query) {
    if (!this.isConfigured()) return null;
    try {
      const rows = await this.restClient.select(table, query);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      // Sin semilla de base de datos el escudo sigue funcionando con lo que
      // detecta en el texto; no hay motivo para tumbar la llamada.
      this.logger.warn?.(`[Privacidad] No se pudo leer ${table}: ${error.message}`);
      return null;
    }
  }

  async doctorProfile(doctorId) {
    if (!isUuid(doctorId)) return null;
    return this.selectOne('profiles', `id=eq.${encodeURIComponent(doctorId)}&select=id,organization_id,full_name&limit=1`);
  }

  async patientById(patientId) {
    if (!isUuid(patientId)) return null;
    return this.selectOne('patients', `id=eq.${encodeURIComponent(patientId)}&select=id,organization_id,nombre,documento,telefono&limit=1`);
  }

  async consultationIdentity(consultationId) {
    if (!isUuid(consultationId)) return null;
    return this.selectOne(
      'consultations',
      `id=eq.${encodeURIComponent(consultationId)}&select=id,organization_id,medico_id,patient_id,paciente_nombre,paciente_documento&limit=1`
    );
  }
}

SupabasePatientSeedRepository.isUuid = isUuid;

module.exports = SupabasePatientSeedRepository;
