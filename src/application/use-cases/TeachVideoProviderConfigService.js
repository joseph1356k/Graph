const VercelProjectEnvService = require('./VercelProjectEnvService');
const { resolveTeachConfig } = require('../../infrastructure/conscious-brain/config');

// Providers para la tarjeta de Provider Studio "Enseñanza por video" (tab
// Windows App). El análisis de video SIEMPRE es Gemini (es el único proveedor
// del catálogo que entiende video con audio vía la Files API), así que las
// opciones son solo Google o apagar la funcionalidad.
const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'Análisis de video (imagen + audio) con la Files API + generateContent. Único proveedor soportado.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-3.5-flash',
    modelOptions: ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultBaseUrl: '',
    apiKeyEnv: 'MIRACLE_TEACH_LLM_GOOGLE_API_KEY'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga la enseñanza por video (los endpoints /api/v1/teach/* responden error controlado).',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: '',
    apiKeyEnv: null
  }
};

// Config de la enseñanza por video (prefijo MIRACLE_TEACH -> MIRACLE_TEACH_LLM_*),
// con fallback a GEMINI_API_KEY (comportamiento del backend viejo, donde la
// enseñanza compartía la key global de Gemini). Mismo patrón de persistencia
// Vercel + redeploy que las demás tarjetas.
class TeachVideoProviderConfigService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  static storedApiKeyFor(spec, activeProviderId, activeConfig) {
    if (!spec.apiKeyEnv) {
      return '';
    }
    const dedicated = `${process.env[spec.apiKeyEnv] || ''}`.trim();
    if (dedicated) {
      return dedicated;
    }
    if (spec.id === activeProviderId) {
      return `${process.env.MIRACLE_TEACH_LLM_API_KEY || ''}`.trim() || activeConfig.apiKey || '';
    }
    return '';
  }

  status() {
    const config = resolveTeachConfig();
    const provider = config.provider === 'disabled' ? 'disabled' : 'google';
    const currentSpec = PROVIDERS[provider] || PROVIDERS.disabled;
    const explicit = `${process.env.MIRACLE_TEACH_LLM_PROVIDER || ''}`.trim();
    const source = explicit ? 'teach-env' : (config.configured ? 'fallback-env' : 'none');

    return {
      providers: Object.values(PROVIDERS).map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        requires_api_key: spec.requiresApiKey,
        requires_base_url: spec.requiresBaseUrl,
        requires_model: spec.requiresModel,
        default_model: spec.defaultModel,
        model_options: spec.modelOptions || [],
        default_base_url: spec.defaultBaseUrl,
        recommended: spec.id === 'google',
        stored_api_key: TeachVideoProviderConfigService.storedApiKeyFor(spec, provider, config)
      })),
      current_setup: {
        provider,
        label: currentSpec.label,
        model: config.model || '',
        base_url: '',
        configured: config.configured,
        source
      },
      status: {
        provider,
        model: config.model || '',
        base_url: '',
        configured: config.configured,
        source,
        storage: 'vercel-env',
        redeploy_required: false
      },
      vercel: this.vercelEnvService.status()
    };
  }

  async configure(payload = {}) {
    const providerId = `${payload.provider || ''}`.trim().toLowerCase();
    const spec = PROVIDERS[providerId];
    if (!spec) {
      const error = new Error('Provider de enseñanza por video no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const activeConfig = resolveTeachConfig();
    const activeProviderId = activeConfig.provider === 'disabled' ? 'disabled' : 'google';
    const sameProvider = providerId === activeProviderId;
    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const storedApiKey = TeachVideoProviderConfigService.storedApiKeyFor(spec, activeProviderId, activeConfig);
    const apiKey = requestedApiKey || storedApiKey;
    const model = requestedModel || (sameProvider ? `${activeConfig.model || ''}`.trim() : '') || spec.defaultModel || '';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error('La API key es obligatoria para este provider.');
      error.statusCode = 400;
      throw error;
    }
    if (spec.requiresModel && !model) {
      const error = new Error('El modelo es obligatorio para este provider.');
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_TEACH_LLM_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_TEACH_LLM_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_TEACH_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, { secret: true })
    ];
    if (spec.apiKeyEnv && apiKey) {
      envWrites.push(this.vercelEnvService.upsertProjectEnv(spec.apiKeyEnv, apiKey, { secret: true }));
    }

    await Promise.all(envWrites);
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      provider: providerId,
      summary: {
        provider: providerId,
        model: providerId === 'disabled' ? null : model
      },
      deployment
    };
  }
}

module.exports = TeachVideoProviderConfigService;
