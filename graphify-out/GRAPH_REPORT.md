# Graph Report - C:\Users\Jose David Jaramillo\Documents\Backend Miracle\Graph  (2026-08-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2862 nodes · 5416 edges · 186 communities (144 shown, 42 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 314 edges (avg confidence: 0.58)
- Token cost: 87,458 input · 4,403 output

## Community Hubs (Navigation)
- Backend Server Composition Root
- Windows Panel Workspace UI
- Browser Plugin Client Modules
- Lab Test Pages (Assistant/Biopsy)
- Assistant Voice Runtime Overlay
- Python LLM Client Config
- DOM Interaction Recorder
- Clinical Assistant Verification Tests
- Note Export Postgres Verification
- Extension Popup Diagnostics Panel
- Institutional Templates Seed Generator
- Clinical Assistant Feature Tests
- Agent Turn Orchestration
- Gemini Computer-Use Brain
- Python Voice Streaming Config
- Workflow Surface Learning Docs
- Windows Panel Service
- Auth Middleware
- Python Notes Workspace App
- Voice Orchestration API Contracts
- Agent Chat Workflow Selection
- Neo4j Workflow Repository
- Workspace Voice App Bootstrap
- Note Export E2E Demo
- Clinical Assistant Service
- Graph Workflow Engine Docs
- NPM Scripts
- Clinical Workflow Verification
- Admin Workspace UI
- Clinical Encounter API Contract
- Python Note Context Builder
- Consultation Mirror Verification
- Architecture Decisions and Refactor Plan
- Extension Content Script
- Note Fidelity Verification
- Auth Gate Overlay
- Chrome Extension Build
- Plugin Page Context Capture
- Note Signature Hash Verification
- Miracle Workspace Store
- Windows Element Inspector Diagnostics
- Python Agent CLI Context
- Node Dependencies
- HTTP Route Registration Helpers
- Public API Documentation
- Clinical Note Export Service
- Tree Node Step Verification
- Android Panel Service
- Biopsy Extraction Service
- Teach Video Provider Config
- Vercel Deployment Runtime Architecture
- Chrome Extension Manifest
- Dynamic Value Resolution Tests
- Execution Intelligence Service
- Workflow Catalog
- Neo4j Driver
- Windows App Release Service
- LLM Provider Transport
- Vercel Configuration
- Python Filesystem Knowledge Storage
- Note Generation Rescue
- Usage Dashboard Pricing
- EMR Demo Web Pages
- Clinical JWT Auth Middleware
- Dev Logs Panel
- Python Notes Session Store
- System Readiness Audit
- Chrome Extension Auth Verification
- API Key Service
- Learning Session Service
- Surface Profile Service
- Teach Video Processing
- Public and Medical API Routes
- SAP GUI Surface Identity
- Architecture Assessment Docs
- Supabase Clinical Schema and RLS
- Soniox STT Context Builder
- Extension Background Service Worker
- Note Exports Database Migration
- Note Exports DB Verification
- Workflow Execution Guide Builder
- Clinical Routes Registration
- SAP COM Automation Engine
- Operations Executor Simulator
- Clinical Note Prompt Builder
- Clinical Note Validation
- Clinical Template Service
- Windows Telemetry Service
- Workflow Branch Entity
- Clinical Review Confirmation UI
- Browser Dictation Streaming
- Usage Dashboard Frontend
- Product Vision and Principles
- Python Runtime Feature Modules
- STT Provider Configuration
- Gemini Live Voice Tokens
- Step Selector Resolution
- Surface Locator Navigation
- Python Runtime ASGI Entry
- Clinical Note Export Pipeline
- Package Manifest Metadata
- Windows Device Enrollment Auth
- Studio Progress Service
- Workflow Branch Planner
- Demo Local Auth Session
- Plugin Learning Bridge
- SAP GUI Field Reading
- Workflow Location Matching
- Biopsy Photo Provider Config
- Clinical Assistant Context Builder
- Dynamic Value Resolution
- Graph Provider Config
- Assistant Provider Config
- Product LLM Provider Config
- Transversal Workflow Composition
- Workflow Learning Sessions
- Usage Ledger Storage
- Plugin API Client
- Clinical Note Engine Schema
- Workflow Repository Verification
- Agent Workflow Store
- Conscious And STT Provider Config
- Vercel Env Management
- Workflow Branch Learning
- Workflow Domain Model
- Markdown Catalog Writer
- Agent Memory Repository
- Gemini Video Processing
- Android Telemetry Schema
- Page State Management
- Studio Docs Viewer
- Vercel Build Script
- Conscious Provider Config
- Workflow Execution Engine
- Supabase Auth Bootstrap
- Visual Element Inspection
- Surface ID Detection
- Execution Timing Metrics
- App Launch Strategies
- Note Quality Maintenance Schema
- Dynamic Live E2E Test
- Clinical Note Export
- Plugin Surface Adapters
- Workflow Overlay Bridge
- Raw Clinical Transcription
- Graph Visualization Query
- Note Generation Rescue
- Preview Rendering
- Notes App Shell UI
- Capabilities API Contract
- Live Plan Verification
- Windows Users Events Schema
- Android Panel Routes
- Maintenance Routes
- Studio Progress Routes
- Usage Routes
- Windows Distribution Routes
- API Entry Point
- Teach Video Service
- Studio Engine Lab Schema
- Service Worker Shell
- Step Row Rendering
- Miracle Agent Root
- Clinical Encounters Table
- Telemetry Derived Dimensions
- Visualizer Authenticated Fetch

## God Nodes (most connected - your core abstractions)
1. `clinicalError()` - 35 edges
2. `MiracleContext` - 31 edges
3. `Neo4jWorkflowRepository` - 30 edges
4. `bindEvents()` - 26 edges
5. `mount()` - 26 edges
6. `scripts` - 25 edges
7. `MiracleSettings` - 24 edges
8. `currentProvider()` - 23 edges
9. `ensureElements()` - 22 edges
10. `setMessage()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `web/server.js (Express server)` --semantically_similar_to--> `web/server.js — composition root`  [EXTRACTED] [semantically similar]
  README.md → architecture-infrastructure.md
- `Chrome MV3 manifest — host_permissions <all_urls>` --semantically_similar_to--> `chrome-extension-src/graph-trainer (host wrapper)`  [INFERRED] [semantically similar]
  architecture-infrastructure.md → README.md
- `Fase de aprendizaje (enseñar un formulario)` --semantically_similar_to--> `Bucle central: grabar → persistir → catalogar → replay`  [INFERRED] [semantically similar]
  como-funciona-el-sistema.md → README.md
- `app/web_app.py — composición ASGI/Starlette` --semantically_similar_to--> `api/miracle_runtime.py — entrada ASGI Python`  [INFERRED] [semantically similar]
  bounded/miracle-ai/README.md → architecture-infrastructure.md
- `DOC: Distribución — el .exe llega conectado` --references--> `GraphConfig.cs (prioridad graph.json > env > key embebida)`  [EXTRACTED]
  web/public/studio-docs/distribucion-app-conectada.md → windows-client/src/GraphConfig.cs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Contrato público /api/v1 (pipeline, streaming, autofill, workflows, assistant)** — web_public_api_docs, web_public_autofill_api_docs, web_public_api_docs_assistant_chat_endpoint, web_public_autofill_api_docs_learning_sessions_endpoint, web_public_autofill_api_docs_workflows_endpoint, web_public_api_docs_apikey_auth [EXTRACTED 0.90]
- **Cadena única del producto: aprender campos → transcribir → organizar nota → autofill** — arquitectura_y_plan_graph_engine, arquitectura_y_plan_miracle_flow, bounded_miracle_ai_readme_integrations_deepgram, bounded_miracle_ai_readme_integrations_product_llm, docs_api_architecture_note_field_matcher, como_funciona_el_sistema_human_confirmation [EXTRACTED 0.90]
- **Ciclo de exportación de nota firmada al HIS (encolar → claim → result → exportada)** — docs_note_export_contract_note_export_service, docs_note_export_contract_signature_hash, docs_note_export_contract_claim_endpoint, docs_note_export_contract_state_machine, architecture_infrastructure_graph_note_exports_table, docs_note_export_contract_simulator [EXTRACTED 0.95]
- **Pipeline de generación de nota clínica sobre el template_snapshot** — docs_clinical_api_contract_template_snapshot, docs_clinical_note_generation_prompt_builder, docs_clinical_note_generation_generator_service, docs_clinical_note_generation_validation_service, docs_clinical_api_contract_note_json, docs_consultation_data_ownership_mirror_service [EXTRACTED 0.90]
- **Los tres recorridos de la pantalla SAP (campos, visual, árbol)** — web_public_studio_docs_motor_escaneo_sapgui_readfields, web_public_studio_docs_motor_escaneo_sapgui_readvisibleelements, web_public_studio_docs_motor_escaneo_sapgui_treenodes, web_public_studio_docs_motor_escaneo_sapgui_session [EXTRACTED 0.90]
- **Clasificación de causa raíz del inspector** — web_public_studio_docs_motor_inspector_elementos_inspectordiagnostics, web_public_studio_docs_motor_inspector_elementos_causa_sin_etiqueta, web_public_studio_docs_motor_inspector_elementos_causa_etiqueta_ambigua, web_public_studio_docs_motor_inspector_elementos_no_resoluble, web_public_studio_docs_motor_inspector_elementos_fragil [EXTRACTED 0.90]
- **Flujo de alineación al punto de arranque (locator → escalera → mismatch)** — web_public_studio_docs_motor_localizador_superficie_surfacelocator, web_public_studio_docs_motor_navegacion_superficie_surfacenavigator, web_public_studio_docs_motor_navegacion_superficie_escalera, web_public_studio_docs_motor_localizador_superficie_surfacemismatch, web_public_studio_docs_motor_localizador_superficie_resumeindexfor [INFERRED 0.80]

## Communities (186 total, 42 thin omitted)

### Community 0 - "Backend Server Composition Root"
Cohesion: 0.02
Nodes (106): AgentChat, agentMemoryRepository, AgentTurnService, AgentWorkflowStore, ALLOWED_ORIGINS, AndroidPanelService, ApiKeyService, apiLimiter (+98 more)

### Community 1 - "Windows Panel Workspace UI"
Cohesion: 0.06
Nodes (97): createWorkspaceController(), activate(), aggregateEngines(), appendLogs(), appGroup(), appRadius(), authedFetch(), authedSend() (+89 more)

### Community 2 - "Browser Plugin Client Modules"
Cohesion: 0.06
Nodes (91): create(), create(), create(), apiClient(), appendAgentMessage(), applySurfaceProfileToOptions(), bindControls(), bindControlsDelegated() (+83 more)

### Community 3 - "Lab Test Pages (Assistant/Biopsy)"
Cohesion: 0.06
Nodes (92): seed_bacteriology_templates.sql (Supabase seed), Assistant Lab Chat Page, appendMessage, authenticatedFetch (assistant lab), POST /api/providers/assistant/test-chat, Biopsy Lab Vision Test Page, authenticatedFetch (biopsy lab), setMessage (+84 more)

### Community 4 - "Assistant Voice Runtime Overlay"
Cohesion: 0.07
Nodes (76): bindDragHandlers(), cancelPendingMove(), clamp(), clearChatComposer(), clearSpeech(), clearSpotlight(), clearUserSpeech(), closeChatComposer() (+68 more)

### Community 5 - "Python LLM Client Config"
Cohesion: 0.09
Nodes (32): _parse_custom_terms_env(), Path, Custom STT vocabulary env value: one term per line (commas also split)., OpenAICompatibleProductLLMClient, ProductLLMClientError, RuntimeError, _env_str(), ProductLLMSettings (+24 more)

### Community 6 - "DOM Interaction Recorder"
Cohesion: 0.10
Nodes (64): apiClient(), appendActivity(), buildAttributeSelector(), buildClickIntentId(), buildPendingClickIntent(), buildSurfaceHints(), clearPendingClickIntent(), collectAlternativeTargets() (+56 more)

### Community 7 - "Clinical Assistant Verification Tests"
Cohesion: 0.05
Nodes (35): assert, ClinicalAssistantPromptBuilder, ClinicalAssistantService, ClinicalAssistantValidationService, ClinicalEncounterService, ClinicalNoteValidationService, ClinicalTemplateService, createFakeLlm() (+27 more)

### Community 8 - "Note Export Postgres Verification"
Cohesion: 0.05
Nodes (28): assert, check(), { computeSignatureHash }, fs, http, main(), NoteExportService, path (+20 more)

### Community 9 - "Extension Popup Diagnostics Panel"
Cohesion: 0.10
Nodes (46): Panel de cuenta (login usuario/clave), buildExecutionDiagnosticSummary(), buildSessionTraceSummary(), buildVoiceLogSummary(), clearLogs(), collectErrorContextWindows(), escapeHtml(), EXECUTION_LOG_SCOPES (+38 more)

### Community 10 - "Institutional Templates Seed Generator"
Cohesion: 0.07
Nodes (28): buildSectionInputs(), buildSql(), buildTemplates(), capitalize(), clinicalSpecialties, ClinicalTemplateService, conciseInstruction(), crypto (+20 more)

### Community 11 - "Clinical Assistant Feature Tests"
Cohesion: 0.08
Nodes (26): assert, { chromium }, ClinicalDiagnosisSuggestionService, contentTypeFor(), createJsonProvider(), createResponseRecorder(), fs, http (+18 more)

### Community 12 - "Agent Turn Orchestration"
Cohesion: 0.08
Nodes (25): AgentTurnService, { baseCatalog, catalogNames }, { freshSession, encodeSession, decodeSession }, { learnedToMcp, workflowToMcp, InMemoryAgentLearningStore }, { resolveConsciousConfig }, { runProviderTurn }, InMemoryAgentLearningStore, { LEARNED_VIA, WORKFLOW_VIA } (+17 more)

### Community 13 - "Gemini Computer-Use Brain"
Cohesion: 0.10
Nodes (36): asArr(), asInt(), asObj(), asStr(), builtinFns(), COMPUTER_FNS, fn(), gemHttp() (+28 more)

### Community 14 - "Python Voice Streaming Config"
Cohesion: 0.11
Nodes (19): MiracleSettings, VoiceStreamSession, Protocol, RuntimeError, VoiceStreamingError, VoiceStreamingProvider, VoiceStreamingService, _build_deepgram_websocket_url() (+11 more)

### Community 15 - "Workflow Surface Learning Docs"
Cohesion: 0.09
Nodes (31): AgentWorkflowStore.matchesSurface, WorkflowExecutionGuideBuilder (LLM organizador), WorkflowLearner (título autogenerado), DOC: Coincidencia de superficie y estado — los 3 escenarios, valueMode (fixed | dynamic | flexible), DOC: Cómo probamos — el banco de pruebas del laboratorio, Bitácora de avances (graph_studio_progress), DOC: HIPÓTESIS — nodos = ubicaciones, aristas = transiciones (+23 more)

### Community 16 - "Windows Panel Service"
Cohesion: 0.11
Nodes (27): APP_LABELS, appCoordinate(), appLabel(), badRequest(), clampLimit(), { decorateEvent, summarizeEngines }, requireEmail(), WindowsPanelService (+19 more)

### Community 17 - "Auth Middleware"
Cohesion: 0.12
Nodes (33): attachWorkflowAccess(), authenticateRequest(), createLocalAdminPayload(), createLocalAdminSession(), createLocalAnonymousSession(), crypto, extractApiKey(), extractToken() (+25 more)

### Community 18 - "Python Notes Workspace App"
Cohesion: 0.12
Nodes (15): create_notes_app(), create_notes_routes(), Route, NotesWorkspaceService, create_runtime_routes(), Route, create_voice_routes(), Route (+7 more)

### Community 19 - "Voice Orchestration API Contracts"
Cohesion: 0.13
Nodes (15): create_voice_orchestration_routes(), Route, VoiceOrchestratorAgentTask, VoiceOrchestratorEvent, VoiceOrchestratorNoteUpdate, VoiceOrchestratorResponse, VoiceOrchestratorSegment, VoiceOrchestratorSessionState (+7 more)

### Community 20 - "Agent Chat Workflow Selection"
Cohesion: 0.12
Nodes (9): AgentChat, workflowAssistantPolicy, WorkflowDecisionNormalizer, buildChatDecisionPrompt(), buildSharedBehaviorPrompt(), isDemoAutopilotContext(), summarizeWorkflow(), summarizeWorkflowVariable() (+1 more)

### Community 22 - "Workspace Voice App Bootstrap"
Cohesion: 0.11
Nodes (23): appendVoiceDebug(), classifyVoiceDebugEntry(), clearVoiceDebug(), dom, getFilteredVoiceDebugEntries(), loadVoiceOrchestrationStatus(), onFinalTranscript(), onRecordingStarted() (+15 more)

### Community 23 - "Note Export E2E Demo"
Cohesion: 0.10
Nodes (26): assert, { computeSignatureHash }, { createFakeSupabase }, express, http, main(), NoteExportService, outcome (+18 more)

### Community 24 - "Clinical Assistant Service"
Cohesion: 0.12
Nodes (13): ClinicalAssistantService, ClinicalAssistantValidationService, { clinicalError, isClinicalError }, contextBuilder, CLINICAL_ERROR_STATUS, isClinicalError(), { clinicalError, isClinicalError }, ClinicalNoteGeneratorService (+5 more)

### Community 25 - "Graph Workflow Engine Docs"
Cohesion: 0.08
Nodes (28): Neo4jDriver.js, Neo4jWorkflowRepository.js, registerPublicApiRoutes.js — /api/v1, requireAuth.js — realm local (sesión/API key), src/domain/entities/Step.js (valueMode), src/domain/entities/Workflow.js, WorkflowExecutor.js — planes fail-closed, WorkflowLearner.js (+20 more)

### Community 26 - "NPM Scripts"
Cohesion: 0.08
Nodes (25): scripts, audit:readiness, build:chrome-extension, build:vercel, demo:note-export, simulate:operations, start, test (+17 more)

### Community 27 - "Clinical Workflow Verification"
Cohesion: 0.11
Nodes (22): assert, ClinicalEncounterService, ClinicalNoteGeneratorService, ClinicalNotePromptBuilder, ClinicalNoteValidationService, ClinicalTemplateService, createFakeLlm(), createFakeSupabaseRestClient() (+14 more)

### Community 28 - "Admin Workspace UI"
Cohesion: 0.16
Nodes (23): actionButton(), actionLink(), appendLogEntry(), authenticatedFetch(), clearLogs(), copyLogs(), ensureLogPanel(), getAccessToken() (+15 more)

### Community 29 - "Clinical Encounter API Contract"
Cohesion: 0.11
Nodes (24): ClinicalEncounterService.js, registerClinicalRoutes.js, requireClinicalAuth.js — JWT Supabase vía JWKS, Contrato API Clínica — Miracle Backend, ClinicalEncounter, ClinicalTemplate, Máquina de estados del encounter, NoteJson (+16 more)

### Community 30 - "Python Note Context Builder"
Cohesion: 0.25
Nodes (18): annotate_heading_paths(), BlockContext, build_context_packet(), build_history_entry(), build_note_blocks(), build_session_diff(), _classify_block_change(), ContextPacket (+10 more)

### Community 31 - "Consultation Mirror Verification"
Cohesion: 0.13
Nodes (16): assert, ClinicalNoteGeneratorService, ConsultationMirrorService, ENCOUNTER, fakeRest(), main(), NOTE, ConsultationMirrorService (+8 more)

### Community 32 - "Architecture Decisions and Refactor Plan"
Cohesion: 0.11
Nodes (23): Chrome MV3 manifest — host_permissions <all_urls>, LLMProvider.js — transporte Chat Completions, Arquitectura y Plan del Refactor (Graph), Decisión: Deepgram como proveedor STT canónico, Dashboard — Extension Releases, Motor Graph (aprendizaje y replay de workflows), Flujo clínico Miracle (voz → nota → autofill), Pipeline unificado en streaming SSE (propuesto) (+15 more)

### Community 33 - "Extension Content Script"
Cohesion: 0.17
Nodes (19): bootstrap(), buildElementSelector(), buildSelectedElementPayload(), collectElementContextTrail(), createExtensionAuthBridge(), describeElementText(), EXECUTION_LOG_SCOPES, fetchPublicConfig() (+11 more)

### Community 34 - "Note Fidelity Verification"
Cohesion: 0.13
Nodes (14): assert, ClinicalEncounterService, ClinicalNotePromptBuilder, ClinicalTemplateService, GENERAL_SECTIONS, main(), PATHOLOGY_SECTIONS, snapshot() (+6 more)

### Community 35 - "Auth Gate Overlay"
Cohesion: 0.18
Nodes (17): buildOverlay(), createParticleField(), ensureOverlay(), ensureStyle(), hideOverlay(), init(), readStoredSession(), setBusy() (+9 more)

### Community 36 - "Chrome Extension Build"
Cohesion: 0.13
Nodes (19): build(), ensureDir(), { EXTENSION_DIR_NAME, collectExtensionFiles, buildReadme }, fs, outputRoot, path, removeDir(), repoRoot (+11 more)

### Community 37 - "Plugin Page Context Capture"
Cohesion: 0.20
Nodes (20): buildAttributeSelector(), buildControlSnapshot(), buildDomPathSelector(), buildPageContext(), capturePageSnapshot(), controlPriority(), controlTypeForElement(), describeControlGroup() (+12 more)

### Community 38 - "Note Signature Hash Verification"
Cohesion: 0.14
Nodes (16): assert, {
  canonicalSignaturePayload,
  computeSignatureHash,
  signatureHashMatches
}, path, vector, VECTOR_PATH, { buildNoteExportPayload }, { clinicalError }, { computeSignatureHash, signatureHashMatches } (+8 more)

### Community 39 - "Miracle Workspace Store"
Cohesion: 0.17
Nodes (7): buildBlocks(), diffSummary(), ensureDir(), fs, MiracleWorkspaceStore, path, safeRelativePath()

### Community 40 - "Windows Element Inspector Diagnostics"
Cohesion: 0.12
Nodes (20): SelectedTreeNode (fila del árbol por selección), SurfaceDetector (lista cerrada saplogon/sapgui), windowsEngines.js (catálogo de motores del backend), Doc: Inspector de elementos, causa=ETIQUETA-AMBIGUA, causa=SIN-ETIQUETA, DiagnoseSap (comparación por Id), DiagnoseUia (comparación por Bounds) (+12 more)

### Community 41 - "Python Agent CLI Context"
Cohesion: 0.20
Nodes (12): _build_runtime_app(), ArgumentParser, build_parser(), main(), MiracleContext, Path, load_voice_orchestration_session(), Path (+4 more)

### Community 42 - "Node Dependencies"
Cohesion: 0.11
Nodes (19): archiver, axios, body-parser, dotenv, express, express-rate-limit, jose, neo4j-driver (+11 more)

### Community 43 - "HTTP Route Registration Helpers"
Cohesion: 0.22
Nodes (14): isDependencyUnavailable(), publicErrorMessage(), statusForError(), buildSurfaceContext(), registerContextRoutes(), { statusForError, publicErrorMessage }, registerExecutionIntelligenceRoutes(), { statusForError, publicErrorMessage } (+6 more)

### Community 44 - "Public API Documentation"
Cohesion: 0.18
Nodes (18): WorkflowRecorder.cs, WorkflowTeachSession.cs, Miracle Backend API (v1), POST /api/v1/autofill/match, Guía para consumir la API de Miracle, POST /api/v1/learning/sessions (+steps/finish), POST /api/v1/pipeline, POST /api/v1/transcription/session (+10 more)

### Community 45 - "Clinical Note Export Service"
Cohesion: 0.33
Nodes (3): clinicalError(), NoteExportService, toPublicExport()

### Community 46 - "Tree Node Step Verification"
Cohesion: 0.15
Nodes (11): assert, Step, treeStepData, WorkflowExecutor, Step, Workflow, normalizeText(), parseAllowedOptions() (+3 more)

### Community 47 - "Android Panel Service"
Cohesion: 0.22
Nodes (8): ALLOWED_PROVIDERS, AndroidPanelService, badRequest(), clampLimit(), isEmptyOrMasked(), KEY_FIELDS, maskKey(), requireId()

### Community 48 - "Biopsy Extraction Service"
Cohesion: 0.24
Nodes (8): alignSections(), BiopsyExtractionService, capitalizeFirst(), extractionError(), MEDIA_TYPES, parseTemplateSections(), sanitizeDynamicSections(), sanitizeWarnings()

### Community 49 - "Teach Video Provider Config"
Cohesion: 0.24
Nodes (11): PROVIDERS, { resolveTeachConfig }, TeachVideoProviderConfigService, VercelProjectEnvService, env(), geminiFallbackKey(), normalizeProvider(), resolveConsciousConfig() (+3 more)

### Community 50 - "Vercel Deployment Runtime Architecture"
Cohesion: 0.13
Nodes (16): api/index.js — adaptador Vercel, api/miracle_runtime.py — entrada ASGI Python, integrations/deepgram|soniox/streaming.py, registerMcpRoutes.js — JSON-RPC MCP stateless, Riesgo: estado persistido en /tmp efímero, UsageLedgerStore — ledger JSONL en /tmp, features/voice_orchestration/service.py, features/voice/service.py — mint de credenciales STT (+8 more)

### Community 51 - "Chrome Extension Manifest"
Cohesion: 0.12
Nodes (15): action, default_popup, default_title, background, service_worker, content_scripts, description, host_permissions (+7 more)

### Community 52 - "Dynamic Value Resolution Tests"
Cohesion: 0.13
Nodes (8): assert, DynamicValueResolver, Step, WorkflowExecutor, TransversalWorkflowComposer, WorkflowBranch, TransversalWorkflowComposer, WorkflowBranchPlanner

### Community 58 - "Vercel Configuration"
Cohesion: 0.13
Nodes (14): includeFiles, maxDuration, includeFiles, buildCommand, crons, framework, functions, api/index.js (+6 more)

### Community 59 - "Python Filesystem Knowledge Storage"
Cohesion: 0.36
Nodes (10): Path, safe_workspace_path(), write_markdown(), create_knowledge_file(), knowledge_path(), KnowledgeFile, list_knowledge_files(), Path (+2 more)

### Community 60 - "Note Generation Rescue"
Cohesion: 0.21
Nodes (7): assert, encounter(), fakeGenerator(), fakeRest(), main(), NoteGenerationRescueService, NoteGenerationRescueService

### Community 61 - "Usage Dashboard Pricing"
Cohesion: 0.27
Nodes (6): MODEL_ALIASES, normalizeNumber(), normalizeText(), PRICING_CATALOG, roundCurrency(), UsageDashboardService

### Community 62 - "EMR Demo Web Pages"
Cohesion: 0.22
Nodes (14): vis-network standalone UMD library, Miracle EMR Workspace Expanded Demo, Miracle 'M' app icon (SVG), App icon 192px — blue medical cross on dark navy rounded square (PWA logo), App icon 512px — blue medical cross on dark navy rounded square (PWA logo), Miracle Access Login Gate Page, EMR Anamnesis Module Page, hasValue (anamnesis) (+6 more)

### Community 63 - "Clinical JWT Auth Middleware"
Cohesion: 0.29
Nodes (13): { clinicalError }, extractBearer(), getJoseModule(), getJwks(), isAnonymousPayload(), isProductionRuntime(), isTruthyEnv(), normalizeEmail() (+5 more)

### Community 64 - "Dev Logs Panel"
Cohesion: 0.29
Nodes (11): append(), clearLogs(), copyLogs(), installCapture(), installStyles(), mount(), nowStamp(), renderEntry() (+3 more)

### Community 65 - "Python Notes Session Store"
Cohesion: 0.42
Nodes (6): NotesSessionState, NoteTabSession, load_notes_session(), Path, save_notes_session(), _session_path()

### Community 66 - "System Readiness Audit"
Cohesion: 0.31
Nodes (12): addCheck(), auditMiracleRuntime(), auditNeo4j(), auditStaticConfiguration(), canConnect(), checks, envValue(), isPlaceholder() (+4 more)

### Community 67 - "Chrome Extension Auth Verification"
Cohesion: 0.22
Nodes (12): assert, createStorageArea(), extensionRoot, fs, main(), path, root, sendMessage() (+4 more)

### Community 68 - "API Key Service"
Cohesion: 0.28
Nodes (8): ApiKeyService, crypto, keyId(), maskKey(), parseKeys(), sanitizeLabel(), serializeKeys(), VercelProjectEnvService

### Community 71 - "Teach Video Processing"
Cohesion: 0.23
Nodes (6): geminiVideo, { resolveTeachConfig, teachVideoBucket }, { signVideoUpload }, TeachVideoService, sanitize(), signVideoUpload()

### Community 72 - "Public and Medical API Routes"
Cohesion: 0.22
Nodes (9): createUsageRecorder, registerMedicalRoutes(), boolFlag(), createUsageRecorder, crypto, normalizeStages(), pickArray(), registerPublicApiRoutes() (+1 more)

### Community 73 - "SAP GUI Surface Identity"
Cohesion: 0.21
Nodes (13): Doc: Escaneo SAP GUI, Identity (sapgui://SID/TCODE), SAP GUI Scripting (API COM), SapGuiSurface, Divergencia de los dos sintetizadores de ID, SurfaceIdentity (Origin, Pathname, Title), UiaSurface.Identity (segundo sintetizador de ID), Doc: Superficies (IUiSurface) (+5 more)

### Community 74 - "Architecture Assessment Docs"
Cohesion: 0.18
Nodes (12): Architecture & Infrastructure Analysis — Graph, AgentTurnService.js, Evaluación Clean Architecture (19/28, 68%), src/infrastructure/conscious-brain (OpenAI/Gemini), registerWindowsAgentRoutes.js, VercelProjectEnvService.js, WindowsAppReleaseService.js, Contexto para el agente de WORKFLOWS (+4 more)

### Community 75 - "Supabase Clinical Schema and RLS"
Cohesion: 0.32
Nodes (10): auth.users, private.enforce_consultation_immutability, consultations_immutability, private.current_app_role(), private.current_org(), public.audit_events, public.consultations, public.organizations (+2 more)

### Community 76 - "Soniox STT Context Builder"
Cohesion: 0.21
Nodes (11): build_soniox_context(), _cap_terms(), _context_char_length(), _dedupe_preserving_order(), list_specialties(), parse_custom_terms(), Builds the Soniox `context` object that specializes stt-rt-v5 for medicine.…, Assemble the Soniox context block, or None when medicine is not active.… (+3 more)

### Community 77 - "Extension Background Service Worker"
Cohesion: 0.32
Nodes (10): getSettings(), getValidSession(), proxyApiFetch(), readStoredSession(), responsePayload(), signInWithLocalAdmin(), signOut(), storageGet() (+2 more)

### Community 78 - "Note Exports Database Migration"
Cohesion: 0.21
Nodes (8): public, public.consultations, public.graph_note_exports_touch_updated_at, graph_note_exports_touch_updated_at, public.graph_cancel_note_export(), public.graph_note_exports, public.graph_report_note_export_result(), public.graph_retry_note_export()

### Community 79 - "Note Exports DB Verification"
Cohesion: 0.26
Nodes (10): DATABASE_URL, { execFileSync, execSync, exec }, path, psqlCommand(), REPO_ROOT, runPsql(), runPsqlAsync(), shellQuote() (+2 more)

### Community 80 - "Workflow Execution Guide Builder"
Cohesion: 0.23
Nodes (3): WorkflowExecutionGuideBuilder, Workflow, WorkflowExecutionGuideBuilder

### Community 81 - "Clinical Routes Registration"
Cohesion: 0.32
Nodes (11): canManageInstitutional(), crypto, encounterResponse(), { isClinicalError }, registerClinicalAssistantRoutes(), registerClinicalEngineRoutes(), registerClinicalRoutes(), resolveDoctorId() (+3 more)

### Community 82 - "SAP COM Automation Engine"
Cohesion: 0.17
Nodes (12): Check (SurfaceAvailability con motivo), HitTest (FindByPosition nativo de SAP), PublishChangedFields (ObservedStep por campo cambiado), PumpMain (bomba de mensajes y enganche de eventos), ResolveEngine (enganche COM por reflexión), SapComEvents.TryHook (sinks COM por introspección), ScriptingEngine (cache del motor), Session (primera conexión, primera sesión) (+4 more)

### Community 83 - "Operations Executor Simulator"
Cohesion: 0.44
Nodes (10): claimNext(), executeInHis(), headers(), log(), main(), options, parseArgs(), processOne() (+2 more)

### Community 84 - "Clinical Note Prompt Builder"
Cohesion: 0.33
Nodes (4): ClinicalNotePromptBuilder, DEFAULT_VERBATIM_SPECIALTIES, normalizeSpecialty(), toSpecialtySet()

### Community 85 - "Clinical Note Validation"
Cohesion: 0.38
Nodes (8): capitalizeFirst(), clampConfidence(), { clinicalError }, ClinicalNoteValidationService, isPrudentEmptyContent(), normalizeComparable(), PRUDENT_EMPTY_PHRASES, snapshotSections()

### Community 87 - "Windows Telemetry Service"
Cohesion: 0.29
Nodes (6): badRequest(), KNOWN_KINDS, normEmail(), toDetail(), toIso(), WindowsTelemetryService

### Community 88 - "Workflow Branch Entity"
Cohesion: 0.35
Nodes (6): normalizeKeyText(), normalizeNotes(), normalizeNumberArray(), normalizeObjectArray(), normalizeText(), WorkflowBranch

### Community 89 - "Clinical Review Confirmation UI"
Cohesion: 0.25
Nodes (5): confirmAll(), describe(), mark(), unmark(), updateChip()

### Community 91 - "Usage Dashboard Frontend"
Cohesion: 0.20
Nodes (11): GET /api/account/me, authenticatedFetch (usage dashboard), buildHourSeries, friendlySourceLabel / SOURCE_LABELS map, load (fetch usage summary), loadAccount, renderBreakdown, renderChart (+3 more)

### Community 92 - "Product Vision and Principles"
Cohesion: 0.22
Nodes (10): Miracle runtime README (voz → nota), Implementation Principles, Writing first — la escritura es la interfaz, Product Vision, Orquestar agentes de Openclaw desde la nota, UX Notepad Shell, Simplicidad tipo Bloc de notas, Workspaces README (+2 more)

### Community 93 - "Python Runtime Feature Modules"
Cohesion: 0.20
Nodes (10): features/notes — workspace Markdown, features/voice — sesión de streaming, features/voice_orchestration, integrations/deepgram — streaming STT, integrations/product_llm — organizador de la nota, app/web_app.py — composición ASGI/Starlette, El audio nunca pasa por el servidor central, requirements.txt (runtime Python) (+2 more)

### Community 95 - "Gemini Live Voice Tokens"
Cohesion: 0.24
Nodes (5): {
  createLiveToken,
  CONSTRAINED_WS_URL,
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  SESSION_MINUTES
}, { resolveVoiceLiveConfig }, SYSTEM_INSTRUCTION, VoiceLiveTokenService, createLiveToken()

### Community 96 - "Step Selector Resolution"
Cohesion: 0.22
Nodes (10): Apply (input / select por clave / click), Execute (resolución de selector y alternativos), Etiqueta SAP (Tooltip → Name → Text), SapSelector (normalización de ids), Ambigüedad de etiquetas (razón de ser del inspector), Etiqueta UIA (Name → AutomationId → HelpText), surfaceHints.alternativeTargets (plan de contingencia), Execute (ejecutar un paso) (+2 more)

### Community 97 - "Surface Locator Navigation"
Cohesion: 0.22
Nodes (10): Doc: SurfaceLocator, AgentLoop (ScreenState + telemetría analyze), SurfaceLocator (URL de Windows), SurfaceNavigator (consumidor del locator), Doc: SurfaceNavigator, AppAligner (predecesor hardcodeado), Aprendizaje consciente → subconsciente (paso app:<proceso> en orden 0), SurfaceLocator (única señal válida de llegada) (+2 more)

### Community 98 - "Python Runtime ASGI Entry"
Cohesion: 0.39
Nodes (8): app(), _ensure_runtime_root(), _expected_internal_token(), _is_authorized_internal_request(), Path, _rewrite_scope(), _send_json(), _sync_dir()

### Community 99 - "Clinical Note Export Pipeline"
Cohesion: 0.28
Nodes (9): graph_note_exports — cola durable en Postgres, NoteExportService.js, registerWindowsPanelRoutes.js — SSE polleado, Riesgo: service-role key salta RLS en tablas ajenas, SupabaseRestClient.js — PostgREST service-role, Exportación de nota clínica a la historia clínica, NoteExportService.js (contrato de exportación), NoteSignatureHash.js — hash compartido con Notes (+1 more)

### Community 100 - "Package Manifest Metadata"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 101 - "Windows Device Enrollment Auth"
Cohesion: 0.31
Nodes (9): ApiKeyService.generate → triggerRedeploy, POST /api/v1/enroll (planeado), requireApiKey (validación env + DB), WindowsDeviceService + graph_windows_devices (planeado), GET /api/windows/latest-installer, DOC: Autenticación interna — enrolamiento por instalación (plan), DOC: Distribución — el .exe llega conectado, windows-release.yml (CI que hornea GRAPH_DEFAULT_API_KEY) (+1 more)

### Community 102 - "Studio Progress Service"
Cohesion: 0.28
Nodes (4): badRequest(), clampLimit(), OUTCOMES, StudioProgressService

### Community 104 - "Demo Local Auth Session"
Cohesion: 0.28
Nodes (3): applyLocalSession(), createLocalSession(), init()

### Community 105 - "Plugin Learning Bridge"
Cohesion: 0.31
Nodes (5): captureTranscript(), emit(), events(), reset(), stopSession()

### Community 106 - "SAP GUI Field Reading"
Cohesion: 0.22
Nodes (9): Describe (DetectedField), GraphControlType (vocabulario de Graph), OptionsOf (opciones de combo, tope 80), ReadFields (campos de formulario), SapContextReader (contexto de UI del turno), ValueOf (nunca lee GuiPasswordField), Walk (recorrido de campos, prof. 20 / 300 elem.), ReadFields (campos accionables) (+1 more)

### Community 107 - "Workflow Location Matching"
Cohesion: 0.28
Nodes (9): JumpForwardIndex (saltar tras un fallo), NormalizePlace (solo letras, mata contadores del título), OriginOf, PathnameOf, ResumeIndexFor (reanudar donde estás), SameOrigin, SamePlace, SurfaceMismatch (+1 more)

### Community 108 - "Biopsy Photo Provider Config"
Cohesion: 0.32
Nodes (3): BiopsyPhotoProviderConfigService, PROVIDERS, VercelProjectEnvService

### Community 109 - "Clinical Assistant Context Builder"
Cohesion: 0.39
Nodes (7): ALLOWED_HISTORY_ROLES, build(), ClinicalTemplateService, resolveSpecialty(), sanitizeHistory(), sanitizeScreenContext(), SCREEN_CONTEXT_FIELDS

### Community 110 - "Dynamic Value Resolution"
Cohesion: 0.39
Nodes (3): buildPrompt(), buildResponseFormat(), DynamicValueResolver

### Community 111 - "Graph Provider Config"
Cohesion: 0.32
Nodes (3): GraphProviderConfigService, PROVIDERS, VercelProjectEnvService

### Community 112 - "Assistant Provider Config"
Cohesion: 0.32
Nodes (3): MiracleAssistantProviderConfigService, PROVIDERS, VercelProjectEnvService

### Community 113 - "Product LLM Provider Config"
Cohesion: 0.32
Nodes (3): MiracleProductLlmProviderConfigService, PROVIDERS, VercelProjectEnvService

### Community 116 - "Usage Ledger Storage"
Cohesion: 0.32
Nodes (3): fs, path, UsageLedgerStore

### Community 117 - "Plugin API Client"
Cohesion: 0.43
Nodes (6): buildUrl(), createClient(), createJsonRequest(), normalizeBaseUrl(), waitForAuthReady(), withAuth()

### Community 118 - "Clinical Note Engine Schema"
Cohesion: 0.38
Nodes (5): private.set_updated_at, public.clinical_encounters, public.clinical_templates, set_clinical_encounters_updated_at, set_clinical_templates_updated_at

### Community 119 - "Workflow Repository Verification"
Cohesion: 0.29
Nodes (3): assert, Neo4jWorkflowRepository, Step

### Community 121 - "Conscious And STT Provider Config"
Cohesion: 0.29
Nodes (4): PROVIDERS, { resolveConsciousConfig }, VercelProjectEnvService, VercelProjectEnvService

### Community 125 - "Markdown Catalog Writer"
Cohesion: 0.33
Nodes (3): fs, MarkdownCatalogWriter, path

### Community 127 - "Gemini Video Processing"
Cohesion: 0.38
Nodes (4): firstJsonObject(), isTransient(), MEDICAL_TEACH_PROMPT, processVideo()

### Community 128 - "Android Telemetry Schema"
Cohesion: 0.33
Nodes (4): public.graph_app_users, public.graph_client_config, public.graph_exec_logs, public.graph_prompts

### Community 129 - "Page State Management"
Cohesion: 0.43
Nodes (3): createStateManager(), hydrate(), init()

### Community 130 - "Studio Docs Viewer"
Cohesion: 0.57
Nodes (5): escapeHtml(), inline(), openDoc(), render(), renderMarkdown()

### Community 131 - "Vercel Build Script"
Cohesion: 0.33
Nodes (5): fs, outputDirectory, path, projectRoot, sourceDirectory

### Community 135 - "Visual Element Inspection"
Cohesion: 0.33
Nodes (6): DescribeVisual (geometría en píxeles físicos), NodeText (texto de nodo o de ítem de columna), ReadVisibleElements (todo lo visible con geometría), TreeColumnNames (tope 20), Enumeración de nodos de GuiTree (en anchura por clave), WalkVisual (prof. 30 / 700 elem.)

### Community 136 - "Surface ID Detection"
Cohesion: 0.33
Nodes (6): Compute (normalización del ID), Descarte silencioso de _computing (bug conocido), Esquema de IDs (uia:// / web:// / sapgui://), Probe (DispatcherTimer 800 ms), Slug (título → segmento de ruta, corte a 60), TryReadBrowserUrl (omnibox por ValuePattern)

### Community 137 - "Execution Timing Metrics"
Cohesion: 0.33
Nodes (6): Doc: RunTimings, IUiSurface.Execute (fase de acción medida), Resumen ⏱ TIEMPOS (log tag workflow), RunTimings (colector puro de tiempos), SurfaceReadiness (motor de carga), WorkflowPlayer (alimenta las mediciones)

### Community 138 - "App Launch Strategies"
Cohesion: 0.33
Nodes (6): acceso-directo-inicio (.lnk del menú Inicio), Capa 1 — llegar a la APP (sin LLM), Capa 2 — llegar a la PANTALLA (con LLM, pendiente), enfocar-app-viva, Escalera de estrategias v1, shell (Process.Start / cmd /c start)

### Community 139 - "Note Quality Maintenance Schema"
Cohesion: 0.40
Nodes (4): borradas, public.clinical_note_edit_stats, public.purge_abandoned_encounters(), public.clinical_encounters

### Community 141 - "Clinical Note Export"
Cohesion: 0.90
Nodes (4): acceptedCodes(), buildNoteExportPayload(), normalizeSections(), renderNoteText()

### Community 142 - "Plugin Surface Adapters"
Cohesion: 0.70
Nodes (4): createAdapter(), getSurfacePreset(), normalizePathname(), resolve()

### Community 143 - "Workflow Overlay Bridge"
Cohesion: 0.70
Nodes (4): buildOverlayItems(), buildStepEvidence(), buildStepFootnote(), buildStepTitle()

### Community 147 - "Note Generation Rescue"
Cohesion: 0.67
Nodes (3): public.claim_next_note_generation(), public.release_note_generation(), public.clinical_encounters

### Community 149 - "Notes App Shell UI"
Cohesion: 0.50
Nodes (3): Miracle Notes App Shell, controller, Miracle Product LLM (organizador) card

### Community 150 - "Capabilities API Contract"
Cohesion: 0.67
Nodes (3): Estructura destino backend/capabilities, openapi.yaml — contrato v1 como fuente de verdad, SDK por lenguaje (.NET / Kotlin / TS)

## Ambiguous Edges - Review These
- `Decisión: eliminar Supabase por completo` → `SupabaseRestClient.js — PostgREST service-role`  [AMBIGUOUS]
  ARQUITECTURA_Y_PLAN.md · relation: conceptually_related_to
- `requireAuth.js — realm local (sesión/API key)` → `Panel de cuenta (login usuario/clave)`  [AMBIGUOUS]
  chrome-extension-src/graph-trainer/popup.html · relation: references
- `SurfaceDetector (lista cerrada saplogon/sapgui)` → `windowsEngines.js (catálogo de motores del backend)`  [AMBIGUOUS]
  web/public/studio-docs/motor-escaneo-sapgui.md · relation: conceptually_related_to
- `Miracle 'M' app icon (SVG)` → `App icon 192px — blue medical cross on dark navy rounded square (PWA logo)`  [AMBIGUOUS]
  web/public/icon-192.png · relation: semantically_similar_to

## Knowledge Gaps
- **527 isolated node(s):** `app`, `miracle-agent`, `EXECUTION_LOG_SCOPES`, `VOICE_LOG_SCOPES`, `LEARNING_LOG_SCOPES` (+522 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Decisión: eliminar Supabase por completo` and `SupabaseRestClient.js — PostgREST service-role`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `requireAuth.js — realm local (sesión/API key)` and `Panel de cuenta (login usuario/clave)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `SurfaceDetector (lista cerrada saplogon/sapgui)` and `windowsEngines.js (catálogo de motores del backend)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Miracle 'M' app icon (SVG)` and `App icon 192px — blue medical cross on dark navy rounded square (PWA logo)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `clinicalError()` connect `Clinical Note Export Service` to `Note Fidelity Verification`, `Note Signature Hash Verification`, `Clinical Note Validation`, `Clinical Template Service`, `Clinical Assistant Service`, `Clinical Workflow Verification`, `Clinical JWT Auth Middleware`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `POST /api/v1/pipeline` connect `Public API Documentation` to `Usage Dashboard Frontend`, `Python Runtime Feature Modules`, `Notes App Shell UI`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `bindEvents()` (e.g. with `createEditorController()` and `createProductLlmController()`) actually correct?**
  _`bindEvents()` has 4 INFERRED edges - model-reasoned connections that need verification._