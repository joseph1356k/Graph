// /api/medical/*: hoy solo la transcripción cruda (STT, sin prompt). El
// registro E8 de docs/privacy-egress-gateway.md dice que la usa el collar Omi a
// través de Graph; en el monorepo no tiene cliente, así que se verifica antes de
// borrarla. POST /api/medical/notes/organized (el bloque provisional del
// orquestador de voz, deprecada desde 2026-09) se borró el 2026-10-01: no tenía
// cliente y su sucesor es POST /api/v1/pipeline con `template.sections`.

const MAX_AUDIO_BASE64_LENGTH = 15 * 1024 * 1024;

function registerMedicalRoutes(app, deps = {}) {
  const rawTranscriptionService = deps.rawTranscriptionService;

  if (!app || !rawTranscriptionService) {
    throw new Error('registerMedicalRoutes requires app and rawTranscriptionService');
  }

  app.post('/api/medical/transcriptions/raw', async (req, res) => {
    const audioBase64 = `${req.body?.audioBase64 || req.body?.audio_base64 || ''}`.trim();
    if (!audioBase64) {
      return res.status(400).json({ error: 'audio_base64 es obligatorio.' });
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
      return res.status(413).json({ error: 'El audio supera el limite permitido para esta ruta.' });
    }

    try {
      const result = await rawTranscriptionService.transcribe(req.body || {});
      return res.json(result);
    } catch (error) {
      console.error(`[Medical Raw Transcription] Error: ${error.message}`);
      return res.status(error.statusCode || 500).json({
        error: error.message || 'No fue posible transcribir el audio.'
      });
    }
  });
}

registerMedicalRoutes.MAX_AUDIO_BASE64_LENGTH = MAX_AUDIO_BASE64_LENGTH;

module.exports = registerMedicalRoutes;
