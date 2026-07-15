const VercelProjectEnvService = require('./VercelProjectEnvService');

const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI Responses API',
    description: 'LLM propio de Miracle para estructurar notas y planear acciones.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-4.1-mini',
    modelOptions: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    defaultBaseUrl: 'https://api.openai.com',
    apiKeyEnv: 'MIRACLE_PRODUCT_LLM_OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini via la capa compatible con OpenAI (Chat Completions + salida estructurada json_schema) para estructurar notas.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-3.5-flash',
    modelOptions: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'MIRACLE_PRODUCT_LLM_GOOGLE_API_KEY'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga la hoja en blanco y deja solo el fallback heuristico actual.',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: '',
    apiKeyEnv: null
  }
};

class MiracleProductLlmProviderConfigService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  // Per-provider key, remembered even after switching away and back. Falls
  // back to the legacy shared MIRACLE_PRODUCT_LLM_API_KEY only for the
  // provider that is currently active (pre-migration deployments only ever
  // wrote that one).
  static storedApiKeyFor(spec, activeProviderId) {
    if (!spec.apiKeyEnv) {
      return '';
    }
    const dedicated = `${process.env[spec.apiKeyEnv] || ''}`.trim();
    if (dedicated) {
      return dedicated;
    }
    if (spec.id === activeProviderId) {
      return `${process.env.MIRACLE_PRODUCT_LLM_API_KEY || ''}`.trim();
    }
    return '';
  }

  status() {
    const baseUrl = `${process.env.MIRACLE_PRODUCT_LLM_BASE_URL || ''}`.trim();
    const apiKey = `${process.env.MIRACLE_PRODUCT_LLM_API_KEY || ''}`.trim();
    const configured = Boolean(baseUrl && apiKey);
    const defaultProvider = configured ? 'openai' : 'heuristic';
    const providerId = `${process.env.MIRACLE_PRODUCT_LLM_PROVIDER || defaultProvider}`.trim().toLowerCase();
    const provider = (providerId === 'openai' || providerId === 'google')
      ? providerId
      : (providerId === 'disabled' ? 'disabled' : 'heuristic');
    const currentSpec = PROVIDERS[provider] || PROVIDERS.disabled;

    const currentSetup = provider === 'heuristic'
      ? null
      : {
          provider,
          label: currentSpec.label,
          base_url: baseUrl,
          model: `${process.env.MIRACLE_PRODUCT_LLM_MODEL || currentSpec.defaultModel || ''}`.trim(),
          configured
        };

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
        recommended: spec.id === 'openai',
        stored_api_key: MiracleProductLlmProviderConfigService.storedApiKeyFor(spec, provider)
      })),
      current_setup: currentSetup,
      status: {
        provider,
        configured,
        model: `${process.env.MIRACLE_PRODUCT_LLM_MODEL || (PROVIDERS[provider] ? PROVIDERS[provider].defaultModel : '') || ''}`.trim(),
        base_url: baseUrl,
        execution_enabled: (`${process.env.MIRACLE_VOICE_AGENT_EXECUTION_ENABLED || 'false'}`.trim().toLowerCase() === 'true'),
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
      const error = new Error('Product LLM provider no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedBaseUrl = `${payload.base_url || ''}`.trim();

    const currentProviderId = `${process.env.MIRACLE_PRODUCT_LLM_PROVIDER || ''}`.trim().toLowerCase();
    const currentModel = `${process.env.MIRACLE_PRODUCT_LLM_MODEL || ''}`.trim();
    const currentBaseUrl = `${process.env.MIRACLE_PRODUCT_LLM_BASE_URL || ''}`.trim();
    const storedApiKey = MiracleProductLlmProviderConfigService.storedApiKeyFor(spec, currentProviderId);

    const apiKey = requestedApiKey || storedApiKey;
    const model = requestedModel || (currentProviderId === providerId ? currentModel : '') || spec.defaultModel || '';
    const baseUrl = requestedBaseUrl || (currentProviderId === providerId ? currentBaseUrl : '') || spec.defaultBaseUrl || '';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error('La API key del Product LLM es obligatoria.');
      error.statusCode = 400;
      throw error;
    }
    if (spec.requiresBaseUrl && !baseUrl) {
      const error = new Error('La base URL del Product LLM es obligatoria.');
      error.statusCode = 400;
      throw error;
    }
    if (spec.requiresModel && !model) {
      const error = new Error('El modelo del Product LLM es obligatorio.');
      error.statusCode = 400;
      throw error;
    }

    const writes = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_PRODUCT_LLM_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_PRODUCT_LLM_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_PRODUCT_LLM_BASE_URL', providerId === 'disabled' ? '' : baseUrl, { secret: false }),
      // Legacy shared var: still what config.py reads at runtime for whichever
      // provider is active.
      this.vercelEnvService.upsertProjectEnv('MIRACLE_PRODUCT_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, { secret: true })
    ];
    if (spec.apiKeyEnv && apiKey) {
      // Dedicated per-provider slot so the key survives switching providers
      // and back (this is what Provider Studio prefills from).
      writes.push(this.vercelEnvService.upsertProjectEnv(spec.apiKeyEnv, apiKey, { secret: true }));
    }

    await Promise.all(writes);
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      provider: providerId,
      summary: {
        provider: providerId,
        model: providerId === 'disabled' ? null : model,
        base_url: providerId === 'disabled' ? null : baseUrl
      },
      deployment
    };
  }
}

module.exports = MiracleProductLlmProviderConfigService;
