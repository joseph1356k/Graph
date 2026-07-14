const VercelProjectEnvService = require('./VercelProjectEnvService');

const PROVIDERS = {
  'azure-foundry': {
    id: 'azure-foundry',
    label: 'Azure Foundry',
    description: 'Provider recomendado para salidas mas controladas en matching y dynamic fill.',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultModel: 'grok-4.1',
    modelOptions: ['gpt-4.1-mini', 'DeepSeek-V4-Flash', 'grok-4.1'],
    defaultBaseUrl: ''
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Catalogo amplio con una sola API key. Util como fallback o laboratorio.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'openai/gpt-4o',
    modelOptions: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-4.1-mini'],
    defaultBaseUrl: 'https://openrouter.ai/api/v1'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Usa Chat Completions estandar desde Graph.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-4.1-mini',
    modelOptions: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    defaultBaseUrl: 'https://api.openai.com/v1'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini via la capa compatible con OpenAI de Google. Soporta salidas estructuradas (json_schema) para matching fiable.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-3.5-flash',
    modelOptions: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga el matching LLM de Graph y deja solo comportamiento no asistido.',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: ''
  }
};

class GraphProviderConfigService {
  constructor(llmProvider, options = {}) {
    this.llmProvider = llmProvider;
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
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
        recommended: spec.id === 'azure-foundry'
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
      const error = new Error('Provider de Graph no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const sameProvider = providerId === (this.llmProvider?.provider || 'disabled');
    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedBaseUrl = `${payload.base_url || ''}`.trim();
    const apiKey = requestedApiKey || (sameProvider ? `${this.llmProvider?.apiKey || ''}`.trim() : '');
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
      this.vercelEnvService.upsertProjectEnv('GRAPH_LLM_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('GRAPH_LLM_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('GRAPH_LLM_BASE_URL', providerId === 'disabled' ? '' : baseUrl, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('GRAPH_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, { secret: true })
    ];

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

module.exports = GraphProviderConfigService;
