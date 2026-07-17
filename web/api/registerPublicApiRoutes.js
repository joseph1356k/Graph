const crypto = require('crypto');
const { statusForError, publicErrorMessage } = require('./httpErrors');
const createUsageRecorder = require('./recordUsageBestEffort');

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

function registerPublicApiRoutes(app, deps = {}) {
  const callMiracleRuntime = deps.callMiracleRuntime;
  const noteFieldMatcher = deps.noteFieldMatcher || null;
  const learningSessionService = deps.learningSessionService || null;
  const catalogService = deps.catalogService || null;
  const workflowExecutor = deps.workflowExecutor || null;
  const usageDashboardService = deps.usageDashboardService || null;
  const assistantService = deps.assistantService || null;
  const biopsyService = deps.biopsyService || null;

  if (!app || typeof callMiracleRuntime !== 'function') {
    throw new Error('registerPublicApiRoutes requires app and callMiracleRuntime');
  }

  const recordUsageBestEffort = createUsageRecorder(usageDashboardService);

  function recordPassthroughUsage(usage, event) {
    if (!usage || typeof usage !== 'object') {
      return;
    }
    recordUsageBestEffort({
      sourceRepo: 'graph',
      provider: usage.provider || 'miracle',
      apiFamily: usage.api_family || usage.apiFamily || 'chat_completions',
      model: usage.model || '',
      inputTokens: Number(usage.input_tokens ?? usage.inputTokens) || 0,
      outputTokens: Number(usage.output_tokens ?? usage.outputTokens) || 0,
      status: 'ok',
      ...event
    }, event.eventType);
  }

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
          note: { default: true, description: 'Organiza la transcripcion en una nota estructurada (Product-LLM).' },
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
      biopsy: {
        available: Boolean(biopsyService),
        endpoint: 'POST /api/v1/biopsy/extract',
        description: 'Lee la foto de una hoja de laboratorio manuscrita (bacteriologia/patologia) y la transcribe a las secciones de la plantilla enviada.',
      },
    });
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

    if (stages.note) {
      if (!transcript) {
        result.note = { status: 'skipped', reason: 'no_transcript' };
      } else {
        try {
          const sequence = Number(body.sequence) || 1;
          const orchestrated = await callMiracleRuntime(req, '/api/voice/orchestrator/events', {
            method: 'POST',
            body: JSON.stringify({
              voice_session_id: sessionId,
              note_path: body.note && typeof body.note.path !== 'undefined' ? body.note.path : null,
              note_title: (body.note && body.note.title) || 'Nota',
              note_content: (body.note && body.note.content) || '',
              tab_id: body.client_id || 'api-v1',
              event_id: crypto.randomUUID(),
              sequence,
              segment: {
                segment_id: `api_${sessionId}_${sequence}`,
                kind: 'final',
                transcript,
                language: body.language || null,
              },
            }),
          });
          const payload = orchestrated.body || {};
          result.note = {
            content: payload.resolved_note_content || '',
            backend_status: payload.backend_status || '',
            usage: payload.usage || null,
          };
          recordPassthroughUsage(payload.usage, {
            eventType: 'api_v1_pipeline_note_usage',
            sessionId,
            feature: 'pipeline_note'
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
          const matched = await noteFieldMatcher.match({
            noteContent,
            fields,
            alreadyFulfilled: pickArray(body.already_fulfilled, pickArray(body.alreadyFulfilled)),
            pageUrl: body.page_url || body.pageUrl || '',
            voiceSessionId: sessionId,
          });
          result.autofill = {
            matches: matched.matches || [],
            readyToSubmit: Boolean(matched.readyToSubmit),
            ready_to_submit: Boolean(matched.readyToSubmit),
            submit_reason: matched.submitReason || '',
            usage: matched.usage || null,
          };
          if (matched.usage) {
            recordUsageBestEffort({
              sourceRepo: 'graph',
              eventType: 'api_v1_pipeline_autofill_usage',
              provider: matched.usage.provider || 'openai',
              apiFamily: matched.usage.apiFamily || 'chat_completions',
              model: matched.usage.model || '',
              inputTokens: Number(matched.usage.inputTokens) || 0,
              outputTokens: Number(matched.usage.outputTokens) || 0,
              sessionId,
              feature: 'pipeline_autofill',
              status: 'ok',
              metadata: {
                fieldCount: fields.length,
                matchCount: Array.isArray(matched.matches) ? matched.matches.length : 0,
                readyToSubmit: Boolean(matched.readyToSubmit),
                totalTokens: Number(matched.usage.totalTokens) || 0
              }
            }, 'api v1 pipeline autofill usage');
          }
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
      const matched = await noteFieldMatcher.match({
        noteContent,
        fields: pickArray(body.fields),
        alreadyFulfilled: pickArray(body.already_fulfilled, pickArray(body.alreadyFulfilled)),
        pageUrl: body.page_url || body.pageUrl || '',
        voiceSessionId: sessionId
      });
      if (matched.usage) {
        recordUsageBestEffort({
          sourceRepo: 'graph',
          eventType: 'api_v1_autofill_match_usage',
          provider: matched.usage.provider || 'openai',
          apiFamily: matched.usage.apiFamily || 'chat_completions',
          model: matched.usage.model || '',
          inputTokens: Number(matched.usage.inputTokens) || 0,
          outputTokens: Number(matched.usage.outputTokens) || 0,
          sessionId,
          feature: 'autofill_match',
          status: 'ok',
          metadata: {
            fieldCount: pickArray(body.fields).length,
            matchCount: Array.isArray(matched.matches) ? matched.matches.length : 0,
            readyToSubmit: Boolean(matched.readyToSubmit),
            totalTokens: Number(matched.usage.totalTokens) || 0
          }
        }, 'api v1 autofill match usage');
      }
      return res.json({
        autofill: {
          matches: matched.matches || [],
          ready_to_submit: Boolean(matched.readyToSubmit),
          readyToSubmit: Boolean(matched.readyToSubmit),
          submit_reason: matched.submitReason || '',
          usage: matched.usage || null
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
      const result = await assistantService.chat({
        message: body.message,
        specialty: body.specialty,
        history: pickArray(body.history)
      }, {});
      if (result.usage) {
        recordUsageBestEffort({
          sourceRepo: 'graph',
          eventType: 'api_v1_assistant_chat_usage',
          provider: result.usage.provider || '',
          apiFamily: result.usage.api_family || 'chat_completions',
          model: result.usage.model || '',
          inputTokens: Number(result.usage.input_tokens) || 0,
          outputTokens: Number(result.usage.output_tokens) || 0,
          feature: 'assistant_chat',
          status: 'ok',
          metadata: {
            totalTokens: Number(result.usage.total_tokens) || 0
          }
        }, 'api v1 assistant chat usage');
      }
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
      const result = await biopsyService.extract({
        image: body.image,
        mediaType: body.media_type,
        template: body.template,
        mode: body.mode
      });
      if (result.usage) {
        recordUsageBestEffort({
          sourceRepo: 'graph',
          eventType: 'api_v1_biopsy_extract_usage',
          provider: result.usage.provider || '',
          apiFamily: result.usage.api_family || 'chat_completions',
          model: result.usage.model || '',
          inputTokens: Number(result.usage.input_tokens) || 0,
          outputTokens: Number(result.usage.output_tokens) || 0,
          feature: 'biopsy_extract',
          status: 'ok',
          metadata: {
            totalTokens: Number(result.usage.total_tokens) || 0,
            sections: Array.isArray(result.sections) ? result.sections.length : 0
          }
        }, 'api v1 biopsy extract usage');
      }
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
