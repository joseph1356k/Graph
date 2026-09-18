const crypto = require('crypto');
const { statusForError, publicErrorMessage } = require('./httpErrors');
const createUpstreamUsageRecorder = require('./recordUsageBestEffort');
const { withFeature } = require('../../src/infrastructure/usage/UsageContext');
const { FEATURES } = require('../../src/domain/usage/vocabulary');
const { isClinicalError } = require('../../src/application/use-cases/ClinicalErrors');
const ClinicalTemplateService = require('../../src/application/use-cases/ClinicalTemplateService');
const ClinicalEncounterService = require('../../src/application/use-cases/ClinicalEncounterService');
const { renderNoteMarkdown } = require('../../src/domain/clinical/noteText');
const { withPrivacyScope } = require('../../src/infrastructure/privacy/PrivacyContext');

// Public, versioned API surface for client apps (Chrome extension, Windows app,
// web app). This layer keeps external contracts stable while delegating to the
// existing application services that power transcription, notes, workflows, and
// autofill.

function boolFlag(value, fallback) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStages(input) {
  const stages = input && typeof input === 'object' ? input : {};
  return {
    transcription: boolFlag(stages.transcription, true),
    note: boolFlag(stages.note, true),
    autofill: boolFlag(stages.autofill, false),
  };
}

function pickArray(primary, fallback = []) {
  return Array.isArray(primary) ? primary : fallback;
}

// Una plantilla enviada inline por un cliente de API se normaliza con las mismas
// reglas que las plantillas guardadas (2–30 secciones, keys estables, modo) y se
// congela como snapshot, igual que en una consulta del portal.
function buildInlineSnapshot(template = {}) {
  const sections = ClinicalTemplateService.normalizeSections(template.sections);
  return ClinicalEncounterService.buildTemplateSnapshot({
    id: `${template.id || 'inline'}`,
    name: `${template.name || 'Plantilla'}`.trim() || 'Plantilla',
    specialty: ClinicalTemplateService.normalizeSpecialty(template.specialty || ''),
    description: '',
    scope: 'inline',
    is_default: false,
    note_mode: template.note_mode,
    sections
  });
}

// Que clave de tercero se sirve bajo que nombre. El nombre de la variable es el mismo que usa el
// cliente de escritorio en su entorno, para que poner una a mano y recibirla del backend sean lo mismo.
const AGENT_KEYS = [
  ['openai', 'OPENAI_API_KEY'],
  ['typesafe', 'TYPESAFE_API_KEY'],
];

function agentKeyNames() {
  return AGENT_KEYS.filter(([, variable]) => `${process.env[variable] || ''}`.trim()).map(([campo]) => campo);
}

function registerPublicApiRoutes(app, deps = {}) {
  const callMiracleRuntime = deps.callMiracleRuntime;
  const noteFieldMatcher = deps.noteFieldMatcher || null;
  const learningSessionService = deps.learningSessionService || null;
  const catalogService = deps.catalogService || null;
  const workflowExecutor = deps.workflowExecutor || null;
  const usageDashboardService = deps.usageDashboardService || null;
  const assistantService = deps.assistantService || null;
  const biopsyService = deps.biopsyService || null;
  // Motor canónico de nota (el mismo que usa el portal). Con él, el pipeline
  // produce note_json cuando el cliente manda plantilla, en vez del Markdown de
  // estructura propia del orquestador de voz.
  const noteGeneratorService = deps.noteGeneratorService || null;
  // Solo para el manifiesto: las rutas del organizador las registra
  // registerOrganizerRoutes. Aquí se declara para que un cliente que descubra
  // el API por GET /api/v1 sepa que existe.
  const organizerService = deps.organizerService || null;
  // Escudo de privacidad para el salto Node → runtime Python (etapa `note`
  // del pipeline). Opcional: sin él la etapa sale como antes y el ledger lo dice.
  const privacyShield = deps.privacyShield || null;

  if (!app || typeof callMiracleRuntime !== 'function') {
    throw new Error('registerPublicApiRoutes requires app and callMiracleRuntime');
  }

  // Solo para el consumo que reporta el runtime de Miracle (Python): esa
  // llamada al modelo no pasa por LLMProvider, así que no la ve nadie más.
  // Todo lo demás de este archivo (autofill, asistente, biopsia) sí pasa por
  // LLMProvider y ya queda anotado allí — volver a anotarlo aquí lo contaría
  // dos veces.
  const recordUpstreamUsage = createUpstreamUsageRecorder(deps.usageRecorder || null);

  function workflowAccess(req) {
    return req.workflowAccess || null;
  }

  function publicError(res, error, fallback = 'request_failed') {
    return res.status(statusForError(error)).json({
      error: publicErrorMessage(error) || error?.message || fallback
    });
  }

  // Capability manifest / discovery.
  app.get('/api/v1', (req, res) => {
    res.json({
      name: 'Miracle Backend API',
      version: 'v1',
      description: 'Backend central que expone las funcionalidades de Miracle a las aplicaciones cliente.',
      pipeline: {
        endpoint: 'POST /api/v1/pipeline',
        description: 'Un solo llamado. Activa/desactiva etapas con stages; el backend procesa solo lo pedido.',
        stages: {
          transcription: { default: true, description: 'Devuelve la transcripcion cruda recibida.' },
          note: { default: true, description: 'Con `template.sections`: nota clinica canonica (note_json con grounding y evidencia verificada, engine=canonical-note). Sin plantilla: bloque de sesion de voz del orquestador (Markdown provisional, engine=voice-scratchpad).' },
          autofill: {
            default: false,
            available: Boolean(noteFieldMatcher),
            description: 'Mapea la nota a los campos detectados por el cliente. Se activa si envias fields.',
          },
        },
      },
      transcriptionSession: {
        endpoint: 'POST /api/v1/transcription/session',
        description: 'Credenciales para transcripcion cruda en streaming (Deepgram) en tiempo real.',
      },
      workflows: {
        available: Boolean(catalogService && workflowExecutor),
        endpoints: [
          'GET /api/v1/workflows',
          'GET /api/v1/workflows/:id',
          'POST /api/v1/workflows/:id/plan'
        ],
        description: 'Catalogo de workflows aprendidos y planes de ejecucion client-side.',
      },
      learning: {
        available: Boolean(learningSessionService),
        endpoints: [
          'POST /api/v1/learning/sessions',
          'POST /api/v1/learning/sessions/:id/steps',
          'POST /api/v1/learning/sessions/:id/context-notes',
          'POST /api/v1/learning/sessions/:id/finish'
        ],
        description: 'Entrenamiento de workflows desde aplicaciones cliente.',
      },
      autofill: {
        available: Boolean(noteFieldMatcher),
        endpoint: 'POST /api/v1/autofill/match',
        description: 'Mapea una nota organizada contra los campos detectados por el cliente.',
      },
      assistant: {
        available: Boolean(assistantService),
        endpoint: 'POST /api/v1/assistant/chat',
        description: 'Chat con el asistente clinico de Miracle (preguntas medicas generales, sin contexto de un paciente especifico).',
      },
      organizer: {
        available: Boolean(organizerService),
        endpoints: [
          'POST /api/v1/organizer/profiles',
          'GET /api/v1/organizer/profiles/:deviceId',
          'POST /api/v1/organizer/profiles/:deviceId/samples',
          'POST /api/v1/organizer/organize'
        ],
        description: 'Hoja en blanco para quien no es medico: genera un system prompt a medida desde lo que la persona cuenta por voz (y capturas de sus reportes actuales) y con el organiza cada transcripcion.',
      },
      biopsy: {
        available: Boolean(biopsyService),
        endpoint: 'POST /api/v1/biopsy/extract',
        description: 'Lee la foto de una hoja de laboratorio manuscrita (bacteriologia/patologia) y la transcribe a las secciones de la plantilla enviada.',
      },
      agentKeys: {
        available: Boolean(agentKeyNames().length),
        endpoint: 'GET /api/v1/agent/claves',
        description: 'Claves de terceros (voz y decisor) para el asistente de escritorio, que no las lleva dentro del instalador.',
      },
    });
  });

  // CLAVES DE TERCEROS PARA EL ASISTENTE DE ESCRITORIO (Windows). Ver spec 041 de windows-app.
  //
  // POR QUE EXISTE. El Setup.exe que se distribuye lleva embebidas la credencial de Graph y el token
  // de actualizaciones, y nada mas. La voz (OpenAI) y el decisor (TypeSafe) salian de variables de
  // entorno del equipo de quien desarrolla, asi que una copia instalada en otra maquina llegaba SIN
  // VOZ Y SIN JEV. Embeberlas en el binario era la salida rapida y se descarto: un .exe que lleva
  // claves de pago se las entrega a quien lo reciba, y rotarlas obligaria a sacar instalador nuevo.
  // Aqui ya viven como variables de entorno, y rotarlas es cambiarlas y volver a desplegar.
  //
  // QUIEN PUEDE PEDIRLAS. Todo lo que cuelga de /api/v1 pasa por requireApiKey (web/server.js), que
  // valida contra el registro de keys y deja la etiqueta del cliente en req.apiClient. Eso significa
  // que CUALQUIER key valida —tambien la de la extension o la web— puede pedirlas; si eso deja de
  // ser aceptable, AGENT_KEYS_ALLOWED_LABELS acota a una lista de etiquetas sin tocar codigo.
  //
  // QUE NO SE REGISTRA: ni un valor. Solo QUE etiqueta pidio y QUE nombres se sirvieron. Un secreto
  // en un log es un secreto repartido.
  app.get('/api/v1/agent/claves', (req, res) => {
    const permitidas = `${process.env.AGENT_KEYS_ALLOWED_LABELS || ''}`
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const etiqueta = (req.apiClient && req.apiClient.label) || 'desconocida';
    if (permitidas.length && !permitidas.includes(etiqueta)) {
      console.warn(`[agent/claves] ${etiqueta} no esta en AGENT_KEYS_ALLOWED_LABELS: no se le sirven claves`);
      return res.status(403).json({ error: 'Esta API key no puede pedir claves de terceros.' });
    }

    const claves = {};
    for (const [campo, variable] of AGENT_KEYS) {
      const valor = `${process.env[variable] || ''}`.trim();
      if (valor) claves[campo] = valor;
    }

    // Que no se quede en ninguna cache intermedia, ni de proxy ni de navegador.
    res.set('Cache-Control', 'no-store, private');
    console.log(`[agent/claves] ${etiqueta} pidio claves; se sirven: ${Object.keys(claves).join(', ') || 'ninguna'}`);
    return res.json(claves);
  });

  // Raw transcription streaming enablement (Deepgram credentials).
  app.post('/api/v1/transcription/session', async (req, res) => {
    try {
      const proxied = await callMiracleRuntime(req, '/api/voice/stream-session', {
        method: 'POST',
        body: JSON.stringify(req.body || {}),
      });
      return res.status(proxied.statusCode).json(proxied.body);
    } catch (error) {
      if (error.code === 'MIRACLE_RUNTIME_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'La transcripcion no esta configurada en este entorno.' });
      }
      return res
        .status(error.statusCode || 502)
        .json({ error: error.message || 'No fue posible iniciar la transcripcion.' });
    }
  });

  // Unified pipeline: one call, toggleable stages.
  app.post('/api/v1/pipeline', async (req, res) => {
    const body = req.body || {};
    const stages = normalizeStages(body.stages);
    const sessionId = `${body.session_id || ''}`.trim() || crypto.randomUUID();
    const transcript = `${body.transcript || ''}`.trim();
    const result = { session_id: sessionId, stages };

    if (stages.transcription) {
      result.transcription = { text: transcript };
    }

    const inlineTemplate = body.template && typeof body.template === 'object' && Array.isArray(body.template.sections)
      ? body.template
      : null;

    if (stages.note) {
      if (!transcript) {
        result.note = { status: 'skipped', reason: 'no_transcript' };
      } else if (inlineTemplate) {
        // Con plantilla: nota clínica canónica (note_json validado, con
        // grounding y evidencia verificada). Es la misma representación que
        // persiste el portal; aquí sólo no se guarda.
        if (!noteGeneratorService || typeof noteGeneratorService.generateFromTranscript !== 'function') {
          result.note = { status: 'unavailable', reason: 'note_engine_not_configured' };
        } else {
          try {
            const snapshot = buildInlineSnapshot(inlineTemplate);
            const generated = await noteGeneratorService.generateFromTranscript({
              transcript,
              templateSnapshot: snapshot,
              noteDetail: body.note_detail,
              sessionId,
            // Ámbito de privacidad: el escudo siembra desde la consulta si el
            // cliente la identifica; sin id, desde lo que detecte en el texto.
            privacyScope: { consultationId: `${body.consultation_id || body.consultationId || body.export_id || ''}`.trim() }
          });
            result.note = {
              engine: 'canonical-note',
              note_json: generated.noteJson,
              content: renderNoteMarkdown(generated.noteJson),
              note_mode: generated.noteMode,
              prompt_version: generated.promptVersion,
              backend_status: 'canonical-note',
              usage: null
            };
          } catch (error) {
            // Una plantilla mal formada es error del cliente, no de una etapa.
            if (isClinicalError(error) && error.code === 'TEMPLATE_INVALID') {
              return res.status(400).json({ error: error.message, code: error.code });
            }
            result.note = { status: 'error', error: error.message || 'note_failed' };
          }
        }
      } else {
        // Sin plantilla: bloque de sesión de voz del orquestador (Markdown
        // provisional que sigue al médico mientras habla). No es la nota
        // clínica final; se etiqueta para que el cliente lo sepa.
        try {
          const sequence = Number(body.sequence) || 1;
          // El runtime Python llama al proveedor por su cuenta: se tapa aquí,
          // en el salto Node → Python, que es el último punto de Miracle. El
          // runtime no tiene otra fuente de datos, así que equivale a taparlo
          // antes del proveedor.
          const consultationId = `${body.consultation_id || body.consultationId || body.export_id || ''}`.trim();
          const protection = privacyShield
            ? await withPrivacyScope(
              { consultationId, noteContent: (body.note && body.note.content) || '' },
              () => privacyShield.protectTexts(
                { transcript, noteContent: (body.note && body.note.content) || '' },
                { feature: FEATURES.CLINICAL_STRUCTURING }
              )
            )
            : null;
          const outbound = protection ? protection.texts : { transcript, noteContent: (body.note && body.note.content) || '' };
          const orchestrated = await callMiracleRuntime(req, '/api/voice/orchestrator/events', {
            method: 'POST',
            body: JSON.stringify({
              voice_session_id: sessionId,
              note_path: body.note && typeof body.note.path !== 'undefined' ? body.note.path : null,
              note_title: (body.note && body.note.title) || 'Nota',
              note_content: outbound.noteContent,
              tab_id: body.client_id || 'api-v1',
              event_id: crypto.randomUUID(),
              sequence,
              segment: {
                segment_id: `api_${sessionId}_${sequence}`,
                kind: 'final',
                transcript: outbound.transcript,
                language: body.language || null,
              },
            }),
          });
          const payload = orchestrated.body || {};
          const resolvedContent = protection
            ? privacyShield.restoreText(payload.resolved_note_content || '', protection)
            : (payload.resolved_note_content || '');
          result.note = {
            engine: 'voice-scratchpad',
            content: resolvedContent,
            // Intacto a propósito: el plugin detecta el modo degradado con
            // startsWith('heuristic-fallback').
            backend_status: payload.backend_status || '',
            usage: payload.usage || null,
            ...(protection ? { privacy: privacyShield.publicSummaryFor(protection) } : {})
          };
          recordUpstreamUsage(payload.usage, {
            feature: FEATURES.CLINICAL_STRUCTURING,
            sessionId,
            metadata: protection ? privacyShield.metadataFor(protection) : {}
          });
        } catch (error) {
          if (error.code === 'MIRACLE_RUNTIME_NOT_CONFIGURED') {
            result.note = { status: 'unavailable', reason: 'runtime_not_configured' };
          } else {
            result.note = { status: 'error', error: error.message || 'note_failed' };
          }
        }
      }
    }

    if (stages.autofill) {
      const fields = pickArray(body.fields);
      const noteContent = (result.note && result.note.content) || (body.note && body.note.content) || '';
      if (!noteFieldMatcher) {
        result.autofill = { status: 'unavailable', reason: 'not_configured' };
      } else if (!fields.length) {
        result.autofill = { status: 'skipped', reason: 'no_fields' };
      } else if (!`${noteContent}`.trim()) {
        result.autofill = { status: 'skipped', reason: 'no_note_content' };
      } else {
        try {
          const matched = await withFeature(FEATURES.FIELD_MATCHING, () => noteFieldMatcher.match({
            noteContent,
            fields,
            alreadyFulfilled: pickArray(body.already_fulfilled, pickArray(body.alreadyFulfilled)),
            pageUrl: body.page_url || body.pageUrl || '',
            voiceSessionId: sessionId,
            // Id de la consulta (= id del trabajo de exportación): con él el
            // escudo de privacidad siembra desde la base, no solo desde la nota.
            consultationId: `${body.consultation_id || body.consultationId || body.export_id || ''}`.trim(),
          }));
          result.autofill = {
            matches: matched.matches || [],
            readyToSubmit: Boolean(matched.readyToSubmit),
            ready_to_submit: Boolean(matched.readyToSubmit),
            submit_reason: matched.submitReason || '',
            usage: matched.usage || null,
            ...(matched.privacy ? { privacy: matched.privacy } : {})
          };
        } catch (error) {
          result.autofill = { status: 'error', error: error.message || 'autofill_failed' };
        }
      }
    }

    return res.json(result);
  });

  app.post('/api/v1/autofill/match', async (req, res) => {
    if (!noteFieldMatcher) {
      return res.status(503).json({ error: 'Note field matcher not configured.' });
    }
    try {
      const body = req.body || {};
      const noteContent = body.note_content || body.noteContent || body.note?.content || '';
      const sessionId = body.session_id || body.voiceSessionId || '';
      const matched = await withFeature(FEATURES.FIELD_MATCHING, () => noteFieldMatcher.match({
        noteContent,
        fields: pickArray(body.fields),
        alreadyFulfilled: pickArray(body.already_fulfilled, pickArray(body.alreadyFulfilled)),
        pageUrl: body.page_url || body.pageUrl || '',
        voiceSessionId: sessionId,
        consultationId: `${body.consultation_id || body.consultationId || body.export_id || ''}`.trim()
      }));
      return res.json({
        autofill: {
          matches: matched.matches || [],
          ready_to_submit: Boolean(matched.readyToSubmit),
          readyToSubmit: Boolean(matched.readyToSubmit),
          submit_reason: matched.submitReason || '',
          usage: matched.usage || null,
          ...(matched.privacy ? { privacy: matched.privacy } : {})
        }
      });
    } catch (error) {
      return publicError(res, error, 'autofill_match_failed');
    }
  });

  // Clinical assistant chat, general mode only (no encounter_id — public API
  // clients authenticate with a permanent key, not a doctor's Supabase
  // session, so there is no ownership to check against). Same engine as the
  // Supabase-gated /api/clinical/assistant/chat and the Provider Studio test
  // surface: one prompt, one validation pass, one provider config.
  app.post('/api/v1/assistant/chat', async (req, res) => {
    if (!assistantService) {
      return res.status(503).json({ error: 'Assistant not configured.' });
    }
    try {
      const body = req.body || {};
      const result = await withFeature(FEATURES.ASISTENTE, () => assistantService.chat({
        message: body.message,
        specialty: body.specialty,
        history: pickArray(body.history)
      }, {}));
      return res.json({
        answer: result.answer,
        specialty: result.specialty,
        safety_notice: result.safety_notice,
        usage: result.usage || null
      });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        error: error.message || 'assistant_chat_failed'
      });
    }
  });

  // Lab/biopsy photo extraction. Clients (e.g. the bacteriology "Laboratorio"
  // module) POST the photo of a hand-written worksheet plus the template
  // sections; one vision call transcribes it into { key, content }. Stateless:
  // the client owns persistence and the resulting note is plain data.
  app.post('/api/v1/biopsy/extract', async (req, res) => {
    if (!biopsyService) {
      return res.status(503).json({ error: 'Biopsy extraction not configured.' });
    }
    try {
      const body = req.body || {};
      const result = await withFeature(FEATURES.BIOPSIA, () => biopsyService.extract({
        image: body.image,
        mediaType: body.media_type,
        template: body.template,
        mode: body.mode
      }));
      return res.json({
        template: result.template,
        sections: result.sections,
        warnings: result.warnings,
        usage: result.usage || null
      });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        error: error.message || 'biopsy_extract_failed'
      });
    }
  });

  app.post('/api/v1/learning/sessions', async (req, res) => {
    if (!learningSessionService) {
      return res.status(503).json({ error: 'Workflow learning not configured.' });
    }
    try {
      const body = req.body || {};
      const description = `${body.description || ''}`.trim() || 'Untitled workflow';
      const context = body.context && typeof body.context === 'object' ? body.context : {};
      const workflowId = await learningSessionService.startSession(
        description,
        {
          ...context,
          appId: body.app_id || body.appId || context.appId || '',
          sourceUrl: body.source_url || body.sourceUrl || context.sourceUrl || '',
          sourceOrigin: body.source_origin || body.sourceOrigin || context.sourceOrigin || '',
          sourcePathname: body.source_pathname || body.sourcePathname || context.sourcePathname || '',
          sourceTitle: body.source_title || body.sourceTitle || context.sourceTitle || '',
          scope: 'private',
          ownerId: req.workflowAccess?.ownerId || ''
        },
        { access: workflowAccess(req) }
      );
      return res.status(201).json({
        session: {
          id: workflowId,
          workflow_id: workflowId,
          recording: true
        }
      });
    } catch (error) {
      learningSessionService.reset({ access: workflowAccess(req) });
      return publicError(res, error, 'learning_session_start_failed');
    }
  });

  app.post('/api/v1/learning/sessions/:id/steps', async (req, res) => {
    if (!learningSessionService) {
      return res.status(503).json({ error: 'Workflow learning not configured.' });
    }
    try {
      const stepOrder = await learningSessionService.recordStep(req.body || {}, {
        sessionId: req.params.id,
        access: workflowAccess(req)
      });
      return res.status(201).json({
        step: {
          step_order: stepOrder,
          stepOrder
        }
      });
    } catch (error) {
      return publicError(res, error, 'learning_step_failed');
    }
  });

  app.post('/api/v1/learning/sessions/:id/context-notes', async (req, res) => {
    if (!learningSessionService) {
      return res.status(503).json({ error: 'Workflow learning not configured.' });
    }
    try {
      const body = req.body || {};
      await learningSessionService.addContextNote(body.note || body, {
        sessionId: req.params.id,
        access: workflowAccess(req)
      });
      return res.status(201).json({ ok: true });
    } catch (error) {
      return publicError(res, error, 'learning_context_note_failed');
    }
  });

  app.post('/api/v1/learning/sessions/:id/finish', async (req, res) => {
    if (!learningSessionService) {
      return res.status(503).json({ error: 'Workflow learning not configured.' });
    }
    try {
      const result = await learningSessionService.finishSession({
        sessionId: req.params.id,
        access: workflowAccess(req)
      });
      let workflow = null;
      if (catalogService && result.workflowId) {
        workflow = await catalogService.getWorkflowById(result.workflowId, workflowAccess(req));
      }
      return res.json({
        workflow_id: result.workflowId,
        summary: result.summary || '',
        workflow
      });
    } catch (error) {
      return publicError(res, error, 'learning_session_finish_failed');
    }
  });

  app.get('/api/v1/workflows', async (req, res) => {
    if (!catalogService) {
      return res.status(503).json({ error: 'Workflow catalog not configured.' });
    }
    try {
      const workflows = await catalogService.getCatalog(workflowAccess(req));
      return res.json({ workflows });
    } catch (error) {
      return publicError(res, error, 'workflows_list_failed');
    }
  });

  app.get('/api/v1/workflows/:id', async (req, res) => {
    if (!catalogService) {
      return res.status(503).json({ error: 'Workflow catalog not configured.' });
    }
    try {
      const workflow = await catalogService.getWorkflowById(req.params.id, workflowAccess(req));
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      return res.json({ workflow });
    } catch (error) {
      return publicError(res, error, 'workflow_read_failed');
    }
  });

  // Borrar un workflow (desde el carrusel del cliente Windows). Mismo modelo de acceso que el resto de
  // /api/v1/workflows (X-API-Key → workflowAccess). El delete es idempotente-amistoso: 404 si no existe.
  app.delete('/api/v1/workflows/:id', async (req, res) => {
    if (!catalogService) {
      return res.status(503).json({ error: 'Workflow catalog not configured.' });
    }
    try {
      await catalogService.deleteWorkflow(req.params.id, workflowAccess(req));
      return res.json({ deleted: true, id: req.params.id });
    } catch (error) {
      if ((error.message || '').includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      return publicError(res, error, 'workflow_delete_failed');
    }
  });

  // Aprendizaje del loop consciente→subconsciente: el cliente se alineó conscientemente con la
  // superficie del workflow (abrió/enfocó la app), y lo enseña anteponiendo un step de alineación
  // en orden 0. Así la próxima vez el plan ya lo trae y arranca solo. Idempotente. La app se deriva
  // del sourceOrigin YA guardado del workflow (el cliente no manda nada).
  app.post('/api/v1/workflows/:id/prepend-alignment', async (req, res) => {
    if (!catalogService) {
      return res.status(503).json({ error: 'Workflow catalog not configured.' });
    }
    try {
      const access = workflowAccess(req);
      const wf = await catalogService.getWorkflowById(req.params.id, access);
      if (!wf) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      const origin = `${wf.sourceOrigin || ''}`.trim();
      if (!origin) {
        return res.status(400).json({ error: 'El workflow no tiene superficie de origen.' });
      }
      const steps = Array.isArray(wf.steps) ? wf.steps : [];
      const first = steps[0];
      if (first && `${first.selector || ''}`.startsWith('app:')) {
        return res.json({ workflow: wf, already_present: true });
      }
      const proc = origin.replace(/^[a-z]+:\/\//i, '').split('/')[0]; // uia://notepad.exe → notepad.exe
      const alignmentStep = {
        actionType: 'navigation',       // único tipo con url que sobrevive al planner
        url: origin,                    // isExecutableStep exige url truthy para navigation
        selector: `app:${proc}`,        // el cliente reconoce el step de alineación por este prefijo
        label: `Abrir/enfocar ${proc}`,
        explanation: 'Alineación consciente: llegar a la superficie del workflow antes de ejecutar.',
        surfaceHints: { kind: 'surface-alignment', appId: proc },
        stepOrder: 0                    // NO se reindexan los demás (branches/variables dependen del orden)
      };
      const updated = await catalogService.updateWorkflow(
        { id: wf.id, steps: [alignmentStep, ...steps] },
        access
      );
      return res.json({ workflow: updated, learned: true });
    } catch (error) {
      if ((error.message || '').includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      return publicError(res, error, 'workflow_prepend_alignment_failed');
    }
  });

  app.post('/api/v1/workflows/:id/plan', async (req, res) => {
    if (!workflowExecutor) {
      return res.status(503).json({ error: 'Workflow execution planner not configured.' });
    }
    try {
      const body = req.body || {};
      const executionPlan = await workflowExecutor.getExecutionPlanById(
        req.params.id,
        body.variables || {},
        body.execution_intent || body.executionIntent || {},
        workflowAccess(req)
      );
      return res.json({ execution_plan: executionPlan });
    } catch (error) {
      if ((error.message || '').includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      return publicError(res, error, 'workflow_plan_failed');
    }
  });
}

module.exports = registerPublicApiRoutes;
