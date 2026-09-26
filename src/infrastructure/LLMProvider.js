const axios = require('axios');
const { fromOpenAiCompatible, toRecorderUsage } = require('../domain/usage/providerUsage');
const { currentContext } = require('./usage/UsageContext');
const { API_FAMILIES } = require('../domain/usage/vocabulary');

// Grabador de consumo compartido por todas las instancias. Se inyecta una vez
// desde el arranque (`LLMProvider.setUsageRecorder`) en vez de pasarlo por
// constructor: este archivo se instancia en varios sitios (GRAPH, asistente,
// biopsia) y con el setter no hay ninguno que pueda quedarse sin instrumentar
// por olvido.
let usageRecorder = null;

// Escudo de privacidad, inyectado igual que el grabador: un solo setter para
// las seis instancias. Tapa los identificadores del paciente ANTES de que el
// payload salga hacia el proveedor y los devuelve al volver la respuesta. Ver
// PrivacyShieldService y docs/privacy-egress-gateway.md.
let privacyShield = null;

class LLMProvider {
  static setUsageRecorder(recorder) {
    usageRecorder = recorder;
  }

  static getUsageRecorder() {
    return usageRecorder;
  }

  static setPrivacyShield(shield) {
    privacyShield = shield;
  }

  static getPrivacyShield() {
    return privacyShield;
  }

  // envPrefix picks which *_LLM_PROVIDER/_API_KEY/_BASE_URL/_MODEL env vars this
  // instance reads (e.g. "GRAPH" -> GRAPH_LLM_*, "MIRACLE_ASSISTANT" ->
  // MIRACLE_ASSISTANT_LLM_*). This lets independent features (Graph field
  // matching, the clinical assistant) run on different providers without
  // duplicating the Chat Completions client.
  constructor(envPrefix = 'GRAPH') {
    this.envPrefix = envPrefix;
    this.reloadFromEnv();
  }

  normalizeAzureFoundryModel(model = '') {
    const normalized = `${model || ''}`.trim();
    if (!normalized) {
      return normalized;
    }

    // DeepSeek V4 Flash in Foundry does not meet the structured-output
    // guarantees required by the clinical autofill path, so we force the
    // supported GPT-4.1 Mini route until the environment is updated explicitly.
    if (normalized.toLowerCase() === 'deepseek-v4-flash') {
      return 'gpt-4.1-mini';
    }

    return normalized;
  }

  reloadFromEnv() {
    this.provider = null;
    this.apiKey = '';
    this.baseUrl = '';
    this.model = '';
    this.configSource = 'none';

    const prefix = this.envPrefix;
    // Sin timeout, un proveedor colgado se queda hasta que Vercel mata la
    // función y responde HTML. 60 s es el presupuesto por defecto; la nota
    // clínica, que es la llamada más larga, trae el suyo por llamada
    // (`timeoutMs` en las opciones, ver ClinicalNoteGeneratorService).
    this.timeoutMs = Number(process.env[`${prefix}_LLM_TIMEOUT_MS`]) || 60000;
    // Escape para modelos que rechazan `temperature` (familias de razonamiento).
    this.sendTemperature = `${process.env[`${prefix}_LLM_DISABLE_TEMPERATURE`] || ''}`.trim() !== '1';
    const explicitProvider = (process.env[`${prefix}_LLM_PROVIDER`] || '').trim().toLowerCase();
    const explicitApiKey = (process.env[`${prefix}_LLM_API_KEY`] || '').trim();
    const explicitBaseUrl = (process.env[`${prefix}_LLM_BASE_URL`] || '').trim().replace(/\/+$/, '');
    const explicitModel = (process.env[`${prefix}_LLM_MODEL`] || '').trim();
    const envSource = `${prefix.toLowerCase()}-env`;

    if (explicitProvider === 'disabled') {
      this.provider = 'disabled';
      this.configSource = envSource;
      return;
    }

    if (explicitProvider && explicitApiKey) {
      if (explicitProvider === 'azure-foundry') {
        this.provider = 'azure-foundry';
        this.apiKey = explicitApiKey;
        this.baseUrl = explicitBaseUrl;
        this.model = this.normalizeAzureFoundryModel(explicitModel);
        this.configSource = envSource;
        return;
      }

      if (explicitProvider === 'openrouter') {
        this.provider = 'openrouter';
        this.apiKey = explicitApiKey;
        this.baseUrl = explicitBaseUrl || 'https://openrouter.ai/api/v1';
        this.model = explicitModel || 'openai/gpt-4o';
        this.configSource = envSource;
        return;
      }

      if (explicitProvider === 'openai') {
        this.provider = 'openai';
        this.apiKey = explicitApiKey;
        this.baseUrl = explicitBaseUrl || 'https://api.openai.com/v1';
        this.model = explicitModel || 'gpt-4o';
        this.configSource = envSource;
        return;
      }

      if (explicitProvider === 'google') {
        // Google Gemini via its OpenAI-compatible layer: same Chat Completions
        // shape (Bearer auth, /chat/completions) and it honors `response_format`
        // json_schema, so structured field matching keeps the same reliability.
        this.provider = 'google';
        this.apiKey = explicitApiKey;
        this.baseUrl = explicitBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai';
        this.model = explicitModel || 'gemini-3.5-flash';
        this.configSource = envSource;
        return;
      }
    }

    // Legacy global-env discovery (AZURE_FOUNDRY_*, OPENROUTER_API_KEY,
    // OPENAI_API_KEY) only applies to the original Graph instance, which is
    // what predates the *_LLM_* env convention. Other instances (e.g. the
    // clinical assistant) simply stay unconfigured until explicitly set.
    if (prefix !== 'GRAPH') {
      this.provider = null;
      this.configSource = 'none';
      return;
    }

    this.azureFoundryApiKey = (process.env.AZURE_FOUNDRY_API_KEY || '').trim();
    this.azureFoundryBaseUrl = (process.env.AZURE_FOUNDRY_BASE_URL || '').trim().replace(/\/+$/, '');
    this.azureFoundryModel = (process.env.AZURE_FOUNDRY_MODEL || process.env.AZURE_FOUNDRY_DEPLOYMENT || '').trim();
    this.openRouterApiKey = (process.env.OPENROUTER_API_KEY || '').trim();
    this.openAiApiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (this.azureFoundryApiKey && this.azureFoundryBaseUrl && this.azureFoundryModel) {
      this.provider = 'azure-foundry';
      this.apiKey = this.azureFoundryApiKey;
      this.baseUrl = this.azureFoundryBaseUrl;
      this.model = this.normalizeAzureFoundryModel(this.azureFoundryModel);
      this.configSource = 'legacy-env';
      return;
    }
    this.provider = this.openRouterApiKey ? 'openrouter' : (this.openAiApiKey ? 'openai' : null);
    this.apiKey = this.provider === 'openrouter' ? this.openRouterApiKey : this.openAiApiKey;
    this.baseUrl = this.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
    this.model = this.provider === 'openrouter'
      ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o')
      : (process.env.OPENAI_MODEL || 'gpt-4o');
    this.configSource = this.provider ? 'legacy-env' : 'none';
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  getHeaders() {
    if (!this.hasApiKey()) {
      throw new Error('No LLM API key is configured');
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.provider === 'azure-foundry') {
      headers['api-key'] = this.apiKey;
      return headers;
    }

    headers.Authorization = `Bearer ${this.apiKey}`;

    if (this.provider === 'openrouter') {
      headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'http://localhost:3000';
      headers['X-Title'] = process.env.OPENROUTER_APP_NAME || 'Graph Workflow Trainer';
    }

    return headers;
  }

  // Toda llamada facturable de texto pasa por aquí, así que aquí es donde se
  // mide. Instrumentar en los ~15 servicios que la usan habría dejado huecos:
  // la versión anterior anotaba consumo en 8 rutas y siempre con status 'ok',
  // de modo que AgentChat, SurfaceProfile, ClinicalNoteGenerator, las
  // sugerencias diagnósticas y todos los fallos no aparecían en el ledger.
  // `requestOptions.timeoutMs` sustituye el timeout de la instancia solo para
  // esta llamada: lo usa quien tiene un presupuesto de tiempo propio.
  async postChatCompletions(payload, usageOptions = {}, requestOptions = {}) {
    const timeoutMs = Number(requestOptions?.timeoutMs) > 0
      ? Number(requestOptions.timeoutMs)
      : this.timeoutMs;
    const feature = usageOptions.feature || currentContext().feature || '';
    const descriptor = {
      provider: this.provider || 'unknown',
      apiFamily: API_FAMILIES.CHAT_COMPLETIONS,
      requestedModel: payload?.model || this.model || '',
      attempt: usageOptions.attempt || 1,
      fallbackFromModel: usageOptions.fallbackFromModel || '',
      // El módulo lo pone el contexto de la petición; `usageOptions.feature`
      // solo lo afina cuando el llamador sabe más que el contexto.
      ...(usageOptions.feature ? { feature: usageOptions.feature } : {}),
      metadata: {
        // Lo que el contexto de la petición quiera adjuntar (promptVersion,
        // noteMode…) viaja aquí; UsageEvent filtra por allowlist.
        ...(currentContext().metadata || {}),
        messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
        ...(payload?.response_format?.type
          ? { responseFormat: `${payload.response_format.type}` }
          : {}),
        ...(Number.isFinite(payload?.temperature) ? { temperature: payload.temperature } : {}),
        ...(Number.isFinite(payload?.max_tokens) ? { maxTokens: payload.max_tokens } : {})
      }
    };

    // El escudo corre ANTES de `measure`: un fallo suyo no es una llamada
    // facturable ni una caída del proveedor, y en `enforce` la llamada no sale.
    // Lo que se manda es la COPIA tapada; `payload` del llamador no se toca.
    let outbound = payload;
    let protection = null;
    if (privacyShield) {
      protection = await privacyShield.protectChatPayload(payload, { feature });
      outbound = protection.payload;
      Object.assign(descriptor.metadata, privacyShield.metadataFor(protection));
    }

    const run = async () => {
      let data;
      try {
        const response = await axios.post(`${this.baseUrl}/chat/completions`, outbound, {
          headers: this.getHeaders(),
          timeout: timeoutMs
        });
        data = response.data;
      } catch (error) {
        const status = error.response?.status;
        const details = typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data || {});
        const wrapped = new Error(`LLM request failed (${status || 'unknown'}): ${details}`);
        // Se conserva la respuesta cruda para que el grabador pueda leer el
        // `usage` de un error que sí gastó tokens (p. ej. context_length),
        // pero SIN `config`: ahí viaja el cuerpo enviado, y un error no puede
        // ser la vía por la que el prompt acabe en un log.
        wrapped.response = error.response ? { status: error.response.status, data: error.response.data } : undefined;
        wrapped.statusCode = status;
        throw wrapped;
      }
      // Rehidratación dentro de `run`: por debajo de aquí nadie ve marcadores.
      if (protection) {
        data = privacyShield.restoreChatResponse(data, protection);
        Object.assign(descriptor.metadata, privacyShield.metadataFor(protection));
      }
      return data;
    };

    if (!usageRecorder) {
      return run();
    }

    return usageRecorder.measure(
      descriptor,
      run,
      (data) => toRecorderUsage(fromOpenAiCompatible(data))
    );
  }

  async chat(messages, options = {}) {
    const result = await this.chatWithUsage(messages, options);
    return result.content;
  }

  // Parámetros de generación opcionales. Sólo se envían cuando el llamador los
  // fija: un prompt que exige copiar palabra por palabra pide temperature 0; un
  // chat, 0.4. Antes todo corría a la temperatura por defecto del proveedor.
  generationParams(options = {}) {
    const params = {};
    if (this.sendTemperature && Number.isFinite(options.temperature)) {
      params.temperature = options.temperature;
    }
    if (Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
      params.max_tokens = Math.floor(options.maxTokens);
    }
    return params;
  }

  async chatWithUsage(messages, options = {}) {
    const data = await this.postChatCompletions({
      model: options.model || this.model,
      messages,
      ...this.generationParams(options)
    }, options.usage, { timeoutMs: options.timeoutMs });

    return {
      content: data.choices?.[0]?.message?.content?.trim() || '',
      usage: data.usage || null,
      model: data.model || options.model || this.model,
      provider: this.provider || ''
    };
  }

  async chatExpectingJson(messages, responseFormat = { type: 'json_object' }, options = {}) {
    const result = await this.chatExpectingJsonWithUsage(messages, responseFormat, options);
    return result.content;
  }

  async chatExpectingJsonWithUsage(messages, responseFormat = { type: 'json_object' }, options = {}) {
    const data = await this.postChatCompletions({
      model: options.model || this.model,
      messages,
      response_format: responseFormat,
      ...this.generationParams(options)
    }, options.usage, { timeoutMs: options.timeoutMs });

    return {
      content: data.choices?.[0]?.message?.content?.trim() || '{}',
      usage: data.usage || null,
      model: data.model || options.model || this.model,
      provider: this.provider || ''
    };
  }

  // Recupera el JSON de la respuesta del modelo. Los fences se quitan sólo al
  // principio y al final: la versión anterior hacía un replace GLOBAL de ```,
  // que corrompía cualquier valor de texto que contuviera uno. Acepta objetos y
  // arrays, y tolera prosa alrededor.
  parseJsonObject(content) {
    if (typeof content !== 'string') {
      throw new Error('LLM content must be a string');
    }

    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    if (!cleaned) {
      throw new Error('LLM returned empty content');
    }

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      const startsWithArray = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace);
      const open = startsWithArray ? firstBracket : firstBrace;
      const close = startsWithArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
      if (open >= 0 && close > open) {
        return JSON.parse(cleaned.slice(open, close + 1));
      }
      throw new Error(`Could not parse LLM JSON response: ${cleaned.slice(0, 200)}`);
    }
  }
}

module.exports = LLMProvider;
