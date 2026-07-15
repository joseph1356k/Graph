const { clinicalError, isClinicalError } = require('./ClinicalErrors');
const contextBuilder = require('./ClinicalAssistantContextBuilder');
const ClinicalAssistantValidationService = require('./ClinicalAssistantValidationService');

// Miracle Clinical Assistant: contextual clinical chat, encounter-based
// diagnostic suggestions and note adjustments. One service, three use cases —
// they share encounter loading (with ownership), context building and the
// shared LLMProvider. Never persists anything and never logs PHI.
const MAX_MESSAGE_LENGTH = 8000;
const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_EXPLANATION_LENGTH = 600;

class ClinicalAssistantService {
  constructor({ encounterService, llmProvider, promptBuilder, validationService, noteValidationService = null } = {}) {
    if (!encounterService || !promptBuilder || !validationService) {
      throw new Error('ClinicalAssistantService requires encounterService, promptBuilder and validationService');
    }
    this.encounterService = encounterService;
    this.llmProvider = llmProvider || null;
    this.promptBuilder = promptBuilder;
    this.validationService = validationService;
    // Optional: only needed for adjustNote (reuses the note engine validator).
    this.noteValidationService = noteValidationService;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  requireLlm() {
    if (!this.hasLlm()) {
      throw clinicalError('LLM_NOT_CONFIGURED', 'El proveedor de IA no está configurado.');
    }
  }

  async loadEncounterIfRequested(encounterId, doctorId) {
    const id = `${encounterId || ''}`.trim();
    if (!id) {
      return null;
    }
    return this.encounterService.getOwnedEncounter(id, { doctorId });
  }

  // ---- Chat clínico contextual (modos A: general, B: con encounter) ----
  async chat({ message, encounterId = '', specialty = '', screenContext = null, history = [] } = {}, { doctorId = null } = {}) {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    if (!cleanMessage) {
      throw clinicalError('ASSISTANT_INVALID', 'El mensaje para el asistente no puede estar vacío.');
    }
    if (cleanMessage.length > MAX_MESSAGE_LENGTH) {
      throw clinicalError('ASSISTANT_INVALID', `El mensaje supera el máximo de ${MAX_MESSAGE_LENGTH} caracteres.`);
    }
    this.requireLlm();

    const encounter = await this.loadEncounterIfRequested(encounterId, doctorId);
    const { clinicalContext, usedContext } = contextBuilder.build({
      encounter,
      specialtyInput: specialty,
      screenContext,
      history
    });

    try {
      const messages = this.promptBuilder.buildChatMessages({
        clinicalContext,
        message: cleanMessage,
        history: clinicalContext.history
      });
      const { content: rawAnswer, usage } = await this.llmProvider.chatWithUsage(messages);
      return {
        answer: this.validationService.sanitizeAnswer(rawAnswer),
        mode: 'clinical_chat',
        specialty: clinicalContext.specialty,
        used_context: usedContext,
        safety_notice: ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT,
        suggested_actions: [],
        usage: usage
          ? {
              provider: this.llmProvider.provider || '',
              api_family: 'chat_completions',
              model: this.llmProvider.model || '',
              input_tokens: Number(usage.prompt_tokens) || 0,
              output_tokens: Number(usage.completion_tokens) || 0,
              total_tokens: Number(usage.total_tokens) || 0
            }
          : null
      };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] chat falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar la respuesta del asistente. Intenta de nuevo.');
    }
  }

  // ---- Sugerencias diagnósticas al final de la cita ----
  async suggestForEncounter(encounterId, { doctorId = null } = {}) {
    const encounter = await this.encounterService.getOwnedEncounter(encounterId, { doctorId });
    const { clinicalContext, fullTranscript } = contextBuilder.build({ encounter });

    // Prudent empty response when there is no clinical material to reason on.
    if (!fullTranscript && !clinicalContext.note_json) {
      return {
        suggestions: [],
        safety_notice: ClinicalAssistantValidationService.SAFETY_NOTICE_DIAGNOSTIC
      };
    }
    this.requireLlm();

    try {
      const messages = this.promptBuilder.buildDiagnosticMessages({ clinicalContext });
      const content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      const result = this.validationService.normalizeSuggestions(parsed, {
        transcript: fullTranscript,
        noteJson: encounter.note_json
      });
      console.log(`[Clinical Assistant] Encounter ${encounter.id}: ${result.suggestions.length} sugerencias diagnósticas.`);
      return result;
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] diagnostic-suggestions falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar sugerencias diagnósticas. Intenta de nuevo.');
    }
  }

  // ---- Ajuste de nota clínica (modo C) — propone, nunca persiste ----
  async adjustNote({ encounterId = '', instruction = '', sectionKey = '' } = {}, { doctorId = null } = {}) {
    if (!this.noteValidationService) {
      throw new Error('adjustNote requires the noteValidationService dependency');
    }
    const cleanInstruction = typeof instruction === 'string' ? instruction.trim() : '';
    if (!cleanInstruction) {
      throw clinicalError('ASSISTANT_INVALID', 'La instrucción de ajuste no puede estar vacía.');
    }
    if (cleanInstruction.length > MAX_INSTRUCTION_LENGTH) {
      throw clinicalError('ASSISTANT_INVALID', `La instrucción supera el máximo de ${MAX_INSTRUCTION_LENGTH} caracteres.`);
    }

    const encounter = await this.encounterService.getOwnedEncounter(encounterId, { doctorId });
    const originalNote = encounter.note_json;
    if (!originalNote || !Array.isArray(originalNote.sections) || originalNote.sections.length === 0) {
      throw clinicalError('ENCOUNTER_INVALID', 'La consulta aún no tiene una nota clínica generada para ajustar.');
    }
    this.requireLlm();

    const { clinicalContext } = contextBuilder.build({ encounter });
    const cleanSectionKey = `${sectionKey || ''}`.trim();

    try {
      const messages = this.promptBuilder.buildNoteAdjustmentMessages({
        clinicalContext,
        instruction: cleanInstruction,
        sectionKey: cleanSectionKey
      });
      const content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      const modelNote = parsed?.note_json && typeof parsed.note_json === 'object' ? parsed.note_json : parsed;

      // Merge BEFORE validating: a partial model response (only the adjusted
      // section) must not wipe the rest of the note. Per snapshot key we take
      // the model's section when present, otherwise the original one.
      const merged = this.mergeWithOriginalNote(modelNote, originalNote);
      const proposedNote = this.noteValidationService.validateAndRepair(merged, encounter.template_snapshot);

      const changedSections = proposedNote.sections
        .filter((section) => {
          const original = originalNote.sections.find((item) => item.key === section.key);
          return `${original?.content || ''}` !== section.content;
        })
        .map((section) => section.key);

      const explanation = `${parsed?.explanation || ''}`.trim().slice(0, MAX_EXPLANATION_LENGTH)
        || (changedSections.length > 0
          ? `Se ajustó la redacción de: ${changedSections.join(', ')}. Sin datos clínicos nuevos.`
          : 'No se aplicaron cambios: la instrucción no requería modificar la nota o exigía información no disponible.');

      return {
        proposed_note_json: proposedNote,
        changed_sections: changedSections,
        explanation,
        requires_physician_review: true
      };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] note-adjustment falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible proponer el ajuste de la nota. Intenta de nuevo.');
    }
  }

  mergeWithOriginalNote(modelNote, originalNote) {
    const modelSections = new Map(
      (Array.isArray(modelNote?.sections) ? modelNote.sections : [])
        .filter((section) => section && typeof section === 'object')
        .map((section) => [`${section.key || ''}`.trim(), section])
    );
    const sections = originalNote.sections.map((original) => modelSections.get(original.key) || original);
    return {
      summary: typeof modelNote?.summary === 'string' && modelNote.summary.trim()
        ? modelNote.summary
        : originalNote.summary,
      sections,
      warnings: Array.isArray(originalNote.warnings) ? originalNote.warnings : [],
      missing_required_sections: Array.isArray(originalNote.missing_required_sections)
        ? originalNote.missing_required_sections
        : []
    };
  }
}

ClinicalAssistantService.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;

module.exports = ClinicalAssistantService;
