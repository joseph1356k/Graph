const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const path = require('path');

const Neo4jDriver = require('../src/infrastructure/Neo4jDriver');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const PlaywrightRunner = require('../src/infrastructure/PlaywrightRunner');
const VoiceRealtimeGateway = require('../src/infrastructure/VoiceRealtimeGateway');
const Neo4jWorkflowRepository = require('../src/infrastructure/repositories/Neo4jWorkflowRepository');
const MarkdownCatalogWriter = require('../src/infrastructure/file-system/MarkdownCatalogWriter');
const UsageLedgerStore = require('../src/infrastructure/file-system/UsageLedgerStore');

const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');
const WorkflowLearner = require('../src/application/use-cases/WorkflowLearner');
const WorkflowExecutor = require('../src/application/use-cases/WorkflowExecutor');
const AgentChat = require('../src/application/use-cases/AgentChat');
const GeneratePitchArtifacts = require('../src/application/use-cases/GeneratePitchArtifacts');
const ConversationInsights = require('../src/application/use-cases/ConversationInsights');
const SurfaceProfileService = require('../src/application/use-cases/SurfaceProfileService');
const LearningSessionService = require('../src/application/use-cases/LearningSessionService');
const ExecutionIntelligenceService = require('../src/application/use-cases/ExecutionIntelligenceService');
const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
const ClinicalDiagnosisSuggestionService = require('../src/application/use-cases/ClinicalDiagnosisSuggestionService');
const UsageDashboardService = require('../src/application/use-cases/UsageDashboardService');
const GraphProviderConfigService = require('../src/application/use-cases/GraphProviderConfigService');
const registerLearningRoutes = require('./api/registerLearningRoutes');
const registerWorkflowRoutes = require('./api/registerWorkflowRoutes');
const registerContextRoutes = require('./api/registerContextRoutes');
const registerExecutionIntelligenceRoutes = require('./api/registerExecutionIntelligenceRoutes');
const registerVoiceRoutes = require('./api/registerVoiceRoutes');
const registerClinicalRoutes = require('./api/registerClinicalRoutes');
const registerUsageRoutes = require('./api/registerUsageRoutes');
const rateLimit = require('express-rate-limit');
const {
  requireAuth,
  requireAccountAuth,
  attachWorkflowAccess,
  createLocalAdminSession,
  createLocalAnonymousSession,
  extractToken,
  isLocalAnonymousAccessEnabled,
  isAuthBypassEnabled,
  verifyAccessToken
} = require('./api/requireAuth');
const phoneVoiceStore = require('./api/phoneVoiceStore');
const { statusForError, publicErrorMessage } = require('./api/httpErrors');

const GetGraphVisualization = require('../src/application/use-cases/GetGraphVisualization');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env.local'),
  quiet: true
});
require('dotenv').config({ quiet: true });

const app = express();
app.set('trust proxy', process.env.VERCEL ? 1 : false);
const miracleWorkspaceStaticRoot = path.join(__dirname, 'public', 'miracle');

function resolveGeneratedRoot(...segments) {
  const baseRoot = process.env.VERCEL
    ? path.join('/tmp', 'graph-generated')
    : path.join(process.cwd(), 'generated');
  return path.join(baseRoot, ...segments);
}

const db = new Neo4jDriver();
const llmProvider = new LLMProvider();
const playwrightRunner = new PlaywrightRunner();
const repository = new Neo4jWorkflowRepository(db);
const catalogWriter = new MarkdownCatalogWriter();
const usageLedgerStore = new UsageLedgerStore(resolveGeneratedRoot('usage', 'ai-usage-events.jsonl'));
const usageDashboardService = new UsageDashboardService(usageLedgerStore);

const catalogService = new WorkflowCatalog(repository, catalogWriter);
const workflowLearner = new WorkflowLearner(repository, llmProvider, catalogWriter, catalogService);
const workflowExecutor = new WorkflowExecutor(catalogService, playwrightRunner, llmProvider);
const agentChat = new AgentChat(llmProvider, catalogService, workflowExecutor);
const generatePitchArtifacts = new GeneratePitchArtifacts(
  catalogService,
  llmProvider,
  resolveGeneratedRoot('pitch-personalities')
);
const conversationInsights = new ConversationInsights(
  llmProvider,
  resolveGeneratedRoot('conversation-insights')
);
const surfaceProfileService = new SurfaceProfileService(repository, llmProvider);
const learningSessionService = new LearningSessionService(workflowLearner);
const getGraphVisualization = new GetGraphVisualization(repository);
const executionIntelligenceService = new ExecutionIntelligenceService(llmProvider);
const noteFieldMatcher = new NoteFieldMatcher(llmProvider);
const diagnosisSuggestionService = new ClinicalDiagnosisSuggestionService(llmProvider);
const graphProviderConfigService = new GraphProviderConfigService(llmProvider, {
  envPath: path.resolve(__dirname, '..', '.env')
});

app.use(bodyParser.json());

function setAdminSessionCookie(res, accessToken) {
  const secure = Boolean(process.env.VERCEL)
    || `${process.env.NODE_ENV || ''}`.trim().toLowerCase() === 'production';
  const cookieParts = [
    `miracle_admin_session=${encodeURIComponent(accessToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${12 * 60 * 60}`
  ];
  if (secure) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearAdminSessionCookie(res) {
  const secure = Boolean(process.env.VERCEL)
    || `${process.env.NODE_ENV || ''}`.trim().toLowerCase() === 'production';
  const cookieParts = [
    'miracle_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

const ALLOWED_ORIGINS = `${process.env.ALLOWED_ORIGINS || ''}`
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin, curl, or native apps (no Origin header)
  if (ALLOWED_ORIGINS.length === 0) {
    return !process.env.VERCEL
      && `${process.env.NODE_ENV || ''}`.trim().toLowerCase() !== 'production';
  }
  return ALLOWED_ORIGINS.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.get('origin') || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Graph-Voice-Context, X-Graph-Voice-History, X-Graph-Phone-Session-Id, X-Graph-Phone-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

async function requireProtectedPageSession(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.redirect(`/index.html?next=${encodeURIComponent(req.originalUrl || req.url || '/provider-studio.html')}`);
  }
  try {
    await verifyAccessToken(token);
    return next();
  } catch (error) {
    return res.redirect(`/index.html?next=${encodeURIComponent(req.originalUrl || req.url || '/provider-studio.html')}`);
  }
}

app.use([
  '/provider-studio.html',
  '/emr-workspace.html',
  '/visualize.html',
  '/usage-dashboard.html',
  '/miracle',
  '/miracle/voice-lab'
], requireProtectedPageSession);

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/examples/medical-demo', (req, res) => {
  res.redirect('/index.html');
});

app.get('/miracle', (req, res) => {
  res.sendFile(path.join(miracleWorkspaceStaticRoot, 'index.html'));
});

app.get('/miracle/voice-lab', (req, res) => {
  res.sendFile(path.join(miracleWorkspaceStaticRoot, 'voice.html'));
});

app.use('/miracle', express.static(miracleWorkspaceStaticRoot));

app.use(express.static('web/public'));

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Rate limiting: a generous backstop on all /api, and a stricter cap on the
// endpoints that spend OpenAI/LLM credits.
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const costlyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);

app.post('/api/auth/local-anonymous', (req, res) => {
  if (!isLocalAnonymousAccessEnabled()) {
    return res.status(404).json({ error: 'El acceso invitado local no esta habilitado.' });
  }
  return res.json(createLocalAnonymousSession());
});

app.post('/api/auth/local-admin/login', (req, res) => {
  try {
    const session = createLocalAdminSession(req.body?.username || '', req.body?.password || '');
    setAdminSessionCookie(res, session.accessToken);
    return res.json(session);
  } catch (error) {
    return res.status(401).json({ error: error.message || 'No fue posible iniciar sesion.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAdminSessionCookie(res);
  return res.json({ ok: true });
});

async function probeSupabaseAuth(timeoutMs = 1500) {
  const baseUrl = `${process.env.SUPABASE_URL || ''}`.replace(/\/+$/, '');
  if (!baseUrl) {
    return { status: 'not_configured' };
  }
  try {
    const response = await fetch(`${baseUrl}/auth/v1/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return {
      status: 'ok',
      httpStatus: response.status
    };
  } catch (error) {
    return { status: 'unavailable' };
  }
}

app.get('/api/auth/status', async (req, res) => {
  if (isAuthBypassEnabled(req)) {
    return res.status(200).json({
      supabase: { status: 'bypassed' },
      localAnonymousAccess: false,
      authBypassEnabled: true,
      localAdminAuthEnabled: true
    });
  }

  const supabase = await probeSupabaseAuth();
  res.status(supabase.status === 'ok' ? 200 : 503).json({
    supabase,
    localAnonymousAccess: isLocalAnonymousAccessEnabled(),
    authBypassEnabled: false,
    localAdminAuthEnabled: true
  });
});


// Require a real account for workflow-bearing APIs. Anonymous demo sessions can
// still load static pages, but they cannot read or mutate workflow data.
app.use('/api/voice/openai', costlyLimiter);
app.use('/api/voice/stream-session', costlyLimiter);
app.use('/api/voice/orchestrator/events', costlyLimiter);
app.use('/api/workflows/:id/note-field-matches', costlyLimiter);
app.use('/api/clinical/diagnosis-suggestions', costlyLimiter);
app.use('/api/voice/openai/session', async (req, res, next) => {
  const phoneSessionId = `${req.get('x-graph-phone-session-id') || ''}`.trim();
  const phoneToken = `${req.get('x-graph-phone-token') || ''}`.trim();
  if (!phoneSessionId && !phoneToken) {
    return next();
  }
  try {
    const session = await phoneVoiceStore.verifyPhoneVoiceToken(phoneSessionId, phoneToken);
    req.phoneVoiceSession = session;
    req.user = {
      id: session.ownerId,
      email: session.ownerEmail,
      role: 'phone-pairing',
      token: '',
      isAnonymous: false
    };
    req.workflowAccess = {
      ownerId: session.ownerId,
      includeGlobal: true,
      canManageGlobalWorkflows: false
    };
    return next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({ error: error.message || 'No autorizado.' });
  }
});
app.use('/api/voice/phone-session/:id/events', async (req, res, next) => {
  if (req.method !== 'POST') {
    return next();
  }
  const phoneToken = `${req.get('x-graph-phone-token') || ''}`.trim();
  if (!phoneToken) {
    return res.status(401).json({ error: 'Missing phone microphone token.' });
  }
  try {
    const session = await phoneVoiceStore.verifyPhoneVoiceToken(req.params.id, phoneToken);
    req.phoneVoiceSession = session;
    req.user = {
      id: session.ownerId,
      email: session.ownerEmail,
      role: 'phone-pairing',
      token: '',
      isAnonymous: false
    };
    req.workflowAccess = {
      ownerId: session.ownerId,
      includeGlobal: true,
      canManageGlobalWorkflows: false
    };
    return next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({ error: error.message || 'No autorizado.' });
  }
});
function isMiracleMedicalProxyRequest(req) {
  const method = `${req.method || ''}`.toUpperCase();
  const path = `${req.originalUrl || req.path || req.url || ''}`.split('?')[0];
  return method === 'POST'
    && (path === '/api/voice/stream-session' || path === '/api/voice/orchestrator/events');
}

[
  '/api/voice',
  '/api/clinical',
  '/api/usage'
].forEach((routePrefix) => {
  app.use(routePrefix, (req, res, next) => {
    if (req.phoneVoiceSession) {
      return next();
    }
    if (isMiracleMedicalProxyRequest(req)) {
      req.user = {
        id: 'miracle-medical-demo',
        email: '',
        role: 'medical-demo',
        token: '',
        isAnonymous: true
      };
      req.workflowAccess = {
        ownerId: req.user.id,
        includeGlobal: true,
        canManageGlobalWorkflows: false
      };
      return next();
    }
    return requireAuth(req, res, () => attachWorkflowAccess(req, res, next));
  });
});
[
  '/api/status',
  '/api/reset',
  '/api/step',
  '/api/workflow',
  '/api/workflows',
  '/api/agent',
  '/api/pitch',
  '/api/surface-profile',
  '/api/account',
  '/api/visualize',
  '/api/providers'
].forEach((routePrefix) => {
  app.use(routePrefix, requireAccountAuth, attachWorkflowAccess);
});

const DEFAULT_MIRACLE_MEDICAL_ENGINE_URL = 'https://miracle-ai-t0dn.onrender.com';
const DEFAULT_MIRACLE_WORKSPACE_URL = 'https://miracle-ai-one.vercel.app';

function resolveMiracleMedicalEngineUrl() {
  return `${process.env.MIRACLE_MEDICAL_ENGINE_URL || process.env.MIRACLE_BASE_URL || DEFAULT_MIRACLE_MEDICAL_ENGINE_URL}`.replace(/\/+$/, '');
}

function resolveMiracleWorkspaceUrl() {
  return DEFAULT_MIRACLE_WORKSPACE_URL;
}

function resolvePublicAppBaseUrl(req) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  return `${process.env.PUBLIC_BASE_URL || `${protocol}://${req.get('host') || ''}`}`.replace(/\/+$/, '');
}

app.get('/api/public-config', (req, res) => {
  const miracleBaseUrl = resolvePublicAppBaseUrl(req);
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    localAnonymousAccess: isLocalAnonymousAccessEnabled(),
    authBypassEnabled: isAuthBypassEnabled(req),
    miracleBaseUrl,
    phoneMicrophoneAvailable: Boolean(
      (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL)
      && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
    ),
    voiceGatewayUrl: process.env.VOICE_GATEWAY_URL || ''
  });
});

async function probeMiracleSidecar(timeoutMs = 1500) {
  const baseUrl = resolveMiracleMedicalEngineUrl();
  if (!baseUrl) {
    return { status: 'not_configured' };
  }

  try {
    const response = await fetch(`${baseUrl}/api/setup/status`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    return {
      status: response.ok ? 'ok' : 'unavailable',
      httpStatus: response.status
    };
  } catch (error) {
    return { status: 'unavailable' };
  }
}

async function proxyMiracleMedicalRequest(req, res, path, init = {}) {
  const baseUrl = resolveMiracleMedicalEngineUrl();
  try {
    const upstreamResponse = await fetch(`${baseUrl}${path}`, {
      method: init.method || req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {})
      },
      body: init.body
    });
    const payloadText = await upstreamResponse.text();
    let payload = {};
    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (error) {
        payload = { message: payloadText };
      }
    }
    if (!upstreamResponse.ok) {
      return res.status(upstreamResponse.status).json({
        error: payload?.error || payload?.message || 'Miracle medical engine request failed'
      });
    }
    return res.status(upstreamResponse.status).json(payload);
  } catch (error) {
    console.error(`[Miracle Proxy] ${path} failed: ${error.message}`);
    return res.status(502).json({ error: 'Miracle medical engine unavailable' });
  }
}

function buildMiracleProxyRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (typeof req.body === 'undefined' || req.body === null) {
    return undefined;
  }
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body);
}

async function proxyMiracleWorkspaceRequest(req, res) {
  const baseUrl = resolveMiracleWorkspaceUrl();
  const upstreamPath = req.originalUrl.replace(/^\/api\/miracle/, '/api');
  const headers = {};
  const contentType = req.get('content-type');
  const accept = req.get('accept');

  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (accept) {
    headers.Accept = accept;
  }

  try {
    const upstreamResponse = await fetch(`${baseUrl}${upstreamPath}`, {
      method: req.method,
      headers,
      body: buildMiracleProxyRequestBody(req)
    });
    const payloadText = await upstreamResponse.text();
    const upstreamContentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';
    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', upstreamContentType);
    return res.send(payloadText);
  } catch (error) {
    console.error(`[Miracle Workspace Proxy] ${upstreamPath} failed: ${error.message}`);
    return res.status(502).json({ error: 'Miracle workspace unavailable' });
  }
}

app.post('/api/voice/stream-session', async (req, res) => {
  await proxyMiracleMedicalRequest(req, res, '/api/voice/stream-session', {
    method: 'POST'
  });
});

app.post('/api/voice/orchestrator/events', async (req, res) => {
  await proxyMiracleMedicalRequest(req, res, '/api/voice/orchestrator/events', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  });
});

app.use('/api/miracle', async (req, res) => {
  await proxyMiracleWorkspaceRequest(req, res);
});

app.get('/api/health', async (req, res) => {
  const [neo4j, miracle, supabase] = await Promise.all([
    db.healthCheck(),
    probeMiracleSidecar(),
    probeSupabaseAuth()
  ]);
  const authBypassEnabled = isAuthBypassEnabled();
  const degraded = neo4j.status !== 'ok'
    || (miracle.status !== 'ok' && miracle.status !== 'not_configured')
    || (!authBypassEnabled && supabase.status !== 'ok' && supabase.status !== 'not_configured');
  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    services: {
      server: { status: 'ok' },
      neo4j,
      miracle,
      llm: {
        status: llmProvider.hasApiKey() ? 'configured' : 'not_configured',
        provider: llmProvider.provider || '',
        model: llmProvider.model || ''
      },
      supabase,
      auth: {
        status: authBypassEnabled ? 'bypassed' : 'enabled'
      }
    }
  });
});

app.get('/api/account/me', (req, res) => {
  res.json({
    user: {
      id: req.user?.id || '',
      email: req.user?.email || '',
      role: req.user?.role || ''
    },
    permissions: {
      canManageGlobalWorkflows: Boolean(req.workflowAccess?.canManageGlobalWorkflows)
    }
  });
});

app.get('/api/providers/graph/status', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  return res.json(graphProviderConfigService.status());
});

app.post('/api/providers/graph/configure', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(graphProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el provider de Graph.'
    });
  }
});

registerLearningRoutes(app, { learningSessionService });
registerWorkflowRoutes(app, { catalogService, workflowExecutor, noteFieldMatcher, usageDashboardService });
registerContextRoutes(app, {
  generatePitchArtifacts,
  conversationInsights,
  catalogService,
  surfaceProfileService
});
registerExecutionIntelligenceRoutes(app, { catalogService, executionIntelligenceService });
registerVoiceRoutes(app, {
  express,
  agentChat,
  catalogService,
  phoneVoiceStore
});
registerClinicalRoutes(app, { diagnosisSuggestionService });
registerUsageRoutes(app, { usageDashboardService });

app.post('/api/agent/chat', costlyLimiter, async (req, res) => {
  try {
    const response = await agentChat.handleMessage(
        req.body?.message,
        req.body?.history,
        req.body?.context || {},
      {
        executionMode: req.body?.executionMode || 'browser',
        workflowAccess: req.workflowAccess || null
      }
    );
    res.json(response);
  } catch (err) {
    console.error(`[Agent Chat] Error: ${err.message}`);
    res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
  }
});

app.get('/api/visualize', async (req, res) => {
  try {
    const data = await getGraphVisualization.execute(req.workflowAccess || null);
    console.log(`[Visualize] Returning ${data.nodes.length} nodes and ${data.edges.length} edges`);
    res.json(data);
  } catch (err) {
    console.error(`[Visualize] Error: ${err.message}`);
    res.status(statusForError(err)).send(publicErrorMessage(err));
  }
});

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
app.set('port', PORT);

function startServer() {
  const server = http.createServer(app);
  const voiceGateway = new VoiceRealtimeGateway({
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    llmProvider,
    catalogService,
    agentChat,
    conversationInsights
  });
  voiceGateway.attach(server);
  server.listen(PORT, () => console.log(`[Server] Running on http://localhost:${PORT}`));
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
