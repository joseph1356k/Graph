const crypto = require('crypto');
const { statusForError, publicErrorMessage } = require('./httpErrors');

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

  if (!app || typeof callMiracleRuntime !== 'function') {
    throw new Error('registerPublicApiRoutes requires app and callMiracleRuntime');
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
      const matched = await noteFieldMatcher.match({
        noteContent,
        fields: pickArray(body.fields),
        alreadyFulfilled: pickArray(body.already_fulfilled, pickArray(body.alreadyFulfilled)),
        pageUrl: body.page_url || body.pageUrl || '',
        voiceSessionId: body.session_id || body.voiceSessionId || ''
      });
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
