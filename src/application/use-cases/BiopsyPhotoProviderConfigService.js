const VercelProjectEnvService = require('./VercelProjectEnvService');

// Providers para la tarjeta de Provider Studio "Biopsia / Laboratorio" (lectura
// de fotos de hojas de laboratorio manuscritas). Requiere un modelo con VISIÓN,
// así que el catálogo se limita a proveedores multimodales sobre Chat
// Completions: OpenAI (recomendado) y Google Gemini vía su capa compatible.
const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Visión sobre Chat Completions. Recomendado para leer la hoja manuscrita.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-4o',
    modelOptions: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'MIRACLE_BIOPSY_LLM_OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini multimodal vía la capa compatible con OpenAI de Google.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-2.5-pro',
    modelOptions: ['gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-2.5-flash'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'MIRACLE_BIOPSY_LLM_GOOGLE_API_KEY'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga la lectura de fotos de laboratorio (el cliente ofrece rellenar a mano).',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: '',
    apiKeyEnv: null
  }
};

// Config del LLMProvider propio de la extracción de biopsia (independiente del
// de field-matching y del asistente — cada uno usa su `new LLMProvider(prefix)`
// en web/server.js, aquí el prefijo es MIRACLE_BIOPSY -> MIRACLE_BIOPSY_LLM_*).
class BiopsyPhotoProviderConfigService {
  constructor(llmProvider, options = {}) {
    this.llmProvider = llmProvider;
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  // Key por-provider, recordada aunque se cambie de provider y se vuelva. Cae a
  // la key activa compartida (MIRACLE_BIOPSY_LLM_API_KEY) solo para el provider
  // actualmente activo.
  static storedApiKeyFor(spec, activeProviderId) {
    if (!spec.apiKeyEnv) {
      return '';
    }
    const dedicated = `${process.env[spec.apiKeyEnv] || ''}`.trim();
    if (dedicated) {
      return dedicated;
    }
    if (spec.id === activeProviderId) {
      return `${process.env.MIRACLE_BIOPSY_LLM_API_KEY || ''}`.trim();
    }
    return '';
  }

  status() {
    const provider = this.llmProvider?.provider || 'disabled';
    const source = this.llmProvider?.configSource || 'none';
    const currentSpec = PROVIDERS[provider] || PROVIDERS.disabled;

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
        stored_api_key: BiopsyPhotoProviderConfigService.storedApiKeyFor(spec, provider)
      })),
      current_setup: {
        provider,
        label: currentSpec.label,
        model: this.llmProvider?.model || '',
        base_url: this.llmProvider?.baseUrl || '',
        configured: Boolean(this.llmProvider?.hasApiKey?.()),
        source
      },
      status: {
        provider,
        model: this.llmProvider?.model || '',
        base_url: this.llmProvider?.baseUrl || '',
        configured: Boolean(this.llmProvider?.hasApiKey?.()),
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
      const error = new Error('Provider de Biopsia no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const sameProvider = providerId === (this.llmProvider?.provider || 'disabled');
    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedBaseUrl = `${payload.base_url || ''}`.trim();
    const storedApiKey = BiopsyPhotoProviderConfigService.storedApiKeyFor(spec, this.llmProvider?.provider || 'disabled');
    const apiKey = requestedApiKey || storedApiKey;
    const model = requestedModel || (sameProvider ? `${this.llmProvider?.model || ''}`.trim() : '') || spec.defaultModel || '';
    const baseUrl = requestedBaseUrl || (sameProvider ? `${this.llmProvider?.baseUrl || ''}`.trim() : '') || spec.defaultBaseUrl || '';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error('La API key es obligatoria para este provider.');
      error.statusCode = 400;
      throw error;
    }
    if (spec.requiresBaseUrl && !baseUrl) {
      const error = new Error('La base URL es obligatoria para este provider.');
      error.statusCode = 400;
      throw error;
    }
    if (spec.requiresModel && !model) {
      const error = new Error('El modelo es obligatorio para este provider.');
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_BIOPSY_LLM_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_BIOPSY_LLM_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_BIOPSY_LLM_BASE_URL', providerId === 'disabled' ? '' : baseUrl, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_BIOPSY_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, { secret: true })
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
        model: providerId === 'disabled' ? null : model,
        base_url: providerId === 'disabled' ? null : baseUrl
      },
      deployment
    };
  }
}

module.exports = BiopsyPhotoProviderConfigService;
