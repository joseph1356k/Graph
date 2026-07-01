const MAX_AUDIO_BASE64_LENGTH = 15 * 1024 * 1024;
const MAX_TRANSCRIPT_LENGTH = 40000;

function registerMedicalRoutes(app, deps = {}) {
  const rawTranscriptionService = deps.rawTranscriptionService;
  const callMiracleRuntime = deps.callMiracleRuntime;

  if (!app || !rawTranscriptionService || typeof callMiracleRuntime !== 'function') {
    throw new Error('registerMedicalRoutes requires app, rawTranscriptionService, and callMiracleRuntime');
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

  app.post('/api/medical/notes/organized', async (req, res) => {
    const transcript = `${req.body?.transcript || ''}`.trim();
    if (!transcript) {
      return res.status(400).json({ error: 'transcript es obligatorio.' });
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return res.status(413).json({ error: 'El transcript supera el limite permitido.' });
    }

    const voiceSessionId = `${req.body?.voiceSessionId || req.body?.voice_session_id || `medical-api-${Date.now()}`}`.trim();
    const notePath = req.body?.notePath || req.body?.note_path || null;
    const noteTitle = `${req.body?.noteTitle || req.body?.note_title || 'API Note'}`.trim() || 'API Note';
    const noteContent = `${req.body?.noteContent || req.body?.note_content || ''}`;
    const language = `${req.body?.language || 'es'}`.trim() || 'es';

    try {
      const orchestrated = await callMiracleRuntime(req, '/api/voice/orchestrator/events', {
        method: 'POST',
        body: {
          voice_session_id: voiceSessionId,
          note_path: notePath,
          note_title: noteTitle,
          note_content: noteContent,
          tab_id: req.body?.tabId || req.body?.tab_id || 'medical-api',
          event_id: req.body?.eventId || req.body?.event_id || `${voiceSessionId}-evt-1`,
          sequence: Number(req.body?.sequence || 1),
          segment: {
            segment_id: req.body?.segmentId || req.body?.segment_id || `${voiceSessionId}-seg-1`,
            kind: 'final',
            transcript,
            language
          }
        }
      });

      return res.json({
        transcript,
        organized_note: orchestrated?.resolved_note_content || '',
        backend_status: orchestrated?.backend_status || '',
        note_updates: Array.isArray(orchestrated?.note_updates) ? orchestrated.note_updates : [],
        agent_tasks: Array.isArray(orchestrated?.agent_tasks) ? orchestrated.agent_tasks : [],
        session_state: orchestrated?.session_state || null,
        usage: orchestrated?.usage || null,
        llm_debug: orchestrated?.llm_debug || null
      });
    } catch (error) {
      console.error(`[Medical Organized Note] Error: ${error.message}`);
      return res.status(error.statusCode || 500).json({
        error: error.message || 'No fue posible organizar la nota clinica.'
      });
    }
  });
}

registerMedicalRoutes.MAX_AUDIO_BASE64_LENGTH = MAX_AUDIO_BASE64_LENGTH;
registerMedicalRoutes.MAX_TRANSCRIPT_LENGTH = MAX_TRANSCRIPT_LENGTH;

module.exports = registerMedicalRoutes;
