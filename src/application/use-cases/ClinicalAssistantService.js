const { clinicalError, isClinicalError } = require('./ClinicalErrors');
const contextBuilder = require('./ClinicalAssistantContextBuilder');
const ClinicalAssistantValidationService = require('./ClinicalAssistantValidationService');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { withPrivacyScope, lastPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');
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
  async chat({ message, encounterId = '', specialty = '', screenContext = null, history = [], doctor = null } = {}, { doctorId = null } = {}) {
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
      history,
      doctor
    });

    try {
      const messages = this.promptBuilder.buildChatMessages({
        clinicalContext,
        message: cleanMessage,
        history: clinicalContext.history
      });
      // Atado a la consulta SOLO en el modo B (con encounter). En el modo A
      // —chat clínico general— no hay consulta a la que imputarlo, y ponerle
      // una sesión inventada haría que un costo sin dueño pareciera de alguien.
      // Ámbito de privacidad por encounter (modo B) o efímero (modo A): en
      // los dos casos el escudo tapa lo que detecte en el mensaje y el
      // historial, y solo con encounter tiene además las semillas de la
      // consulta.
      const { content: rawAnswer, usage, privacy } = await withPrivacyScope(
        encounter ? { encounter, encounterId: encounter.id } : {},
        async () => {
          const result = await withFeature(
            FEATURES.ASISTENTE,
            () => this.llmProvider.chatWithUsage(messages),
            encounter ? { sessionId: encounter.id } : {}
          );
          return { ...result, privacy: lastPrivacyResult() };
        }
      );
      return {
        answer: this.validationService.sanitizeAnswer(rawAnswer),
        mode: 'clinical_chat',
        specialty: clinicalContext.specialty,
        used_context: usedContext,
        privacy: privacy || null,
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
      const { content, privacy } = await withPrivacyScope({ encounter, encounterId: encounter.id }, async () => {
        const raw = await withFeature(
          FEATURES.ASISTENTE,
          () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }),
          { sessionId: encounter.id }
        );
        return { content: raw, privacy: lastPrivacyResult() };
      });
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      const result = this.validationService.normalizeSuggestions(parsed, {
        transcript: fullTranscript,
        noteJson: encounter.note_json
      });
      console.log(`[Clinical Assistant] Encounter ${encounter.id}: ${result.suggestions.length} sugerencias diagnósticas.`);
      return { ...result, privacy: privacy || null };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] diagnostic-suggestions falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar sugerencias diagnósticas. Intenta de nuevo.');
    }
  }

  // ---- Ajuste de nota clínica (modo C) — propone, nunca persiste ----
  //
  // La "nota actual" es la que manda el navegador (`noteJson`, lo que el
  // médico está viendo, con sus ediciones sin guardar) o, si no viene, la
  // persistida. Sobre esa nota se arma el prompt, se hace el merge y se
  // calcula qué cambió; así el ajuste nunca pisa lo que el médico editó a
  // mano en la pantalla.
  async adjustNote({ encounterId = '', instruction = '', sectionKey = '', doctor = null, noteJson = null } = {}, { doctorId = null } = {}) {
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
    const currentNote = this.resolveCurrentNote(noteJson, encounter);
    if (!currentNote || !Array.isArray(currentNote.sections) || currentNote.sections.length === 0) {
      throw clinicalError('ENCOUNTER_INVALID', 'La consulta aún no tiene una nota clínica generada para ajustar.');
    }
    this.requireLlm();

    const cleanSectionKey = `${sectionKey || ''}`.trim();
    const { clinicalContext, fullTranscript, annotationsText } = contextBuilder.buildForAdjustment({
      encounter,
      doctor,
      sectionKey: cleanSectionKey,
      instruction: cleanInstruction,
      currentNote
    });

    try {
      const messages = this.promptBuilder.buildNoteAdjustmentMessages({
        clinicalContext,
        instruction: cleanInstruction
      });
      const { content, privacy } = await withPrivacyScope({ encounter, encounterId: encounter.id }, async () => {
        const raw = await withFeature(
          FEATURES.ASISTENTE,
          () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }),
          { sessionId: encounter.id }
        );
        return { content: raw, privacy: lastPrivacyResult() };
      });
      const parsed = this.llmProvider.parseJsonObject(content || '{}');

      // Formato actual: { sections: [solo las cambiadas], summary?, explanation,
      // unresolved }. Se acepta también el anterior ({ note_json: {...} }) por
      // si el modelo lo devuelve así: el merge de abajo ya sabía convivir con
      // respuestas parciales o completas.
      const modelSections = Array.isArray(parsed?.sections)
        ? parsed.sections
        : (Array.isArray(parsed?.note_json?.sections) ? parsed.note_json.sections : []);
      const modelSummary = typeof parsed?.summary === 'string'
        ? parsed.summary
        : (typeof parsed?.note_json?.summary === 'string' ? parsed.note_json.summary : '');

      const grounded = this.validationService.groundAdjustedSections(modelSections, {
        originalNote: currentNote,
        transcript: fullTranscript,
        annotationsText,
        instruction: cleanInstruction,
        sectionKey: cleanSectionKey
      });

      // Merge BEFORE validating: a partial model response (only the adjusted
      // section) must not wipe the rest of the note. Per snapshot key we take
      // the model's section when present, otherwise the original one. Con
      // alcance de sección, el resumen tampoco se toca.
      const merged = this.mergeWithOriginalNote({
        sections: grounded.sections,
        summary: clinicalContext.scope === 'seccion' ? '' : modelSummary
      }, currentNote);
      const proposedNote = this.noteValidationService.validateAndRepair(merged, encounter.template_snapshot);

      const changedSections = proposedNote.sections
        .filter((section) => {
          const original = currentNote.sections.find((item) => item.key === section.key);
          return `${original?.content || ''}` !== section.content;
        })
        .map((section) => section.key);

      const unresolved = this.validationService.sanitizeUnresolved(parsed?.unresolved);
      const explanation = `${parsed?.explanation || ''}`.trim().slice(0, MAX_EXPLANATION_LENGTH)
        || this.fallbackExplanation({ changedSections, unresolved });

      return {
        proposed_note_json: proposedNote,
        changed_sections: changedSections,
        explanation,
        requires_physician_review: true,
        unresolved,
        unverified: grounded.unverified,
        transcript_coverage: clinicalContext.transcript_coverage,
        sources_used: grounded.sources_used,
        warnings: grounded.warnings,
        privacy: privacy || null
      };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] note-adjustment falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible proponer el ajuste de la nota. Intenta de nuevo.');
    }
  }

  // La nota que manda el navegador tiene que cuadrar con la plantilla de la
  // consulta (mismas keys, todas presentes): es la misma regla que aplica el
  // PUT /note, y por eso se reutiliza su validador. Sin nota en el body, la
  // persistida.
  resolveCurrentNote(noteJson, encounter) {
    if (noteJson === null || typeof noteJson === 'undefined') {
      return encounter.note_json;
    }
    try {
      return this.noteValidationService.validateEditedNote(noteJson, encounter.template_snapshot);
    } catch (error) {
      if (isClinicalError(error) && error.code === 'NOTE_JSON_INVALID') {
        throw clinicalError('ASSISTANT_INVALID', `La nota enviada no coincide con la plantilla de esta consulta: ${error.message}`);
      }
      throw error;
    }
  }

  fallbackExplanation({ changedSections = [], unresolved = [] } = {}) {
    if (changedSections.length > 0) {
      return `Se ajustó: ${changedSections.join(', ')}.`;
    }
    if (unresolved.length > 0) {
      return `No encontré en la consulta lo que pediste (${unresolved.join('; ')}); la nota quedó como estaba.`;
    }
    return 'No se aplicaron cambios: la instrucción no requería modificar la nota.';
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
