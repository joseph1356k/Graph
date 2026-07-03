class VercelProjectEnvService {
  constructor(options = {}) {
    this.apiToken = `${options.apiToken || process.env.GRAPH_VERCEL_API_TOKEN || ''}`.trim();
    this.projectId = `${options.projectId || process.env.GRAPH_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || 'prj_aGN8aRUyPEyWX53NjdTT4fOZ2h15'}`.trim();
    this.projectName = `${options.projectName || process.env.GRAPH_VERCEL_PROJECT_NAME || 'miracle'}`.trim();
    this.teamId = `${options.teamId || process.env.GRAPH_VERCEL_TEAM_ID || 'jose-david-s-projects-22dd4300'}`.trim();
    this.deployHookUrl = `${options.deployHookUrl || process.env.GRAPH_VERCEL_DEPLOY_HOOK_URL || ''}`.trim();
  }

  status() {
    return {
      write_enabled: Boolean(this.apiToken && this.projectId),
      project_id: this.projectId || '',
      project_name: this.projectName || '',
      team_id: this.teamId || '',
      deploy_hook_configured: Boolean(this.deployHookUrl),
      current_deployment_id: `${process.env.VERCEL_DEPLOYMENT_ID || ''}`.trim()
    };
  }

  assertWritable() {
    if (this.apiToken && this.projectId) {
      return;
    }
    const error = new Error('Falta configurar GRAPH_VERCEL_API_TOKEN o GRAPH_VERCEL_PROJECT_ID en el servidor para guardar secretos en Vercel.');
    error.statusCode = 503;
    throw error;
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

  // Finds the most recent production deployment so we can redeploy it even
  // when VERCEL_DEPLOYMENT_ID isn't exposed to the runtime.
  async resolveLatestDeploymentId() {
    if (!this.apiToken || !this.projectId) {
      return '';
    }
    const params = new URLSearchParams({
      projectId: this.projectId,
      target: 'production',
      limit: '1'
    });
    if (this.teamId) {
      params.set('teamId', this.teamId);
    }
    try {
      const response = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` }
      });
      if (!response.ok) {
        return '';
      }
      const payload = await response.json();
      const deployment = Array.isArray(payload?.deployments) ? payload.deployments[0] : null;
      return `${deployment?.uid || deployment?.id || ''}`.trim();
    } catch (error) {
      return '';
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

    let deploymentId = `${process.env.VERCEL_DEPLOYMENT_ID || ''}`.trim();
    if (!deploymentId) {
      deploymentId = await this.resolveLatestDeploymentId();
    }
    if (!deploymentId) {
      return {
        triggered: false,
        strategy: 'manual',
        message: 'Las variables ya quedaron guardadas en Vercel, pero no se encontro un deployment de produccion para redeploy automatico. Configura un deploy hook (GRAPH_VERCEL_DEPLOY_HOOK_URL) o redeploya manualmente.'
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

module.exports = VercelProjectEnvService;
