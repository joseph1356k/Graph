class VercelProjectEnvService {
  constructor(options = {}) {
    this.apiToken = `${options.apiToken || process.env.GRAPH_VERCEL_API_TOKEN || ''}`.trim();
    // Defaults point at the real "graph" project / team so the writeback works
    // even before GRAPH_VERCEL_* are set. Override per-env when needed.
    this.projectId = `${options.projectId || process.env.GRAPH_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || 'prj_gOy4opji8kmUZgMQfaEAaapbT3JU'}`.trim();
    this.projectName = `${options.projectName || process.env.GRAPH_VERCEL_PROJECT_NAME || 'graph'}`.trim();
    this.teamId = `${options.teamId || process.env.GRAPH_VERCEL_TEAM_ID || 'team_CtaJyE2ae5OQmPvQkyjqyPZC'}`.trim();
    this.deployHookUrl = `${options.deployHookUrl || process.env.GRAPH_VERCEL_DEPLOY_HOOK_URL || ''}`.trim();
    // Optional overrides for the git-source redeploy fallback. When unset they
    // are inferred from the latest production deployment's metadata.
    this.gitRepoId = `${options.gitRepoId || process.env.GRAPH_VERCEL_GIT_REPO_ID || ''}`.trim();
    this.productionBranch = `${options.productionBranch || process.env.GRAPH_VERCEL_PRODUCTION_BRANCH || 'main'}`.trim();
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

  // Finds the most recent production deployment (with its git metadata) so we
  // can rebuild it even when VERCEL_DEPLOYMENT_ID isn't exposed to the runtime.
  async resolveLatestProductionDeployment() {
    if (!this.apiToken || !this.projectId) {
      return null;
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
        return null;
      }
      const payload = await response.json();
      const deployment = Array.isArray(payload?.deployments) ? payload.deployments[0] : null;
      if (!deployment) {
        return null;
      }
      return {
        id: `${deployment.uid || deployment.id || ''}`.trim(),
        meta: deployment.meta || {}
      };
    } catch (error) {
      return null;
    }
  }

  // Kept for backwards compatibility / callers that only want the id.
  async resolveLatestDeploymentId() {
    const deployment = await this.resolveLatestProductionDeployment();
    return deployment ? deployment.id : '';
  }

  buildRedeployQuery() {
    const params = new URLSearchParams({ forceNew: '1' });
    if (this.teamId) {
      params.set('teamId', this.teamId);
    }
    return params.toString();
  }

  // Creates a fresh production deployment straight from the git source. Unlike
  // cloning a deployment by id, a git-source build always re-reads the current
  // project env vars, so a key saved moments earlier actually takes effect.
  async redeployFromGitSource(latest) {
    const meta = (latest && latest.meta) || {};
    const repoId = this.gitRepoId || `${meta.githubRepoId || meta.githubCommitRepoId || ''}`.trim();
    const ref = this.productionBranch || `${meta.githubCommitRef || 'main'}`.trim();
    if (!repoId) {
      return null;
    }

    const response = await fetch(`https://api.vercel.com/v13/deployments?${this.buildRedeployQuery()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.projectName,
        project: this.projectId,
        target: 'production',
        gitSource: {
          type: 'github',
          repoId: Number.isNaN(Number(repoId)) ? repoId : Number(repoId),
          ref
        }
      })
    });

    if (!response.ok) {
      const payload = await response.text();
      return {
        ok: false,
        message: `${payload.slice(0, 220) || `HTTP ${response.status}`}`
      };
    }
    const payload = await response.json();
    return {
      ok: true,
      strategy: 'redeploy-git-source',
      deployment_id: payload?.id || '',
      deployment_url: payload?.url ? `https://${payload.url}` : ''
    };
  }

  async triggerRedeploy() {
    // Preferred, most reliable path: a project deploy hook rebuilds production
    // (and re-reads env vars) with a single POST and no token juggling.
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

    const latest = await this.resolveLatestProductionDeployment();

    // Fallback: rebuild from the git source of the latest production deploy.
    const gitResult = await this.redeployFromGitSource(latest);
    if (gitResult && gitResult.ok) {
      return {
        triggered: true,
        strategy: gitResult.strategy,
        deployment_id: gitResult.deployment_id,
        deployment_url: gitResult.deployment_url
      };
    }

    return {
      triggered: false,
      strategy: 'manual',
      message: gitResult
        ? `Las variables quedaron guardadas, pero el redeploy automatico fallo: ${gitResult.message}. Configura un deploy hook (GRAPH_VERCEL_DEPLOY_HOOK_URL) o redeploya manualmente.`
        : 'Las variables ya quedaron guardadas en Vercel, pero no se pudo inferir el git source para el redeploy automatico. Configura un deploy hook (GRAPH_VERCEL_DEPLOY_HOOK_URL) o redeploya manualmente.'
    };
  }
}

module.exports = VercelProjectEnvService;
