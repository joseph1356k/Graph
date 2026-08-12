// Persistencia de los perfiles de organización (graph_organizer_profiles).
//
// Un perfil ACTIVO por instalación: rehacer la configuración archiva el
// anterior y crea uno nuevo, en vez de mutar el vigente. Así queda el rastro de
// cómo fue evolucionando el prompt de un usuario sin romper el índice único
// parcial (device_id where status='active').
//
// Este repositorio es el único que toca la tabla, y siempre con service-role:
// los clientes llegan por /api/v1/organizer/* (X-API-Key), nunca por PostgREST.

const SELECT_COLUMNS = [
  'id',
  'device_id',
  'auth_user_id',
  'profession',
  'occupation',
  'description',
  'system_prompt',
  'sections',
  'sample_notes',
  'sample_count',
  'status',
  'created_at',
  'updated_at'
].join(',');

function mapRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    device_id: row.device_id,
    auth_user_id: row.auth_user_id || null,
    profession: row.profession || 'otra',
    occupation: row.occupation || '',
    description: row.description || '',
    system_prompt: row.system_prompt || '',
    sections: Array.isArray(row.sections) ? row.sections : [],
    sample_notes: Array.isArray(row.sample_notes) ? row.sample_notes : [],
    sample_count: Number(row.sample_count) || 0,
    status: row.status || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class SupabaseOrganizerProfileRepository {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('SupabaseOrganizerProfileRepository requires a Supabase REST client');
    }
    this.restClient = restClient;
  }

  isConfigured() {
    return Boolean(this.restClient.isConfigured?.());
  }

  async findActiveByDevice(deviceId) {
    const rows = await this.restClient.select(
      'graph_organizer_profiles',
      `select=${SELECT_COLUMNS}&device_id=eq.${encodeURIComponent(deviceId)}&status=eq.active&limit=1`
    );
    return mapRow(Array.isArray(rows) ? rows[0] : rows);
  }

  async findById(profileId) {
    const rows = await this.restClient.select(
      'graph_organizer_profiles',
      `select=${SELECT_COLUMNS}&id=eq.${encodeURIComponent(profileId)}&limit=1`
    );
    return mapRow(Array.isArray(rows) ? rows[0] : rows);
  }

  async archiveActiveForDevice(deviceId) {
    await this.restClient.update(
      'graph_organizer_profiles',
      `device_id=eq.${encodeURIComponent(deviceId)}&status=eq.active`,
      { status: 'archived', updated_at: new Date().toISOString() }
    );
  }

  // Reemplaza la configuración de una instalación: archiva la vigente y crea la
  // nueva. El archivado va primero porque el índice único parcial no admite dos
  // perfiles activos para el mismo device_id.
  async replaceActive(profile) {
    await this.archiveActiveForDevice(profile.device_id);
    const row = await this.restClient.insert('graph_organizer_profiles', {
      device_id: profile.device_id,
      auth_user_id: profile.auth_user_id || null,
      profession: profile.profession || 'otra',
      occupation: profile.occupation || '',
      description: profile.description || '',
      system_prompt: profile.system_prompt || '',
      sections: profile.sections || [],
      sample_notes: profile.sample_notes || [],
      sample_count: Number(profile.sample_count) || 0,
      status: 'active'
    });
    return mapRow(Array.isArray(row) ? row[0] : row);
  }

  async update(profileId, patch) {
    const row = await this.restClient.update(
      'graph_organizer_profiles',
      `id=eq.${encodeURIComponent(profileId)}`,
      { ...patch, updated_at: new Date().toISOString() }
    );
    return mapRow(Array.isArray(row) ? row[0] : row);
  }
}

module.exports = SupabaseOrganizerProfileRepository;
