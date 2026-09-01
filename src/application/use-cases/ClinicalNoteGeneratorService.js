const { clinicalError, isClinicalError } = require('./ClinicalErrors');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');

// Orquesta la generación de nota. Dos entradas:
//   - generateFromTranscript: la parte pura (prompt → LLM → validación), sin
//     base de datos. La usan el pipeline público y los evals.
//   - generate: carga el encounter, cambia estados, persiste y publica en el
//     historial. La usan la ruta clínica y el rescate.
// Nunca registra transcripción ni contenido de la nota (PHI).
class ClinicalNoteGeneratorService {
  constructor({
    encounterService = null,
    encounterRepository = null,
    llmProvider,
    promptBuilder,
    validationService,
    consultationMirrorService = null,
    healthAlertService = null
  }) {
    if (!promptBuilder || !validationService) {
      throw new Error('ClinicalNoteGeneratorService requires promptBuilder and validationService');
    }
    this.encounterService = encounterService;
    this.encounterRepository = encounterRepository;
    this.llmProvider = llmProvider || null;
    this.promptBuilder = promptBuilder;
    this.validationService = validationService;
    // Opcional a propósito: los arneses de prueba generan notas sin base de
    // datos detrás, y el espejo no debe ser un requisito para generar.
    this.consultationMirrorService = consultationMirrorService;
    // También opcional: avisar de un fallo no puede ser requisito para generar.
    this.healthAlertService = healthAlertService;
  }

  // Avisar nunca puede tumbar la generación ni retrasar la respuesta al médico.
  notifyInBackground(alertKey, finding, options = {}) {
    if (!this.healthAlertService) {
      return;
    }
    Promise.resolve()
      .then(() => this.healthAlertService.notifyNow(alertKey, finding, options))
      .catch((error) => console.error(`[Clinical Note] Aviso ${alertKey} falló: ${error.message}`));
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  // Los builders antiguos (o los fakes de los arneses) sólo exponen build().
  planPrompt(input) {
    if (typeof this.promptBuilder.plan === 'function') {
      return this.promptBuilder.plan(input);
    }
    return {
      messages: this.promptBuilder.build(input),
      promptVersion: this.promptBuilder.constructor?.PROMPT_VERSION || 'legacy',
      noteMode: 'unknown',
      temperature: undefined,
      modes: null
    };
  }

  /**
   * Parte pura: transcripción + snapshot → note_json validado. Sin encounter,
   * sin persistencia. `sessionId` ata el gasto a una consulta en el ledger
   * cuando existe.
   */
  async generateFromTranscript({ transcript = '', templateSnapshot = null, noteDetail = '', sessionId = '' } = {}) {
    const cleanTranscript = `${transcript || ''}`.trim();
    if (!cleanTranscript) {
      throw clinicalError('TRANSCRIPT_REQUIRED', 'La transcripción no puede estar vacía.');
    }
    const snapshotSections = Array.isArray(templateSnapshot?.sections) ? templateSnapshot.sections : [];
    if (snapshotSections.length === 0) {
      throw clinicalError('TEMPLATE_INVALID', 'La plantilla no tiene secciones utilizables.');
    }
    if (!this.hasLlm()) {
      throw clinicalError('LLM_NOT_CONFIGURED', 'El proveedor de IA no está configurado.');
    }

    const plan = this.planPrompt({ transcript: cleanTranscript, templateSnapshot, noteDetail });
    const content = await withFeature(
      FEATURES.NOTE_GENERATION,
      () => this.llmProvider.chatExpectingJson(plan.messages, { type: 'json_object' }, {
        temperature: plan.temperature
      }),
      {
        ...(sessionId ? { sessionId } : {}),
        // Procedencia: qué revisión del prompt y qué modo produjeron este
        // gasto. Sin esto una regresión sólo se atribuye al modelo.
        metadata: {
          promptVersion: plan.promptVersion,
          noteMode: plan.noteMode,
          templateId: `${templateSnapshot.template_id || ''}`,
          specialtyCode: `${templateSnapshot.specialty || ''}`,
          ...(Number.isFinite(plan.temperature) ? { temperature: plan.temperature } : {}),
          sectionCount: snapshotSections.length
        }
      }
    );
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    const noteJson = this.validationService.validateAndRepair(parsed, templateSnapshot, {
      transcript: cleanTranscript,
      modes: plan.modes
    });
    return {
      noteJson,
      promptVersion: plan.promptVersion,
      noteMode: plan.noteMode,
      temperature: plan.temperature
    };
  }

  async generate(encounterId, { doctorId = null, noteDetail = '' } = {}) {
    if (!this.encounterService || !this.encounterRepository) {
      throw new Error('ClinicalNoteGeneratorService.generate requires encounterService and encounterRepository');
    }
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
      // `sessionId` = el encounter: es lo que ata este gasto a UNA consulta en
      // el ledger, y sin eso el costo solo se puede leer en agregado (ver
      // encounter_metrics en el portal). No es un dato del cliente: sale del
      // encounter que este servicio ya cargó y verificó como propio.
      const { noteJson, noteMode } = await this.generateFromTranscript({
        transcript,
        templateSnapshot: encounter.template_snapshot,
        noteDetail,
        sessionId: encounter.id
      });

      // note_json_ai congela lo que produjo la IA. note_json es la nota viva: el
      // médico la edita con PUT /note y ahí sí se sobrescribe. Guardar las dos es
      // lo único que permite medir después cuánto hubo que corregirle a la IA
      // (y por especialidad, que es donde se ve si un prompt sirve o estorba).
      const updated = await this.encounterRepository.update(encounter.id, {
        note_json: noteJson,
        note_json_ai: noteJson,
        note_generated_at: new Date().toISOString(),
        status: 'note_generated'
      });
      const inferred = noteJson.sections.filter((section) => section.grounding === 'inferred').length;
      console.log(`[Clinical Note] Encounter ${encounter.id}: nota generada (modo ${noteMode}, ${noteJson.sections.length} secciones, ${inferred} interpretadas, ${noteJson.warnings.length} warnings).`);

      // Publicar en el historial es responsabilidad del servidor, no del
      // navegador: si esto dependiera del cliente, cerrar la pestaña dejaría la
      // nota huérfana (así se perdieron 24 consultas hasta el 2026-08-01).
      // Best-effort a propósito: la nota YA está guardada y devolverle un error
      // al médico por un fallo del espejo sería mentirle sobre su trabajo. Si
      // falla, queda en el log y la alerta diaria de huérfanas lo delata.
      if (this.consultationMirrorService) {
        try {
          const mirror = await this.consultationMirrorService.publish(
            { ...encounter, transcript },
            noteJson
          );
          if (!mirror.published && mirror.reason !== 'ya_existe') {
            console.warn(`[Clinical Note] Encounter ${encounter.id}: no se publicó en el historial (${mirror.reason}).`);
            this.notifyInBackground('orphan_note', {
              severity: 'critico',
              title: 'Una nota generada no llegó al historial del médico',
              detail: `La consulta tiene su nota pero no aparece en el historial (motivo: ${mirror.reason}). El médico no la encuentra.`
            });
          }
        } catch (mirrorError) {
          console.error(`[Clinical Note] Encounter ${encounter.id}: espejo falló: ${mirrorError.message}`);
          this.notifyInBackground('orphan_note', {
            severity: 'critico',
            title: 'Una nota generada no llegó al historial del médico',
            detail: 'Falló la publicación en el historial. El médico dictó su consulta y no la encuentra en su lista.'
          });
        }
      }

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
