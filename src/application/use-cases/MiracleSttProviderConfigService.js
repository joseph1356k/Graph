class MiracleSttProviderConfigService {
  constructor(options = {}) {
    this.apiToken = `${options.apiToken || process.env.GRAPH_VERCEL_API_TOKEN || ''}`.trim();
    this.projectId = `${options.projectId || process.env.GRAPH_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || 'prj_aGN8aRUyPEyWX53NjdTT4fOZ2h15'}`.trim();
    this.projectName = `${options.projectName || process.env.GRAPH_VERCEL_PROJECT_NAME || 'miracle'}`.trim();
    this.teamId = `${options.teamId || process.env.GRAPH_VERCEL_TEAM_ID || 'jose-david-s-projects-22dd4300'}`.trim();
    this.deployHookUrl = `${options.deployHookUrl || process.env.GRAPH_VERCEL_DEPLOY_HOOK_URL || ''}`.trim();
  }

  static get PROVIDERS() {
    return {
      deepgram: {
        id: 'deepgram',
        label: 'Deepgram Streaming',
        description: 'STT en streaming para el boton Grabar del asistente flotante y Miracle.',
        requiresApiKey: true,
        requiresModel: true,
        defaultModel: 'nova-3',
        defaultLanguage: 'es',
        recommended: true
      },
      disabled: {
        id: 'disabled',
        label: 'Deshabilitado',
        description: 'Apaga por completo el STT en streaming.',
        requiresApiKey: false,
        requiresModel: false,
        defaultModel: '',
        defaultLanguage: 'es',
        recommended: false
      }
    };
  }

  status() {
    const providerId = `${process.env.MIRACLE_STT_PROVIDER || (process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'disabled')}`.trim().toLowerCase();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId] || MiracleSttProviderConfigService.PROVIDERS.disabled;
    const model = `${process.env.MIRACLE_STT_MODEL || spec.defaultModel || ''}`.trim();
    const language = `${process.env.MIRACLE_STT_LANGUAGE || spec.defaultLanguage || 'es'}`.trim();
    const configured = providerId === 'disabled' ? true : Boolean(`${process.env.DEEPGRAM_API_KEY || ''}`.trim());

    return {
      providers: Object.values(MiracleSttProviderConfigService.PROVIDERS).map((provider) => ({
        id: provider.id,
        label: provider.label,
        description: provider.description,
        requires_api_key: provider.requiresApiKey,
        requires_model: provider.requiresModel,
        default_model: provider.defaultModel,
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
      vercel: {
        write_enabled: Boolean(this.apiToken && this.projectId),
        project_id: this.projectId || '',
        project_name: this.projectName || '',
        team_id: this.teamId || '',
        deploy_hook_configured: Boolean(this.deployHookUrl),
        current_deployment_id: `${process.env.VERCEL_DEPLOYMENT_ID || ''}`.trim()
      }
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

    if (!this.apiToken || !this.projectId) {
      const error = new Error('Falta configurar GRAPH_VERCEL_API_TOKEN o GRAPH_VERCEL_PROJECT_ID en el servidor para guardar secretos en Vercel.');
      error.statusCode = 503;
      throw error;
    }

    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedLanguage = `${payload.language || ''}`.trim();

    const apiKey = requestedApiKey || `${process.env.DEEPGRAM_API_KEY || ''}`.trim();
    const model = requestedModel || `${process.env.MIRACLE_STT_MODEL || ''}`.trim() || spec.defaultModel || '';
    const language = requestedLanguage || `${process.env.MIRACLE_STT_LANGUAGE || ''}`.trim() || spec.defaultLanguage || 'es';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error('La API key de Deepgram es obligatoria para habilitar el STT.');
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.upsertProjectEnv('MIRACLE_STT_PROVIDER', providerId, { secret: false }),
      this.upsertProjectEnv('MIRACLE_STT_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.upsertProjectEnv('MIRACLE_STT_LANGUAGE', language, { secret: false })
    ];

    if (providerId === 'deepgram') {
      envWrites.push(this.upsertProjectEnv('DEEPGRAM_API_KEY', apiKey, { secret: true }));
    }

    await Promise.all(envWrites);
    const deployment = await this.triggerRedeploy();

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

  async upsertProjectEnv(key, value, options = {}) {
    const params = new URLSearchParams({ upsert: 'true' });
    if (this.teamId) {
      params.set('teamId', this.teamId);
    }

    const response = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(this.projectId)}/env?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key,
        value,
        type: options.secret ? 'encrypted' : 'plain',
        target: ['production', 'preview']
      })
    });

    if (!response.ok) {
      const payload = await response.text();
      const error = new Error(`Vercel no pudo guardar ${key}: ${payload.slice(0, 220) || `HTTP ${response.status}`}`);
      error.statusCode = 502;
      throw error;
    }
  }

  async triggerRedeploy() {
    if (this.deployHookUrl) {
      const response = await fetch(this.deployHookUrl, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.text();
        const error = new Error(`Vercel no pudo disparar el deploy hook: ${payload.slice(0, 220) || `HTTP ${response.status}`}`);
        error.statusCode = 502;
        throw error;
      }
      return {
        triggered: true,
        strategy: 'deploy-hook'
      };
    }

    const deploymentId = `${process.env.VERCEL_DEPLOYMENT_ID || ''}`.trim();
    if (!deploymentId) {
      return {
        triggered: false,
        strategy: 'manual',
        message: 'Las variables ya quedaron guardadas en Vercel, pero falta un deploy hook o VERCEL_DEPLOYMENT_ID para redeploy automatico.'
      };
    }

    const params = new URLSearchParams();
    if (this.teamId) {
      params.set('teamId', this.teamId);
    }

    const response = await fetch(`https://api.vercel.com/v13/deployments?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.projectName,
        project: this.projectId,
        target: 'production',
        deploymentId
      })
    });

    if (!response.ok) {
      const payload = await response.text();
      return {
        triggered: false,
        strategy: 'manual',
        message: `Las variables quedaron guardadas, pero el redeploy automatico fallo: ${payload.slice(0, 220) || `HTTP ${response.status}`}`
      };
    }

    const payload = await response.json();
    return {
      triggered: true,
      strategy: 'redeploy-api',
      deployment_id: payload?.id || '',
      deployment_url: payload?.url ? `https://${payload.url}` : ''
    };
  }
}

module.exports = MiracleSttProviderConfigService;
