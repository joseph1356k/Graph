const { clinicalError, isClinicalError } = require('./ClinicalErrors');

// Orchestrates note generation: loads the encounter, builds the strict prompt
// from the template_snapshot, calls the configured LLM, validates/repairs the
// JSON and persists the result. Never logs transcript or note contents (PHI).
class ClinicalNoteGeneratorService {
  constructor({ encounterService, encounterRepository, llmProvider, promptBuilder, validationService }) {
    if (!encounterService || !encounterRepository || !promptBuilder || !validationService) {
      throw new Error('ClinicalNoteGeneratorService requires encounterService, encounterRepository, promptBuilder and validationService');
    }
    this.encounterService = encounterService;
    this.encounterRepository = encounterRepository;
    this.llmProvider = llmProvider || null;
    this.promptBuilder = promptBuilder;
    this.validationService = validationService;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  async generate(encounterId, { doctorId = null } = {}) {
    const encounter = await this.encounterService.getOwnedEncounter(encounterId, { doctorId });

    const transcript = `${encounter.transcript || ''}`.trim();
    if (!transcript) {
      throw clinicalError('TRANSCRIPT_REQUIRED', 'La consulta no tiene transcripción; guárdala antes de generar la nota.');
    }
    const snapshotSections = Array.isArray(encounter.template_snapshot?.sections)
      ? encounter.template_snapshot.sections
      : [];
    if (snapshotSections.length === 0) {
      throw clinicalError('TEMPLATE_INVALID', 'La consulta no tiene un template_snapshot utilizable.');
    }
    if (!this.hasLlm()) {
      throw clinicalError('LLM_NOT_CONFIGURED', 'El proveedor de IA no está configurado.');
    }

    await this.encounterRepository.update(encounter.id, { status: 'note_generating' });

    try {
      const messages = this.promptBuilder.build({
        transcript,
        templateSnapshot: encounter.template_snapshot
      });
      const content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      const noteJson = this.validationService.validateAndRepair(parsed, encounter.template_snapshot);

      const updated = await this.encounterRepository.update(encounter.id, {
        note_json: noteJson,
        status: 'note_generated'
      });
      console.log(`[Clinical Note] Encounter ${encounter.id}: nota generada (${noteJson.sections.length} secciones, ${noteJson.warnings.length} warnings).`);
      return updated;
    } catch (error) {
      try {
        await this.encounterRepository.update(encounter.id, { status: 'failed' });
      } catch (statusError) {
        console.error(`[Clinical Note] Encounter ${encounter.id}: no se pudo marcar como failed: ${statusError.message}`);
      }
      if (isClinicalError(error) && error.code !== 'NOTE_GENERATION_FAILED') {
        throw error;
      }
      console.error(`[Clinical Note] Encounter ${encounter.id}: generación falló: ${error.message}`);
      throw clinicalError('NOTE_GENERATION_FAILED', 'No fue posible generar la nota clínica. Intenta de nuevo.');
    }
  }
}

module.exports = ClinicalNoteGeneratorService;
