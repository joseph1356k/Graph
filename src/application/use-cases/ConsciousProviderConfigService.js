const VercelProjectEnvService = require('./VercelProjectEnvService');
const { resolveConsciousConfig } = require('../../infrastructure/conscious-brain/config');

// Providers para la tarjeta de Provider Studio "Computer-use consciente" (el
// cerebro del agente de escritorio Ü, tab Windows App). A diferencia de las
// demás tarjetas, este módulo NO usa Chat Completions: necesita las APIs
// NATIVAS de cada proveedor (Responses de OpenAI con computer-use nativo,
// generateContent de Gemini con function-calling + visión). Por eso el catálogo
// se limita a esos dos y no hay campo de base URL.
const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Computer-use nativo sobre la Responses API. Recomendado para el agente de escritorio.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-5.6',
    modelOptions: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.1'],
    defaultBaseUrl: '',
    apiKeyEnv: 'MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'generateContent nativo con function-calling + visión (computer-use declarado como funciones).',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-3.5-flash',
    modelOptions: ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultBaseUrl: '',
    apiKeyEnv: 'MIRACLE_CONSCIOUS_LLM_GOOGLE_API_KEY'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga el cerebro del agente de escritorio (POST /api/v1/agent/turn responde error controlado).',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: '',
    apiKeyEnv: null
  }
};

// Config del cerebro consciente (prefijo MIRACLE_CONSCIOUS -> MIRACLE_CONSCIOUS_LLM_*).
// Mismo patrón de persistencia que BiopsyPhotoProviderConfigService: escribe los
// env en Vercel y dispara el redeploy. El estado se lee del resolver del módulo
// (no de un LLMProvider) porque este módulo tiene fallback a las keys globales
// OPENAI_API_KEY / GEMINI_API_KEY del backend original.
class ConsciousProviderConfigService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  // El id 'gemini' interno del engine se muestra como 'google' (convención de
  // las tarjetas del Studio).
  static uiProviderId(config) {
    if (!config.provider) return '';
    return config.provider === 'gemini' ? 'google' : config.provider;
  }

  // Key por-provider, recordada aunque se cambie de provider y se vuelva. Cae a
  // la key activa compartida (MIRACLE_CONSCIOUS_LLM_API_KEY) y luego a la
  // global (OPENAI_API_KEY / GEMINI_API_KEY) solo para el provider activo.
  static storedApiKeyFor(spec, activeProviderId, activeConfig) {
    if (!spec.apiKeyEnv) {
      return '';
    }
    const dedicated = `${process.env[spec.apiKeyEnv] || ''}`.trim();
    if (dedicated) {
      return dedicated;
    }
    if (spec.id === activeProviderId) {
      return `${process.env.MIRACLE_CONSCIOUS_LLM_API_KEY || ''}`.trim() || activeConfig.apiKey || '';
    }
    return '';
  }

  status() {
    const config = resolveConsciousConfig();
    const provider = ConsciousProviderConfigService.uiProviderId(config) || 'disabled';
    const currentSpec = PROVIDERS[provider] || PROVIDERS.disabled;
    const explicit = `${process.env.MIRACLE_CONSCIOUS_LLM_PROVIDER || ''}`.trim();
    const source = explicit ? 'conscious-env' : (config.provider ? 'fallback-env' : 'none');

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
        stored_api_key: ConsciousProviderConfigService.storedApiKeyFor(spec, provider, config)
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
      const error = new Error('Provider del cerebro consciente no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const activeConfig = resolveConsciousConfig();
    const activeProviderId = ConsciousProviderConfigService.uiProviderId(activeConfig) || 'disabled';
    const sameProvider = providerId === activeProviderId;
    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const storedApiKey = ConsciousProviderConfigService.storedApiKeyFor(spec, activeProviderId, activeConfig);
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
      this.vercelEnvService.upsertProjectEnv('MIRACLE_CONSCIOUS_LLM_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_CONSCIOUS_LLM_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_CONSCIOUS_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, { secret: true })
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

module.exports = ConsciousProviderConfigService;
