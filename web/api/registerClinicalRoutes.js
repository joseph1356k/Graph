const MAX_NOTE_LENGTH = 20000;

function registerClinicalRoutes(app, deps = {}) {
  const diagnosisSuggestionService = deps.diagnosisSuggestionService;

  if (!app || !diagnosisSuggestionService) {
    throw new Error('registerClinicalRoutes requires app and diagnosisSuggestionService');
  }

  app.post('/api/clinical/diagnosis-suggestions', async (req, res) => {
    const noteContent = typeof req.body?.noteContent === 'string'
      ? req.body.noteContent
      : '';

    if (!noteContent.trim()) {
      return res.status(400).json({ error: 'La nota clinica esta vacia.' });
    }
    if (noteContent.length > MAX_NOTE_LENGTH) {
      return res.status(413).json({ error: 'La nota clinica supera el limite de 20000 caracteres.' });
    }
    if (!diagnosisSuggestionService.hasLlm()) {
      return res.status(503).json({ error: 'El proveedor de IA no esta configurado.' });
    }

    try {
      const result = await diagnosisSuggestionService.suggest(noteContent);
      res.json(result);
    } catch (error) {
      console.error(`[Clinical Diagnosis Suggestions] Error: ${error.message}`);
      const status = error.code === 'LLM_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({ error: status === 503 ? 'El proveedor de IA no esta configurado.' : 'No fue posible generar sugerencias diagnosticas.' });
    }
  });
}

registerClinicalRoutes.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;

module.exports = registerClinicalRoutes;
