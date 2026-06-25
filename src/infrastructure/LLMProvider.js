const axios = require('axios');

class LLMProvider {
  constructor() {
    this.reloadFromEnv();
  }

  reloadFromEnv() {
    this.provider = null;
    this.apiKey = '';
    this.baseUrl = '';
    this.model = '';
    this.configSource = 'none';

    const graphProvider = (process.env.GRAPH_LLM_PROVIDER || '').trim().toLowerCase();
    const graphApiKey = (process.env.GRAPH_LLM_API_KEY || '').trim();
    const graphBaseUrl = (process.env.GRAPH_LLM_BASE_URL || '').trim().replace(/\/+$/, '');
    const graphModel = (process.env.GRAPH_LLM_MODEL || '').trim();

    if (graphProvider === 'disabled') {
      this.provider = 'disabled';
      this.configSource = 'graph-env';
      return;
    }

    if (graphProvider && graphApiKey) {
      if (graphProvider === 'azure-foundry') {
        this.provider = 'azure-foundry';
        this.apiKey = graphApiKey;
        this.baseUrl = graphBaseUrl;
        this.model = graphModel;
        this.configSource = 'graph-env';
        return;
      }

      if (graphProvider === 'openrouter') {
        this.provider = 'openrouter';
        this.apiKey = graphApiKey;
        this.baseUrl = graphBaseUrl || 'https://openrouter.ai/api/v1';
        this.model = graphModel || 'openai/gpt-4o';
        this.configSource = 'graph-env';
        return;
      }

      if (graphProvider === 'openai') {
        this.provider = 'openai';
        this.apiKey = graphApiKey;
        this.baseUrl = graphBaseUrl || 'https://api.openai.com/v1';
        this.model = graphModel || 'gpt-4o';
        this.configSource = 'graph-env';
        return;
      }
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
      this.model = this.azureFoundryModel;
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

  async postChatCompletions(payload) {
    try {
      const response = await axios.post(`${this.baseUrl}/chat/completions`, payload, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const details = typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data || {});
      throw new Error(`LLM request failed (${status || 'unknown'}): ${details}`);
    }
  }

  async translateToCypher(prompt, schema) {
    const content = await this.chat([
      { role: 'system', content: `Translate natural language to Neo4j Cypher. Schema: ${schema}. Return ONLY the Cypher query.` },
      { role: 'user', content: prompt }
    ]);

    return content.replace(/```cypher|```/gi, '').trim();
  }

  async chat(messages, options = {}) {
    const result = await this.chatWithUsage(messages, options);
    return result.content;
  }

  async chatWithUsage(messages, options = {}) {
    const data = await this.postChatCompletions({
      model: options.model || this.model,
      messages
    });

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
    try {
      const data = await this.postChatCompletions({
        model: options.model || this.model,
        messages,
        response_format: responseFormat
      });

      return {
        content: data.choices?.[0]?.message?.content?.trim() || '{}',
        usage: data.usage || null,
        model: data.model || options.model || this.model,
        provider: this.provider || ''
      };
    } catch (error) {
      const message = `${error.message || ''}`;
      const formatUnsupported =
        message.includes('response format is not supported')
        || message.includes('response_format')
        || message.includes('Invalid request');

      if (!responseFormat || !formatUnsupported) {
        throw error;
      }

      return this.chatWithUsage(messages, options);
    }
  }

  parseJsonObject(content) {
    if (typeof content !== 'string') {
      throw new Error('LLM content must be a string');
    }

    const cleaned = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    if (!cleaned) {
      throw new Error('LLM returned empty content');
    }

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      }
      throw new Error(`Could not parse LLM JSON response: ${cleaned}`);
    }
  }
}

module.exports = LLMProvider;
