const { clinicalError, isClinicalError } = require('./ClinicalErrors');
const contextBuilder = require('./ClinicalAssistantContextBuilder');
const ClinicalAssistantValidationService = require('./ClinicalAssistantValidationService');
const ClinicalAssistantPromptBuilder = require('./ClinicalAssistantPromptBuilder');
const { parseAssistantReply } = require('./ClinicalAssistantResponseParser');
const NoteModeResolver = require('./NoteModeResolver');
const { buildRetrievalContext, inferPopulations, lastUserQuestion, isRagDisabled } = require('../knowledge/ClinicalGuidelineIndex');
const { verifyFigures } = require('./ClinicalAnswerVerifier');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { withPrivacyScope, lastPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');
// Miracle Clinical Assistant: chat clínico contextual, diferenciales (por
// encounter o por texto) y ajuste de nota. Un servicio, un motor de
// diferenciales, un LLMProvider. Nunca persiste nada ni registra PHI.
const MAX_MESSAGE_LENGTH = 8000;
const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_EXPLANATION_LENGTH = 600;
const MAX_NOTE_TEXT_LENGTH = 20000;
// Tope de salida del chat v3 (JSON con respuesta + propuesta). Una sola
// llamada tiene que caber en los 60 s de Vercel con el prompt completo.
const MAX_CHAT_OUTPUT_TOKENS = 1800;

// Cada tarea con su temperatura: conversar tolera variación; razonar sobre un
// caso y editar una nota, casi ninguna. El chat v3 responde JSON con citas y
// propuestas de nota: baja de 0.4 a 0.3.
const TEMPERATURE = Object.freeze({ chat: 0.3, diagnostic: 0.2, adjust: 0.2 });

class ClinicalAssistantService {
  constructor({
    encounterService,
    llmProvider,
    promptBuilder,
    validationService,
    noteValidationService = null,
    guidelineIndex = null,
    drugLabelService = null
  } = {}) {
    if (!encounterService || !promptBuilder || !validationService) {
      throw new Error('ClinicalAssistantService requires encounterService, promptBuilder and validationService');
    }
    this.encounterService = encounterService;
    this.llmProvider = llmProvider || null;
    this.promptBuilder = promptBuilder;
    this.validationService = validationService;
    // Opcional: sólo lo necesita adjustNote (reutiliza el validador de la nota).
    this.noteValidationService = noteValidationService;
    // Opcional: índice de guías clínicas (ClinicalGuidelineIndex). Sin él el
    // chat funciona igual, sin citas.
    this.guidelineIndex = guidelineIndex;
    // Opcional: fichas técnicas oficiales (DrugLabelService) para preguntas de
    // dosis. Sin él, o si la fuente no responde a tiempo, el chat sigue igual.
    this.drugLabelService = drugLabelService;
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
  //
  // v3: la respuesta del modelo es JSON (respaldo, fuentes, faltantes,
  // alertas, seguimientos, propuesta de nota). Lo que el prompt promete se
  // comprueba aquí: las citas se resuelven contra lo recuperado, la propuesta
  // pasa por el validador de notas y `answer` sigue siendo un string para
  // los clientes que solo leen eso (API pública, Provider Studio).
  async chat({
    message,
    encounterId = '',
    specialty = '',
    screenContext = null,
    history = [],
    doctor = null,
    noteDraft = null,
    codes = [],
    patientContext = null,
    noteEditable = true
  } = {}, { doctorId = null } = {}) {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    if (!cleanMessage) {
      throw clinicalError('ASSISTANT_INVALID', 'El mensaje para el asistente no puede estar vacío.');
    }
    if (cleanMessage.length > MAX_MESSAGE_LENGTH) {
      throw clinicalError('ASSISTANT_INVALID', `El mensaje supera el máximo de ${MAX_MESSAGE_LENGTH} caracteres.`);
    }
    this.requireLlm();

    const encounter = await this.loadEncounterIfRequested(encounterId, doctorId);
    const built = contextBuilder.build({
      encounter,
      specialtyInput: specialty,
      screenContext,
      history,
      doctor,
      noteDraft,
      codes,
      patientContext,
      noteEditable
    });
    const { clinicalContext, usedContext } = built;
    const guidelines = this.retrieveGuidelines({ message: cleanMessage, clinicalContext });
    clinicalContext.guidelines = guidelines;
    usedContext.guidelines = guidelines.length;
    const drugLabels = await this.retrieveDrugLabels({ message: cleanMessage, clinicalContext });
    clinicalContext.drug_labels = drugLabels;
    usedContext.drug_labels = drugLabels.length;

    try {
      const messages = this.promptBuilder.buildChatMessages({
        clinicalContext,
        message: cleanMessage,
        history: clinicalContext.history
      });
      // Atado a la consulta SOLO en el modo B (con encounter). En el modo A no
      // hay consulta a la que imputarlo, y ponerle una sesión inventada haría
      // que un costo sin dueño pareciera de alguien.
      // Ámbito de privacidad por encounter (modo B) o efímero (modo A): en
      // los dos casos el escudo tapa lo que detecte en el mensaje y el
      // historial; con encounter tiene además las semillas de la consulta, y
      // con nota en pantalla, las del borrador (noteContent): un nombre que
      // el médico acaba de escribir en la nota y aún no guardó sale tapado.
      const draftText = contextBuilder.noteDraftPlainText(built.noteDraft);
      const privacyScope = {
        ...(encounter ? { encounter, encounterId: encounter.id } : {}),
        ...(draftText ? { noteContent: draftText } : {})
      };
      const { content: rawContent, usage, privacy } = await withPrivacyScope(privacyScope, async () => {
        const result = await withFeature(
          FEATURES.ASISTENTE,
          () => this.llmProvider.chatExpectingJsonWithUsage(
            messages,
            { type: 'json_object' },
            { temperature: TEMPERATURE.chat, maxTokens: MAX_CHAT_OUTPUT_TOKENS }
          ),
          {
            ...(encounter ? { sessionId: encounter.id } : {}),
            metadata: {
              promptVersion: ClinicalAssistantPromptBuilder.CHAT_PROMPT_VERSION,
              temperature: TEMPERATURE.chat,
              maxTokens: MAX_CHAT_OUTPUT_TOKENS,
              guidelineHits: guidelines.length,
              drugLabelHits: drugLabels.length,
              noteSource: clinicalContext.note_source || 'none'
            }
          }
        );
        return { ...result, privacy: lastPrivacyResult() };
      });

      const reply = parseAssistantReply(rawContent, {
        guidelines,
        drugLabels,
        parseJsonObject: (content) => this.llmProvider.parseJsonObject(content)
      });
      // Cada cifra con unidad de la respuesta se busca en las fuentes y en la
      // consulta; las que no aparecen se devuelven para que el médico las
      // verifique (ClinicalAnswerVerifier).
      const verification = verifyFigures(reply.answer, this.evidenceTexts({
        built,
        clinicalContext,
        message: cleanMessage,
        guidelines,
        drugLabels
      }));
      const noteProposal = reply.proposal && clinicalContext.note_editable
        ? this.buildNoteProposal({ proposal: reply.proposal, encounter, noteDraft: built.noteDraft, message: cleanMessage })
        : null;

      return {
        answer: this.validationService.sanitizeAnswer(reply.answer),
        mode: 'clinical_chat',
        specialty: clinicalContext.specialty,
        used_context: usedContext,
        privacy: privacy || null,
        safety_notice: ClinicalAssistantValidationService.SAFETY_NOTICE_CHAT,
        suggested_actions: [],
        usage: this.usageSummary(usage),
        support: reply.support,
        sources: reply.sources,
        missing_information: reply.missing_information,
        alarm_signs: reply.alarm_signs,
        follow_up_questions: reply.follow_up_questions,
        figures_checked: verification.checked,
        unverified_figures: verification.unverified,
        note_proposal: noteProposal
      };
    } catch (error) {
      if (isClinicalError(error)) {
        throw error;
      }
      console.error(`[Clinical Assistant] chat falló: ${error.message}`);
      throw clinicalError('ASSISTANT_FAILED', 'No fue posible generar la respuesta del asistente. Intenta de nuevo.');
    }
  }

  /**
   * Fragmentos de guías para esta pregunta. Nunca lanza: sin índice, con el
   * retrieval apagado (MIRACLE_ASSISTANT_RAG_DISABLED=1) o ante un fallo, el
   * chat sigue sin citas y el prompt lo dice.
   */
  retrieveGuidelines({ message = '', clinicalContext = {} } = {}) {
    if (!this.guidelineIndex || typeof this.guidelineIndex.search !== 'function' || isRagDisabled()) {
      return [];
    }
    try {
      const codes = Array.isArray(clinicalContext.codes) ? clinicalContext.codes : [];
      const context = buildRetrievalContext({ noteJson: clinicalContext.note_json, codes });
      return this.guidelineIndex.search({
        message,
        context,
        followUp: lastUserQuestion(clinicalContext.history),
        specialty: clinicalContext.specialty,
        cie10: codes.filter((code) => code.sistema === 'CIE-10').map((code) => code.codigo),
        populations: inferPopulations({ message, patient: clinicalContext.patient, context, codes })
      });
    } catch (error) {
      console.warn(`[Clinical Assistant] retrieval de guías falló: ${error.message}`);
      return [];
    }
  }

  /**
   * Fichas técnicas para preguntas de dosis. Nunca lanza ni demora el chat más
   * allá del timeout del servicio: ante cualquier fallo, lista vacía. A la
   * fuente externa solo sale el nombre genérico del medicamento.
   */
  async retrieveDrugLabels({ message = '', clinicalContext = {} } = {}) {
    if (!this.drugLabelService || typeof this.drugLabelService.lookup !== 'function') {
      return [];
    }
    try {
      return await this.drugLabelService.lookup({ message, previousQuestion: lastUserQuestion(clinicalContext.history) });
    } catch (error) {
      console.warn(`[Clinical Assistant] fichas técnicas no disponibles: ${error.message}`);
      return [];
    }
  }

  /** Textos contra los que se verifican las cifras de la respuesta. */
  evidenceTexts({ built = {}, clinicalContext = {}, message = '', guidelines = [], drugLabels = [] } = {}) {
    const texts = [message];
    for (const item of [...guidelines, ...drugLabels]) texts.push(item.text);
    const draft = contextBuilder.noteDraftPlainText(built.noteDraft);
    if (draft) texts.push(draft);
    const persisted = built.persistedNote;
    if (persisted && Array.isArray(persisted.sections)) {
      texts.push(persisted.sections.map((section) => `${section.content || ''}`).join('\n'));
    }
    if (built.fullTranscript) texts.push(built.fullTranscript);
    for (const item of Array.isArray(clinicalContext.history) ? clinicalContext.history : []) {
      if (item.role === 'user') texts.push(item.content);
    }
    for (const code of Array.isArray(clinicalContext.codes) ? clinicalContext.codes : []) {
      texts.push(`${code.descripcion || ''}`);
    }
    const age = Number(clinicalContext.patient?.edad);
    if (Number.isFinite(age)) texts.push(`${age} años`);
    return texts;
  }

  /**
   * Convierte la propuesta del modelo (solo secciones cambiadas) en una nota
   * validada. Base = nota en pantalla si llegó, si no la persistida; sin nota
   * no hay nada que proponer. Snapshot = el del encounter o uno sintético a
   * partir de la base (consulta sin encounter en Graph). Nunca persiste.
   */
  buildNoteProposal({ proposal, encounter = null, noteDraft = null, message = '' } = {}) {
    if (!this.noteValidationService || !proposal) {
      return null;
    }
    const persisted = encounter?.note_json && Array.isArray(encounter.note_json.sections) ? encounter.note_json : null;
    const base = noteDraft
      ? {
        summary: noteDraft.summary || `${persisted?.summary || ''}`,
        sections: noteDraft.sections.map((section) => ({ ...section })),
        warnings: [],
        missing_required_sections: []
      }
      : persisted;
    if (!base || !Array.isArray(base.sections) || base.sections.length === 0) {
      return null;
    }
    const baseKeys = new Set(base.sections.map((section) => section.key));
    const labelByKey = new Map(base.sections.map((section) => [section.key, section.label]));
    const sections = proposal.secciones
      .filter((section) => baseKeys.has(section.key))
      .map((section) => ({ key: section.key, label: labelByKey.get(section.key) || section.key, content: section.content }));
    if (!sections.length && !proposal.resumen) {
      return null;
    }

    try {
      const snapshot = Array.isArray(encounter?.template_snapshot?.sections) && encounter.template_snapshot.sections.length > 0
        ? encounter.template_snapshot
        : ClinicalAssistantService.syntheticSnapshot(base);
      const modelNote = { sections, ...(proposal.resumen ? { summary: proposal.resumen } : {}) };
      const merged = this.mergeWithOriginalNote(modelNote, base);
      // Lo que el médico escribió en el chat es fuente legítima de la
      // propuesta («agrega que niega fiebre»): se añade al texto contra el
      // que el validador ubica la evidencia. Solo el mensaje actual, nunca
      // el historial: el validador tomaría texto del modelo por transcripción.
      const transcript = [`${encounter?.transcript || ''}`, '[Indicaciones del médico en el chat]', message]
        .filter(Boolean)
        .join('\n\n');
      const proposed = this.noteValidationService.validateAndRepair(merged, snapshot, {
        transcript,
        modes: NoteModeResolver.resolve(snapshot),
        previous: base
      });
      // Solo cuentan las secciones que el modelo devolvió Y que de verdad
      // cambian: el validador rellena huecos y recalcula grounding, y eso no
      // es un cambio que el médico tenga que revisar.
      const returnedKeys = new Set(sections.map((section) => section.key));
      const changed = proposed.sections
        .filter((section) => returnedKeys.has(section.key))
        .map((section) => ({
          key: section.key,
          label: section.label,
          content: section.content,
          previous_content: `${base.sections.find((item) => item.key === section.key)?.content || ''}`
        }))
        .filter((section) => section.content !== section.previous_content);
      const summaryChanged = Boolean(proposal.resumen) && proposed.summary !== `${base.summary || ''}`;
      if (!changed.length && !summaryChanged) {
        return null;
      }
      return {
        proposed_note_json: proposed,
        changed_sections: changed,
        summary: summaryChanged ? proposed.summary : null,
        explanation: proposal.motivo
          || `Se propone cambiar: ${changed.map((section) => section.label).join(', ') || 'el resumen'}.`,
        requires_physician_review: true
      };
    } catch (error) {
      // Una propuesta que no se puede validar se descarta; la respuesta sigue.
      console.warn(`[Clinical Assistant] propuesta de nota descartada: ${error.message}`);
      return null;
    }
  }

  /** Snapshot mínimo para validar una propuesta cuando no hay encounter en Graph. */
  static syntheticSnapshot(note) {
    return {
      template_id: '',
      name: 'Nota en pantalla',
      specialty: '',
      sections: note.sections.map((section, index) => ({
        key: section.key,
        label: section.label || section.key,
        order: index + 1,
        required: false,
        mode: 'inherit',
        verbatim: false,
        instruction: ''
      }))
    };
  }

  // ---- Diferenciales: un solo motor, dos entradas ----

  async runDiagnostic(messages, { sessionId = '', transcript = '', noteJson = null, noteText = '', privacyScope = null } = {}) {
    // Ámbito de privacidad: por encounter cuando lo hay; efímero (semillas
    // desde el propio texto de la nota) en el endpoint de texto plano.
    const { content, privacy } = await withPrivacyScope(privacyScope || {}, async () => {
      const raw = await withFeature(
      FEATURES.DIAGNOSIS_SUGGESTION,
      () => this.llmProvider.chatExpectingJson(messages, { type: 'json_object' }, { temperature: TEMPERATURE.diagnostic }),
      {
        ...(sessionId ? { sessionId } : {}),
        metadata: { promptVersion: ClinicalAssistantPromptBuilder.DIAGNOSTIC_PROMPT_VERSION, temperature: TEMPERATURE.diagnostic }
      }
      );
      return { content: raw, privacy: lastPrivacyResult() };
    });
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    const result = this.validationService.normalizeSuggestions(parsed, { transcript, noteJson, noteText });
    if (result.definitive_language_hits > 0) {
      console.warn(`[Clinical Assistant] definitive_language_hits=${result.definitive_language_hits}`);
    }
    return { ...result, privacy: privacy || null };
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
        privacyScope: { encounter, encounterId: encounter.id },
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
      return await this.runDiagnostic(messages, { noteText: cleanNote, privacyScope: { noteContent: cleanNote } });
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
      const { content, privacy } = await withPrivacyScope({ encounter, encounterId: encounter.id }, async () => {
        const raw = await withFeature(
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
        return { content: raw, privacy: lastPrivacyResult() };
      });
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
        requires_physician_review: true,
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
