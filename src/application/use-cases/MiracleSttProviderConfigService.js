const VercelProjectEnvService = require('./VercelProjectEnvService');

class MiracleSttProviderConfigService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  static get PROVIDERS() {
    return {
      deepgram: {
        id: 'deepgram',
        label: 'Deepgram Streaming',
        description: 'STT en streaming para el boton Grabar del asistente flotante y Miracle.',
        requiresApiKey: true,
        requiresModel: true,
        defaultModel: 'nova-3',
        defaultLanguage: 'es',
        recommended: true
      },
      disabled: {
        id: 'disabled',
        label: 'Deshabilitado',
        description: 'Apaga por completo el STT en streaming.',
        requiresApiKey: false,
        requiresModel: false,
        defaultModel: '',
        defaultLanguage: 'es',
        recommended: false
      }
    };
  }

  status() {
    const providerId = `${process.env.MIRACLE_STT_PROVIDER || (process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'disabled')}`.trim().toLowerCase();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId] || MiracleSttProviderConfigService.PROVIDERS.disabled;
    const model = `${process.env.MIRACLE_STT_MODEL || spec.defaultModel || ''}`.trim();
    const language = `${process.env.MIRACLE_STT_LANGUAGE || spec.defaultLanguage || 'es'}`.trim();
    const configured = providerId === 'disabled' ? true : Boolean(`${process.env.DEEPGRAM_API_KEY || ''}`.trim());

    return {
      providers: Object.values(MiracleSttProviderConfigService.PROVIDERS).map((provider) => ({
        id: provider.id,
        label: provider.label,
        description: provider.description,
        requires_api_key: provider.requiresApiKey,
        requires_model: provider.requiresModel,
        default_model: provider.defaultModel,
        default_language: provider.defaultLanguage,
        recommended: provider.recommended
      })),
      current_setup: {
        provider: spec.id,
        label: spec.label,
        model,
        language,
        configured
      },
      status: {
        provider: spec.id,
        model,
        language,
        configured,
        storage: 'vercel-env',
        redeploy_required: false
      },
      vercel: this.vercelEnvService.status()
    };
  }

  async configure(payload = {}) {
    const providerId = `${payload.provider || ''}`.trim().toLowerCase();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId];
    if (!spec) {
      const error = new Error('Provider de STT no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedLanguage = `${payload.language || ''}`.trim();

    const apiKey = requestedApiKey || `${process.env.DEEPGRAM_API_KEY || ''}`.trim();
    const model = requestedModel || `${process.env.MIRACLE_STT_MODEL || ''}`.trim() || spec.defaultModel || '';
    const language = requestedLanguage || `${process.env.MIRACLE_STT_LANGUAGE || ''}`.trim() || spec.defaultLanguage || 'es';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error('La API key de Deepgram es obligatoria para habilitar el STT.');
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_LANGUAGE', language, { secret: false })
    ];

    if (providerId === 'deepgram') {
      envWrites.push(this.vercelEnvService.upsertProjectEnv('DEEPGRAM_API_KEY', apiKey, { secret: true }));
    }

    await Promise.all(envWrites);
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      provider: providerId,
      summary: {
        provider: providerId,
        model: providerId === 'disabled' ? null : model,
        language
      },
      deployment
    };
  }
}

module.exports = MiracleSttProviderConfigService;
