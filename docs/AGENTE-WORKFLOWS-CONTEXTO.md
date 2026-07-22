# Contexto para el agente de WORKFLOWS

> Briefing de onboarding. Misión: hacer que la app Windows sea **un rey ejecutando
> workflows**. Este doc es el mapa completo del sistema tal como está HOY (2026-07).
> La fuente de verdad final es el código; verifica antes de asumir.

## 1. La visión en 3 frases

- **Graph** es el backend central (hub). Las superficies (Windows, Android, Web) son
  frontends "tontos": Graph decide **QUÉ**, la superficie decide **CÓMO**. Esa costura
  es sagrada.
- Hay dos modos de ejecución: **consciente** (computer-use puro, loop OpenAI/Gemini vía
  `POST /api/v1/agent/turn`) y **subconsciente** (workflows aprendidos, expuestos al LLM
  **vía MCP** — MCP es el intermediario entre el LLM y los workflows: descubrimiento
  dinámico + invocación). Hoy están conectados en una dirección: el consciente invoca
  workflows y **aprende** (ej. alineación de superficie) reescribiéndolos.
- Tres fuentes alimentarán el subconsciente: la ejecución consciente, la ejecución del
  usuario (grabación de steps UIA/SAP), y la enseñanza por video. El botón **🎓 Enseñar**
  de la app ya unifica steps + video en un gesto.

## 2. Repos y deploy

| Repo | Ruta local | Qué es |
|---|---|---|
| **Graph** | `C:\Users\felip\OneDrive\Documentos\Code\Graph` | Backend Node/Express. Deploy: Vercel `graph-eight-pied.vercel.app`, auto-deploy al pushear `main` (remoto `github.com/joseph1356k/Graph`). Neo4j (workflows), Supabase (memoria agente, teach), Provider Studio (panel admin). |
| **windows-app** | `C:\Users\felip\OneDrive\Documentos\Code\windows-app` | Cliente WPF/.NET 8 → `U.exe`. `windows-client/` (carita, agente, teach) + `windows-graph/` (workflows UIA/SAP, compilado dentro de U.exe). **Sin remoto GitHub** (solo commits locales). |

- Build cliente: `dotnet build windows-client\WindowsClient.csproj -c Debug` (cerrar
  `U.exe` primero: bloquea el binario). Ejecutable:
  `windows-client\bin\x64\Debug\net8.0-windows\U.exe`.
- Auth `/api/v1`: header `X-API-Key` (formato `miracle_…`); la key del cliente vive en
  `%APPDATA%\U\graph.json`. **Nunca imprimirla ni hardcodearla.**
- Trabajamos **directo en producción** (no hay usuarios). Verificar cada deploy con curl.

## 3. El pipeline de workflows, end-to-end

```
ENSEÑAR (cliente)                    GRAPH (hub)                       EJECUTAR (cliente)
🎓 WorkflowTeachSession       POST /api/v1/learning/sessions     chat/consciente → agent/turn
  ├ WorkflowRecorder (steps)    ├ steps → Neo4j (:Workflow/:Step)    └ tool workflow_* → args.workflow_id
  └ TeachSession (video→Gemini) ├ finish → WorkflowLearner:        WorkflowMcpRunner
     summary → context-note     │   summary + executionGuide         └ WorkflowPlayer.RunAsync
                                │   + título automático                 ├ GetPlanAsync (plan filtrado)
                                │   + valueMode por step (LLM)          ├ SurfaceMismatch / Aligner
                                └ catálogo: WorkflowCatalog             ├ CollapseInputRuns
                                                                        └ IUiSurface.Execute por step
```

### Grabación
- `windows-client/src/Teach/WorkflowTeachSession.cs` — orquesta recorder + video en
  paralelo. ORDEN CRÍTICO al parar: video→summary→`AddContextAsync` ANTES de
  `recorder.StopAsync()` (que cierra la sesión en Graph).
- `windows-graph/src/WorkflowRecorder.cs` — observa la superficie (evento `StepObserved`),
  encola y manda steps (`POST /learning/sessions/:id/steps`; body **camelCase**:
  `actionType`, no `action_type`).
- Título ya NO es obligatorio: vacío → Graph lo autogenera del summary
  (`WorkflowLearner.finishSession` → `completeWorkflow(..., autoTitle)`).

### Modelo de datos (Graph)
- `src/domain/entities/Workflow.js` + `Step.js`. Variables NO se almacenan: se **derivan**
  (`inferVariables()`): `input_N` (inputs/selects) y `target_N` (clicks "transversales"
  con `semanticTarget`). Steps 1-indexed; el step de alineación usa `stepOrder: 0`.
- **`valueMode` por step** (los "3 escenarios", ver §5): `fixed | dynamic | flexible`
  (+ `bindTo`), default `fixed`, persistido en Neo4j, clasificado por el LLM al terminar
  la grabación (`WorkflowExecutionGuideBuilder.classifyValueModes`).
- Persistencia: `src/infrastructure/repositories/Neo4jWorkflowRepository.js`.
  `updateFullWorkflow` REEMPLAZA todos los steps (no toca branches → **no reindexar**
  stepOrders al insertar; usar 0/negativos).

### Exposición (MCP)
- Catálogo del cerebro por turno: `AgentTurnService.assembleTools` →
  `AgentWorkflowStore.workflows(userId, apps, surface)` → Neo4j. Declara TODOS los
  workflows con steps (los de la superficie actual primero, el resto anotado
  `[app: x.exe]`), cap 30. El turno inyecta `workflow_id` en los args de la llamada.
- Servidor MCP real: `web/api/registerMcpRoutes.js` — `POST /api/v1/mcp` (JSON-RPC 2.0
  stateless): `initialize`, `tools/list`, `tools/call` (devuelve el PLAN; Graph nunca
  ejecuta). Superficie por headers `X-Surface-Origin`/`X-Surface-Pathname`.
- Prompt del cerebro: `src/infrastructure/conscious-brain/prompt.js` — "REGLA DE ORO":
  si el objetivo coincide con un workflow, la primera acción es llamarlo. Prohibido
  usar terminal para abrir apps (launch_app o computer-use).

### Ejecución (cliente)
- `windows-graph/src/WorkflowPlayer.cs` — pide el plan, verifica superficie
  (`SurfaceMismatch`: origin siempre; pathname solo en `web://`/`sapgui://` — en `uia://`
  el pathname es el documento, no identidad), se **alinea conscientemente** si no estamos
  ahí (`Aligner` → `AppAligner.EnsureAsync`: enfocar o lanzar la app y confirmar con el
  locator), y **aprende**: si se alineó, `PrependAlignmentStepAsync` → Graph antepone el
  step `app:<proc>` en orden 0 (idempotente). Colapsa runs de `input` consecutivos al
  mismo selector (SetValue reemplaza; solo importa el último) → escritura instantánea.
  Log terse vía delegate `Log` (el cliente enchufa `LogBus`, tag `workflow`).
- Superficies: `windows-graph/src/Surfaces/` — `UiaSurface` (UIA + selectores
  `uia:aid=…;ct=…` / `name=` / `path=`) y `SapGuiSurface` (SAP GUI Scripting, selectores
  `sap:`; identity `sapgui://SID/TCODE`). `IUiSurface` es LA abstracción; el player
  reelige superficie por step. `flexible` en ejecución: exacto → aproximado → saltar sin
  romper.
- Invocación desde el cerebro: `windows-client/src/Mcp/WorkflowMcpRunner.cs` (acción
  `mcp` con tool `workflow_*` → player con `strictSurface: true`).

## 4. El "URL de Windows" (localización)

`windows-client/src/Uia/SurfaceLocator.cs` — ID jerárquico de dónde está parado el
usuario: `uia://proceso.exe/titulo-slug`, `web://dominio/ruta` (lee la omnibox por UIA),
`sapgui://SID/TCODE`. Visible en un badge flotante (`LocatorBadge`). Es el MISMO formato
que `source_url` de los workflows → scoping, mismatch y alineación comparten este eje.
Viaja en cada turno (`ScreenState.surfaceId/Origin/Pathname`).

## 5. Los 3 escenarios de coincidencia (doc clave)

Leer `Graph/web/public/studio-docs/coincidencia-superficie-estado.md` (también visible en
el Provider Studio → panel Documentación). Resumen: si un workflow exige el estado exacto
de la grabación **lo decide el LLM** por step vía `valueMode`:
- `fixed` — valor exacto enseñado, nunca se sustituye.
- `dynamic` — valor por-ejecución (contexto/usuario); `bindTo` ata a otra variable
  ("el paciente del paso 5 = el del paso 4"). **La sustitución dinámica por contexto es
  la FASE SIGUIENTE (no implementada).**
- `flexible` — el valor exacto no importa; best-effort y se salta sin romper.

**OJO:** workflows grabados antes de `valueMode` tienen todo `fixed` → re-grabar para que
el LLM clasifique (ej. la pestaña "Sin título" de Notepad debería ser flexible).

## 6. Estado real / deuda conocida (dónde ser rey)

1. **`dynamic` + `bindTo` end-to-end**: clasificado y persistido, pero la sustitución
   por-ejecución (tomar el valor del contexto del chat / de otro step) no corre aún.
   Es el próximo gran paso.
2. **Re-grabar el workflow de prueba** de Notepad (el viejo `wf_1784650978562` tiene 48
   inputs y un select frágil; `wf_1784646300474` es un dummy sin pasos reales — borrable).
3. **Alineación multi-paso**: hoy alinear = enfocar/abrir la app. Navegar DENTRO de la
   app hasta que el primer step sea visible (con computer-use consciente) es la evolución.
4. **SAP**: el árbol de lectura ya añade SAP GUI Scripting al UiContext
   (`SapContextReader`, gate: proceso `sap*`); scripting habilitado en server y cliente
   del usuario. Falta probar grabación/ejecución real de workflows SAP en su máquina.
5. **Reinicio en caliente de la enseñanza** (🔄): `WorkflowTeachSession.RestartAsync` no
   existe aún (detener y volver a empezar).
6. **Branches**: `WorkflowBranchPlanner` existe en Graph (referencian steps por
   stepOrder — otra razón para NO reindexar). Poco ejercitado desde Windows.
7. **Knowledge base futura**: markdown estilo Skills + índice Neo4j, anidada al ID de
   superficie + step. Solo visión, no empezar sin diseñar con el usuario.

## 7. Reglas de trabajo (importan)

- **Contratos espejo**: `windows-client/src/Domain/Protocol.cs` ↔ `AgentTurnService.js`
  (turno) y `windows-graph/src/Contracts.cs` ↔ rutas públicas de Graph. Si tocas un lado,
  toca el otro. La matriz de códigos HTTP y los nombres JSON son sagrados.
- El planner filtra steps: solo `input|select|click` (con selector) y `navigation` (con
  url) sobreviven (`WorkflowExecutor.isExecutableStep`).
- Comentarios y UI en español, con la voz del código existente (explican POR QUÉ).
- Verificar antes de desplegar: `node --check` + boot local (`PORT=3999
  MIRACLE_API_KEYS=test:testkey123 node web/server.js`) + curl; el cliente compila con
  0 warnings. Tras push, sondear `graph-eight-pied` con curl (la key real está en
  `%APPDATA%\U\graph.json`; no imprimirla).
- **Cuidado con el working tree**: el usuario suele tener WIP sin commitear (p.ej.
  `FaceWindow`/carita en windows-app, o rediseños del Studio en Graph). Commitear SOLO
  tus archivos; nunca `git add -A` a ciegas; jamás revertir lo que no escribiste.
- Logs del cliente: `LogBus` → botón 📜 (tags: `workflow`, `align`, `sap`, `teach`,
  `workflow-ui`). Es la herramienta #1 para depurar con el usuario: pídele las líneas.
- Los 500 de `agent/turn` con "OPENAI_API_KEY no está configurada" en local son normales
  (la config del modelo vive en env de Vercel).

## 8. Cómo verificar rápido que todo vive

```bash
B=https://graph-eight-pied.vercel.app; K=<key de %APPDATA%\U\graph.json>
curl -s $B/api/v1 -H "X-API-Key: $K"                       # manifest
curl -s -X POST $B/api/v1/mcp -H "X-API-Key: $K" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'       # MCP (con X-Surface-* para scoping)
curl -s $B/api/v1/workflows -H "X-API-Key: $K"              # catálogo crudo
```

En la app: 🎓 enseñar (countdown 3s → cambiar a la app objetivo), 🧭 (en Backend) para
ejecutar a mano, 📜 para logs, badge arriba-derecha = ID de superficie.
