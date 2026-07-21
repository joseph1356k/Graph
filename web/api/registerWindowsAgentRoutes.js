// Rutas públicas /api/v1 del agente de escritorio Ü (cliente Windows), absorbidas
// del backend viejo (Android/backend/api/{agent,teach}/*). Se montan bajo el
// prefijo /api/v1, que ya está gated con X-API-Key (requireApiKey en server.js),
// reemplazando al CLIENT_TOKEN Bearer del backend original.
//
// Los use-cases devuelven {status, json} y aquí solo se escribe tal cual: la
// matriz de códigos (400/500/502 + {error}) y los campos JSON son EXACTAMENTE
// los que espera windows-client (Protocol.cs / TeachSession.cs). No tocar sin
// tocar el cliente.

function registerWindowsAgentRoutes(app, deps = {}) {
  const agentTurnService = deps.agentTurnService || null;
  const teachVideoService = deps.teachVideoService || null;

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
}

module.exports = registerWindowsAgentRoutes;
