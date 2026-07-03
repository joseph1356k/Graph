# Graph

Graph is a workflow learning and replay engine for web applications.

It watches a user interact with a page, stores the workflow as structured steps, and later lets an assistant choose and execute the right workflow with Playwright.

The real product is the reusable browser runtime plus the Chrome extension host that can attach to arbitrary pages. The medical demo is the current validation surface, not the product boundary.

The long-term direction is not a single demo app. The product direction is a reusable plugin-style system that can be mounted on different surfaces:

- static HTML pages
- React apps
- WordPress sites
- Shopify sites
- Electron apps

The medical demo is the current proving ground for the learning loop.

## Core Idea

Graph closes this loop:

1. A user performs actions in a page.
2. The recorder captures those actions as structured steps.
3. The workflow is persisted in Neo4j.
4. A catalog is regenerated for discovery and execution.
5. An assistant chooses the right workflow for the current page context.
6. Playwright replays the workflow and fills missing values.

## Auth

Local only, no third-party identity provider: an admin login (`web/api/requireAuth.js`, username/password from env) protects the dashboard and the learning-capture API, and an opt-in local anonymous guest mode (`ALLOW_LOCAL_ANONYMOUS`) covers the public demo pages. This repo does not persist patient/encounter data — it is a stateless backend that serves transcription, note-organization, and autofill to client apps.

## Architecture

The codebase is moving toward three layers:

1. Learning and execution core
   - workflow entities
   - workflow catalog
   - workflow selection
   - Playwright execution
   - Neo4j persistence

2. Page plugin layer
   - recorder
   - floating trainer widget
   - page-scoped persistence
   - page context and assistant personality

3. Demo and integration surfaces
   - medical demo
   - future plugin entrypoints for external pages/apps

For a deeper explanation, see [ARCHITECTURE.md](C:/Users/User/Desktop/Graph/ARCHITECTURE.md).

## Main Runtime Pieces

- [web/server.js](C:/Users/User/Desktop/Graph/web/server.js)
  - Express server
  - serves demo pages
  - exposes workflow and agent APIs

- [web/public/recorder.js](C:/Users/User/Desktop/Graph/web/public/recorder.js)
  - generic DOM action recorder
  - captures `navigation`, `click`, `input`, and `select`

- [web/public/trainer-plugin.js](C:/Users/User/Desktop/Graph/web/public/trainer-plugin.js)
  - floating trainer widget
  - workflow recording controls
  - agent chat entrypoint
  - page context and assistant personality wiring

- [web/public/assistant-runtime.js](C:/Users/User/Desktop/Graph/web/public/assistant-runtime.js)
  - reusable floating assistant body
  - guided spotlight and page-tour runtime
  - execution telemetry surface for Playwright and future voice/memory features

- [web/public/page-state.js](C:/Users/User/Desktop/Graph/web/public/page-state.js)
  - generic page form-state persistence

- [chrome-extension-src/graph-trainer](C:/Users/User/Desktop/Graph/chrome-extension-src/graph-trainer)
  - Chrome-specific host wrapper
  - injects the shared runtime into arbitrary pages

- [scripts/build-chrome-extension.js](C:/Users/User/Desktop/Graph/scripts/build-chrome-extension.js)
  - local packaging script for the Chrome extension
  - writes ignored build output into `generated/chrome-extension/`

- [src/application/use-cases/AgentChat.js](C:/Users/User/Desktop/Graph/src/application/use-cases/AgentChat.js)
  - workflow selection
  - page-context filtering
  - assistant personality prompt shaping

- [src/application/use-cases/WorkflowExecutor.js](C:/Users/User/Desktop/Graph/src/application/use-cases/WorkflowExecutor.js)
  - workflow replay with Playwright
  - select-option choice handling via LLM

- [src/infrastructure/LLMProvider.js](C:/Users/User/Desktop/Graph/src/infrastructure/LLMProvider.js)
  - LLM transport
  - currently supports OpenRouter-first configuration

## Demos

### Medical Demo

Pages:

- [web/public/index.html](C:/Users/User/Desktop/Graph/web/public/index.html)
- [web/public/page1.html](C:/Users/User/Desktop/Graph/web/public/page1.html)
- [web/public/page2.html](C:/Users/User/Desktop/Graph/web/public/page2.html)

Characteristics:

- uses `appId: medical-demo`
- mounts the generic trainer plugin
- uses a neutral, professional assistant profile
- serves as the current validation surface for the shared runtime

## Context-Aware Workflows

Workflows are no longer treated as globally interchangeable.

Each learned workflow can store page/application context such as:

- `appId`
- `sourceUrl`
- `sourcePathname`
- `sourceTitle`

This lets the assistant avoid using a workflow from the wrong page surface.

## Assistant Personality

Assistant personality is part of the page plugin configuration.

Today the medical demo uses a clinical, concise profile. This is passed through the page plugin into the agent selection prompt.

## Product Boundary

When working in this repo, the product should be understood in this order:

1. shared learning and execution core in `src/`
2. shared browser runtime in `web/public/` and `web/public/plugin/`
3. Chrome extension host in `chrome-extension-src/graph-trainer/`
4. local demo surfaces used to validate the shared runtime

That means the medical pages are examples of the runtime in action, not the long-term shape of Graph itself.

## Running the Repo

1. Install dependencies:

```bash
npm ci
```

On this Windows setup, prefer `npm.cmd` for npm scripts when PowerShell blocks `npm.ps1`.

2. Start the web server:

```bash
node web/server.js
```

3. Open one of the demos:

- `http://localhost:3000/`
- `http://localhost:3000/page1.html`
- `http://localhost:3000/page2.html`

## Building the Chrome Extension

1. Generate the unpacked Chrome extension locally:

```bash
npm.cmd run build:chrome-extension
```

2. Load the unpacked folder in Chrome:

- `chrome://extensions`
- enable Developer mode
- click `Load unpacked`
- select `C:\Users\User\Desktop\Graph\generated\chrome-extension\graph-trainer`

Notes:

- `generated/chrome-extension/` is local build output and is intentionally ignored by Git.
- rebuilding the extension refreshes the packaged runtime after changes in `web/public/` or `chrome-extension-src/graph-trainer/`.

## Environment Variables

Main environment variables used today:

- `AZURE_FOUNDRY_BASE_URL` (optional, takes precedence for workflow-note matching)
- `AZURE_FOUNDRY_API_KEY` (optional, takes precedence for workflow-note matching)
- `AZURE_FOUNDRY_MODEL` (optional, deployment/model id such as `DeepSeek-V4-Flash`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional)
- `OPENAI_API_KEY` (optional fallback path)
- `OPENAI_MODEL` (optional)
- `NEO4J_URI`
- `NEO4J_USER`
- `NEO4J_PASSWORD`
- `WEB_PORT`
- `LOCAL_ADMIN_USERS` / `LOCAL_ADMIN_PASSWORD` (local admin login for the dashboard)
- `ALLOW_LOCAL_ANONYMOUS` (opt-in guest mode for public demo pages)

## Current State

The system already supports:

- learning workflows from user actions
- persisting workflows in Neo4j
- catalog regeneration
- replay with Playwright
- select choice assistance through the LLM
- page-context filtering
- per-page assistant personality
- a reusable floating assistant runtime for guided movement on the page
- generation of `improvement-tour.json` alongside pitch artifacts

Still intentionally incomplete:

- segmenting workflows into reusable sub-blocks
- advanced ranking among many similar workflows on the same page
- production-grade packaging as a browser/Electron plugin
- adapters for frameworks beyond the current demos
- real-time voice input/output
- assistant-managed long-term memory and CRM sync
