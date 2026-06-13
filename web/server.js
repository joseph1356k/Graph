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
const registerLearningRoutes = require('./api/registerLearningRoutes');
const registerWorkflowRoutes = require('./api/registerWorkflowRoutes');
const registerContextRoutes = require('./api/registerContextRoutes');
const registerExecutionIntelligenceRoutes = require('./api/registerExecutionIntelligenceRoutes');
const registerVoiceRoutes = require('./api/registerVoiceRoutes');
const registerClinicalRoutes = require('./api/registerClinicalRoutes');
const rateLimit = require('express-rate-limit');
const {
  requireAuth,
  requireAccountAuth,
  attachWorkflowAccess,
  createLocalAnonymousSession,
  isLocalAnonymousAccessEnabled
} = require('./api/requireAuth');
const { statusForError, publicErrorMessage } = require('./api/httpErrors');

const GetGraphVisualization = require('../src/application/use-cases/GetGraphVisualization');

require('dotenv').config();

const app = express();

const db = new Neo4jDriver();
const llmProvider = new LLMProvider();
const playwrightRunner = new PlaywrightRunner();
const repository = new Neo4jWorkflowRepository(db);
const catalogWriter = new MarkdownCatalogWriter();

const catalogService = new WorkflowCatalog(repository, catalogWriter);
const workflowLearner = new WorkflowLearner(repository, llmProvider, catalogWriter, catalogService);
const workflowExecutor = new WorkflowExecutor(catalogService, playwrightRunner, llmProvider);
const agentChat = new AgentChat(llmProvider, catalogService, workflowExecutor);
const generatePitchArtifacts = new GeneratePitchArtifacts(
  catalogService,
  llmProvider,
  path.join(process.cwd(), 'generated', 'pitch-personalities')
);
const conversationInsights = new ConversationInsights(
  llmProvider,
  path.join(process.cwd(), 'generated', 'conversation-insights')
);
const surfaceProfileService = new SurfaceProfileService(repository, llmProvider);
const learningSessionService = new LearningSessionService(workflowLearner);
const getGraphVisualization = new GetGraphVisualization(repository);
const executionIntelligenceService = new ExecutionIntelligenceService(llmProvider);
const noteFieldMatcher = new NoteFieldMatcher(llmProvider);
const diagnosisSuggestionService = new ClinicalDiagnosisSuggestionService(llmProvider);

app.use(bodyParser.json());

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Graph-Voice-Context, X-Graph-Voice-History');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.get('/', (req, res) => {
  res.redirect('/index.html');
});

app.get('/examples/medical-demo', (req, res) => {
  res.redirect('/index.html');
});

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
  const supabase = await probeSupabaseAuth();
  res.status(supabase.status === 'ok' ? 200 : 503).json({
    supabase,
    localAnonymousAccess: isLocalAnonymousAccessEnabled()
  });
});

// Require a real account for workflow-bearing APIs. Anonymous demo sessions can
// still load static pages, but they cannot read or mutate workflow data.
app.use('/api/voice/openai', costlyLimiter);
app.use('/api/workflows/:id/note-field-matches', costlyLimiter);
app.use('/api/clinical/diagnosis-suggestions', costlyLimiter);
[
  '/api/voice',
  '/api/clinical'
].forEach((routePrefix) => {
  app.use(routePrefix, requireAuth, attachWorkflowAccess);
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
  '/api/visualize'
].forEach((routePrefix) => {
  app.use(routePrefix, requireAccountAuth, attachWorkflowAccess);
});

app.get('/api/public-config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    localAnonymousAccess: isLocalAnonymousAccessEnabled(),
    phoneMicrophoneAvailable: !process.env.VERCEL
  });
});

async function probeMiracleSidecar(timeoutMs = 1500) {
  const baseUrl = `${process.env.MIRACLE_MEDICAL_ENGINE_URL || ''}`.replace(/\/+$/, '');
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

app.get('/api/health', async (req, res) => {
  const [neo4j, miracle, supabase] = await Promise.all([
    db.healthCheck(),
    probeMiracleSidecar(),
    probeSupabaseAuth()
  ]);
  const degraded = neo4j.status !== 'ok'
    || (miracle.status !== 'ok' && miracle.status !== 'not_configured')
    || (supabase.status !== 'ok' && supabase.status !== 'not_configured');
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
      supabase
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

registerLearningRoutes(app, { learningSessionService });
registerWorkflowRoutes(app, { catalogService, workflowExecutor, noteFieldMatcher });
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
  catalogService
});
registerClinicalRoutes(app, { diagnosisSuggestionService });

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
