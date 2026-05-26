const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
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
const registerLearningRoutes = require('./api/registerLearningRoutes');
const registerWorkflowRoutes = require('./api/registerWorkflowRoutes');
const registerContextRoutes = require('./api/registerContextRoutes');
const registerExecutionIntelligenceRoutes = require('./api/registerExecutionIntelligenceRoutes');
const registerVoiceRoutes = require('./api/registerVoiceRoutes');

const GetGraphVisualization = require('../src/application/use-cases/GetGraphVisualization');

require('dotenv').config();

const app = express();

// Initialize Infrastructure
const db = new Neo4jDriver();
const llmProvider = new LLMProvider();
const playwrightRunner = new PlaywrightRunner(); // Decoupled!
const repository = new Neo4jWorkflowRepository(db);
const catalogWriter = new MarkdownCatalogWriter();

// Initialize Application Use Cases
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

app.use(bodyParser.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Graph-Voice-Context, X-Graph-Voice-History');
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
app.use('/rentacar/assets', express.static(path.join(process.cwd(), 'web/public', 'rentacar', 'assets')));
app.get('/rentacar/assets/home/wallpaper-home.png', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'wallpaper home.png'));
});

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

const CAR_DEMO_ASSISTANT_PROFILE = {
  tone: 'close, sincere, direct, human',
  style: 'helpful car-rental advisor',
  goals: [
    'Sound like a nearby, trustworthy salesperson.',
    'Guide the user through a natural conversation instead of a cold questionnaire.',
    'Ask about the trip, experience, route, passengers, luggage, and what the vehicle will be used for.',
    'Quietly collect the information needed to complete the forms correctly.',
    'Be direct about the missing information and avoid robotic wording.'
  ]
};

function injectTrainerShell(html, options = {}) {
  const workflowDescription = JSON.stringify(options.workflowDescription || '');
  const storageKey = JSON.stringify(options.storageKey || 'graph-page-state-v1');
  const appId = JSON.stringify(options.appId || '');
  const assistantProfile = JSON.stringify(options.assistantProfile || null);

  const scripts = `
<script src="/page-state.js"></script>
<script src="/recorder.js"></script>
<script src="/assistant-runtime.js"></script>
<script src="/plugin/plugin-events.js"></script>
<script src="/plugin/plugin-host.js"></script>
<script src="/plugin/plugin-adapters.js"></script>
<script src="/plugin/plugin-context.js"></script>
<script src="/plugin/plugin-api.js"></script>
<script src="/plugin/plugin-learning-bridge.js"></script>
<script src="/plugin/plugin-learning-client.js"></script>
<script src="/plugin/plugin-voice-client.js"></script>
<script src="/plugin/plugin-trainer-shell.js"></script>
<script src="/plugin/plugin-surface-profile-client.js"></script>
<script src="/plugin/plugin-execution-client.js"></script>
<script src="/trainer-plugin.js"></script>
<script>
window.addEventListener('load', function () {
  window.PageState.init({ storageKey: ${storageKey} });
  window.TrainerPlugin.mount({
    title: ${JSON.stringify(options.title || 'Trainer')},
    workflowDescription: ${workflowDescription},
    apiBaseUrl: ${JSON.stringify(options.apiBaseUrl || '')},
    appId: ${appId},
    assistantProfile: ${assistantProfile}
  });
});
</script>
`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${scripts}\n</body>`);
  }

  return `${html}\n${scripts}`;
}

function injectHomeCallWidget(html) {
  const widget = `
<style>
  .service-hours-banner {
    margin: 10px auto 20px;
    max-width: 760px;
    padding: 14px 18px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(18, 37, 62, 0.96), rgba(34, 51, 76, 0.92));
    color: #fff;
    text-align: center;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.16);
  }
  .service-hours-banner strong,
  .service-hours-banner span {
    display: block;
  }
  .service-hours-banner strong {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.8;
    margin-bottom: 4px;
  }
  .service-hours-banner span {
    font-size: 1rem;
    font-weight: 800;
    line-height: 1.35;
  }
  .social-mov {
    display: none !important;
  }
  .home-contact-dock {
    position: fixed;
    right: 18px;
    bottom: 126px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    font-family: inherit;
  }
  .home-call-widget {
    width: min(320px, calc(100vw - 36px));
  }
  .home-call-card {
    display: none;
    margin-bottom: 10px;
    padding: 16px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
  }
  .home-call-widget.is-open .home-call-card {
    display: block;
  }
  .home-call-card h4 {
    margin: 0 0 6px;
    color: #12253e;
    font-size: 1.05rem;
    font-weight: 800;
  }
  .home-call-card p {
    margin: 0 0 10px;
    color: #4d5b70;
    font-size: 0.92rem;
    line-height: 1.35;
  }
  .home-call-row {
    display: flex;
    gap: 8px;
  }
  .home-call-widget.is-calling .home-call-row {
    display: none;
  }
  .home-call-row input {
    min-width: 0;
    flex: 1;
    height: 42px;
    border: 1px solid #d5dce5;
    border-radius: 6px;
    padding: 10px 12px;
    color: #132238;
    font-weight: 600;
  }
  .home-call-submit {
    border: none;
    border-radius: 6px;
    background: #8bc53f;
    color: #111;
    font-size: 0.9rem;
    font-weight: 800;
    padding: 0 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .home-call-status {
    min-height: 18px;
    margin-top: 10px;
    color: #d51717;
    font-size: 0.86rem;
    font-weight: 700;
  }
  .home-call-widget.is-calling .home-call-status {
    display: none;
  }
  .home-call-live {
    display: none;
    margin-top: 12px;
    padding: 18px 16px;
    border-radius: 16px;
    background: linear-gradient(180deg, #fff6f6, #ffe1e1);
    border: 1px solid rgba(213, 23, 23, 0.14);
    text-align: center;
  }
  .home-call-widget.is-calling .home-call-live {
    display: block;
  }
  .home-call-pulse {
    position: relative;
    width: 74px;
    height: 74px;
    margin: 0 auto 12px;
    border-radius: 999px;
    background: linear-gradient(180deg, #ff4d4d, #d51717);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: 0 14px 30px rgba(213, 23, 23, 0.24);
  }
  .home-call-pulse::before,
  .home-call-pulse::after {
    content: "";
    position: absolute;
    inset: -8px;
    border-radius: inherit;
    border: 2px solid rgba(213, 23, 23, 0.25);
    animation: homeCallRing 1.8s ease-out infinite;
  }
  .home-call-pulse::after {
    animation-delay: 0.6s;
  }
  .home-call-pulse svg {
    width: 28px;
    height: 28px;
  }
  .home-call-live strong,
  .home-call-live span,
  .home-call-live small {
    display: block;
  }
  .home-call-live strong {
    color: #8e0f0f;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .home-call-live span {
    margin-top: 6px;
    color: #18263d;
    font-size: 1rem;
    font-weight: 800;
  }
  .home-call-live small {
    margin-top: 6px;
    color: #5f6775;
    font-size: 0.88rem;
    line-height: 1.4;
  }
  .home-call-live-actions {
    margin-top: 14px;
    display: flex;
    justify-content: center;
  }
  .home-call-reset {
    border: none;
    border-radius: 999px;
    background: #12253e;
    color: #fff;
    height: 40px;
    padding: 0 18px;
    font-weight: 800;
    cursor: pointer;
  }
  @keyframes homeCallRing {
    0% {
      transform: scale(0.92);
      opacity: 0.8;
    }
    100% {
      transform: scale(1.38);
      opacity: 0;
    }
  }
  .home-call-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    border: none;
    background: #d51717;
    color: #fff;
    box-shadow: 0 14px 30px rgba(213, 23, 23, 0.35);
    cursor: pointer;
    width: 156px;
    height: 56px;
    padding: 0 18px;
    border-radius: 999px;
    font-weight: 800;
  }
  .home-contact-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 156px;
  }
  .home-contact-link {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 156px;
    height: 56px;
    padding: 0 18px;
    border-radius: 999px;
    color: #fff !important;
    text-decoration: none !important;
    font-weight: 800;
    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2);
  }
  .home-call-toggle svg,
  .home-contact-link img {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex: 0 0 auto;
  }
  .home-contact-link.whatsapp {
    background: #1f9d55;
  }
  .home-contact-link span,
  .home-call-toggle span {
    display: inline;
    line-height: 1;
  }
  @media (max-width: 767px) {
    .home-call-widget,
    .home-contact-actions,
    .home-call-toggle,
    .home-contact-link {
      width: min(156px, calc(100vw - 36px));
    }
    .home-contact-dock {
      bottom: 112px;
    }
    .service-hours-banner {
      margin-bottom: 16px;
      padding: 12px 14px;
    }
    .service-hours-banner span {
      font-size: 0.92rem;
    }
  }
</style>
<div class="home-contact-dock" data-testid="home-contact-dock">
  <div class="home-call-widget" id="homeCallWidget" data-testid="home-call-widget">
    <div class="home-call-card" id="homeCallCard" data-testid="home-call-card">
      <h4>Te llamamos</h4>
      <p>Dejanos tu numero y un asesor te contacta para ayudarte con la reserva.</p>
      <p>Horario de atencion: 8:00 a.m. a 5:00 p.m., todos los dias.</p>
      <div class="home-call-row">
        <input id="homeCallPhone" data-testid="home-call-phone" type="tel" placeholder="+ Indicativo / numero">
        <button class="home-call-submit" id="homeCallSubmit" data-testid="home-call-submit" type="button">Enviar</button>
      </div>
      <div class="home-call-status" id="homeCallStatus" data-testid="home-call-status" aria-live="polite"></div>
      <div class="home-call-live" id="homeCallLive" data-testid="home-call-live" aria-live="polite">
        <div class="home-call-pulse" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.11.37 2.3.56 3.58.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.28.19 2.47.56 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z"></path>
          </svg>
        </div>
        <strong>Llamando...</strong>
        <span id="homeCallLivePhone">Conectando con un asesor</span>
        <small>Estamos simulando la llamada en este momento para que el usuario sienta respuesta inmediata.</small>
        <div class="home-call-live-actions">
          <button class="home-call-reset" id="homeCallReset" data-testid="home-call-reset" type="button">Volver</button>
        </div>
      </div>
    </div>
  </div>
  <div class="home-contact-actions">
    <button class="home-call-toggle" id="homeCallToggle" data-testid="home-call-toggle" type="button" aria-controls="homeCallCard" aria-expanded="false" aria-label="Llamame" title="Llamame">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.11.37 2.3.56 3.58.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.28.19 2.47.56 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z"></path>
      </svg>
      <span>Llamame</span>
    </button>
    <a class="home-contact-link whatsapp" href="https://api.whatsapp.com/send?phone=573045459999" target="_blank" rel="noreferrer" data-testid="home-whatsapp-link" aria-label="WhatsApp" title="WhatsApp">
      <img src="/rentacar/assets/whatsapp_icon2.png" alt="WhatsApp">
      <span>WhatsApp</span>
    </a>
  </div>
</div>
<script>
window.addEventListener('load', function () {
  var widget = document.getElementById('homeCallWidget');
  var toggle = document.getElementById('homeCallToggle');
  var phone = document.getElementById('homeCallPhone');
  var submit = document.getElementById('homeCallSubmit');
  var status = document.getElementById('homeCallStatus');
  var livePhone = document.getElementById('homeCallLivePhone');
  var reset = document.getElementById('homeCallReset');
  if (!widget || !toggle || !phone || !submit || !status || !livePhone || !reset) return;
  function resetCallingState() {
    widget.classList.remove('is-calling');
    status.textContent = '';
    submit.disabled = false;
  }
  toggle.addEventListener('click', function () {
    var isOpen = widget.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen && !widget.classList.contains('is-calling')) phone.focus();
  });
  submit.addEventListener('click', function () {
    if (!phone.value.trim()) {
      status.textContent = 'Ingresa un numero para poder llamarte.';
      phone.focus();
      return;
    }
    livePhone.textContent = 'Llamando ahora al ' + phone.value.trim();
    widget.classList.add('is-calling');
    status.textContent = '';
    submit.disabled = true;
  });
  reset.addEventListener('click', function () {
    resetCallingState();
    phone.focus();
  });
});
</script>
`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${widget}\n</body>`);
  }

  return `${html}\n${widget}`;
}

function enhanceCarDemoHome(html) {
  const heroWallpaperOverride = `
<style>
  #main-banner {
    background-image:
      linear-gradient(90deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.34)),
      url('/rentacar/assets/home/wallpaper-home.png') !important;
    background-size: cover !important;
    background-position: center center !important;
    background-repeat: no-repeat !important;
  }
  @media (max-width: 991.98px) {
    #main-banner {
      background-image:
        linear-gradient(90deg, rgba(0, 0, 0, 0.68), rgba(0, 0, 0, 0.38)),
        url('/rentacar/assets/home/wallpaper-home.png') !important;
    }
  }
  @media screen and (max-width: 768px) {
    #main-banner {
      background-image:
        linear-gradient(180deg, rgba(36, 0, 0, 0.78), rgba(213, 23, 23, 0.58)),
        url('/rentacar/assets/home/wallpaper-home.png') !important;
      background-position: center center !important;
    }
  }
</style>
`;

  const enhanced = html
    .replace('action="reservar.html"', 'action="/rentacar/reservar.html" data-testid="car-quote-form"')
    .replace(
      /<input type="text" class="form-control datetimepicker-input dateArrow hasDatepicker" id="desde" name="desde" data-target="#dateDel" autocomplete="off" value="\s*([^"]*)">/,
      '<input type="date" class="form-control datetimepicker-input dateArrow" id="desde" data-testid="pickup-date" name="desde" data-target="#dateDel" autocomplete="off" value="$1">'
    )
    .replace('id="searchFormRangeDateTimePicker-starTime" class="form-control datetimepicker-input"', 'id="searchFormRangeDateTimePicker-starTime" data-testid="pickup-time" class="form-control datetimepicker-input"')
    .replace('id="lugEntId" required="required"', 'id="lugEntId" data-testid="pickup-location" required="required"')
    .replace(
      /<input type="text" class="form-control datetimepicker-input dateArrow hasDatepicker" id="hasta" name="hasta" data-target="#dateDev" autocomplete="off" value="\s*([^"]*)">/,
      '<input type="date" class="form-control datetimepicker-input dateArrow" id="hasta" data-testid="return-date" name="hasta" data-target="#dateDev" autocomplete="off" value="$1">'
    )
    .replace('id="searchFormRangeDateTimePicker-endTime" class="form-control datetimepicker-input"', 'id="searchFormRangeDateTimePicker-endTime" data-testid="return-time" class="form-control datetimepicker-input"')
    .replace('id="lugDevId" required="required"', 'id="lugDevId" data-testid="return-location" required="required"')
    .replace(
      '<span class="text-black booking-form2-text2">Ingresa las fechas y horarios para ver disponibilidad y precios</span>',
      '<span class="text-black booking-form2-text2">Ingresa las fechas y horarios para ver disponibilidad y precios</span><div class="service-hours-banner" data-testid="service-hours-banner"><strong>Horario de atencion</strong><span>8:00 a.m. a 5:00 p.m. todos los dias</span></div>'
    )
    .replace('<input type="submit" class="btn btn-success btn-sm btn-block form-control rounded border border-white text-black font-weight-bold" value="COTIZAR">', '<input id="quote-submit" data-testid="quote-submit" type="submit" class="btn btn-success btn-sm btn-block form-control rounded border border-white text-black font-weight-bold" value="COTIZAR">')
    .replace('style="background-image: url(/src/img/que-hacer.webp);"', 'style="background-image: url(/rentacar/assets/home/why-rent.svg);"');

  const withHeroWallpaper = enhanced.includes('</head>')
    ? enhanced.replace('</head>', `${heroWallpaperOverride}\n</head>`)
    : `${heroWallpaperOverride}\n${enhanced}`;

  return injectHomeCallWidget(withHeroWallpaper);
}

app.get('/examples/car-demo', (req, res) => {
  try {
    const htmlPath = path.join(process.cwd(), 'Demo de carros', 'Alquiler de Carros en Medellín _ Rent a Car Medellín 24h.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\.\/Alquiler de Carros en MedellÃ­n _ Rent a Car MedellÃ­n 24h_files\//g, '/rentacar/assets/');
    html = html.replace(/\.\/Alquiler de Carros en Medellín _ Rent a Car Medellín 24h_files\//g, '/rentacar/assets/');
    html = enhanceCarDemoHome(html);
    html = injectTrainerShell(html, {
      title: 'Car Rental Trainer',
      workflowDescription: 'Car rental quote workflow',
      storageKey: 'graph-car-demo-state-v1',
      appId: 'car-demo',
      assistantProfile: CAR_DEMO_ASSISTANT_PROFILE
    });
    res.type('html').send(html);
  } catch (error) {
    console.error(`[Car Demo] Error: ${error.message}`);
    res.status(500).send(error.message);
  }
});

registerLearningRoutes(app, { learningSessionService });
registerWorkflowRoutes(app, { catalogService, workflowExecutor });
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

app.post('/api/agent/chat', async (req, res) => {
  try {
    const response = await agentChat.handleMessage(
      req.body?.message,
      req.body?.history,
      req.body?.context || {},
      { executionMode: req.body?.executionMode || 'browser' }
    );
    res.json(response);
  } catch (err) {
    console.error(`[Agent Chat] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hubspot/reservation', async (req, res) => {
  const token = `${process.env.HUBSPOT_PRIVATE_APP_TOKEN || ''}`.trim();
  if (!token) {
    return res.status(500).json({ error: 'HubSpot no esta configurado en el servidor.' });
  }

  const reservation = req.body || {};
  const contactPayload = {
    email: `${reservation.email || ''}`.trim(),
    firstname: `${reservation.firstName || ''}`.trim(),
    lastname: `${reservation.lastName || ''}`.trim(),
    phone: `${reservation.phone || ''}`.trim()
  };

  if (!contactPayload.email) {
    return res.status(400).json({ error: 'Falta el email del contacto.' });
  }

  const hubspotHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  function buildReservationNoteBody(payload) {
    const lines = [
      'Nueva reserva demo de carros',
      '',
      `Vehiculo: ${payload.vehicle || 'No especificado'}`,
      `Recogida: ${payload.pickupDate || 'Por confirmar'} ${payload.pickupTime || ''}`.trim(),
      `Entrega: ${payload.returnDate || 'Por confirmar'} ${payload.returnTime || ''}`.trim(),
      `Lugar de recogida: ${payload.pickupLocation || 'Por confirmar'}`,
      `Lugar de entrega: ${payload.returnLocation || 'Por confirmar'}`,
      '',
      `Nombre: ${payload.firstName || ''} ${payload.lastName || ''}`.trim(),
      `Email: ${payload.email || 'No especificado'}`,
      `Telefono: ${payload.phone || 'No especificado'}`,
      `Documento: ${payload.documentType || 'No especificado'} ${payload.documentNumber || ''}`.trim(),
      `Fecha de nacimiento: ${payload.birthDate || 'No especificada'}`,
      `Nacionalidad: ${payload.nationality || 'No especificada'}`,
      `Pais de residencia: ${payload.residenceCountry || 'No especificado'}`,
      `Ciudad: ${payload.city || 'No especificada'}`,
      '',
      `Codigo de reserva aerea: ${payload.flightReservationCode || 'No especificado'}`,
      `Aerolinea: ${payload.flightAirline || 'No especificada'}`,
      `Numero de vuelo: ${payload.flightNumber || 'No especificado'}`,
      `Ciudad de origen del vuelo: ${payload.flightOriginCity || 'No especificada'}`,
      '',
      `Hospedaje en Medellin: ${payload.lodgingAddress || 'No especificado'}`,
      `Comentarios: ${payload.additionalComments || 'Sin comentarios adicionales'}`
    ];

    return lines.join('\n');
  }

  async function findContactByEmail(email) {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email
              }
            ]
          }
        ],
        limit: 1,
        properties: ['email', 'firstname', 'lastname', 'phone']
      },
      { headers: hubspotHeaders }
    );

    return response.data?.results?.[0] || null;
  }

  async function createContact(properties) {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      { properties },
      { headers: hubspotHeaders }
    );

    return response.data;
  }

  async function updateContact(contactId, properties) {
    const response = await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
      { properties },
      { headers: hubspotHeaders }
    );

    return response.data;
  }

  async function createNote(noteBody) {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/notes',
      {
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: noteBody
        }
      },
      { headers: hubspotHeaders }
    );

    return response.data;
  }

  async function associateNoteToContact(noteId, contactId) {
    await axios.put(
      `https://api.hubapi.com/crm/v3/objects/notes/${encodeURIComponent(noteId)}/associations/contact/${encodeURIComponent(contactId)}/note_to_contact`,
      {},
      { headers: hubspotHeaders }
    );
  }

  try {
    const existingContact = await findContactByEmail(contactPayload.email);
    const filteredProperties = Object.fromEntries(
      Object.entries(contactPayload).filter(([, value]) => value)
    );

    const contact = existingContact
      ? await updateContact(existingContact.id, filteredProperties)
      : await createContact(filteredProperties);

    let noteCreated = false;
    let warning = null;

    try {
      const note = await createNote(buildReservationNoteBody(reservation));
      await associateNoteToContact(note.id, contact.id);
      noteCreated = true;
    } catch (noteError) {
      console.warn('[HubSpot] Note sync warning:', noteError.response?.data || noteError.message);
      warning = 'El contacto se creo en HubSpot, pero la nota no pudo guardarse con los permisos actuales.';
    }

    res.json({
      ok: true,
      contactId: contact.id,
      noteCreated,
      warning
    });
  } catch (error) {
    const hubspotMessage = error.response?.data?.message || error.response?.data?.error || error.message;
    console.error('[HubSpot] Reservation sync error:', error.response?.data || error.message);
    res.status(500).json({ error: `No se pudo sincronizar con HubSpot: ${hubspotMessage}` });
  }
});

app.get('/api/visualize', async (req, res) => {
  try {
    const data = await getGraphVisualization.execute();
    console.log(`[Visualize] Returning ${data.nodes.length} nodes and ${data.edges.length} edges`);
    res.json(data);
  } catch (err) {
    console.error(`[Visualize] Error: ${err.message}`);
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
app.set('port', PORT);
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
