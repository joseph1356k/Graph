# Guía de implementación — Agente visual (estado real)

Guía breve de construcción (no entregable). Estado tras la primera versión funcional.
Contrato y decisiones: ver `PLAN_DEMO_COMPUTER_USE_VISUAL.md`.

## Qué se construyó
Cliente de Computer Use **visual** en la extensión: `screenshot → /api/v1/agent/turn →
acciones (mouse/teclado/scroll/navigate) → nueva screenshot → …`. Dentro de la página
todo es visual (sin DOM/selectores/AX-tree/MCP-que-resuelve/workflows). `chrome.tabs`
solo transporta; `chrome.debugger`/CDP son los ojos y manos.

## Piezas
**Backend (aditivo, no toca Windows):**
- `src/domain/agent/mcpCatalog.js` — `navigateTool` + `browserVisualCatalog()` (única herramienta: `navigate`).
- `src/infrastructure/conscious-brain/prompt.js` — `browserGoalPrompt` (visión, sin Windows/UIA).
- `src/infrastructure/conscious-brain/openaiBrain.js` — en `s.mode==='browser-visual'`: usa
  `browserGoalPrompt`, tool `computer` con `display_width/height/environment:'browser'`, sin `list_apps`,
  y siempre reenvía el frame actual aunque el turno previo fuera `navigate`.
- `src/application/use-cases/AgentTurnService.js` — si `state.mode==='browser-visual'`: `tools=[navigate]`
  (sin baseCatalog/aprendidas/workflows) y marca `session.mode`.

**Extensión:**
- `manifest.json` — permisos `debugger` + `sidePanel`; `side_panel.default_path`.
- `visual-agent-core.js` — **núcleo agnóstico del transporte** (loop + mapeo acción→CDP). Fuerza DPR=1
  (escala 1). Se prueba con Playwright y corre igual con `chrome.debugger`.
- `visual-agent.js` — runner en el service worker: `chrome.debugger` (CDP), `chrome.tabs` (navigate),
  estado en `chrome.storage.session`, `fetch` a `/api/v1/agent/turn` con `X-API-Key`. Una tarea activa.
- `background.js` — `importScripts` + mensajes `mira:agent-start|stop|get-state`.
- `sidepanel.html/js` — panel persistente: meta, Start/Stop, estado, log por turno, última captura.
- `popup.html/js` — botón "Abrir agente visual" (abre el Side Panel).

## Contrato de acciones (real) → CDP
`tap{x,y}`→mousePressed/Released · `type{x,y?,text}`→click+Input.insertText · `key`→dispatchKeyEvent
(enter→Enter, back→Escape) · `scroll{down}`→mouseWheel ±600 · `swipe`→press/move/release · `wait{ms}` ·
`mcp{navigate,{url}}`→chrome.tabs.update. Coordenadas px absolutos, **escala 1** (DPR=1 forzado).

## Pruebas (reproducibles)
- `node scripts/test-visual-mode.js` — modo visual del backend con mocks (tools=[navigate], marca de
  sesión, shape del contrato, regresión Windows, `browserGoalPrompt`). **Solo deps del repo.**
- `node scripts/visual-loop-harness.js` — loop real con Playwright+CDP y brain mock (acciones genéricas):
  captura/click/type/key/scroll/navigate/continuidad/cancelación/detach. Requiere Playwright global
  (`NODE_PATH=/opt/node22/lib/node_modules`).
- `node scripts/visual-integration-harness.js` — loop real + `AgentTurnService` real (HMAC de sesión,
  gating visual), solo LLM mock. Requiere Playwright global.

## Correr en Chrome real (demo)
1. Backend con `MIRACLE_CONSCIOUS_LLM_PROVIDER`+key+modelo con computer-use, y `MIRACLE_API_KEYS`.
2. `npm run build:chrome-extension` → cargar `generated/chrome-extension/graph-trainer` como desempaquetada.
3. Icono → "Abrir agente visual" → en el Side Panel poner backend URL + API key → meta → Iniciar.

## Pendiente (orden)
1. Validar el path real en Chrome del usuario (modelo con computer-use + sesión logueada).
2. Confirmar el shape del tool `computer` contra el modelo real (display_*/environment).
3. Robustez YouTube → Calendar/ChatGPT (esperas, scroll, teclas).
4. Keepalive del service worker (`chrome.alarms`) para tareas largas.
