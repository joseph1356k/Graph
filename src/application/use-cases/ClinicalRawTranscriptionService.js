class ClinicalRawTranscriptionService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async transcribe(payload = {}) {
    const apiKey = `${process.env.DEEPGRAM_API_KEY || ''}`.trim();
    if (!apiKey) {
      const error = new Error('Deepgram no esta configurado en el backend.');
      error.statusCode = 503;
      throw error;
    }

    const audioBase64 = `${payload.audioBase64 || payload.audio_base64 || ''}`.trim();
    if (!audioBase64) {
      const error = new Error('audio_base64 es obligatorio.');
      error.statusCode = 400;
      throw error;
    }

    const mimeType = `${payload.mimeType || payload.mime_type || 'audio/webm'}`.trim() || 'audio/webm';
    const model = `${payload.model || process.env.MIRACLE_STT_MODEL || 'nova-3'}`.trim() || 'nova-3';
    const language = `${payload.language || process.env.MIRACLE_STT_LANGUAGE || 'es'}`.trim() || 'es';

    let audioBuffer;
    try {
      audioBuffer = Buffer.from(audioBase64, 'base64');
    } catch (error) {
      const invalidError = new Error('audio_base64 no es valido.');
      invalidError.statusCode = 400;
      throw invalidError;
    }

    if (!audioBuffer.length) {
      const error = new Error('audio_base64 no contiene audio.');
      error.statusCode = 400;
      throw error;
    }

    const query = new URLSearchParams({
      model,
      language,
      punctuate: 'true',
      smart_format: 'true'
    });

    let response;
    try {
      response = await this.fetchImpl(`https://api.deepgram.com/v1/listen?${query.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': mimeType
        },
        body: audioBuffer
      });
    } catch (error) {
      const upstreamError = new Error(`No fue posible conectar con Deepgram: ${error.message}`);
      upstreamError.statusCode = 502;
      throw upstreamError;
    }

    const rawText = await response.text();
    let decoded = {};
    if (rawText) {
      try {
        decoded = JSON.parse(rawText);
      } catch (error) {
        decoded = { raw: rawText };
      }
    }

    if (!response.ok) {
      const detail = decoded?.err_msg || decoded?.error || decoded?.message || 'Deepgram rechazo la transcripcion.';
      const upstreamError = new Error(`${detail}`);
      upstreamError.statusCode = response.status || 502;
      throw upstreamError;
    }

    const transcript = `${decoded?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''}`.trim();

    return {
      provider: 'deepgram',
      model,
      language,
      transcript,
      metadata: {
        duration: decoded?.metadata?.duration ?? null,
        request_id: decoded?.metadata?.request_id || null
      },
      raw_response: decoded
    };
  }
}

module.exports = ClinicalRawTranscriptionService;
