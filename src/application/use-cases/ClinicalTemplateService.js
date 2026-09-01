const { clinicalError } = require('./ClinicalErrors');
const NoteModeResolver = require('./NoteModeResolver');

// Business rules for clinical templates: payload validation, section
// normalization (strings or objects in, canonical objects out), stable key
// generation and default instructions.
const MIN_SECTIONS = 2;
const MAX_SECTIONS = 30;
const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_LABEL_LENGTH = 160;
const MAX_INSTRUCTION_LENGTH = 600;

function stripDiacritics(value = '') {
  return `${value || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toSnakeKey(value = '') {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function defaultInstruction(label = '', { verbatim = false } = {}) {
  if (verbatim) {
    return `Copia en la sección "${`${label}`.trim()}" lo que el médico dictó para esa casilla, palabra por palabra y en el mismo orden, sin reformular, resumir ni reordenar. No inventes datos clínicos. Si la información no fue mencionada, indícalo con una frase prudente como "No mencionado en la consulta."`;
  }
  return `Redacta la sección "${`${label}`.trim()}" usando únicamente información mencionada de forma explícita en la transcripción. No inventes datos clínicos. Si la información no fue mencionada, indícalo con una frase prudente como "No mencionado en la consulta."`;
}

class ClinicalTemplateService {
  constructor(templateRepository) {
    if (!templateRepository) {
      throw new Error('ClinicalTemplateService requires a template repository');
    }
    this.templateRepository = templateRepository;
  }

  static normalizeSpecialty(value = '') {
    return toSnakeKey(value);
  }

  static normalizeSections(rawSections) {
    if (!Array.isArray(rawSections)) {
      throw clinicalError('TEMPLATE_INVALID', 'Las secciones deben ser una lista.');
    }

    const drafts = rawSections.map((raw, index) => {
      if (typeof raw === 'string') {
        return { label: raw, index };
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...raw, index };
      }
      throw clinicalError('TEMPLATE_INVALID', `La sección en la posición ${index + 1} debe ser un texto o un objeto.`);
    });

    const normalized = drafts.map((draft) => {
      const label = `${draft.label || ''}`.trim().slice(0, MAX_LABEL_LENGTH);
      if (!label) {
        throw clinicalError('TEMPLATE_INVALID', `La sección en la posición ${draft.index + 1} no tiene label.`);
      }
      const key = toSnakeKey(`${draft.key || ''}`.trim() || label) || `seccion_${draft.index + 1}`;
      const orderValue = Number(draft.order);
      // mode: cómo se genera esta casilla. 'inherit' sigue a la plantilla (y ésta
      // a la especialidad); 'verbatim' se copia tal cual se dictó; 'interpretive'
      // se redacta a partir de la conversación. `verbatim: true` legado se lee
      // como 'verbatim' y se sigue emitiendo como booleano derivado una release.
      const mode = NoteModeResolver.normalizeSectionMode(draft);
      const verbatim = mode === 'verbatim';
      // La instrucción entra al prompt: una línea, sin saltos, con tope. Se
      // colapsa el whitespace porque un salto de línea dentro de una instrucción
      // es la forma más fácil de que parezca una regla nueva del sistema.
      const rawInstruction = `${draft.instruction || ''}`.replace(/\s+/g, ' ').trim();
      if (rawInstruction.length > MAX_INSTRUCTION_LENGTH) {
        console.warn(`[Clinical Templates] instrucción de "${label}" truncada a ${MAX_INSTRUCTION_LENGTH} caracteres.`);
      }
      const instruction = rawInstruction.slice(0, MAX_INSTRUCTION_LENGTH)
        || defaultInstruction(label, { verbatim });
      return {
        key,
        label,
        order: Number.isFinite(orderValue) && orderValue > 0 ? orderValue : draft.index + 1,
        required: draft.required === true,
        mode,
        verbatim,
        instruction,
        index: draft.index
      };
    });

    if (normalized.length < MIN_SECTIONS) {
      throw clinicalError('TEMPLATE_INVALID', `La plantilla debe tener al menos ${MIN_SECTIONS} secciones.`);
    }
    if (normalized.length > MAX_SECTIONS) {
      throw clinicalError('TEMPLATE_INVALID', `La plantilla no puede tener más de ${MAX_SECTIONS} secciones.`);
    }

    const seenKeys = new Set();
    normalized.forEach((section) => {
      if (seenKeys.has(section.key)) {
        throw clinicalError('TEMPLATE_INVALID', `La plantilla tiene keys de sección duplicadas: "${section.key}".`);
      }
      seenKeys.add(section.key);
    });

    return normalized
      .sort((a, b) => (a.order - b.order) || (a.index - b.index))
      .map((section, position) => ({
        key: section.key,
        label: section.label,
        order: position + 1,
        required: section.required,
        mode: section.mode,
        verbatim: section.verbatim,
        instruction: section.instruction
      }));
  }

  static validatePayload(payload = {}) {
    const name = `${payload.name || ''}`.trim();
    if (!name) {
      throw clinicalError('TEMPLATE_INVALID', 'La plantilla debe tener un nombre.');
    }
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      throw clinicalError('TEMPLATE_INVALID', `El nombre debe tener entre ${MIN_NAME_LENGTH} y ${MAX_NAME_LENGTH} caracteres.`);
    }

    const specialty = ClinicalTemplateService.normalizeSpecialty(payload.specialty);
    if (!specialty) {
      throw clinicalError('TEMPLATE_INVALID', 'La plantilla debe tener una especialidad.');
    }

    const description = `${payload.description || ''}`.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw clinicalError('TEMPLATE_INVALID', `La descripción no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres.`);
    }

    const sections = ClinicalTemplateService.normalizeSections(payload.sections);
    const noteMode = NoteModeResolver.normalizeTemplateNoteMode(payload.note_mode);

    return { name, specialty, description, sections, note_mode: noteMode };
  }

  canEdit(template, { ownerUserId = null, canManageInstitutional = false } = {}) {
    if (!template) {
      return false;
    }
    if (template.scope === 'institutional') {
      return Boolean(canManageInstitutional);
    }
    return Boolean(ownerUserId && template.owner_user_id === ownerUserId);
  }

  isVisible(template, { ownerUserId = null } = {}) {
    if (!template) {
      return false;
    }
    if (template.scope === 'institutional') {
      return true;
    }
    return Boolean(ownerUserId && template.owner_user_id === ownerUserId);
  }

  async list({ specialty = '', ownerUserId = null } = {}) {
    return this.templateRepository.listVisible({
      specialty: ClinicalTemplateService.normalizeSpecialty(specialty),
      ownerUserId
    });
  }

  async create(payload, { ownerUserId = null } = {}) {
    const normalized = ClinicalTemplateService.validatePayload(payload);
    return this.templateRepository.create({
      ...normalized,
      owner_user_id: ownerUserId,
      scope: 'personal',
      is_default: false,
      status: 'active'
    });
  }

  async getVisible(templateId, { ownerUserId = null } = {}) {
    const template = await this.templateRepository.getById(templateId);
    if (!this.isVisible(template, { ownerUserId })) {
      throw clinicalError('TEMPLATE_NOT_FOUND', 'No se encontró la plantilla clínica.');
    }
    return template;
  }

  async update(templateId, payload, { ownerUserId = null, canManageInstitutional = false } = {}) {
    const template = await this.getVisible(templateId, { ownerUserId });
    if (!this.canEdit(template, { ownerUserId, canManageInstitutional })) {
      throw clinicalError('UNAUTHORIZED', 'No autorizado para modificar esta plantilla.', 403);
    }
    const normalized = ClinicalTemplateService.validatePayload({
      name: typeof payload.name !== 'undefined' ? payload.name : template.name,
      specialty: typeof payload.specialty !== 'undefined' ? payload.specialty : template.specialty,
      description: typeof payload.description !== 'undefined' ? payload.description : template.description,
      sections: typeof payload.sections !== 'undefined' ? payload.sections : template.sections,
      note_mode: typeof payload.note_mode !== 'undefined' ? payload.note_mode : template.note_mode
    });
    return this.templateRepository.update(templateId, normalized);
  }

  async archive(templateId, { ownerUserId = null, canManageInstitutional = false } = {}) {
    const template = await this.getVisible(templateId, { ownerUserId });
    if (!this.canEdit(template, { ownerUserId, canManageInstitutional })) {
      throw clinicalError('UNAUTHORIZED', 'No autorizado para archivar esta plantilla.', 403);
    }
    return this.templateRepository.archive(templateId);
  }
}

ClinicalTemplateService.MAX_INSTRUCTION_LENGTH = MAX_INSTRUCTION_LENGTH;
ClinicalTemplateService.MIN_SECTIONS = MIN_SECTIONS;
ClinicalTemplateService.MAX_SECTIONS = MAX_SECTIONS;
ClinicalTemplateService.defaultInstruction = defaultInstruction;
ClinicalTemplateService.toSnakeKey = toSnakeKey;

module.exports = ClinicalTemplateService;
