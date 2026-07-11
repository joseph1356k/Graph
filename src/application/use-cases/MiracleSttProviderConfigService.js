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
        apiKeyEnv: 'DEEPGRAM_API_KEY',
        defaultModel: 'nova-3',
        modelOptions: ['nova-3', 'nova-2'],
        defaultLanguage: 'es',
        recommended: true
      },
      soniox: {
        id: 'soniox',
        label: 'Soniox Streaming',
        description: 'STT en streaming (Soniox stt-rt-v5) para el boton Grabar del asistente flotante y Miracle.',
        requiresApiKey: true,
        requiresModel: true,
        apiKeyEnv: 'SONIOX_API_KEY',
        defaultModel: 'stt-rt-v5',
        modelOptions: ['stt-rt-v5'],
        defaultLanguage: 'es',
        recommended: false
      },
      disabled: {
        id: 'disabled',
        label: 'Deshabilitado',
        description: 'Apaga por completo el STT en streaming.',
        requiresApiKey: false,
        requiresModel: false,
        apiKeyEnv: null,
        defaultModel: '',
        modelOptions: [],
        defaultLanguage: 'es',
        recommended: false
      }
    };
  }

  static defaultProviderId() {
    if (process.env.MIRACLE_STT_PROVIDER) {
      return `${process.env.MIRACLE_STT_PROVIDER}`.trim().toLowerCase();
    }
    if (`${process.env.DEEPGRAM_API_KEY || ''}`.trim()) {
      return 'deepgram';
    }
    if (`${process.env.SONIOX_API_KEY || ''}`.trim()) {
      return 'soniox';
    }
    return 'disabled';
  }

  status() {
    const providerId = MiracleSttProviderConfigService.defaultProviderId();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId] || MiracleSttProviderConfigService.PROVIDERS.disabled;
    const model = `${process.env.MIRACLE_STT_MODEL || spec.defaultModel || ''}`.trim();
    const language = `${process.env.MIRACLE_STT_LANGUAGE || spec.defaultLanguage || 'es'}`.trim();
    const configured = spec.id === 'disabled'
      ? true
      : Boolean(spec.apiKeyEnv && `${process.env[spec.apiKeyEnv] || ''}`.trim());

    return {
      providers: Object.values(MiracleSttProviderConfigService.PROVIDERS).map((provider) => ({
        id: provider.id,
        label: provider.label,
        description: provider.description,
        requires_api_key: provider.requiresApiKey,
        requires_model: provider.requiresModel,
        default_model: provider.defaultModel,
        model_options: provider.modelOptions || [],
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

    const existingApiKey = spec.apiKeyEnv ? `${process.env[spec.apiKeyEnv] || ''}`.trim() : '';
    const apiKey = requestedApiKey || existingApiKey;
    const model = requestedModel || `${process.env.MIRACLE_STT_MODEL || ''}`.trim() || spec.defaultModel || '';
    const language = requestedLanguage || `${process.env.MIRACLE_STT_LANGUAGE || ''}`.trim() || spec.defaultLanguage || 'es';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error(`La API key de ${spec.label} es obligatoria para habilitar el STT.`);
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_LANGUAGE', language, { secret: false })
    ];

    if (spec.requiresApiKey && spec.apiKeyEnv && apiKey) {
      envWrites.push(this.vercelEnvService.upsertProjectEnv(spec.apiKeyEnv, apiKey, { secret: true }));
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
