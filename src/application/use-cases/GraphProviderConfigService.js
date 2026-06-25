const fs = require('fs');
const path = require('path');

function quoteEnvValue(value) {
  return JSON.stringify(`${value ?? ''}`);
}

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return { lines: [], values: {} };
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const values = {};
  lines.forEach((line) => {
    const trimmed = `${line || ''}`.trim();
    if (!trimmed || trimmed.startsWith('#') || !line.includes('=')) {
      return;
    }
    const [key, rawValue] = line.split('=', 2);
    let value = `${rawValue || ''}`.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key.trim()] = value;
  });
  return { lines, values };
}

function updateEnvFile(envPath, updates) {
  const { lines } = parseEnvFile(envPath);
  const existing = {};

  lines.forEach((line, index) => {
    if (!line.includes('=') || `${line}`.trim().startsWith('#')) {
      return;
    }
    existing[line.split('=', 1)[0].trim()] = index;
  });

  Object.entries(updates).forEach(([key, value]) => {
    const rendered = `${key}=${quoteEnvValue(value)}`;
    if (Object.prototype.hasOwnProperty.call(existing, key)) {
      lines[existing[key]] = rendered;
    } else {
      lines.push(rendered);
    }
  });

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
}

const PROVIDERS = {
  'azure-foundry': {
    id: 'azure-foundry',
    label: 'Azure Foundry',
    description: 'Provider recomendado para salidas más controladas en matching y dynamic fill.',
    requiresApiKey: true,
    requiresBaseUrl: true,
    requiresModel: true,
    defaultModel: 'grok-4.1',
    defaultBaseUrl: ''
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Catálogo amplio con una sola API key. Útil como fallback o laboratorio.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'openai/gpt-4o',
    defaultBaseUrl: 'https://openrouter.ai/api/v1'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Usa Chat Completions estándar desde Graph.',
    requiresApiKey: true,
    requiresBaseUrl: false,
    requiresModel: true,
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1'
  },
  disabled: {
    id: 'disabled',
    label: 'Deshabilitado',
    description: 'Apaga el matching LLM de Graph y deja solo comportamiento no asistido.',
    requiresApiKey: false,
    requiresBaseUrl: false,
    requiresModel: false,
    defaultModel: '',
    defaultBaseUrl: ''
  }
};

class GraphProviderConfigService {
  constructor(llmProvider, options = {}) {
    this.llmProvider = llmProvider;
    this.envPath = options.envPath || path.resolve(process.cwd(), '.env');
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
        source
      }
    };
  }

  configure(payload = {}) {
    const providerId = `${payload.provider || ''}`.trim().toLowerCase();
    const spec = PROVIDERS[providerId];
    if (!spec) {
      const error = new Error('Provider de Graph no soportado.');
      error.statusCode = 400;
      throw error;
    }

    const apiKey = `${payload.api_key || ''}`.trim();
    const model = `${payload.model || spec.defaultModel || ''}`.trim();
    const baseUrl = `${payload.base_url || spec.defaultBaseUrl || ''}`.trim();

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

    const updates = {
      GRAPH_LLM_PROVIDER: providerId,
      GRAPH_LLM_API_KEY: providerId === 'disabled' ? '' : apiKey,
      GRAPH_LLM_BASE_URL: providerId === 'disabled' ? '' : baseUrl,
      GRAPH_LLM_MODEL: providerId === 'disabled' ? '' : model
    };

    updateEnvFile(this.envPath, updates);
    if (this.llmProvider?.reloadFromEnv) {
      this.llmProvider.reloadFromEnv();
    }

    return {
      ok: true,
      provider: providerId,
      status: this.status().status
    };
  }
}

module.exports = GraphProviderConfigService;
