// Persists clinical templates in Supabase (public.clinical_templates).
// The table predates this engine, so the repository maps between the API model
// and the physical columns: specialty <-> specialty_code (+ specialty_name),
// owner_user_id <-> owner_id, sections as jsonb.
const TABLE = 'clinical_templates';

const SELECT_COLUMNS = [
  'id',
  'owner_id',
  'name',
  'description',
  'specialty_code',
  'specialty_name',
  'sections',
  'scope',
  'is_default',
  'status',
  'created_at',
  'updated_at'
].join(',');

function humanizeSpecialty(code = '') {
  const cleaned = `${code || ''}`.trim().replace(/[_-]+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function toDomain(row) {
  if (!row) {
    return null;
  }
  return {
    id: `${row.id || ''}`,
    name: `${row.name || ''}`,
    specialty: `${row.specialty_code || ''}`,
    description: `${row.description || ''}`,
    owner_user_id: row.owner_id || null,
    scope: `${row.scope || 'personal'}`,
    is_default: Boolean(row.is_default),
    status: `${row.status || 'active'}`,
    sections: Array.isArray(row.sections) ? row.sections : [],
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

class SupabaseClinicalTemplateRepository {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('SupabaseClinicalTemplateRepository requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  async listVisible({ specialty = '', ownerUserId = null } = {}) {
    const filters = [];
    if (`${specialty || ''}`.trim()) {
      filters.push(`specialty_code=eq.${encodeURIComponent(`${specialty}`.trim())}`);
    }
    const branches = ['and(scope.eq.institutional,status.eq.active)'];
    if (ownerUserId) {
      branches.push(`and(owner_id.eq.${encodeURIComponent(ownerUserId)},status.eq.active)`);
    }
    filters.push(`or=(${branches.join(',')})`);
    filters.push(`select=${SELECT_COLUMNS}`);
    filters.push('order=is_default.desc,name.asc');

    const rows = await this.restClient.select(TABLE, filters.join('&'));
    return (Array.isArray(rows) ? rows : []).map(toDomain);
  }

  async getById(templateId) {
    const query = [
      `id=eq.${encodeURIComponent(`${templateId || ''}`)}`,
      `select=${SELECT_COLUMNS}`,
      'limit=1'
    ].join('&');
    const rows = await this.restClient.select(TABLE, query);
    return toDomain(Array.isArray(rows) ? rows[0] : null);
  }

  async create(template) {
    const row = await this.restClient.insert(TABLE, {
      name: template.name,
      description: template.description || '',
      specialty_code: template.specialty,
      specialty_name: humanizeSpecialty(template.specialty),
      sections: template.sections,
      owner_id: template.owner_user_id || null,
      scope: template.scope || 'personal',
      is_default: Boolean(template.is_default),
      status: template.status || 'active'
    }, `select=${SELECT_COLUMNS}`);
    return toDomain(row);
  }

  async update(templateId, patch) {
    const fields = {};
    if (typeof patch.name !== 'undefined') fields.name = patch.name;
    if (typeof patch.description !== 'undefined') fields.description = patch.description;
    if (typeof patch.specialty !== 'undefined') {
      fields.specialty_code = patch.specialty;
      fields.specialty_name = humanizeSpecialty(patch.specialty);
    }
    if (typeof patch.sections !== 'undefined') fields.sections = patch.sections;
    if (typeof patch.status !== 'undefined') fields.status = patch.status;

    const row = await this.restClient.update(
      TABLE,
      `id=eq.${encodeURIComponent(`${templateId || ''}`)}&select=${SELECT_COLUMNS}`,
      fields
    );
    return toDomain(row);
  }

  async archive(templateId) {
    return this.update(templateId, { status: 'archived' });
  }
}

SupabaseClinicalTemplateRepository.toDomain = toDomain;
SupabaseClinicalTemplateRepository.humanizeSpecialty = humanizeSpecialty;

module.exports = SupabaseClinicalTemplateRepository;
