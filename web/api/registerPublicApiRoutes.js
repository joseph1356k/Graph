const crypto = require('crypto');

// Public, versioned API surface for client apps (Chrome extension, Windows app,
// web app). One exposure center. The pipeline endpoint is a single call whose
// `stages` flags decide what the backend actually processes, so a client can
// ask for raw transcription only, transcription + organized note, or the full
// chain (adding autofill) without changing the call shape.

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

function registerPublicApiRoutes(app, deps = {}) {
  const callMiracleRuntime = deps.callMiracleRuntime;
  const noteFieldMatcher = deps.noteFieldMatcher || null;
  if (!app || typeof callMiracleRuntime !== 'function') {
    throw new Error('registerPublicApiRoutes requires app and callMiracleRuntime');
  }

  // Capability manifest / discovery.
  app.get('/api/v1', (req, res) => {
    res.json({
      name: 'Miracle Backend API',
      version: 'v1',
      description: 'Backend central que expone las funcionalidades de Miracle a las aplicaciones cliente.',
      pipeline: {
        endpoint: 'POST /api/v1/pipeline',
        description: 'Un solo llamado. Activa/desactiva etapas con `stages`; el backend procesa solo lo pedido.',
        stages: {
          transcription: { default: true, description: 'Devuelve la transcripción cruda recibida.' },
          note: { default: true, description: 'Organiza la transcripción en una nota estructurada (Product-LLM).' },
          autofill: {
            default: false,
            available: Boolean(noteFieldMatcher),
            description: 'Mapea la nota a los campos detectados por el cliente. Se activa si envías `fields`.',
          },
        },
      },
      transcriptionSession: {
        endpoint: 'POST /api/v1/transcription/session',
        description: 'Credenciales para transcripción cruda en streaming (Deepgram) en tiempo real.',
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
        return res.status(503).json({ error: 'La transcripción no está configurada en este entorno.' });
      }
      return res
        .status(error.statusCode || 502)
        .json({ error: error.message || 'No fue posible iniciar la transcripción.' });
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
      const fields = Array.isArray(body.fields) ? body.fields : [];
      const noteContent = (result.note && result.note.content) || (body.note && body.note.content) || '';
      if (!noteFieldMatcher) {
        result.autofill = { status: 'unavailable', reason: 'not_configured' };
      } else if (!fields.length) {
        // Autofill needs the fields detected by the client. Kept optional so this
        // first version stays useful up to note organization and is ready to
        // light up once the client detection layer is refactored.
        result.autofill = { status: 'skipped', reason: 'no_fields' };
      } else if (!`${noteContent}`.trim()) {
        result.autofill = { status: 'skipped', reason: 'no_note_content' };
      } else {
        try {
          const matched = await noteFieldMatcher.match({
            noteContent,
            fields,
            alreadyFulfilled: Array.isArray(body.already_fulfilled) ? body.already_fulfilled : [],
            pageUrl: body.page_url || '',
            voiceSessionId: sessionId,
          });
          result.autofill = {
            matches: matched.matches || [],
            readyToSubmit: Boolean(matched.readyToSubmit),
          };
        } catch (error) {
          result.autofill = { status: 'error', error: error.message || 'autofill_failed' };
        }
      }
    }

    return res.json(result);
  });
}

module.exports = registerPublicApiRoutes;
