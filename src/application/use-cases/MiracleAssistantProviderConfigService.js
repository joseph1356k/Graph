const VercelProjectEnvService = require('./VercelProjectEnvService');

const PROVIDERS = {
  'azure-foundry': {
    id: 'azure-foundry',
    label: 'Azure Foundry',
    description: 'Provider recomendado para respuestas clinicas mas controladas.',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultModel: 'grok-4.1',
    modelOptions: ['gpt-4.1-mini', 'DeepSeek-V4-Flash', 'grok-4.1'],
    defaultBaseUrl: '',
    apiKeyEnv: 'MIRACLE_ASSISTANT_LLM_AZURE_FOUNDRY_API_KEY'
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
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'MIRACLE_ASSISTANT_LLM_OPENROUTER_API_KEY'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Chat Completions estandar para el asistente clinico.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-4.1-mini',
    modelOptions: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'MIRACLE_ASSISTANT_LLM_OPENAI_API_KEY'
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini via la capa compatible con OpenAI de Google.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gemini-3.5-flash',
    modelOptions: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'MIRACLE_ASSISTANT_LLM_GOOGLE_API_KEY'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga el asistente clinico (chat, sugerencias diagnosticas y ajuste de nota).',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    modelOptions: [],
    defaultBaseUrl: '',
    apiKeyEnv: null
  }
};

// Provider config for the clinical assistant's own LLMProvider (independent
// from Graph's field-matching provider — see web/server.js, where each gets
// its own `new LLMProvider(envPrefix)` instance).
class MiracleAssistantProviderConfigService {
  constructor(llmProvider, options = {}) {
    this.llmProvider = llmProvider;
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  // Per-provider key, remembered even after switching away and back. Falls
  // back to the legacy shared MIRACLE_ASSISTANT_LLM_API_KEY only for the
  // provider that is currently active.
  static storedApiKeyFor(spec, activeProviderId) {
    if (!spec.apiKeyEnv) {
      return '';
    }
    const dedicated = `${process.env[spec.apiKeyEnv] || ''}`.trim();
    if (dedicated) {
      return dedicated;
    }
    if (spec.id === activeProviderId) {
      return `${process.env.MIRACLE_ASSISTANT_LLM_API_KEY || ''}`.trim();
    }
    return '';
  }

  // Only the tail, and only enough of it to tell two keys apart. The status
  // endpoint is admin-gated, but it is still a browser response: shipping a
  // usable provider key to the client is not something an authorization check
  // makes safe.
  static maskApiKey(apiKey) {
    const value = `${apiKey || ''}`.trim();
    if (!value) {
      return '';
    }
    return `…${value.slice(-4)}`;
  }

  status() {
    const provider = this.llmProvider?.provider || 'disabled';
    const source = this.llmProvider?.configSource || 'none';
    const currentSpec = PROVIDERS[provider] || PROVIDERS.disabled;
    // Which env var the RUNTIME actually read its key from. Without this, a key
    // updated in the wrong variable looks identical to one that took effect.
    const apiKeySource = this.llmProvider?.apiKeySource || 'none';
    const activeApiKeyEnv = apiKeySource === 'per-provider' && currentSpec.apiKeyEnv
      ? currentSpec.apiKeyEnv
      : (apiKeySource === 'generic' ? 'MIRACLE_ASSISTANT_LLM_API_KEY' : '');

    const runtime = {
      provider,
      model: this.llmProvider?.model || '',
      base_url: this.llmProvider?.baseUrl || '',
      configured: Boolean(this.llmProvider?.hasApiKey?.()),
      source,
      api_key_source: apiKeySource,
      api_key_env: activeApiKeyEnv,
      api_key_masked: MiracleAssistantProviderConfigService.maskApiKey(this.llmProvider?.apiKey)
    };

    return {
      providers: Object.values(PROVIDERS).map((spec) => {
        const storedApiKey = MiracleAssistantProviderConfigService.storedApiKeyFor(spec, provider);
        return {
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
          api_key_env: spec.apiKeyEnv || '',
          // Never the key itself: enough to recognise it, useless to reuse.
          has_stored_api_key: Boolean(storedApiKey),
          stored_api_key_masked: MiracleAssistantProviderConfigService.maskApiKey(storedApiKey)
        };
      }),
      current_setup: { ...runtime, label: currentSpec.label },
      status: { ...runtime, storage: 'vercel-env', redeploy_required: false },
      vercel: this.vercelEnvService.status()
    };
  }

  async configure(payload = {}) {
    const providerId = `${payload.provider || ''}`.trim().toLowerCase();
    const spec = PROVIDERS[providerId];
    if (!spec) {
      const error = new Error('Provider de Asistente no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const sameProvider = providerId === (this.llmProvider?.provider || 'disabled');
    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedBaseUrl = `${payload.base_url || ''}`.trim();
    const storedApiKey = MiracleAssistantProviderConfigService.storedApiKeyFor(spec, this.llmProvider?.provider || 'disabled');
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

    const writes = [
      ['MIRACLE_ASSISTANT_LLM_PROVIDER', providerId, false],
      ['MIRACLE_ASSISTANT_LLM_MODEL', providerId === 'disabled' ? '' : model, false],
      ['MIRACLE_ASSISTANT_LLM_BASE_URL', providerId === 'disabled' ? '' : baseUrl, false],
      ['MIRACLE_ASSISTANT_LLM_API_KEY', providerId === 'disabled' ? '' : apiKey, true]
    ];
    if (spec.apiKeyEnv && apiKey) {
      writes.push([spec.apiKeyEnv, apiKey, true]);
    }

    await Promise.all(writes.map(([key, value, secret]) => (
      this.vercelEnvService.upsertProjectEnv(key, value, { secret })
    )));
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      provider: providerId,
      summary: {
        provider: providerId,
        model: providerId === 'disabled' ? null : model,
        base_url: providerId === 'disabled' ? null : baseUrl
      },
      // Exactly which variables changed and in which project. When a key does
      // not take effect, this is what tells you whether it was written where the
      // runtime reads it.
      written_env_keys: writes.map(([key]) => key),
      target_project_id: this.vercelEnvService.projectId || '',
      deployment
    };
  }
}

module.exports = MiracleAssistantProviderConfigService;
