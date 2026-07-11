const { clinicalError } = require('./ClinicalErrors');

// Business rules for clinical encounters: consent, template snapshots,
// transcript intake and status transitions. Note generation lives in
// ClinicalNoteGeneratorService.
const CONSULTATION_TYPES = ['presencial', 'telemedicina', 'audio_upload'];
const STATUSES = [
  'created',
  'recording',
  'transcript_ready',
  'note_generating',
  'note_generated',
  'completed',
  'failed'
];
const MAX_TRANSCRIPT_LENGTH = 200000;
const MAX_PATIENT_ID_LENGTH = 200;

class ClinicalEncounterService {
  constructor(encounterRepository, templateService) {
    if (!encounterRepository || !templateService) {
      throw new Error('ClinicalEncounterService requires encounterRepository and templateService');
    }
    this.encounterRepository = encounterRepository;
    this.templateService = templateService;
  }

  static buildTemplateSnapshot(template, now = new Date()) {
    return {
      template_id: template.id,
      name: template.name,
      specialty: template.specialty,
      description: template.description || '',
      scope: template.scope,
      is_default: Boolean(template.is_default),
      sections: (template.sections || []).map((section) => ({
        key: section.key,
        label: section.label,
        order: section.order,
        required: Boolean(section.required),
        instruction: section.instruction
      })),
      snapshot_at: now.toISOString()
    };
  }

  async createEncounter(payload = {}, { doctorId = null } = {}) {
    if (payload.consent !== true) {
      throw clinicalError('CONSENT_REQUIRED', 'Se requiere el consentimiento del paciente para crear la consulta.');
    }

    const consultationType = `${payload.consultation_type || ''}`.trim();
    if (!CONSULTATION_TYPES.includes(consultationType)) {
      throw clinicalError('ENCOUNTER_INVALID', `consultation_type debe ser uno de: ${CONSULTATION_TYPES.join(', ')}.`);
    }

    const templateId = `${payload.template_id || ''}`.trim();
    if (!templateId) {
      throw clinicalError('TEMPLATE_NOT_FOUND', 'Debes indicar la plantilla clínica de la consulta.');
    }

    const template = await this.templateService.getVisible(templateId, { ownerUserId: doctorId });
    if (template.status !== 'active') {
      throw clinicalError('TEMPLATE_NOT_FOUND', 'La plantilla clínica está archivada y no puede usarse en consultas nuevas.');
    }
    if (!Array.isArray(template.sections) || template.sections.length === 0) {
      throw clinicalError('TEMPLATE_INVALID', 'La plantilla clínica no tiene secciones utilizables.');
    }

    const patientIdRaw = payload.patient_id == null ? '' : `${payload.patient_id}`.trim();
    if (patientIdRaw.length > MAX_PATIENT_ID_LENGTH) {
      throw clinicalError('ENCOUNTER_INVALID', `patient_id no puede superar ${MAX_PATIENT_ID_LENGTH} caracteres.`);
    }

    return this.encounterRepository.create({
      doctor_id: doctorId,
      patient_id: patientIdRaw || null,
      consultation_type: consultationType,
      consent: true,
      template_id: template.id,
      template_snapshot: ClinicalEncounterService.buildTemplateSnapshot(template),
      status: 'created',
      transcript: ''
    });
  }

  async getOwnedEncounter(encounterId, { doctorId = null } = {}) {
    const id = `${encounterId || ''}`.trim();
    if (!id) {
      throw clinicalError('ENCOUNTER_NOT_FOUND', 'No se encontró la consulta clínica.');
    }
    let encounter = null;
    try {
      encounter = await this.encounterRepository.getById(id);
    } catch (error) {
      // PostgREST rejects malformed uuids with 400; treat them as not found.
      if (error.statusCode === 400) {
        throw clinicalError('ENCOUNTER_NOT_FOUND', 'No se encontró la consulta clínica.');
      }
      throw error;
    }
    if (!encounter || (encounter.doctor_id || null) !== (doctorId || null)) {
      throw clinicalError('ENCOUNTER_NOT_FOUND', 'No se encontró la consulta clínica.');
    }
    return encounter;
  }

  async saveTranscript(encounterId, transcriptRaw, { doctorId = null } = {}) {
    const encounter = await this.getOwnedEncounter(encounterId, { doctorId });
    if (encounter.status === 'completed') {
      throw clinicalError('ENCOUNTER_INVALID', 'La consulta ya fue completada; no se puede reemplazar la transcripción.', 409);
    }

    const transcript = typeof transcriptRaw === 'string' ? transcriptRaw.trim() : '';
    if (!transcript) {
      throw clinicalError('TRANSCRIPT_REQUIRED', 'La transcripción no puede estar vacía.');
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      throw clinicalError('TRANSCRIPT_TOO_LONG', `La transcripción supera el máximo de ${MAX_TRANSCRIPT_LENGTH} caracteres.`);
    }

    return this.encounterRepository.update(encounter.id, {
      transcript,
      status: 'transcript_ready'
    });
  }

  async saveEditedNote(encounterId, noteJson, { doctorId = null } = {}, noteValidationService) {
    if (!noteValidationService) {
      throw new Error('saveEditedNote requires the note validation service');
    }
    const encounter = await this.getOwnedEncounter(encounterId, { doctorId });
    const validated = noteValidationService.validateEditedNote(noteJson, encounter.template_snapshot);
    return this.encounterRepository.update(encounter.id, {
      note_json: validated,
      status: 'completed'
    });
  }
}

ClinicalEncounterService.CONSULTATION_TYPES = CONSULTATION_TYPES;
ClinicalEncounterService.STATUSES = STATUSES;
ClinicalEncounterService.MAX_TRANSCRIPT_LENGTH = MAX_TRANSCRIPT_LENGTH;

module.exports = ClinicalEncounterService;
