// Use-case de la enseñanza por video del agente de escritorio (Ü). Port de
// Android/backend/src/http/handleTeach.ts. Tres endpoints, contrato idéntico al
// que consume windows-client/src/Teach/TeachSession.cs:
//
//   POST /api/v1/teach/upload-token  → URLs firmadas (Gemini + archivo Supabase). Rápido.
//   POST /api/v1/teach/file-state    → ¿el video ya está ACTIVE en Gemini? Bucle del cliente.
//   POST /api/v1/teach/process-video → generateContent con el prompt médico + guarda notas.
//
// OJO: la enseñanza SIEMPRE va contra Gemini (es quien entiende video),
// independientemente del provider del cerebro consciente. Por eso tiene su
// propia config (MIRACLE_TEACH_LLM_* con fallback a GEMINI_API_KEY) y no
// pregunta nada al módulo del cerebro.

const geminiVideo = require('../../infrastructure/teach/GeminiVideoClient');
const { signVideoUpload } = require('../../infrastructure/teach/SupabaseVideoStorage');
const { resolveTeachConfig, teachVideoBucket } = require('../../infrastructure/conscious-brain/config');

class TeachVideoService {
  /**
   * @param {object} deps
   * @param {object} deps.memoryRepository mismo store que inyecta memoria en cada turno del cerebro.
   * @param {object} [deps.supabaseRestClient] para firmar la subida al archivo de Storage (opcional).
   * @param {object} [deps.geminiVideo]   inyectable para tests.
   * @param {Function} [deps.resolveConfig] inyectable para tests.
   */
  constructor(deps = {}) {
    if (!deps.memoryRepository) {
      throw new Error('TeachVideoService requiere memoryRepository');
    }
    this.memoryRepository = deps.memoryRepository;
    this.supabaseRestClient = deps.supabaseRestClient || null;
    this.geminiVideo = deps.geminiVideo || geminiVideo;
    this.resolveConfig = deps.resolveConfig || resolveTeachConfig;
  }

  /** Config o error controlado (500 + {error}), igual que guard() del backend viejo. */
  guard() {
    const config = this.resolveConfig();
    if (!config.configured) {
      return { error: { status: 500, json: { error: config.errorMessage } } };
    }
    return { config };
  }

  /**
   * Reserva el archivo en Gemini y firma la subida al archivo de Supabase.
   * Devuelve las dos URLs; el cliente sube el mismo mp4 a ambas. Ninguna key
   * sale de aquí.
   */
  async uploadToken(body = {}) {
    const { config, error } = this.guard();
    if (error) return error;

    const contentLength = Number(body.contentLength) || 0;
    if (contentLength <= 0) {
      return { status: 400, json: { error: 'falta `contentLength` (bytes del mp4 a subir)' } };
    }
    const userId = `${body.userId || ''}`.trim() || 'anon';

    try {
      const geminiUploadUrl = await this.geminiVideo.startUpload(config.apiKey, 'graph_teach', contentLength);

      // Archivar es deseable, no imprescindible: si Supabase no está configurado
      // o falla, la enseñanza sigue. Se avisa con `archiveError` en vez de tumbar
      // la petición entera.
      let archive = null;
      let archiveError = null;
      try {
        archive = await signVideoUpload(
          this.supabaseRestClient,
          teachVideoBucket(),
          userId,
          new Date().toISOString()
        );
      } catch (err) {
        archiveError = err.message;
      }

      return {
        status: 200,
        json: {
          geminiUploadUrl,
          archiveUploadUrl: archive?.uploadUrl ?? null,
          archivePath: archive?.path ?? null,
          archiveError
        }
      };
    } catch (err) {
      return { status: 502, json: { error: `Gemini: ${err.message}` } };
    }
  }

  /** ¿El video ya salió de PROCESSING? Llamada corta a propósito: el cliente la repite en bucle. */
  async fileState(body = {}) {
    const { config, error } = this.guard();
    if (error) return error;

    const fileUri = `${body.fileUri || ''}`.trim();
    if (!fileUri) return { status: 400, json: { error: 'falta `fileUri`' } };

    try {
      return { status: 200, json: { state: await this.geminiVideo.fileState(config.apiKey, fileUri) } };
    } catch (err) {
      return { status: 502, json: { error: `Gemini: ${err.message}` } };
    }
  }

  /**
   * El video ya está ACTIVE: se le pide a Gemini el conocimiento del sistema
   * (prompt médico) y se guardan las notas en la memoria del usuario — el mismo
   * store que el bucle de ejecución ya usa para inyectar contexto en cada turno.
   */
  async processVideo(body = {}) {
    const { config, error } = this.guard();
    if (error) return error;

    const fileUri = `${body.fileUri || ''}`.trim();
    if (!fileUri) return { status: 400, json: { error: 'falta `fileUri`' } };
    const userId = `${body.userId || ''}`.trim() || 'anon';

    try {
      const result = await this.geminiVideo.processVideo(config.apiKey, fileUri, config.model);

      for (const note of result.notes) {
        await this.memoryRepository.remember(userId, note.app, note.note);
      }

      return {
        status: 200,
        json: { summary: result.summary, notes: result.notes, questions: result.questions }
      };
    } catch (err) {
      return { status: 502, json: { error: `Gemini: ${err.message}` } };
    }
  }
}

module.exports = TeachVideoService;
