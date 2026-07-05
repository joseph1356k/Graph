const net = require('net');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env.local'),
  quiet: true
});
require('dotenv').config({ quiet: true });

const checks = [];

function addCheck(name, status, detail) {
  checks.push({ name, status, detail });
}

function envValue(name) {
  return `${process.env[name] || ''}`.trim();
}

function isPlaceholder(value) {
  return /placeholder|change_me|your[_-]|example/i.test(`${value || ''}`);
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(`${value || ''}`.trim().toLowerCase());
}

async function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function auditNeo4j() {
  const rawUri = envValue('NEO4J_URI');
  const password = envValue('NEO4J_PASSWORD');
  if (!rawUri) {
    addCheck('Neo4j config', 'FAIL', 'NEO4J_URI is missing.');
    return;
  }
  if (!password || isPlaceholder(password)) {
    addCheck('Neo4j credentials', 'FAIL', 'NEO4J_PASSWORD is missing or still a placeholder.');
  } else {
    addCheck('Neo4j credentials', 'PASS', 'Neo4j credentials are configured.');
  }

  try {
    const uri = new URL(rawUri);
    const port = Number(uri.port || 7687);
    const reachable = await canConnect(uri.hostname, port);
    addCheck('Neo4j connectivity', reachable ? 'PASS' : 'FAIL',
      reachable ? `${uri.hostname}:${port} accepts connections.` : `${uri.hostname}:${port} is unreachable.`);
  } catch (error) {
    addCheck('Neo4j connectivity', 'FAIL', 'NEO4J_URI is invalid.');
  }
}

async function auditMiracleSidecar() {
  const baseUrl = envValue('MIRACLE_MEDICAL_ENGINE_URL').replace(/\/+$/, '');
  if (!baseUrl) {
    addCheck('Miracle sidecar', 'WARN', 'MIRACLE_MEDICAL_ENGINE_URL is not configured.');
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/api/setup/status`, {
      signal: AbortSignal.timeout(2000)
    });
    addCheck('Miracle sidecar', response.ok ? 'PASS' : 'FAIL', `Setup endpoint returned HTTP ${response.status}.`);
  } catch (error) {
    addCheck('Miracle sidecar', 'FAIL', 'The configured sidecar is unreachable.');
  }
}

function auditStaticConfiguration() {
  addCheck('OpenAI', envValue('OPENAI_API_KEY') ? 'PASS' : 'FAIL',
    envValue('OPENAI_API_KEY') ? 'OPENAI_API_KEY is available.' : 'OPENAI_API_KEY is missing.');

  const publicBaseUrl = envValue('PUBLIC_BASE_URL');
  addCheck('Public URL', publicBaseUrl ? 'PASS' : 'WARN',
    publicBaseUrl ? 'PUBLIC_BASE_URL is configured.' : 'PUBLIC_BASE_URL is missing; public absolute URLs are local-only.');

  const allowedOrigins = envValue('ALLOWED_ORIGINS');
  addCheck('CORS allowlist', allowedOrigins ? 'PASS' : 'WARN',
    allowedOrigins ? 'ALLOWED_ORIGINS is configured.' : 'ALLOWED_ORIGINS is empty and development CORS is permissive.');

  const localAnonymous = isTruthy(envValue('ALLOW_LOCAL_ANONYMOUS'));
  addCheck('Local guest mode', localAnonymous ? 'WARN' : 'PASS',
    localAnonymous ? 'Local guest mode is enabled; keep NODE_ENV=production in deployments.' : 'Local guest mode is disabled.');
}

async function main() {
  auditStaticConfiguration();
  await Promise.all([
    auditNeo4j(),
    auditMiracleSidecar()
  ]);

  const rank = { FAIL: 0, WARN: 1, PASS: 2 };
  checks.sort((left, right) => rank[left.status] - rank[right.status] || left.name.localeCompare(right.name));
  console.table(checks);

  const failures = checks.filter((check) => check.status === 'FAIL').length;
  const warnings = checks.filter((check) => check.status === 'WARN').length;
  console.log(`Readiness summary: ${failures} failure(s), ${warnings} warning(s), ${checks.length} checks.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Readiness audit failed: ${error.message}`);
  process.exitCode = 1;
});
