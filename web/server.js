const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const path = require('path');

const Neo4jDriver = require('../src/infrastructure/Neo4jDriver');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const Neo4jWorkflowRepository = require('../src/infrastructure/repositories/Neo4jWorkflowRepository');
// Clinical module (stateful, Supabase-backed) — isolated behind /api/clinical.
const SupabaseRestClient = require('../src/infrastructure/SupabaseRestClient');
const SupabaseClinicalTemplateRepository = require('../src/infrastructure/repositories/SupabaseClinicalTemplateRepository');
const SupabaseClinicalEncounterRepository = require('../src/infrastructure/repositories/SupabaseClinicalEncounterRepository');
const MarkdownCatalogWriter = require('../src/infrastructure/file-system/MarkdownCatalogWriter');
const UsageLedgerStore = require('../src/infrastructure/file-system/UsageLedgerStore');

const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');
const WorkflowLearner = require('../src/application/use-cases/WorkflowLearner');
const WorkflowExecutor = require('../src/application/use-cases/WorkflowExecutor');
const AgentChat = require('../src/application/use-cases/AgentChat');
const SurfaceProfileService = require('../src/application/use-cases/SurfaceProfileService');
const LearningSessionService = require('../src/application/use-cases/LearningSessionService');
const ExecutionIntelligenceService = require('../src/application/use-cases/ExecutionIntelligenceService');
const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
const ClinicalDiagnosisSuggestionService = require('../src/application/use-cases/ClinicalDiagnosisSuggestionService');
const ClinicalRawTranscriptionService = require('../src/application/use-cases/ClinicalRawTranscriptionService');
const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');
const ClinicalEncounterService = require('../src/application/use-cases/ClinicalEncounterService');
const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const UsageDashboardService = require('../src/application/use-cases/UsageDashboardService');
const GraphProviderConfigService = require('../src/application/use-cases/GraphProviderConfigService');
const MiracleProductLlmProviderConfigService = require('../src/application/use-cases/MiracleProductLlmProviderConfigService');
const MiracleSttProviderConfigService = require('../src/application/use-cases/MiracleSttProviderConfigService');
const MiracleAssistantProviderConfigService = require('../src/application/use-cases/MiracleAssistantProviderConfigService');
const BiopsyPhotoProviderConfigService = require('../src/application/use-cases/BiopsyPhotoProviderConfigService');
const BiopsyExtractionService = require('../src/application/use-cases/BiopsyExtractionService');
const ApiKeyService = require('../src/application/use-cases/ApiKeyService');
const AndroidPanelService = require('../src/application/use-cases/AndroidPanelService');
// Módulo Windows App (agente de escritorio Ü, absorbido del backend viejo de
// Vercel Functions): cerebro consciente + enseñanza por video + sus tarjetas.
const AgentTurnService = require('../src/application/use-cases/AgentTurnService');
const TeachVideoService = require('../src/application/use-cases/TeachVideoService');
const ConsciousProviderConfigService = require('../src/application/use-cases/ConsciousProviderConfigService');
const TeachVideoProviderConfigService = require('../src/application/use-cases/TeachVideoProviderConfigService');
const SupabaseAgentMemoryRepository = require('../src/infrastructure/repositories/SupabaseAgentMemoryRepository');
const registerLearningRoutes = require('./api/registerLearningRoutes');
const registerWorkflowRoutes = require('./api/registerWorkflowRoutes');
const registerContextRoutes = require('./api/registerContextRoutes');
const registerExecutionIntelligenceRoutes = require('./api/registerExecutionIntelligenceRoutes');
const registerClinicalRoutes = require('./api/registerClinicalRoutes');
const registerMedicalRoutes = require('./api/registerMedicalRoutes');
const registerUsageRoutes = require('./api/registerUsageRoutes');
const registerPublicApiRoutes = require('./api/registerPublicApiRoutes');
const registerAndroidPanelRoutes = require('./api/registerAndroidPanelRoutes');
const registerWindowsAgentRoutes = require('./api/registerWindowsAgentRoutes');
const requireClinicalAuth = require('./api/requireClinicalAuth');
const MiracleWorkspaceStore = require('./api/miracleWorkspaceStore');
const rateLimit = require('express-rate-limit');
const {
  requireAuth,
  requireAccountAuth,
  requireApiKey,
  attachWorkflowAccess,
  createLocalAdminSession,
  createLocalAnonymousSession,
  extractToken,
  isLocalAnonymousAccessEnabled,
  isAuthBypassEnabled,
  verifyAccessToken
} = require('./api/requireAuth');
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
// Independent provider for the clinical assistant chat (Provider Studio card
// "Asistente"): its own MIRACLE_ASSISTANT_LLM_* env vars, decoupled from
// Graph's field-matching provider above.
const assistantLlmProvider = new LLMProvider('MIRACLE_ASSISTANT');
// Independent provider for the lab/biopsy photo reader (Provider Studio card
// "Biopsia"): its own MIRACLE_BIOPSY_LLM_* env vars, a vision-capable model
// decoupled from the assistant and field-matching providers above.
const biopsyLlmProvider = new LLMProvider('MIRACLE_BIOPSY');
const repository = new Neo4jWorkflowRepository(db);
const catalogWriter = new MarkdownCatalogWriter();
const usageLedgerStore = new UsageLedgerStore(resolveGeneratedRoot('usage', 'ai-usage-events.jsonl'));
const usageDashboardService = new UsageDashboardService(usageLedgerStore);

const catalogService = new WorkflowCatalog(repository, catalogWriter);
const workflowLearner = new WorkflowLearner(repository, llmProvider, catalogWriter, catalogService);
const workflowExecutor = new WorkflowExecutor(catalogService);
const agentChat = new AgentChat(llmProvider, catalogService, workflowExecutor);
const surfaceProfileService = new SurfaceProfileService(repository, llmProvider);
const learningSessionService = new LearningSessionService(workflowLearner);
const getGraphVisualization = new GetGraphVisualization(repository);
const executionIntelligenceService = new ExecutionIntelligenceService(llmProvider);
const noteFieldMatcher = new NoteFieldMatcher(llmProvider);
const diagnosisSuggestionService = new ClinicalDiagnosisSuggestionService(llmProvider);
const rawTranscriptionService = new ClinicalRawTranscriptionService();
// Clinical module wiring: note generation reuses the shared Graph LLMProvider
// (engine capability, not duplicated); the assistant chat gets its own
// (assistantLlmProvider, above). Persistence is isolated in the Supabase REST
// client + repos.
const supabaseRestClient = new SupabaseRestClient();
const clinicalTemplateRepository = new SupabaseClinicalTemplateRepository(supabaseRestClient);
const clinicalEncounterRepository = new SupabaseClinicalEncounterRepository(supabaseRestClient);
const clinicalTemplateService = new ClinicalTemplateService(clinicalTemplateRepository);
const clinicalEncounterService = new ClinicalEncounterService(clinicalEncounterRepository, clinicalTemplateService);
const clinicalNoteValidationService = new ClinicalNoteValidationService();
const clinicalNoteGeneratorService = new ClinicalNoteGeneratorService({
  encounterService: clinicalEncounterService,
  encounterRepository: clinicalEncounterRepository,
  llmProvider,
  promptBuilder: new ClinicalNotePromptBuilder(),
  validationService: clinicalNoteValidationService
});
const clinicalAssistantService = new ClinicalAssistantService({
  encounterService: clinicalEncounterService,
  llmProvider: assistantLlmProvider,
  promptBuilder: new ClinicalAssistantPromptBuilder(),
  validationService: new ClinicalAssistantValidationService(),
  noteValidationService: clinicalNoteValidationService
});
const graphProviderConfigService = new GraphProviderConfigService(llmProvider);
const miracleProductLlmProviderConfigService = new MiracleProductLlmProviderConfigService();
const miracleSttProviderConfigService = new MiracleSttProviderConfigService();
const miracleAssistantProviderConfigService = new MiracleAssistantProviderConfigService(assistantLlmProvider);
const biopsyExtractionService = new BiopsyExtractionService({ llmProvider: biopsyLlmProvider });
const miracleBiopsyProviderConfigService = new BiopsyPhotoProviderConfigService(biopsyLlmProvider);
const apiKeyService = new ApiKeyService();
// Android panel (Provider Studio): telemetry + distributed client config,
// same Supabase project/service-role client as the clinical module.
const androidPanelService = new AndroidPanelService(supabaseRestClient);
// Agente de escritorio Ü (Windows App): la memoria por usuario vive en Supabase
// (tabla graph_agent_memory, con fallback en memoria del proceso si Supabase no
// está configurado) y la comparten el bucle de turnos y la enseñanza por video
// — exactamente el acoplamiento que tenía el backend viejo con su MemoryStore.
const agentMemoryRepository = new SupabaseAgentMemoryRepository(supabaseRestClient);
const agentTurnService = new AgentTurnService({ memoryRepository: agentMemoryRepository });
const teachVideoService = new TeachVideoService({
  memoryRepository: agentMemoryRepository,
  supabaseRestClient
});
const consciousProviderConfigService = new ConsciousProviderConfigService();
const teachVideoProviderConfigService = new TeachVideoProviderConfigService();
const miracleWorkspaceStore = new MiracleWorkspaceStore();

app.use(bodyParser.json({ limit: '16mb' }));

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

app.get('/api/auth/status', async (req, res) => {
  res.status(200).json({
    localAnonymousAccess: isLocalAnonymousAccessEnabled(),
    authBypassEnabled: isAuthBypassEnabled(req),
    localAdminAuthEnabled: true
  });
});


// Require a real account for workflow-bearing APIs. Anonymous demo sessions can
// still load static pages, but they cannot read or mutate workflow data.
app.use('/api/voice/stream-session', costlyLimiter);
app.use('/api/voice/orchestrator/events', costlyLimiter);
app.use('/api/medical', costlyLimiter);
app.use('/api/workflows/:id/note-field-matches', costlyLimiter);
app.use('/api/clinical/diagnosis-suggestions', costlyLimiter);
app.use('/api/clinical/encounters/:encounterId/generate-note', costlyLimiter);
app.use('/api/clinical/encounters/:encounterId/diagnostic-suggestions', costlyLimiter);
app.use('/api/clinical/assistant', costlyLimiter);
app.use('/api/v1/pipeline', costlyLimiter);
app.use('/api/v1/autofill/match', costlyLimiter);
app.use('/api/v1/biopsy/extract', costlyLimiter);
app.use('/api/providers/biopsy/test-extract', costlyLimiter);
function isMiracleMedicalProxyRequest(req) {
  const method = `${req.method || ''}`.toUpperCase();
  const path = `${req.originalUrl || req.path || req.url || ''}`.split('?')[0];
  return method === 'POST'
    && (path === '/api/voice/stream-session' || path === '/api/voice/orchestrator/events');
}

// Local/session auth for stateless surfaces. NOTE: /api/clinical is intentionally
// scoped to only the pre-existing diagnosis-suggestions endpoint; the stateful
// clinical routes (templates/encounters) use Supabase auth (requireClinicalAuth)
// and must NOT go through this local auth.
[
  '/api/voice',
  '/api/clinical/diagnosis-suggestions',
  '/api/usage'
].forEach((routePrefix) => {
  app.use(routePrefix, (req, res, next) => {
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

// Stateful clinical module: Supabase Bearer auth, isolated from the surfaces
// above and from /api/v1. Sets req.clinicalUser (never req.user).
// '/api/clinical/encounters' also covers the nested diagnostic-suggestions route.
[
  '/api/clinical/templates',
  '/api/clinical/encounters',
  '/api/clinical/assistant'
].forEach((routePrefix) => {
  app.use(routePrefix, requireClinicalAuth);
});
[
  '/api/status',
  '/api/reset',
  '/api/step',
  '/api/workflow',
  '/api/workflows',
  '/api/agent',
  '/api/surface-profile',
  '/api/tree',
  '/api/file',
  '/api/files',
  '/api/session',
  '/api/context',
  '/api/history-change',
  '/api/product-llm',
  '/api/setup/product-llm',
  '/api/medical',
  '/api/account',
  '/api/visualize',
  '/api/providers',
  '/api/android'
].forEach((routePrefix) => {
  app.use(routePrefix, requireAccountAuth, attachWorkflowAccess);
});

// Public API surface: authenticated only with a permanent client API key
// (MIRACLE_API_KEYS). No session-token fallback.
app.use('/api/v1', requireApiKey);

function resolvePublicAppBaseUrl(req) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  return `${process.env.PUBLIC_BASE_URL || `${protocol}://${req.get('host') || ''}`}`.replace(/\/+$/, '');
}

function resolveMiracleRuntimeUrl(req) {
  const configured = `${process.env.MIRACLE_RUNTIME_URL || ''}`.trim().replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  if (process.env.VERCEL) {
    return `${resolvePublicAppBaseUrl(req)}/api/miracle-runtime`;
  }
  return '';
}

function extractQueryString(req) {
  const original = `${req.originalUrl || req.url || ''}`;
  const queryIndex = original.indexOf('?');
  return queryIndex >= 0 ? original.slice(queryIndex) : '';
}

app.get('/api/public-config', (req, res) => {
  const miracleBaseUrl = resolvePublicAppBaseUrl(req);
  res.json({
    localAnonymousAccess: isLocalAnonymousAccessEnabled(),
    authBypassEnabled: isAuthBypassEnabled(req),
    miracleBaseUrl,
  });
});

async function proxyMiracleRuntimeRequest(req, res, targetPath, init = {}) {
  try {
    const response = await callMiracleRuntime(req, targetPath, {
      ...init,
      method: init.method || req.method,
      body: typeof init.body !== 'undefined' ? init.body : buildMiracleProxyRequestBody(req)
    });
    return res.status(response.statusCode).json(response.body);
  } catch (error) {
    if (error.code === 'MIRACLE_RUNTIME_NOT_CONFIGURED') {
      return false;
    }
    console.error(`[Miracle Runtime Proxy] ${targetPath} failed: ${error.message}`);
    return res.status(error.statusCode || 502).json({ error: error.message || 'Miracle runtime unavailable' });
  }
}

async function callMiracleRuntime(req, targetPath, init = {}) {
  const baseUrl = resolveMiracleRuntimeUrl(req);
  if (!baseUrl) {
    const error = new Error('Miracle runtime no configurado.');
    error.code = 'MIRACLE_RUNTIME_NOT_CONFIGURED';
    throw error;
  }
  const internalToken = process.env.GRAPH_INTERNAL_TOKEN || '';

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${baseUrl}${targetPath}${init.includeQueryString === false ? '' : extractQueryString(req)}`, {
      method: init.method || req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(internalToken ? { 'X-Graph-Internal-Token': internalToken } : {}),
        ...(init.headers || {})
      },
      body: typeof init.body === 'undefined'
        ? undefined
        : (typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : JSON.stringify(init.body))
    });
  } catch (error) {
    const upstreamError = new Error('Miracle runtime unavailable');
    upstreamError.statusCode = 502;
    throw upstreamError;
  }

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
    const upstreamError = new Error(payload?.error || payload?.message || 'Miracle runtime request failed');
    upstreamError.statusCode = upstreamResponse.status || 502;
    throw upstreamError;
  }

  return {
    statusCode: upstreamResponse.status,
    body: payload
  };
}

app.get('/api/tree', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/tree')) {
    return;
  }
  res.json(miracleWorkspaceStore.listFiles());
});

app.get('/api/file', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/file')) {
    return;
  }
  try {
    return res.json(miracleWorkspaceStore.readFile(req.query.path || ''));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible leer el archivo.' });
  }
});

app.post('/api/files', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/files', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  try {
    return res.status(201).json(miracleWorkspaceStore.createFile(req.body?.path || '', req.body?.template || ''));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible crear el archivo.' });
  }
});

app.put('/api/file', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/file', {
    method: 'PUT',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  try {
    return res.json(miracleWorkspaceStore.writeFile(req.body?.path || '', req.body?.content || ''));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible guardar el archivo.' });
  }
});

app.get('/api/session', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/session')) {
    return;
  }
  res.json(miracleWorkspaceStore.getSession());
});

app.put('/api/session', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/session', {
    method: 'PUT',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  res.json(miracleWorkspaceStore.saveSession(req.body || {}));
});

app.post('/api/session', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/session', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  res.json(miracleWorkspaceStore.saveSession(req.body || {}));
});

app.post('/api/context', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/context', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  res.json(miracleWorkspaceStore.buildContextPacket(req.body || {}));
});

app.post('/api/history-change', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/history-change', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  res.json(miracleWorkspaceStore.buildHistoryEntry(req.body || {}));
});

app.get('/api/product-llm/status', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  return res.json(miracleProductLlmProviderConfigService.status());
});

app.post('/api/setup/product-llm', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(await miracleProductLlmProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'No fue posible actualizar la hoja en blanco.' });
  }
});

async function probeMiracleSidecar(req, timeoutMs = 1500) {
  const baseUrl = resolveMiracleRuntimeUrl(req);
  if (!baseUrl) {
    return { status: 'not_configured' };
  }
  const internalToken = process.env.GRAPH_INTERNAL_TOKEN || '';

  try {
    const response = await fetch(`${baseUrl}/api/setup/status`, {
      headers: internalToken ? { 'X-Graph-Internal-Token': internalToken } : {},
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

app.post('/api/voice/stream-session', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/voice/stream-session', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  return res.status(503).json({ error: 'Miracle runtime unavailable' });
});

app.post('/api/voice/orchestrator/events', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/voice/orchestrator/events', {
    method: 'POST',
    body: JSON.stringify(req.body || {})
  })) {
    return;
  }
  return res.status(503).json({ error: 'Miracle runtime unavailable' });
});

app.get('/api/voice/orchestrator/status', async (req, res) => {
  if (await proxyMiracleRuntimeRequest(req, res, '/api/voice/orchestrator/status', {
    method: 'GET'
  })) {
    return;
  }
  return res.status(503).json({ error: 'Miracle runtime unavailable' });
});

app.get('/api/health', async (req, res) => {
  const [neo4j, miracle] = await Promise.all([
    db.healthCheck(),
    probeMiracleSidecar(req)
  ]);
  const authBypassEnabled = isAuthBypassEnabled();
  const degraded = neo4j.status !== 'ok'
    || (miracle.status !== 'ok' && miracle.status !== 'not_configured');
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

app.post('/api/providers/graph/configure', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(await graphProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el provider de Graph.'
    });
  }
});

app.get('/api/providers/assistant/status', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  return res.json(miracleAssistantProviderConfigService.status());
});

app.post('/api/providers/assistant/configure', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(await miracleAssistantProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el provider del Asistente.'
    });
  }
});

// Admin-only test surface for the "Probar asistente" button in Provider
// Studio: same ClinicalAssistantService.chat() as the real Supabase-gated
// route, general mode only (no encounter_id/doctor ownership — this is just
// for verifying the configured provider answers).
app.post('/api/providers/assistant/test-chat', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para probar el asistente.' });
  }
  try {
    const result = await clinicalAssistantService.chat({
      message: req.body?.message,
      specialty: req.body?.specialty,
      history: req.body?.history
    }, {});
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible generar la respuesta del asistente.'
    });
  }
});

app.get('/api/providers/biopsy/status', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  return res.json(miracleBiopsyProviderConfigService.status());
});

app.post('/api/providers/biopsy/configure', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(await miracleBiopsyProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el provider de Biopsia.'
    });
  }
});

// Admin-only test surface for the "Probar biopsia" button in Provider Studio:
// same BiopsyExtractionService.extract() as the real /api/v1/biopsy/extract
// route, verifying the configured vision provider reads a photo into the
// template sections.
app.post('/api/providers/biopsy/test-extract', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para probar la biopsia.' });
  }
  try {
    const result = await biopsyExtractionService.extract({
      image: req.body?.image,
      mediaType: req.body?.media_type,
      template: req.body?.template,
      mode: req.body?.mode
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible leer la hoja de laboratorio.'
    });
  }
});

app.get('/api/providers/miracle-stt/status', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  return res.json(miracleSttProviderConfigService.status());
});

app.post('/api/providers/miracle-stt/configure', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar providers.' });
  }
  try {
    return res.json(await miracleSttProviderConfigService.configure(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el STT Provider.'
    });
  }
});

app.post('/api/providers/miracle-stt/medical', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar el vocabulario médico.' });
  }
  try {
    return res.json(await miracleSttProviderConfigService.configureMedical(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible actualizar el vocabulario médico.'
    });
  }
});

app.get('/api/providers/chrome-extension/download', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para generar la extension.' });
  }
  try {
    const archiver = require('archiver');
    const {
      EXTENSION_DIR_NAME,
      collectExtensionFiles,
      buildReadme
    } = require('../scripts/lib/chrome-extension-bundle');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'No fue posible generar la extension.' });
      } else {
        res.destroy(error);
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="miracle-chrome-extension.zip"');
    archive.pipe(res);

    for (const { absPath, archivePath } of collectExtensionFiles()) {
      archive.file(absPath, { name: archivePath });
    }
    archive.append(buildReadme(EXTENSION_DIR_NAME), { name: `${EXTENSION_DIR_NAME}/README.txt` });
    archive.finalize();
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible generar la extension.'
    });
  }
});

app.get('/api/providers/api-keys/status', (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar API keys.' });
  }
  return res.json(apiKeyService.status());
});

app.post('/api/providers/api-keys/generate', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar API keys.' });
  }
  try {
    return res.json(await apiKeyService.generate(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible generar la API key.'
    });
  }
});

app.post('/api/providers/api-keys/revoke', async (req, res) => {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar API keys.' });
  }
  try {
    return res.json(await apiKeyService.revoke(req.body || {}));
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || 'No fue posible revocar la API key.'
    });
  }
});

registerLearningRoutes(app, { learningSessionService });
registerWorkflowRoutes(app, { catalogService, workflowExecutor, noteFieldMatcher, usageDashboardService });
registerContextRoutes(app, {
  surfaceProfileService
});
registerExecutionIntelligenceRoutes(app, { catalogService, executionIntelligenceService });
registerClinicalRoutes(app, {
  diagnosisSuggestionService,
  templateService: clinicalTemplateService,
  encounterService: clinicalEncounterService,
  noteGeneratorService: clinicalNoteGeneratorService,
  noteValidationService: clinicalNoteValidationService,
  assistantService: clinicalAssistantService
});
registerMedicalRoutes(app, {
  rawTranscriptionService,
  callMiracleRuntime,
  usageDashboardService
});
registerUsageRoutes(app, { usageDashboardService });
registerAndroidPanelRoutes(app, { androidPanelService });
registerWindowsAgentRoutes(app, { agentTurnService, teachVideoService });
registerPublicApiRoutes(app, {
  callMiracleRuntime,
  noteFieldMatcher,
  learningSessionService,
  catalogService,
  workflowExecutor,
  usageDashboardService,
  assistantService: clinicalAssistantService,
  biopsyService: biopsyExtractionService
});

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
  server.listen(PORT, () => console.log(`[Server] Running on http://localhost:${PORT}`));
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
