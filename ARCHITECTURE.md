# Architecture

This document explains the current architecture of Graph as it exists today.

Graph is a reusable learning-and-replay system. The demos matter, but they are not the product boundary. The product boundary is:

1. learn a workflow from real page interaction
2. persist it with enough semantics to replay it later
3. discover the right workflow for the current page and user request
4. execute it through an assistant-driven runtime

For the next architectural core, see [SELF_IMPROVEMENT_ARCHITECTURE.md](./SELF_IMPROVEMENT_ARCHITECTURE.md). It defines the self-improvement vision and the move from linear workflows to graph-based workflow route extensions.

## System Goal

Graph should behave like a page-attachable assistant plugin that can:

- learn how to use a page
- remember those workflows globally
- adapt its assistant behavior to the page it is mounted on
- replay learned workflows with minimal user friction

Today the product shape is:

- a shared workflow core
- a browser runtime/plugin layer
- a central backend with Neo4j + LLM orchestration
- demos and extension packaging on top

## Architectural Principles

### 1. The learning loop is the product

The critical loop is:

1. capture interaction
2. persist workflow
3. infer variables/options
4. rebuild catalog
5. select workflow for current page context
6. replay successfully

Any refactor that weakens this loop is architectural debt.

### 2. Workflows are global by default

Today workflows are intentionally shared across users.

That means:

- if a page has already been taught, everyone can benefit
- the system gets stronger as more workflows are learned

We are leaving room for future private workflows, but they are not active in the current product model.

### 3. Surface behavior is page-scoped

The assistant tone, welcome message, system prompt addendum, and page summary belong to the page surface, not to the workflow engine.

### 4. The runtime should be capability-based

The browser plugin runtime is moving away from a single giant `trainer-plugin.js` file and toward capability modules:

- learning
- execution
- voice
- surface profile hydration
- trainer shell / UI orchestration

This is the main architectural evolution of the current codebase.

## Layered View

## 1. Domain and Application Layer

Primary responsibility:

- represent workflows and steps
- choose workflows
- execute workflows
- preserve the learning loop

Key files:

- [src/domain/entities/Workflow.js](C:/Users/User/Desktop/Graph/src/domain/entities/Workflow.js)
- [src/domain/entities/Step.js](C:/Users/User/Desktop/Graph/src/domain/entities/Step.js)
- [src/application/use-cases/WorkflowLearner.js](C:/Users/User/Desktop/Graph/src/application/use-cases/WorkflowLearner.js)
- [src/application/use-cases/WorkflowCatalog.js](C:/Users/User/Desktop/Graph/src/application/use-cases/WorkflowCatalog.js)
- [src/application/use-cases/WorkflowExecutor.js](C:/Users/User/Desktop/Graph/src/application/use-cases/WorkflowExecutor.js)
- [src/application/use-cases/AgentChat.js](C:/Users/User/Desktop/Graph/src/application/use-cases/AgentChat.js)
- [src/application/use-cases/SurfaceProfileService.js](C:/Users/User/Desktop/Graph/src/application/use-cases/SurfaceProfileService.js)
- [src/application/use-cases/LearningSessionService.js](C:/Users/User/Desktop/Graph/src/application/use-cases/LearningSessionService.js)

### Workflow

`Workflow` is the aggregate root for learned behavior.

Today it contains:

- workflow metadata
- page context
- context notes
- ordered steps
- inferred variables derived from steps

Important fields:

- `id`
- `description`
- `summary`
- `status`
- `appId`
- `sourceUrl`
- `sourceOrigin`
- `sourcePathname`
- `sourceTitle`
- `contextNotes`
- `steps`

The important architectural idea is that the workflow is not just “a macro”. It is a page-scoped, semantically enriched replay artifact.

### Step

`Step` is the execution primitive.

Current action types:

- `navigation`
- `click`
- `input`
- `select`

Important step fields:

- `selector`
- `label`
- `value`
- `selectedValue`
- `selectedLabel`
- `allowedOptions`
- `stepOrder`

This is what lets Graph execute with more structure than a naive click recorder.

### WorkflowLearner

`WorkflowLearner` is the current application service for recording sessions.

It is responsible for:

- starting a workflow session
- appending steps
- appending `contextNotes`
- finishing the workflow
- generating a summary
- triggering catalog rebuild

Current limit:

- it still owns a publication side-effect by rebuilding the catalog directly when a session finishes

### WorkflowCatalog

`WorkflowCatalog` rebuilds full workflows from row-oriented storage and exposes them as replay-ready objects.

It currently also writes the markdown catalog file, which is convenient but still somewhat coupled.

### WorkflowExecutor

`WorkflowExecutor` is the backend execution planner.

In browser mode, it returns an execution plan that the browser runtime applies step by step.

In server mode, it can execute directly through Playwright.

### AgentChat

`AgentChat` is the workflow-selection layer.

It is responsible for:

- filtering workflows for the current page
- injecting assistant personality and prompt guidance
- deciding whether enough information exists to run now
- filling missing variables through the LLM when needed

This is where the assistant becomes page-aware without hardcoding page semantics into the workflow core.

### SurfaceProfileService

`SurfaceProfileService` is the page-context authoring layer.

It ensures that each page surface can have a global profile describing:

- assistant personality
- assistant runtime copy
- workflow description
- system prompt addendum
- page summary
- language-specific greeting behavior

Profiles are currently global per:

- `appId`
- `sourcePathname`
- `scope`
- `ownerId`
- `languageCode`

Today we use `scope = global` and empty `ownerId`.

### LearningSessionService

`LearningSessionService` is the session-state coordinator for the learning loop.

It is responsible for:

- starting a browser learning session
- tracking the active `sessionId`
- routing steps to the correct workflow session
- routing `contextNotes` to the correct session
- finishing or resetting a session cleanly

This is an important architectural shift: the learning flow is no longer modeled as one global mutable `currentWorkflowId` hanging off the HTTP server.

## 2. Infrastructure Layer

Primary responsibility:

- persistence
- LLM transport
- execution backend
- generated artifacts

Key files:

- [src/infrastructure/repositories/Neo4jWorkflowRepository.js](C:/Users/User/Desktop/Graph/src/infrastructure/repositories/Neo4jWorkflowRepository.js)
- [src/infrastructure/LLMProvider.js](C:/Users/User/Desktop/Graph/src/infrastructure/LLMProvider.js)
- [src/infrastructure/PlaywrightRunner.js](C:/Users/User/Desktop/Graph/src/infrastructure/PlaywrightRunner.js)
- [src/infrastructure/VoiceRealtimeGateway.js](C:/Users/User/Desktop/Graph/src/infrastructure/VoiceRealtimeGateway.js)
- [src/infrastructure/file-system/MarkdownCatalogWriter.js](C:/Users/User/Desktop/Graph/src/infrastructure/file-system/MarkdownCatalogWriter.js)

### Neo4j Repository

Neo4j is the persistence layer for:

- workflows
- steps
- workflow `contextNotes`
- surface profiles

This is important: Graph does **not** execute workflows by sending Cypher scripts to Neo4j.

Neo4j is only being used as the persistence graph.

The application runs normal JavaScript services, and those services read/write workflow data through repository methods that internally use Cypher queries.

Current graph shape:

- `(:Workflow)`
- `(:Step)`
- `(:SurfaceProfile)`
- relationship: `(:Workflow)-[:HAS_STEP]->(:Step)`

So the “graph” today is mostly:

- one workflow node
- many ordered step nodes attached to it
- separate surface-profile nodes for page behavior

Step ordering is stored as `stepOrder`, not as a linked-list style relationship between step nodes.

### LLM Provider

`LLMProvider` isolates:

- provider transport
- model invocation
- JSON-object prompting
- auth/config handling

This lets application services ask for:

- summary generation
- workflow decision
- page profile generation

without knowing provider details.

### Playwright Runner

`PlaywrightRunner` is the backend execution path.

Important current behaviors:

- locator resolution
- input filling
- select option application
- empty-select interpretation support

The browser runtime and Playwright runner are conceptually parallel execution surfaces:

- browser runtime executes inside the page for extension/plugin behavior
- Playwright runner executes from backend/server mode

### Voice Realtime Gateway

`VoiceRealtimeGateway` is the server-side realtime voice transport/orchestration layer.

It helps bridge browser voice flows with backend-assisted decision and execution logic.

## 2.5. HTTP Composition Layer

Primary responsibility:

- compose application services into HTTP endpoints
- keep route concerns grouped by capability
- avoid putting product logic directly inside the top-level server bootstrap

Key files:

- [web/server.js](C:/Users/User/Desktop/Graph/web/server.js)
- [web/api/registerLearningRoutes.js](C:/Users/User/Desktop/Graph/web/api/registerLearningRoutes.js)
- [web/api/registerWorkflowRoutes.js](C:/Users/User/Desktop/Graph/web/api/registerWorkflowRoutes.js)
- [web/api/registerContextRoutes.js](C:/Users/User/Desktop/Graph/web/api/registerContextRoutes.js)
- [web/api/registerVoiceRoutes.js](C:/Users/User/Desktop/Graph/web/api/registerVoiceRoutes.js)
- [web/phone/buildPhoneMicPage.js](C:/Users/User/Desktop/Graph/web/phone/buildPhoneMicPage.js)

### Server

`web/server.js` is increasingly the composition root for the backend.

Its responsibilities today are mainly:

- initialize infrastructure and use cases
- register capability route groups
- serve static assets and demo surfaces
- inject the trainer shell into served demo pages

The architectural direction is that feature behavior should live in services or route modules, not in `server.js`.

### Route registration modules

The backend is now grouped by capability:

- `registerLearningRoutes.js`
- `registerWorkflowRoutes.js`
- `registerContextRoutes.js`
- `registerVoiceRoutes.js`

This keeps the HTTP boundary closer to the product concepts:

- learning
- workflows and planning
- page context and surface profiles
- voice and phone microphone pairing

## 3. Browser Runtime / Plugin Layer

Primary responsibility:

- connect the generic learning system to a real web page

Key files:

- [web/public/assistant-runtime.js](C:/Users/User/Desktop/Graph/web/public/assistant-runtime.js)
- [web/public/recorder.js](C:/Users/User/Desktop/Graph/web/public/recorder.js)
- [web/public/trainer-plugin.js](C:/Users/User/Desktop/Graph/web/public/trainer-plugin.js)
- [web/public/page-state.js](C:/Users/User/Desktop/Graph/web/public/page-state.js)
- [web/public/plugin/plugin-events.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-events.js)
- [web/public/plugin/plugin-host.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-host.js)
- [web/public/plugin/plugin-api.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-api.js)
- [web/public/plugin/plugin-context.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-context.js)
- [web/public/plugin/plugin-learning-bridge.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-learning-bridge.js)
- [web/public/plugin/plugin-learning-client.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-learning-client.js)
- [web/public/plugin/plugin-execution-client.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-execution-client.js)
- [web/public/plugin/plugin-surface-profile-client.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-surface-profile-client.js)
- [web/public/plugin/plugin-voice-client.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-voice-client.js)
- [web/public/plugin/plugin-trainer-shell.js](C:/Users/User/Desktop/Graph/web/public/plugin/plugin-trainer-shell.js)

### Assistant Runtime

`assistant-runtime.js` is the visual body of the assistant.

Its responsibilities:

- render the floating assistant shell
- move near selectors
- spotlight page regions
- show conversation copy
- expose APIs like:
  - `speak`
  - `moveToSelector`
  - `handleAutomationEvent`
  - `startTour`
  - `pinBottomRight`
  - `openChatComposer`

It should remain UI/runtime focused, not workflow-decision focused.

### Recorder

`recorder.js` captures DOM interactions with enough semantics to replay them later.

Current responsibilities:

- detect clicks
- detect input changes
- detect select changes
- capture labels and selectors
- capture allowed options for selects
- send steps to the backend
- emit learning lifecycle events

The recorder is now also session-aware:

- it stores the `sessionId` returned by `/api/workflow/start`
- it sends that `sessionId` on `/api/step`
- it sends that `sessionId` on `/api/workflow/context-note`
- it uses that `sessionId` on `/api/workflow/stop`

### Trainer Plugin

`trainer-plugin.js` is still the composition root for the browser runtime.

Its job today is increasingly:

- mount page configuration
- wire capabilities together
- wire assistant-runtime subscriptions
- keep compatibility with existing runtime behavior

It is no longer the only place where product behavior lives. That is the key architectural improvement.

### Capability Modules

The runtime is now split into capability modules:

#### `plugin-context.js`

Builds normalized page context and lightweight page snapshots.

It is responsible for:

- `appId`
- `sourceOrigin`
- `sourcePathname`
- `browserLocale`
- `languageCode`
- workflow filtering hooks
- page snapshot capture for surface-profile generation

#### `plugin-api.js`

Defines the browser-facing API client for:

- workflow start/stop/steps
- workflow context notes
- workflow execution planning
- assistant chat
- pitch generation
- voice session endpoints
- surface-profile ensure

#### `plugin-host.js`

Abstracts the host platform.

Today it normalizes:

- `apiBaseUrl`
- `fetchImpl`
- local storage namespace
- session storage namespace
- platform identity such as `chrome-extension` vs `web-page`

This is one of the foundations for extension packaging and future host-specific adapters.

#### `plugin-events.js`

Simple event bus for plugin-level events.

Examples:

- `learning.session.started`
- `learning.context.captured`
- `workflow.execution.started`
- `voice.transcript.captured`
- `surface.profile.hydrated`

#### `plugin-learning-bridge.js`

Bridges voice transcripts into learning sessions.

It listens for:

- learning session start/finish
- captured voice transcripts

and emits:

- `learning.context.captured`

This is how “teach while speaking” is modeled today.

#### `plugin-learning-client.js`

Owns the learning-session controls on the browser side:

- start workflow recording
- stop workflow recording
- reset workflow recording
- sync recorder status into the UI

#### `plugin-execution-client.js`

Owns browser-side execution behavior:

- pending execution persistence
- URL normalization and resume logic
- DOM element resolution
- replay of `click`, `input`, `select`
- runtime automation notifications
- browser-side step execution loop

It is the module that actually moves through the page during extension/plugin replay.

#### `plugin-surface-profile-client.js`

Owns surface-profile hydration:

- build page context
- persist learning context notes
- ensure a surface profile exists for the current page
- merge profile output into runtime options

#### `plugin-voice-client.js`

Owns the public browser voice controls:

- start voice conversation
- stop voice conversation
- open phone microphone pairing
- process voice complaints
- restore stored phone session

The deep realtime implementation still partially lives in `trainer-plugin.js`, but the public control surface is now split out.

#### `plugin-trainer-shell.js`

Owns the visible trainer shell behavior.

It currently handles:

- open/close workflow panel
- open/close improvement panel
- open chat panel
- update panel expansion state
- update workflow/improvement/voice status text
- voice button state
- long-press binding for the learning button
- panel-level click handling for:
  - execute workflow
  - view workflow overlay
  - delete workflow

Architecturally, this is the UI-shell layer for the trainer, not the workflow engine itself.

### Page State

`page-state.js` remains the generic local form persistence helper.

## 4. Demo and Packaging Layer

Primary responsibility:

- provide realistic surfaces
- package the runtime for browser use

Current surfaces:

- medical demo pages
- injected car-rental demo
- Chrome extension build output

### Chrome Extension

Source:

- [chrome-extension-src/graph-trainer](C:/Users/User/Desktop/Graph/chrome-extension-src/graph-trainer)

Build script:

- [scripts/build-chrome-extension.js](C:/Users/User/Desktop/Graph/scripts/build-chrome-extension.js)

Built output:

- [generated/chrome-extension/graph-trainer](C:/Users/User/Desktop/Graph/generated/chrome-extension/graph-trainer)

The extension injects:

- recorder
- assistant runtime
- capability modules
- trainer plugin bootstrap

into arbitrary pages.

## Runtime Flow

### Learning flow

```text
User on page
  -> Trainer shell long-press / record control
    -> learning-client
      -> recorder
        -> /api/workflow/start
          -> LearningSessionService
          -> sessionId returned to browser
        -> /api/step (with sessionId)
          -> LearningSessionService
        -> /api/workflow/context-note (with sessionId)
          -> LearningSessionService
        -> /api/workflow/stop (with sessionId)
          -> LearningSessionService
          -> WorkflowLearner
            -> Neo4j
            -> catalog rebuild
```

### Assistant execution flow

```text
User asks for something
  -> assistant runtime chat
  -> trainer-plugin orchestration
  -> /api/agent/chat
    -> AgentChat
      -> WorkflowCatalog
      -> context filter
      -> page personality
      -> workflow decision
  -> /api/workflows/:id/plan
    -> WorkflowExecutor
  -> execution-client
    -> browser step replay
    -> assistant runtime movement + spotlight
```

### Surface-profile flow

```text
Page mounts
  -> surface-profile-client
    -> capture page snapshot
    -> /api/surface-profile/ensure
      -> SurfaceProfileService
      -> Neo4j SurfaceProfile
  -> trainer options updated
  -> assistant greeting / behavior updated for page + language
```

## Current Graph Model

Today Neo4j is used as a persistence graph, not as an execution language.

Current node types:

- `Workflow`
- `Step`
- `SurfaceProfile`

Current relationship types:

- `HAS_STEP`

Conceptually:

```text
(Workflow)-[:HAS_STEP]->(Step)

(SurfaceProfile) is stored separately and looked up by
appId + pathname + scope + ownerId + languageCode
```

Important implications:

- workflows are stored as graph data, but replay is driven by JavaScript services
- Cypher is only used by repository methods
- there is no user-facing “workflow shell language”
- step order is explicit numeric data, not inferred from graph topology

## Current Limits

The architecture is much better aligned than before, but still incomplete.

Main current limits:

- `web/public/trainer-plugin.js` is still too large, even after capability extraction
- the deep realtime voice implementation still partially lives in `web/public/trainer-plugin.js`
- workflow and surface-profile persistence still live together in one Neo4j repository
- catalog publication is still coupled to learning/catalog services
- the private workflow model is not activated yet

## Recommended Direction

Near-term architecture work should continue to strengthen:

1. making `trainer-plugin.js` a true composition root
2. moving the remaining deep voice/realtime internals behind `plugin-voice-client.js`
3. splitting `WorkflowRepository` and `SurfaceProfileRepository`
4. formalizing one shared context contract end-to-end
5. preparing workflow visibility fields for future private workflows

That path preserves the current product shape:

- global workflows first
- page-aware assistant behavior
- extension/plugin runtime
- future optional private memory and private workflows
