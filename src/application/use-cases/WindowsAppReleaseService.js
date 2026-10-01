// Distribución de la app de Windows (Ü) desde Provider Studio: dispara un
// build en GitHub Actions del repo windows-app y resuelve el instalador
// vigente, publicado por ese mismo workflow como una RELEASE de ese repo
// (ver windows-app/RELEASING-WINDOWS.md).
//
// ANTES SE LEÍA DE UN BUCKET PÚBLICO DE SUPABASE y por eso la descarga no
// necesitaba credenciales. Aquello no podía funcionar: el plan gratuito corta
// las subidas en 50 MB —tope global, por encima del ajuste del bucket— y el
// paquete pesa 80, así que el bucket estuvo siempre vacío y este endpoint
// respondía 404 «todavía no hay ningún instalador» aunque sí lo hubiera
// (2026-08-16).
//
// El repo es privado, así que ahora la descarga TAMBIÉN necesita el PAT. Pero
// el navegador no lo tiene ni debe tenerlo: se le pide a GitHub la URL firmada
// del asset —que caduca sola y no lleva credenciales— y se le redirige ahí. El
// token no sale nunca del servidor y el enlace público sigue siendo público.
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


  githubHeaders() {
    return {
      Authorization: `Bearer ${this.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  // Best-effort: el bucket no tiene nada publicado hasta el primer release real.
  async readLatestReleaseInfo() {
    if (!this.isConfigured()) return { version: null, assets: [] };
    try {
      const response = await this.fetchImpl(
        `https://api.github.com/repos/${this.repo}/releases/latest`,
        { headers: this.githubHeaders(), cache: 'no-store' }
      );
      if (!response.ok) return { version: null, assets: [] };
      const payload = await response.json();
      const assets = Array.isArray(payload?.assets) ? payload.assets : [];
      return {
        // El tag es `v1.2.3`; fuera la v para que siga siendo comparable con
        // computeNextVersion, que espera SemVer pelado.
        version: `${payload?.tag_name || ''}`.replace(/^v/i, '') || null,
        assets: assets.map((a) => ({ FileName: a?.name, AssetId: a?.id, Size: a?.size }))
      };
    } catch (error) {
      return { version: null, assets: [] };
    }
  }

  // La URL firmada con la que un navegador SIN credenciales puede bajarse un
  // asset de un repo privado. GitHub la entrega como un 302 al pedir el asset
  // con Accept: application/octet-stream; hay que NO seguir el redirect para
  // poder quedarse con el destino, porque es ahí donde va la firma.
  async signedAssetUrl(assetId) {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repo}/releases/assets/${assetId}`,
      {
        headers: { ...this.githubHeaders(), Accept: 'application/octet-stream' },
        redirect: 'manual',
        cache: 'no-store'
      }
    );
    const location = response.headers?.get?.('location');
    if (!location) {
      const error = new Error('GitHub no devolvió el enlace de descarga del instalador.');
      error.statusCode = 502;
      throw error;
    }
    return location;
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

  // EL MENSAJE ES OBLIGATORIO, Y SE COMPRUEBA AQUÍ ANTES DE LLAMAR A GITHUB.
  //
  // El workflow exige `user_message` desde el commit 30259989 (lo que Ü le
  // cuenta a la persona sobre la versión). Este servicio siguió mandando solo
  // `version` y `request_id`, así que GitHub contestaba 422 «Required input
  // 'user_message' not provided» y el botón «Distribuir App» no podía publicar
  // nada: la última release salió a mano el 2026-09-24 (medido el 2026-09-30
  // con un dispatch de prueba en dry-run).
  async triggerBuild({ userMessage } = {}) {
    this.assertConfigured();
    const message = `${userMessage || ''}`.trim();
    if (!message) {
      const error = new Error('Escribe qué trae esta versión: es lo que Ü le contará a cada persona al actualizarse.');
      error.statusCode = 400;
      throw error;
    }
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
          inputs: { version, request_id: requestId, user_message: message }
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
    return { version, url: await this.signedAssetUrl(setupAsset.AssetId) };
  }

  // Distingue builds reales de pruebas dry-run por el tag que el propio
  // workflow escribe en su run-name (ver windows-app/.github/workflows/windows-release.yml),
  // ya que la API de runs de GitHub no expone los inputs del dispatch.
  async getLastBuildStatus() {
    this.assertConfigured();

    const params = new URLSearchParams({ event: 'workflow_dispatch', status: 'success', per_page: '25' });
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repo}/actions/workflows/${this.workflowFile}/runs?${params.toString()}`,
      { headers: this.githubHeaders(), cache: 'no-store' }
    );
    if (!response.ok) {
      const payload = await response.text();
      const error = new Error(`GitHub no devolvió el historial de builds: ${payload.slice(0, 220) || `HTTP ${response.status}`}`);
      error.statusCode = 502;
      throw error;
    }
    const payload = await response.json();
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const lastRealRun = runs.find((run) => `${run?.display_title || ''}`.includes('[real]'));

    if (!lastRealRun) {
      return { lastBuildAt: null, headSha: null, latestMainSha: null, upToDate: null };
    }

    let latestMainSha = null;
    try {
      const branchResponse = await this.fetchImpl(
        `https://api.github.com/repos/${this.repo}/commits/${this.branch}`,
        { headers: this.githubHeaders(), cache: 'no-store' }
      );
      if (branchResponse.ok) {
        const branchPayload = await branchResponse.json();
        latestMainSha = branchPayload?.sha || null;
      }
    } catch (error) {
      latestMainSha = null;
    }

    return {
      lastBuildAt: lastRealRun.updated_at || lastRealRun.run_started_at || null,
      headSha: lastRealRun.head_sha || null,
      latestMainSha,
      upToDate: latestMainSha ? latestMainSha === lastRealRun.head_sha : null
    };
  }
}

module.exports = WindowsAppReleaseService;
