// Rutas públicas /api/v1 del agente de escritorio Ü (cliente Windows), absorbidas
// del backend viejo (Android/backend/api/{agent,teach}/*). Se montan bajo el
// prefijo /api/v1, que ya está gated con X-API-Key (requireApiKey en server.js),
// reemplazando al CLIENT_TOKEN Bearer del backend original.
//
// Los use-cases devuelven {status, json} y aquí solo se escribe tal cual: la
// matriz de códigos (400/500/502 + {error}) y los campos JSON son EXACTAMENTE
// los que espera windows-client (Protocol.cs / TeachSession.cs). No tocar sin
// tocar el cliente.

const { FEATURES, API_FAMILIES, normalizeFeature } = require('../../src/domain/usage/vocabulary');

function registerWindowsAgentRoutes(app, deps = {}) {
  const agentTurnService = deps.agentTurnService || null;
  const teachVideoService = deps.teachVideoService || null;
  const usageRecorder = deps.usageRecorder || null;

  if (!app || !agentTurnService || !teachVideoService) {
    throw new Error('registerWindowsAgentRoutes requiere app, agentTurnService y teachVideoService');
  }

  // El bucle de ejecución: el cliente Windows lo llama una vez por turno.
  //  - Primer turn: manda { goal, state }  (sin `session`).
  //  - Siguientes:  manda { session, state, results, inform? } (echa el blob opaco).
  // Devuelve { session, ...BrainTurn }. El cliente nunca ve prompt, catálogo
  // MCP, memoria ni la key del modelo.
  app.post('/api/v1/agent/turn', async (req, res) => {
    const result = await agentTurnService.handleTurn(req.body || {});
    return res.status(result.status).json(result.json);
  });

  // Enseñanza por video (ver TeachVideoService para el reparto de trabajo con
  // el cliente). Los tres endpoints son POST: así los llama TeachSession.cs.
  app.post('/api/v1/teach/upload-token', async (req, res) => {
    const result = await teachVideoService.uploadToken(req.body || {});
    return res.status(result.status).json(result.json);
  });

  app.post('/api/v1/teach/file-state', async (req, res) => {
    const result = await teachVideoService.fileState(req.body || {});
    return res.status(result.status).json(result.json);
  });

  app.post('/api/v1/teach/process-video', async (req, res) => {
    const result = await teachVideoService.processVideo(req.body || {});
    return res.status(result.status).json(result.json);
  });

  // Consumo que el cliente midió por su cuenta.
  //
  // POR QUÉ EXISTE ESTA RUTA. La voz en vivo abre un WebSocket DIRECTO contra
  // Google desde el PC del usuario — es lo que hace que la conversación tenga
  // latencia de conversación y no de servidor. El precio de eso es que Graph no
  // ve la llamada: el único testigo del consumo es el cliente. O se acepta lo
  // que reporte, o ese gasto no aparece en ninguna parte y el panel deja de
  // cuadrar con la factura.
  //
  // QUÉ SE ACEPTA Y QUÉ NO. Del cliente se toman SOLO las cifras. El usuario y
  // la organización NO se leen del cuerpo: los resuelve el middleware de
  // atribución contra la key y el correo con los que ya vino autenticada la
  // petición, igual que en cualquier otra ruta. Un cliente no puede atribuirle
  // su gasto a otra persona ni a otra institución aunque lo intente.
  //
  // Y SE MARCA. `usageSource: 'client_reported'` queda en el evento para poder
  // separarlo de lo que midió el servidor. Estas cifras valen —el proveedor las
  // cobra igual— pero no se auditan del mismo modo, y mezclarlas sin marca haría
  // creer que todo el ledger tiene la misma solidez.
  app.post('/api/v1/agent/usage', async (req, res) => {
    if (!usageRecorder) {
      return res.status(503).json({ error: 'El grabador de consumo no está disponible.' });
    }
    const body = req.body || {};
    const intOf = (value) => {
      const n = Math.trunc(Number(value));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const inputTokens = intOf(body.inputTokens);
    const outputTokens = intOf(body.outputTokens);
    const totalTokens = intOf(body.totalTokens) || (inputTokens + outputTokens);

    // Sin una sola cifra no hay nada que contabilizar. Se contesta 400 en vez de
    // escribir una fila vacía que luego nadie sabría interpretar.
    if (!totalTokens && !intOf(body.audioSeconds)) {
      return res.status(400).json({ error: 'Se requiere al menos un token o segundo de audio.' });
    }

    try {
      const result = await usageRecorder.record({
        provider: `${body.provider || 'google'}`.trim().toLowerCase(),
        apiFamily: API_FAMILIES.LIVE,
        feature: normalizeFeature(body.feature || FEATURES.LIVE_VOICE),
        requestedModel: `${body.model || ''}`.trim(),
        servedModel: `${body.servedModel || body.model || ''}`.trim(),
        inputTokens,
        outputTokens,
        cachedInputTokens: intOf(body.cachedInputTokens),
        totalTokens,
        audioSeconds: Number(body.audioSeconds) || 0,
        status: body.status === 'error' ? 'error' : 'ok',
        errorCode: `${body.errorCode || ''}`.trim().slice(0, 60),
        latencyMs: intOf(body.durationMs) || null,
        // La sesión es la unidad de idempotencia: si el cliente reintenta el
        // envío tras un corte de red, no se cuenta dos veces lo mismo.
        sessionId: `${body.sessionId || ''}`.trim().slice(0, 80),
        metadata: {
          usageSource: 'client_reported',
          liveSessionTurns: intOf(body.turns),
          clientVersion: `${body.clientVersion || ''}`.trim(),
          durationMsProvider: intOf(body.durationMs)
        }
      });
      return res.status(result?.duplicate ? 200 : 201).json({
        ok: Boolean(result?.ok),
        duplicate: Boolean(result?.duplicate)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
}

module.exports = registerWindowsAgentRoutes;
