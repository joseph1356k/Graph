// Distribución de la app de Windows (Ü) desde Provider Studio: dispara un
// build en GitHub Actions del repo windows-app y resuelve el instalador
// vigente, publicado por ese mismo workflow en el bucket público de Supabase
// (windows/releases.win.json vía `vpk upload s3`, ver windows-app/RELEASING-WINDOWS.md).
// El repo de GitHub es privado, así que solo el trigger/polling usan el PAT;
// la descarga en sí lee el bucket público sin credenciales.
const crypto = require('crypto');

class WindowsAppReleaseService {
  constructor(options = {}) {
    this.githubToken = `${options.githubToken || process.env.WINDOWS_APP_GITHUB_TOKEN || ''}`.trim();
    this.repo = `${options.repo || process.env.WINDOWS_APP_GITHUB_REPO || ''}`.trim();
    this.workflowFile = `${options.workflowFile || process.env.WINDOWS_APP_GITHUB_WORKFLOW_FILE || 'windows-release.yml'}`.trim();
    this.branch = `${options.branch || process.env.WINDOWS_APP_GITHUB_BRANCH || 'main'}`.trim();
    this.supabaseUrl = `${options.supabaseUrl || process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || ''}`.trim().replace(/\/+$/, '');
    this.fetchImpl = options.fetch || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.githubToken && this.repo);
  }

  assertConfigured() {
    if (this.isConfigured()) return;
    const error = new Error('Falta configurar WINDOWS_APP_GITHUB_TOKEN o WINDOWS_APP_GITHUB_REPO en el servidor para distribuir builds de Windows.');
    error.statusCode = 503;
    throw error;
  }

  releasesFeedUrl() {
    if (!this.supabaseUrl) {
      const error = new Error('Falta configurar SUPABASE_URL en el servidor.');
      error.statusCode = 503;
      throw error;
    }
    return `${this.supabaseUrl}/storage/v1/object/public/windows/releases.win.json`;
  }

  githubHeaders() {
    return {
      Authorization: `Bearer ${this.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  // Best-effort: el bucket no tiene nada publicado hasta el primer release real.
  async readLatestReleaseInfo() {
    try {
      const response = await this.fetchImpl(this.releasesFeedUrl(), { cache: 'no-store' });
      if (!response.ok) {
        return { version: null, assets: [] };
      }
      const payload = await response.json();
      const assets = Array.isArray(payload?.Assets) ? payload.Assets : [];
      const current = assets.find((asset) => asset?.Version === payload?.CurrentReleaseVersion) || assets[assets.length - 1] || null;
      return {
        version: current?.Version || payload?.CurrentReleaseVersion || null,
        assets
      };
    } catch (error) {
      return { version: null, assets: [] };
    }
  }

  computeNextVersion(currentVersion) {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(`${currentVersion || ''}`.trim());
    if (!match) {
      return '1.0.0';
    }
    const [, major, minor, patch] = match;
    return `${major}.${minor}.${Number(patch) + 1}`;
  }

  async status() {
    const { version } = await this.readLatestReleaseInfo();
    return {
      configured: this.isConfigured(),
      repo: this.repo,
      current_version: version
    };
  }

  async triggerBuild() {
    this.assertConfigured();
    const { version: currentVersion } = await this.readLatestReleaseInfo();
    const version = this.computeNextVersion(currentVersion);
    const requestId = crypto.randomUUID();

    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: { ...this.githubHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: this.branch,
          inputs: { version, request_id: requestId }
        })
      }
    );

    if (!response.ok) {
      const payload = await response.text();
      const error = new Error(`GitHub no aceptó el build: ${payload.slice(0, 220) || `HTTP ${response.status}`}`);
      error.statusCode = 502;
      throw error;
    }

    return { requestId, version, dispatchedAt: Date.now() };
  }

  async pollBuildStatus(requestId) {
    this.assertConfigured();
    if (!requestId) {
      const error = new Error('Falta request_id.');
      error.statusCode = 400;
      throw error;
    }

    const params = new URLSearchParams({ event: 'workflow_dispatch', per_page: '15' });
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repo}/actions/workflows/${this.workflowFile}/runs?${params.toString()}`,
      { headers: this.githubHeaders(), cache: 'no-store' }
    );

    if (!response.ok) {
      const payload = await response.text();
      const error = new Error(`GitHub no devolvió el estado del build: ${payload.slice(0, 220) || `HTTP ${response.status}`}`);
      error.statusCode = 502;
      throw error;
    }

    const payload = await response.json();
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const run = runs.find((candidate) => `${candidate?.display_title || ''}`.includes(requestId));

    if (!run) {
      return { phase: 'queued', runUrl: null };
    }
    if (run.status !== 'completed') {
      return { phase: run.status === 'queued' ? 'queued' : 'running', runUrl: run.html_url };
    }
    return {
      phase: run.conclusion === 'success' ? 'success' : 'failure',
      runUrl: run.html_url
    };
  }

  async getLatestInstallerUrl() {
    const { version, assets } = await this.readLatestReleaseInfo();
    const setupAsset = assets.find((asset) => /setup/i.test(asset?.FileName || '') && /\.exe$/i.test(asset?.FileName || ''));
    if (!version || !setupAsset) {
      const error = new Error('Todavía no hay ningún instalador de Windows distribuido.');
      error.statusCode = 404;
      throw error;
    }
    return {
      version,
      url: `${this.supabaseUrl}/storage/v1/object/public/windows/${setupAsset.FileName}`
    };
  }
}

module.exports = WindowsAppReleaseService;
