const { clinicalError, isClinicalError } = require('./ClinicalErrors');

const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { withPrivacyScope, lastPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');

// Orquesta la generación de nota. Dos entradas:
//   - generateFromTranscript: la parte pura (prompt → LLM → validación), sin
//     base de datos. La usan el pipeline público y los evals.
//   - generate: carga el encounter, cambia estados, persiste y publica en el
//     historial. La usan la ruta clínica y el rescate.
// Nunca registra transcripción ni contenido de la nota (PHI).
const JSON_OBJECT_FORMAT = Object.freeze({ type: 'json_object' });

// Presupuesto de tiempo de la nota. Es la llamada más larga del sistema (una
// transcripción entera de entrada, la nota entera de salida) y tenía el mismo
// timeout que todo lo demás, 60 s, igual que el tope de la función en Vercel:
// una nota que pasaba de ~59 s la mataba Vercel desde fuera. El médico recibía
// un 504 sin CORS ("revisa tu conexión"), la consulta se quedaba en
// note_generating para siempre y reintentar fallaba igual con la misma
// transcripción.
//
// Los tres números van escalonados, y el orden importa:
//   web (GENERATE_NOTE_TIMEOUT_MS) 180 s  >  este timeout 160 s + persistir
//   función de Vercel (vercel.json)  300 s  >  todo lo anterior
// Así el que corta primero es el proveedor, con un error limpio: la consulta
// pasa a failed y el médico recibe NOTE_GENERATION_FAILED, no un 504.
const DEFAULT_NOTE_TIMEOUT_MS = 160000;
// Nunca por encima del tope de la función: ahí volvería el corte desde fuera.
const MAX_NOTE_TIMEOUT_MS = 280000;

function noteTimeoutMs(env = process.env) {
  const configured = Number(env.CLINICAL_NOTE_LLM_TIMEOUT_MS);
  const value = configured > 0 ? configured : DEFAULT_NOTE_TIMEOUT_MS;
  return Math.min(value, MAX_NOTE_TIMEOUT_MS);
}

// Un proveedor que no soporta json_schema lo dice con un 400 que nombra el
// response_format. Se recuerda a nivel de módulo: pagar un 400 por cada nota
// para volver a descubrirlo sería absurdo.
let schemaRejected = false;

function looksLikeSchemaRejection(error) {
  const message = `${error?.message || ''}`;
  return /response_format|json_schema|schema/i.test(message);
}

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
  callModel(plan, format, usage) {
    return withFeature(
      FEATURES.NOTE_GENERATION,
      () => this.llmProvider.chatExpectingJson(plan.messages, format, {
        temperature: plan.temperature,
        timeoutMs: noteTimeoutMs()
      }),
      usage
    );
  }

  // Schema estricto cuando el builder lo trae y el proveedor lo acepta; si lo
  // rechaza, un reintento con json_object y las siguientes van directas.
  async requestNoteJson(plan, usage) {
    const strict = plan.responseFormat && plan.responseFormat.type === 'json_schema';
    const format = strict && !schemaRejected ? plan.responseFormat : JSON_OBJECT_FORMAT;
    try {
      return await this.callModel(plan, format, usage);
    } catch (error) {
      if (format.type === 'json_schema' && looksLikeSchemaRejection(error)) {
        schemaRejected = true;
        console.warn(`[Clinical Note] el proveedor rechazó json_schema (${`${error.message || ''}`.slice(0, 120)}); se usa json_object en adelante.`);
        return this.callModel(plan, JSON_OBJECT_FORMAT, usage);
      }
      throw error;
    }
  }

  async generateFromTranscript({ transcript = '', templateSnapshot = null, noteDetail = '', sessionId = '', privacyScope = null } = {}) {
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
    const usage = {
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
    };
    // El escudo de privacidad corre dentro de LLMProvider; el ámbito (semillas
    // del encounter o de la consulta) lo pone quien conoce la fuente.
    const { content, privacy } = await withPrivacyScope(privacyScope || {}, async () => {
      const raw = await this.requestNoteJson(plan, usage);
      return { content: raw, privacy: lastPrivacyResult() };
    });
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    if (privacy?.rehydration === 'incomplete') {
      // Un marcador que esta llamada no emitió se deja visible a propósito:
      // el médico tiene que verlo, no una adivinanza nuestra.
      parsed.warnings = [
        ...(Array.isArray(parsed?.warnings) ? parsed.warnings : []),
        'La nota contiene un marcador de privacidad que no se pudo resolver. Revísala antes de firmar.'
      ];
    }
    const noteJson = this.validationService.validateAndRepair(parsed, templateSnapshot, {
      transcript: cleanTranscript,
      modes: plan.modes
    });
    return {
      noteJson,
      promptVersion: plan.promptVersion,
      noteMode: plan.noteMode,
      temperature: plan.temperature,
      // Conteos y estados de la protección, nunca valores (PrivacyContext).
      privacy: privacy || null
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
      // El ámbito de privacidad lo fija ESTE servicio, con el encounter ya
      // cargado y verificado: el rescate oportunista llama aquí desde la
      // petición de otro médico, y un ámbito heredado de la ruta taparía con
      // la identidad equivocada.
      const { noteJson, noteMode, privacy } = await this.generateFromTranscript({
        transcript,
        templateSnapshot: encounter.template_snapshot,
        noteDetail,
        sessionId: encounter.id,
        privacyScope: { encounter, encounterId: encounter.id }
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

      // `privacy` viaja con la respuesta (conteos, nunca valores): es lo que
      // la web le enseña al médico en vez de una insignia fija.
      return { ...updated, privacy: privacy || null };
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

// Para los arneses: el flag de módulo sobrevive entre casos.
ClinicalNoteGeneratorService.noteTimeoutMs = noteTimeoutMs;
ClinicalNoteGeneratorService.resetSchemaSupport = () => { schemaRejected = false; };
ClinicalNoteGeneratorService.schemaRejected = () => schemaRejected;

module.exports = ClinicalNoteGeneratorService;
