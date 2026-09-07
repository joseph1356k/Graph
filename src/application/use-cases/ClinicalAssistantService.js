const { clinicalError, isClinicalError } = require('./ClinicalErrors');
const contextBuilder = require('./ClinicalAssistantContextBuilder');
const ClinicalAssistantValidationService = require('./ClinicalAssistantValidationService');
const ClinicalAssistantPromptBuilder = require('./ClinicalAssistantPromptBuilder');
const NoteModeResolver = require('./NoteModeResolver');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
// Miracle Clinical Assistant: chat clínico contextual, diferenciales (por
// encounter o por texto) y ajuste de nota. Un servicio, un motor de
// diferenciales, un LLMProvider. Nunca persiste nada ni registra PHI.
const MAX_MESSAGE_LENGTH = 8000;
const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_EXPLANATION_LENGTH = 600;
const MAX_NOTE_TEXT_LENGTH = 20000;

// Cada tarea con su temperatura: conversar tolera variación; razonar sobre un
// caso y editar una nota, casi ninguna.
const TEMPERATURE = Object.freeze({ chat: 0.4, diagnostic: 0.2, adjust: 0.2 });

class ClinicalAssistantService {
  constructor({ encounterService, llmProvider, promptBuilder, validationService, noteValidationService = null } = {}) {
    if (!encounterService || !promptBuilder || !validationService) {
      throw new Error('ClinicalAssistantService requires encounterService, promptBuilder and validationService');
    }
    this.encounterService = encounterService;
    this.llmProvider = llmProvider || null;
    this.promptBuilder = promptBuilder;
    this.validationService = validationService;
    // Opcional: sólo lo necesita adjustNote (reutiliza el validador de la nota).
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

  usageSummary(usage) {
    return usage
      ? {
        provider: this.llmProvider.provider || '',
        api_family: 'chat_completions',
        model: this.llmProvider.model || '',
        input_tokens: Number(usage.prompt_tokens) || 0,
        output_tokens: Number(usage.completion_tokens) || 0,
        total_tokens: Number(usage.total_tokens) || 0
      }
      : null;
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
      // Atado a la consulta SOLO en el modo B (con encounter). En el modo A no
      // hay consulta a la que imputarlo, y ponerle una sesión inventada haría
      // que un costo sin dueño pareciera de alguien.
      const { content: rawAnswer, usage } = await withFeature(
        FEATURES.ASISTENTE,
        () => this.llmProvider.chatWithUsage(messages, { temperature: TEMPERATURE.chat }),
        {
          ...(encounter ? { sessionId: encounter.id } : {}),
          metadata: { promptVersion: ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION, temperature: TEMPERATURE.chat }
        }
      );
      return {
        answer: this.validationService.sanitizeAnswer(rawAnswer),
        mode: 'clinical_chat',
        specialty: clinicalContext.specialty,
        used_context: usedContext,
        safety_notice: ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT,
        suggested_actions: [],
        usage: this.usageSummary(usage)
      };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] chat falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar la respuesta del asistente. Intenta de nuevo.');
    }
  }

  // ---- Diferenciales: un solo motor, dos entradas ----

  async runDiagnostic(messages, { sessionId = '', transcript = '', noteJson = null, noteText = '' } = {}) {
    const content = await withFeature(
      FEATURES.DIAGNOSIS_SUGGESTION,
      () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }, { temperature: TEMPERATURE.diagnostic }),
      {
        ...(sessionId ? { sessionId } : {}),
        metadata: { promptVersion: ClinicalAssistantPromptBuilder.DIAGNOSTIC_PROMPT_VERSION, temperature: TEMPERATURE.diagnostic }
      }
    );
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    const result = this.validationService.normalizeSuggestions(parsed, { transcript, noteJson, noteText });
    if (result.definitive_language_hits > 0) {
      console.warn(`[Clinical Assistant] definitive_language_hits=${result.definitive_language_hits}`);
    }
    return result;
  }

  // Por encounter (contrato rico, con transcripción y nota persistidas).
  async suggestForEncounter(encounterId, { doctorId = null } = {}) {
    const encounter = await this.encounterService.getOwnedEncounter(encounterId, { doctorId });
    const { clinicalContext, fullTranscript } = contextBuilder.build({ encounter });

    // Respuesta vacía prudente cuando no hay material clínico sobre el que razonar.
    if (!fullTranscript && !clinicalContext.note_json) {
      return {
        suggestions: [],
        safety_notice: ClinicalAssistantValidationService.SAFETY_NOTICE_DIAGNOSTIC
      };
    }
    this.requireLlm();

    try {
      const messages = this.promptBuilder.buildDiagnosticMessages({ clinicalContext });
      const result = await this.runDiagnostic(messages, {
        sessionId: encounter.id,
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

  // Por texto plano, sin encounter (endpoint del plugin). Mismo prompt, misma
  // verificación de evidencia; el adaptador de la ruta proyecta al contrato
  // antiguo.
  async suggestFromText({ noteContent = '', specialty = '' } = {}) {
    const cleanNote = typeof noteContent === 'string' ? noteContent.trim() : '';
    if (!cleanNote) {
      throw clinicalError('ASSISTANT_INVALID', 'La nota clínica está vacía.');
    }
    if (cleanNote.length > MAX_NOTE_TEXT_LENGTH) {
      throw clinicalError('ASSISTANT_INVALID', `La nota clínica supera el límite de ${MAX_NOTE_TEXT_LENGTH} caracteres.`, 413);
    }
    this.requireLlm();
    try {
      const messages = this.promptBuilder.buildDiagnosticMessages({
        clinicalContext: { specialty: NoteModeResolver.normalizeSpecialty(specialty) },
        noteText: cleanNote
      });
      return await this.runDiagnostic(messages, { noteText: cleanNote });
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] diagnosis-suggestions (texto) falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar sugerencias diagnósticas. Intenta de nuevo.');
    }
  }

  // ---- Ajuste de nota clínica (modo C) — propone, nunca persiste ----
  async adjustNote({ encounterId = '', instruction = '', sectionKey = '', instructionKind = 'rewrite', doctor = null } = {}, { doctorId = null } = {}) {
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
    const kind = ClinicalAssistantPromptBuilder.normalizeInstructionKind(instructionKind);
    const cleanSectionKey = `${sectionKey || ''}`.trim();
    if (kind === 'dictation' && !cleanSectionKey) {
      throw clinicalError('ASSISTANT_INVALID', 'El dictado requiere indicar la sección (section_key).');
    }

    const encounter = await this.encounterService.getOwnedEncounter(encounterId, { doctorId });
    const originalNote = encounter.note_json;
    if (!originalNote || !Array.isArray(originalNote.sections) || originalNote.sections.length === 0) {
      throw clinicalError('ENCOUNTER_INVALID', 'La consulta aún no tiene una nota clínica generada para ajustar.');
    }
    if (cleanSectionKey && !originalNote.sections.some((section) => section.key === cleanSectionKey)) {
      throw clinicalError('ASSISTANT_INVALID', `La sección "${cleanSectionKey}" no existe en la nota.`);
    }
    this.requireLlm();

    const { clinicalContext } = contextBuilder.build({ encounter, doctor });

    try {
      const messages = this.promptBuilder.buildNoteAdjustmentMessages({
        clinicalContext,
        instruction: cleanInstruction,
        sectionKey: cleanSectionKey,
        instructionKind: kind
      });
      const content = await withFeature(
        FEATURES.ASISTENTE,
        () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }, { temperature: TEMPERATURE.adjust }),
        {
          sessionId: encounter.id,
          metadata: {
            promptVersion: ClinicalAssistantPromptBuilder.ADJUST_PROMPT_VERSION,
            instructionKind: kind,
            temperature: TEMPERATURE.adjust
          }
        }
      );
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      const modelNote = parsed?.note_json && typeof parsed.note_json === 'object' ? parsed.note_json : parsed;
      // El contrato pide warnings dentro de note_json, pero los modelos los
      // suben a la raíz con frecuencia; se aceptan en ambos sitios.
      if (modelNote !== parsed && Array.isArray(parsed?.warnings) && !Array.isArray(modelNote.warnings)) {
        modelNote.warnings = parsed.warnings;
      }

      // Merge ANTES de validar: una respuesta parcial (sólo la sección
      // ajustada) no puede borrar el resto de la nota. Por key del snapshot se
      // toma la sección del modelo si vino, si no la original.
      const merged = this.mergeWithOriginalNote(modelNote, originalNote);
      // La transcripción permite verificar la evidencia de lo que el modelo
      // tocó; las secciones cuyo contenido no cambió conservan la suya
      // (`previous`). El centinela «[dictado del médico]» sólo vale en modo
      // dictation y sólo en la sección indicada: en una reescritura es una cita
      // inexistente y el validador la descarta.
      const proposedNote = this.noteValidationService.validateAndRepair(merged, encounter.template_snapshot, {
        transcript: `${encounter.transcript || ''}`,
        modes: NoteModeResolver.resolve(encounter.template_snapshot || {}),
        dictation: kind === 'dictation' ? { sectionKey: cleanSectionKey } : null,
        previous: originalNote
      });

      const changedSections = proposedNote.sections
        .filter((section) => {
          const original = originalNote.sections.find((item) => item.key === section.key);
          return `${original?.content || ''}` !== section.content;
        })
        .map((section) => section.key);

      const explanation = `${parsed?.explanation || ''}`.trim().slice(0, MAX_EXPLANATION_LENGTH)
        || (changedSections.length > 0
          ? (kind === 'dictation'
            ? `Se escribió lo dictado en: ${changedSections.join(', ')}.`
            : `Se ajustó la redacción de: ${changedSections.join(', ')}. Sin datos clínicos nuevos.`)
          : 'No se aplicaron cambios: la instrucción no requería modificar la nota o exigía información no disponible.');

      return {
        proposed_note_json: proposedNote,
        changed_sections: changedSections,
        instruction_kind: kind,
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
    // Los warnings del modelo se conservan (antes se descartaban): son la única
    // pista de por qué no aplicó parte de la instrucción.
    const modelWarnings = (Array.isArray(modelNote?.warnings) ? modelNote.warnings : [])
      .map((warning) => `${warning || ''}`.trim())
      .filter(Boolean);
    const originalWarnings = Array.isArray(originalNote.warnings) ? originalNote.warnings : [];
    return {
      summary: typeof modelNote?.summary === 'string' && modelNote.summary.trim()
        ? modelNote.summary
        : originalNote.summary,
      sections,
      warnings: [...new Set([...modelWarnings, ...originalWarnings])],
      missing_required_sections: Array.isArray(originalNote.missing_required_sections)
        ? originalNote.missing_required_sections
        : []
    };
  }
}

ClinicalAssistantService.TEMPERATURE = TEMPERATURE;
ClinicalAssistantService.MAX_NOTE_TEXT_LENGTH = MAX_NOTE_TEXT_LENGTH;

module.exports = ClinicalAssistantService;
