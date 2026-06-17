const QRCode = require('qrcode');
const workflowAssistantPolicy = require('../../src/application/use-cases/WorkflowAssistantPolicy');
const buildPhoneMicPage = require('../phone/buildPhoneMicPage');

function decodeBase64JsonHeader(value, fallback = null) {
  const encoded = `${value || ''}`.trim();
  if (!encoded) {
    return fallback;
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    return fallback;
  }
}

function getLanHost() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return 'localhost';
}

function getPublicBaseUrl(req, explicitPort) {
  const forwardedProto = `${req.get('x-forwarded-proto') || ''}`.split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || '';

  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return `${proto}://${host}`;
  }

  const port = explicitPort || req.app.get('port') || process.env.PORT || process.env.WEB_PORT || 3000;
  return `http://${getLanHost()}:${port}`;
}

function buildOpenAiRealtimeInstructions(context = {}, workflows = []) {
  return workflowAssistantPolicy.buildVoiceExecutionPrompt(context, workflows);
}

function buildOpenAiRealtimeTools() {
  return workflowAssistantPolicy.buildVoiceFunctionDefinitions().map((definition) => ({
    type: 'function',
    ...definition
  }));
}

function readSdpOffer(body) {
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body.sdp === 'string') {
    return body.sdp;
  }
  return '';
}

function prepareSdpOfferForOpenAi(body) {
  const sdp = readSdpOffer(body);
  const trimmed = sdp.trim();
  if (!trimmed) {
    const error = new Error('Missing SDP offer.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^v=0(?:\r?\n)/.test(trimmed) || !/(?:^|\r?\n)m=audio(?:\s|$)/.test(trimmed)) {
    const error = new Error('Invalid SDP offer.');
    error.statusCode = 400;
    throw error;
  }
  return sdp.endsWith('\n') ? sdp : `${sdp}\r\n`;
}

function parseOpenAiRealtimeError(body) {
  const text = `${body || ''}`.trim();
  if (!text) {
    return 'Failed to create OpenAI Realtime session.';
  }
  try {
    const payload = JSON.parse(text);
    if (payload?.error?.message) {
      return payload.error.message;
    }
    if (typeof payload?.error === 'string') {
      return parseOpenAiRealtimeError(payload.error);
    }
  } catch (error) {
    // The Realtime API can also return plain text for SDP/session failures.
  }
  return text;
}

function registerVoiceRoutes(app, deps = {}) {
  const express = deps.express;
  const agentChat = deps.agentChat;
  const catalogService = deps.catalogService;
  const phoneVoiceStore = deps.phoneVoiceStore;

  if (!app || !express || !agentChat || !catalogService || !phoneVoiceStore) {
    throw new Error('registerVoiceRoutes requires app, express, agentChat, catalogService, and phoneVoiceStore');
  }

  app.post('/api/voice/openai/session', express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }), async (req, res) => {
    try {
      const openAiApiKey = `${process.env.OPENAI_API_KEY || ''}`.trim();
      if (!openAiApiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
      }

      const sdp = prepareSdpOfferForOpenAi(req.body);

      const context = req.phoneVoiceSession?.context || decodeBase64JsonHeader(req.get('x-graph-voice-context'), {});
      const history = req.phoneVoiceSession?.history || decodeBase64JsonHeader(req.get('x-graph-voice-history'), []);
      const workflows = agentChat.filterWorkflowsForContext(await catalogService.getCatalog(req.workflowAccess || null), context);

      const sessionConfig = {
        type: 'realtime',
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        instructions: buildOpenAiRealtimeInstructions(context, workflows),
        conversation: Array.isArray(history) && history.length > 0 ? 'auto' : undefined,
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: {
              model: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
              language: 'es'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 900,
              create_response: false,
              interrupt_response: true
            }
          },
          output: {
            voice: process.env.OPENAI_REALTIME_VOICE || 'marin'
          }
        },
        tools: buildOpenAiRealtimeTools(),
        tool_choice: 'auto'
      };

      const form = new FormData();
      form.set('sdp', sdp);
      form.set('session', JSON.stringify(sessionConfig));

      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiApiKey}`
        },
        body: form
      });

      const answerSdp = await response.text();
      if (!response.ok) {
        return res.status(response.status).json({
          error: parseOpenAiRealtimeError(answerSdp)
        });
      }

      res
        .set('Content-Type', 'application/sdp')
        .set('X-OpenAI-Realtime-Model', sessionConfig.model)
        .set('X-OpenAI-Realtime-Voice', sessionConfig.audio.output.voice)
        .send(answerSdp);
    } catch (err) {
      console.error(`[Voice OpenAI] Session Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/voice/phone-session', async (req, res) => {
    try {
      const requestedId = `${req.body?.requestedId || ''}`.trim();
      const session = await phoneVoiceStore.createPhoneVoiceSession({
        requestedId,
        ownerId: req.workflowAccess?.ownerId || req.user?.id || '',
        ownerEmail: req.user?.email || '',
        context: req.body?.context || {},
        history: req.body?.history || []
      });
      const phoneUrl = `${getPublicBaseUrl(req, req.app.get('port'))}/phone-mic/${encodeURIComponent(session.id)}?token=${encodeURIComponent(session.token)}`;
      const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
        margin: 1,
        width: 260
      });

      res.json({ id: session.id, phoneUrl, qrDataUrl, expiresAt: session.expiresAt });
    } catch (err) {
      console.error(`[Voice Phone] Session Error: ${err.message}`);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get('/api/voice/phone-session/:id/events', async (req, res) => {
    try {
      await phoneVoiceStore.getPhoneVoiceSessionForOwner(req.params.id, req.workflowAccess?.ownerId || '');
      const events = await phoneVoiceStore.listPhoneVoiceEvents(req.params.id, req.query?.after || 0);
      res.json({ events });
    } catch (err) {
      console.error(`[Voice Phone] Poll Error: ${err.message}`);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/voice/phone-session/:id/events', async (req, res) => {
    try {
      if (!req.phoneVoiceSession || req.phoneVoiceSession.id !== req.params.id) {
        return res.status(401).json({ error: 'No autorizado.' });
      }
      const payload = req.body?.payload && typeof req.body.payload === 'object'
        ? req.body.payload
        : req.body || {};
      const type = `${req.body?.type || payload.type || ''}`.trim();
      const event = await phoneVoiceStore.appendPhoneVoiceEvent({
        sessionId: req.params.id,
        source: 'phone',
        type,
        payload: {
          ...payload,
          type: payload.type || type
        }
      });
      res.json({ event });
    } catch (err) {
      console.error(`[Voice Phone] Event Error: ${err.message}`);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get(['/phone-mic/:id', '/api/phone-mic/:id'], (req, res) => {
    const sessionId = `${req.params.id || ''}`;
    res.type('html').send(buildPhoneMicPage(sessionId));
  });
}

module.exports = registerVoiceRoutes;
