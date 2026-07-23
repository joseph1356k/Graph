# Plan: Agente de control del navegador (Miracle → "toma el control")

> **Objetivo de este documento.** Definir, con base en el código que ya existe,
> cómo convertir a Miracle de un asistente que **llena un formulario aprendido en
> una sola página** a un **agente que toma control del navegador**: abre pestañas,
> navega a cualquier sitio y ejecuta tareas en lenguaje natural.
>
> Casos objetivo (lo que el usuario quiere poder decir y que suceda):
> - *"Abre Google Calendar y agéndame una reunión el martes a las 3."*
> - *"Ve a ChatGPT y genérame una imagen de un gato astronauta."*
> - *"Abre YouTube, busca un video de cómo hacer pan y ponlo a reproducir."*
>
> **Rama de trabajo:** `claude/browser-control-agent-plan`
> **Repo:** `Graph` (es donde vive toda la base — ver §1).
> **Estado:** documento de planeación. Todavía no hay código nuevo de esta feature.

---

## 0. Resumen ejecutivo (TL;DR)

El hallazgo central del análisis es que **buena parte de esta visión ya está
diseñada y construida**, pero repartida en dos "mitades" que hoy no se tocan:

1. **El cerebro ya es general.** El backend tiene un **"conscious brain"** (agente
   "Ü") que toma una meta en lenguaje natural y devuelve **acciones** turno por
   turno (patrón *observar → decidir → ejecutar*), usando modelos con *computer-use*
   y un **catálogo de herramientas genéricas** (`open_url`, `create_event`,
   `web_search`, `send_email`, `launch_app`, `set_timer`…). No tiene nada clínico.
   Vive en `src/infrastructure/conscious-brain/` y se expone en `POST /api/v1/agent/turn`.

2. **El cuerpo ya sabe actuar sobre páginas.** La extensión Chrome se inyecta en
   **cualquier** sitio (`<all_urls>`) y tiene un motor sólido para hacer click,
   escribir, seleccionar, esperar elementos y navegar — con confirmación humana.

**El problema:** esas dos mitades **no están conectadas en el navegador**. El
cerebro general (conscious brain) hoy tiene como cliente ejecutor la **app de
Windows**, no la extensión. Y el motor del navegador solo sabe **reproducir un
formulario ya aprendido en un solo tab** — no abre pestañas, no navega libremente
entre sitios, y el `background.js` es un simple proxy sin estado.

**Por lo tanto, el trabajo NO es "construir un agente desde cero".** Es:
- **(A)** Conectar el cerebro general al navegador (un cliente ejecutor en la extensión).
- **(B)** Darle al navegador control de pestañas y navegación (orquestador con estado en el service worker).
- **(C)** Agregar percepción en vivo de páginas nunca entrenadas y un vocabulario de acciones web.
- **(D)** Poner una capa de confirmación/seguridad para acciones consecuentes.

Esto es un atajo enorme respecto a empezar de cero.

---

## 1. Por qué el repo es `Graph`

Todo lo necesario ya está en `Graph`:

- La **extensión MV3** (`chrome-extension-src/graph-trainer/`) con inyección universal.
- El **motor de ejecución** en el navegador (`web/public/plugin/plugin-execution-client.js`).
- El **grabador de workflows** (`web/public/recorder.js`).
- El **cerebro general** (`src/infrastructure/conscious-brain/`) y su API (`web/api/registerWindowsAgentRoutes.js`, `registerMcpRoutes.js`).
- El **backend híbrido** Node + Python y la persistencia (Neo4j para workflows).

`Android` y `Pagina-web-clientes-final` no aportan la base para esto. El agente de
escritorio (app Windows) que hoy consume el conscious brain vive en **otro repo**
(según `ARQUITECTURA_Y_PLAN.md`), pero **el cerebro que consume está aquí**, así
que aquí construimos el cliente-navegador equivalente.

---

## 2. Estado actual — las tres capas mapeadas

### 2.1 Capa de ejecución en el navegador (el "cuerpo")

**Archivo núcleo:** `web/public/plugin/plugin-execution-client.js`.

Es un **driver de un solo tab, mismo documento**. Lo que ya hace bien:

- **Primitivas de acción DOM con fidelidad de eventos:**
  - `click` (`:1559`): `scrollIntoView` → verifica `disabled` → `element.click()`.
  - `input` (`applyInputStep`, `:766`): focus, set `value`/`checked`, dispara `input`+`change`, `blur`.
  - `select` (`applySelectStep`, `:1059`): espera la opción, secuencia pointer/mouse/click, fija índice, dispara eventos, **verifica** que pegó, con **fallback de flechas de teclado** y `showPicker()`.
- **Resolución de elementos robusta** (`resolveElementFromStep`, `:474`): selector CSS → fallback por label exacto → **retargeting semántico** de clicks (`scoreTransversalTargetCandidate`, `:402`, umbral ≥90).
- **Espera y descubrimiento** (`waitForStepElement`, `:626`): poll cada 120 ms hasta 15 s; si un click no aparece, hace un **barrido de scroll** (`sweepSurfaceForStep`, `:592`) para revelar contenido lazy.
- **Navegación mismo-tab + resume:** los pasos `navigation` hacen `window.location.assign` (`:1514`) y el plan continúa tras el reload leyendo de `sessionStorage` (`persistPendingExecution`, `:45`).
- **Auto-reparación en ejecución** ("runtime intelligence", `/api/workflows/:id/intelligence`): decisiones `continue/patch_step/skip_step/retry_step/ask_user/abort`.
- **Autofill dinámico** (`createDynamicFillSession`, `:1695`): nota en lenguaje natural → backend LLM (`NoteFieldMatcher`) → `{stepOrder→value}` → aplica al DOM con **undo** y auditoría.

**Límites duros (lo que bloquea la visión):**
- Solo **un tab, mismo documento**. La única navegación es `window.location.assign` — **no hay `chrome.tabs` ni `window.open` en ningún lado** del path de automatización.
- Los pasos `key` (teclado) se aceptan pero **no se ejecutan** (caen en un `else` que solo avanza el índice, `:1629`). `scroll` solo existe como heurística interna de descubrimiento, no como acción.
- Un workflow está **clavado a un origin + pathname**: no hay noción de tarea multi-sitio.
- Ejecución **secuencial, un workflow a la vez**, con estado singleton. No hay "abre un tab, haz X, vuelve".
- Selectores frágiles en SPAs (CSS exacto / label exacto); las regex de secciones están hardcodeadas al demo médico.

### 2.2 Capa de extensión (el "sistema nervioso")

**Archivos:** `chrome-extension-src/graph-trainer/{manifest,background,content,popup}.js`.

- **Inyección universal declarativa:** `manifest.json` matchea `<all_urls>` y carga el runtime compartido (`web/public/*` empaquetado como `assets/*`) + `content.js`. **No usa `chrome.scripting`** — todo es inyección estática de manifest.
- **`content.js`** monta el asistente **solo en el top frame** (`:564`), una vez por hostname. El workflow se crea como *"Workflow on `<hostname>`"* → **inherentemente de un solo sitio**.
- **`background.js` = broker sin estado.** Solo hace: login local-admin, guardar token en `chrome.storage.local`, y **proxy de API** (`proxyApiFetch`, `:90`) que solo permite llamadas a `/api/*` del backend configurado. **No tiene ninguna máquina de estados ni orquestación.**
- **El permiso `tabs` está casi sin usar:** solo el popup hace `chrome.tabs.query`/`sendMessage` al tab activo. **Cero `chrome.tabs.create/update`, cero `chrome.scripting`, cero `chrome.debugger`, cero `chrome.webNavigation`** en todo el repo.
- **El mismo JS se comparte** entre la web app y la extensión (`scripts/lib/chrome-extension-bundle.js`); la única diferencia se resuelve en runtime con `GraphPluginHost.detectPlatform()` (cambia `fetch` por el proxy del service worker).
- **Grabar workflows** (`recorder.js`): captura clicks/inputs/selects con selectores robustos (`data-testid`→`#id`→`[name]`→`a[href]`), label, `semanticTarget`, `alternativeTargets`, `surfaceSection`; cada paso se POSTea en vivo (`/api/workflow/start` → `/api/step` → `/api/workflow/stop`).

### 2.3 Capa de cerebro (backend) — hay **tres** planificadores

**Ubicación:** `src/` (Node) + `bounded/miracle-ai/` (Python), tras Express (`web/server.js`).

1. **Motor de aprendizaje/replay ("subconsciente").** Graba interacciones → Neo4j (`Workflow`, `Step`, `WorkflowBranch`, `SurfaceProfile`) → plan de ejecución determinista. **Sin LLM en tiempo de plan** (la "inteligencia" se horneó al aprender). `WorkflowExecutor.buildExecutionPlan` (`src/application/use-cases/WorkflowExecutor.js:22`).

2. **⭐ Conscious brain ("Ü") — el planificador NL→acciones REAL y GENERAL.** Este es el descubrimiento clave.
   - Entrada: `POST /api/v1/agent/turn` → `AgentTurnService.handleTurn` (`src/application/use-cases/AgentTurnService.js:75`).
   - Arma el catálogo de herramientas del turno (gestos base + tools del sistema + workflows del *surface* actual), carga **memoria del usuario**, y llama al **brain**.
   - Prompt server-side en `src/infrastructure/conscious-brain/prompt.js:37` — inyecta la meta, la lista de tools, la memoria y un bloque de estado de pantalla/UI-tree, y el modelo elige entre **function-calling** o **computer-use**.
   - Adaptadores: `openaiBrain.js` (OpenAI **Responses API**, tool nativo `{type:'computer'}`) y `geminiBrain.js`. Devuelven `BrainTurn = { actions[], question, done, text }`. Las acciones son taps/types/keys/scrolls/llamadas MCP.
   - **El cliente ejecuta; el servidor solo decide.** El bucle (screenshot → decidir → ejecutar → repetir) corre en el cliente; cada `/agent/turn` es stateless.
   - **Catálogo MCP genérico** (`src/domain/agent/mcpCatalog.js`): `launch_app`, `create_event`, `web_search`, `open_url`, `open_maps`, `send_email`, `set_timer`. **Cero contenido clínico.**
   - **MCP server** (`/api/v1/mcp`, JSON-RPC): `tools/list` scoped por surface (`X-Surface-Origin`/`X-Surface-Pathname`), `tools/call` devuelve el plan de ejecución.

3. **Orquestador de nota clínica (Python).** Voz → transcripción (Deepgram) → nota estructurada + `agent_tasks`. Es **ortogonal** a esta feature; se puede dejar intacto.

**Proveedores de IA hoy:** OpenAI (Responses/computer-use) + Google Gemini para el brain; OpenAI/OpenRouter/Azure/Google (compat) vía `LLMProvider` para matching/summaries. **No se usa Anthropic Claude en ningún lado.** Los modelos por defecto en config (`gpt-5.6`, `gemini-3.5-flash`) parecen **placeholders/aspiracionales** — hay que fijar modelos reales (ver §7 y §9).

**Acoplamiento clínico:** el **planificador y el motor de workflows son generales**; lo clínico es una **aplicación encima** (rutas `Clinical*` + Supabase + pipeline de voz Python), aislada. Es decir: no hay que "des-acoplar" el cerebro — ya es general.

---

## 3. El gap: qué separa "hoy" de "la visión"

| # | Falta | Por qué es necesario para los casos objetivo |
|---|---|---|
| G1 | **Cliente ejecutor del conscious brain en el navegador** | El cerebro general ya existe pero su único cuerpo es la app Windows. Sin un cliente browser que consuma `Action[]`/`tools/call`, el navegador no puede usar el cerebro general. |
| G2 | **Orquestador con estado en el service worker** | Abrir Calendar/YouTube/ChatGPT y coordinar pasos entre pestañas requiere una máquina de estados que **sobreviva navegaciones** (el estado del content-script muere al navegar). Hoy `background.js` no tiene estado. |
| G3 | **Control real de pestañas y navegación** | `chrome.tabs.create/update/query`, `chrome.scripting.executeScript`, `chrome.webNavigation` (saber cuándo cargó un tab). Hoy: cero. |
| G4 | **Percepción en vivo de páginas nunca entrenadas** | Calendar/YouTube/ChatGPT no están "aprendidos". Hace falta un snapshot de la página (árbol DOM/accesibilidad + opcional screenshot) que se manda al cerebro para decidir la siguiente acción. |
| G5 | **Vocabulario de acciones web ejecutable** | `navigate`, `openTab`, `switchTab`, `pressKey`, `scroll`, `hover`, `waitFor`, `extractText`, `uploadFile`, y travesía de `iframe`/shadow-DOM. Hoy solo click/input/select en un documento. |
| G6 | **Representación de plan multi-sitio** | "Copia el link de este video a un evento de Calendar" cruza dos orígenes. Hoy un workflow = un origin. |
| G7 | **Confirmación humana para acciones consecuentes** | Enviar, publicar, comprar, borrar, agendar. Existe la *filosofía* propose→confirm; falta el gate general. |
| G8 | **Persistencia real de "learned tools"** | `InMemoryAgentLearningStore` es un **stub** que se pierde en frío (TODO marcado en `src/domain/agent/learning.js`). Sin esto no hay aceleración por aprendizaje. |
| G9 | **Permisos nuevos en el manifest** | `scripting`, `webNavigation`, opcional `debugger`; y ejercer `tabs` de verdad. |
| G10 | **Selectores generalizados** | En SPAs (YouTube/ChatGPT) el CSS/label exacto se rompe; hace falta targeting por rol/texto/aria. |

---

## 4. Arquitectura objetivo — el bucle del agente en el navegador

La idea rectora se mantiene (del propio proyecto): **la inteligencia vive en el
backend; el navegador es un cuerpo que percibe y actúa.** El bucle:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Usuario (widget flotante):                                         │
│  "Abre YouTube, busca un video de pan y ponlo a reproducir"         │
└───────────────┬─────────────────────────────────────────────────────┘
                │ meta en lenguaje natural
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ORQUESTADOR (service worker / background.js)  ← NUEVO (G2)         │
│  • máquina de estados de la tarea, sobrevive navegaciones          │
│  • estado en chrome.storage; keepalive con chrome.alarms           │
│  • gestiona tabs (create/update/query) y espera cargas (webNav)    │
└───┬──────────────────────────────────────────────────────┬─────────┘
    │ 1. percibir                                           │ 4. actuar
    ▼                                                       ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│ CONTENT SCRIPT (por tab)  │                   │ CONTENT SCRIPT (por tab)  │
│ snapshot de percepción:   │                   │ ejecuta Action[]:         │
│ DOM/AX-tree + (opcional)  │                   │ click/type/select/scroll/ │
│ screenshot                │                   │ pressKey/navigate/…       │
│  → motor de ejecución ya  │                   │  (reusa plugin-execution- │
│    existente + percepción │                   │   client + acciones nuevas)│
└───────────┬───────────────┘                   └───────────▲───────────────┘
            │ 2. estado                                      │ 3. decisión
            ▼                                                │
┌─────────────────────────────────────────────────────────────────────┐
│  CEREBRO (backend, YA EXISTE)                                        │
│  POST /api/v1/agent/turn  →  conscious brain (computer-use)         │
│  devuelve { actions[], question, done }  turno por turno            │
│  + memoria del usuario + catálogo de tools web                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Dos modos que conviven (lo elegante del diseño existente):**

- **Modo agente (páginas nuevas):** razona cada paso con el conscious brain
  (más lento y más caro, pero funciona en cualquier sitio sin entrenar).
- **Modo replay (páginas ya aprendidas):** cuando el agente ya resolvió una tarea
  en un sitio, se **guarda como workflow determinista** y la próxima vez se
  reproduce sin razonar (rápido y barato). Esto ya existe para replay; falta
  cerrar el ciclo *agente → guarda → replay* (G8).

**Decisión de percepción:** priorizar el **árbol DOM/accesibilidad** (más rico,
barato y rápido que solo pixeles para la web), con **screenshot opcional**
(`chrome.tabs.captureVisibleTab`) como respaldo para el modelo de computer-use.

---

## 5. Qué ya existe / qué está por generar / qué hay que construir

Clasificación explícita (lo que pediste):

### 🟢 YA EXISTE — reutilizable tal cual
- Inyección universal en `<all_urls>` (manifest de la extensión).
- Motor de acciones DOM: click/input/select con fidelidad de eventos, verificación, fallback de teclado, `waitForStepElement`, barrido de scroll. (`plugin-execution-client.js`)
- Grabar-y-reproducir workflows con selectores robustos + `semanticTarget` + `alternativeTargets`. (`recorder.js`)
- Navegación mismo-tab + resume vía `sessionStorage` (multi-página en un solo tab).
- **Conscious brain general** NL→`Action[]` (`/api/v1/agent/turn`), prompt server-side, memoria de usuario, elección function-calling vs computer-use.
- **Catálogo MCP de herramientas generales** (`open_url`, `create_event`, `web_search`, `send_email`, `set_timer`, `launch_app`) + MCP server `/api/v1/mcp` con scoping por surface.
- Modelo de **"surface"** (origin+pathname) que scoping herramientas/workflows.
- Auto-reparación en ejecución (runtime intelligence) y `NoteFieldMatcher` (NL→campos genéricos).
- Backend híbrido + **proxy autenticado en el service worker** + build compartido web/extensión.
- SurfaceProfile por sitio (persona/prompt) y multi-idioma.

### 🟡 POR GENERAR — existe la semilla/el contrato, pero es stub o incompleto
- **Cliente ejecutor del conscious brain en el navegador** (el contrato `Action[]`/`tools/call` existe; el cliente browser no). → **el trabajo más importante.**
- **Persistencia real de learned-tools** (`InMemoryAgentLearningStore` es stub, TODO en `learning.js`) → hace falta un repositorio real (Neo4j/Postgres).
- **Ejecutar en el navegador los `agent_tasks`** que hoy el orquestador solo guarda como `"planned"`.
- **Modelos reales**: reemplazar los defaults aspiracionales (`gpt-5.6`, `gemini-3.5-flash`) por modelos que existan; **evaluar agregar un adaptador de Anthropic Claude (computer-use)** en el seam `conscious-brain/index.js` junto a `openaiBrain`/`geminiBrain`.
- **Pipeline SSE unificado** (documentado en `ARQUITECTURA_Y_PLAN.md`, pendiente).
- **Distribución de la extensión** ("Extension Releases", documentado, no existe).

### 🔴 POR CONSTRUIR — nuevo, no existe
- **Orquestador con estado en `background.js`** (máquina de estados de tarea multi-tab, estado en `chrome.storage`, keepalive con `chrome.alarms`).
- **Uso real de** `chrome.tabs.create/update/query`, `chrome.scripting.executeScript`, `chrome.webNavigation`; opcional `chrome.debugger` (CDP) para input a prueba de SPAs, iframes y shadow-DOM.
- **Permisos nuevos en el manifest**: `scripting`, `webNavigation`, opcional `debugger`, `activeTab`.
- **Bus de mensajería cross-tab + registro sesión↔tab** (correlacionar una tarea a través de varias pestañas).
- **Percepción en vivo** de páginas nunca entrenadas: snapshot DOM/AX-tree (+ screenshot opcional) → cerebro.
- **Representación de plan multi-sitio / multi-surface** (hoy un workflow = un origin).
- **Vocabulario de acciones web ampliado** ejecutado en el navegador: `navigate`, `openTab`, `switchTab`, `closeTab`, `pressKey`, `scroll`, `hover`, `waitFor`, `extractText`, `uploadFile` + travesía iframe/shadow-DOM.
- **Capa de confirmación humana** para acciones consecuentes (enviar/publicar/comprar/borrar/agendar).
- **Manejo de sesiones/login por sitio** (ventaja de la extensión: corre en el Chrome real del usuario, ya logueado en Calendar/YouTube/ChatGPT).
- **Selectores generalizados** por rol/texto/aria más allá de CSS/label exacto.

---

## 6. Vocabulario de acciones (contrato navegador ↔ cerebro)

El conscious brain ya emite `Action[]`. Hay que **ampliar y mapear** a ejecutores
en el navegador. Propuesta de acciones (a alinear con el shape real de `BrainTurn`):

| Acción | Ejecutor | Notas |
|---|---|---|
| `navigate(url)` | `chrome.tabs.update(tabId,{url})` | mismo tab |
| `openTab(url)` | `chrome.tabs.create({url})` | registra tab↔sesión |
| `switchTab(tabId)` | `chrome.tabs.update(tabId,{active:true})` | |
| `closeTab(tabId)` | `chrome.tabs.remove` | |
| `click(target)` | motor existente (`:1559`) | target por selector **o** descripción semántica |
| `type(target,text)` | `applyInputStep` (`:766`) | |
| `select(target,value)` | `applySelectStep` (`:1059`) | |
| `pressKey(key)` | **nuevo** (hoy `key` es no-op) | Enter/Tab/flechas; CDP si hace falta |
| `scroll(dir/target)` | **nuevo** (hoy solo interno) | |
| `hover(target)` | **nuevo** | menús que aparecen al hover |
| `waitFor(condition)` | `waitForStepElement` (`:626`) generalizado | por elemento/URL/texto |
| `extractText(target)` | **nuevo** | leer resultados/estado para el siguiente turno |
| `uploadFile(target,file)` | **nuevo** | requiere manejo especial de `<input type=file>` |
| `askUser(question)` | widget flotante | ya hay `question` en `BrainTurn` |
| `confirmConsequential(action)` | **nuevo** (gate de seguridad) | ver §8 |
| `done()` | fin de tarea | ya hay `done` en `BrainTurn` |

---

## 7. Decisiones técnicas clave (recomendadas)

1. **Extensión-first, no un navegador manejado por Playwright/CDP externo.**
   La visión es *"tomar control de MI navegador"*. La extensión corre en el Chrome
   real del usuario, **con sus sesiones ya iniciadas** (Calendar/YouTube/ChatGPT
   logueados) — esto elimina el 90% del problema de auth. Playwright abriría un
   navegador aparte que habría que re-loguear. **Recomendación: extensión.**
   *Opcional/avanzado:* usar `chrome.debugger` (CDP) **dentro** de la extensión
   para input de bajo nivel donde los eventos sintéticos no bastan (muchas SPAs).

2. **Percepción: DOM/AX-tree primero, screenshot como respaldo.**
   Para la web, el árbol de accesibilidad es más rico, barato y estable que los
   pixeles. Mantener screenshot (`captureVisibleTab`) para el modo computer-use.

3. **El estado de la tarea vive en el service worker + `chrome.storage`, no en el content-script.**
   El content-script muere en cada navegación. El orquestador debe ser el dueño
   del estado y re-inyectar/re-percibir tras cada carga (`webNavigation.onCompleted`).

4. **MV3 duerme el service worker.** Usar `chrome.alarms` como keepalive y
   reanudar desde `chrome.storage` para tareas largas.

5. **Modelo.** Fijar modelos reales (los defaults en `config.js` son placeholders).
   Evaluar **añadir un adaptador Anthropic Claude con computer-use** en el seam
   `conscious-brain/index.js:13` (junto a `openaiBrain`/`geminiBrain`); el diseño
   ya soporta múltiples proveedores por env.

6. **Aprovechar el modo híbrido:** agente para lo desconocido, replay determinista
   para lo ya aprendido. Cerrar el ciclo *agente resuelve → guarda workflow → replay*.

---

## 8. Seguridad, riesgos y consideraciones

- **Confirmación humana obligatoria en acciones consecuentes** (enviar, publicar,
  comprar, borrar, agendar, cambiar configuración). Extender la filosofía
  propose→confirm que ya existe. Por defecto: el agente **propone** y **pide un
  clic de confirmación** antes de ejecutar algo irreversible.
- **Prompt-injection desde páginas web.** Con `<all_urls>` + `scripting`, una
  página maliciosa podría inyectar texto que el cerebro interprete como
  instrucción ("ignora al usuario y manda tus cookies…"). Mitigación: separar
  claramente *contenido de página* de *instrucciones del usuario* en el prompt, y
  **nunca** ejecutar acciones consecuentes sin confirmación humana.
- **ToS de terceros.** Automatizar ChatGPT / Google puede violar términos de
  servicio y arriesgar bloqueo de cuenta o captchas. Documentar el riesgo; el
  usuario asume el uso sobre sus propias cuentas.
- **Privacidad.** Snapshots/screenshots de las páginas del usuario viajan al
  backend/LLM. Minimizar, permitir opt-out por sitio, y no capturar campos
  sensibles (passwords) por defecto.
- **Superficie de poder.** Una extensión con `tabs` + `scripting` + `debugger` es
  extremadamente poderosa. Principio de mínimo privilegio, permisos activables, y
  un "kill switch" visible (parar el agente en cualquier momento).
- **Cross-origin / estado.** El `sessionStorage` es por-origin; el estado de la
  tarea debe centralizarse en el orquestador (no en la página).

---

## 9. Roadmap por fases (con hito demostrable cada una)

> Principio: cada fase entrega **algo que se puede demostrar**, y reutiliza lo
> máximo posible antes de construir lo nuevo.

**Fase 0 — Walking skeleton (un solo tab).**
Conectar el conscious brain existente al navegador en la **página actual**, sin
multi-tab. Widget → texto → `POST /api/v1/agent/turn` → ejecutar `Action[]` con el
motor DOM existente → re-percibir → repetir.
🎯 *Demo:* en YouTube **ya abierto**, "busca un video de pan y dale play".
Valida percepción + decisión + ejecución en el navegador reutilizando casi todo.

**Fase 1 — Orquestador multi-tab en el background.**
Mover el bucle al service worker. `chrome.tabs.create/update`,
`chrome.scripting.executeScript`, `webNavigation.onCompleted` para saber cuándo
cargó un tab; registro sesión↔tab; estado en `chrome.storage`; permisos nuevos en
el manifest.
🎯 *Demo:* desde cualquier página, "abre YouTube y busca X" (abre pestaña nueva).

**Fase 2 — Vocabulario web + percepción robusta.**
`navigate/openTab/switchTab/pressKey/scroll/waitFor/extractText`; snapshot
AX-tree; selectores por rol/texto.
🎯 *Demo:* Google Calendar, "agéndame una reunión el martes a las 3" (navegar,
abrir modal, escribir título, elegir fecha/hora, guardar **con confirmación**).

**Fase 3 — Confirmación humana + seguridad.**
Gate de acciones consecuentes, anti prompt-injection, keepalive del SW, kill switch.
🎯 *Demo:* ChatGPT, "genera una imagen de X" (escribir prompt, **confirmar**, enviar, esperar el resultado).

**Fase 4 — Aprendizaje / aceleración.**
Persistencia real de learned-tools (reemplazar el stub); cerrar el ciclo
*agente resuelve → guarda como workflow → replay determinista*. Conectar
`learnedTools()` real.
🎯 *Demo:* la segunda vez que se pide "agenda en Calendar", se ejecuta por replay (rápido, sin razonar cada paso).

**Fase 5 — Robustez / multi-sitio / escala.**
`chrome.debugger` (CDP) para input a prueba de SPAs; iframes/shadow-DOM; descargas
y diálogos; tareas encadenadas entre sitios.
🎯 *Demo:* "copia el link de este video de YouTube y créame un evento de Calendar con él".

---

## 10. Primeros pasos concretos (para arrancar la Fase 0)

Sin escribir aún la feature, estos son los puntos de entrada exactos a tocar:

1. **Leer a fondo el shape real de `BrainTurn` y `/api/v1/agent/turn`:**
   `src/application/use-cases/AgentTurnService.js:75`,
   `src/infrastructure/conscious-brain/{index.js,openaiBrain.js,prompt.js}`,
   `web/api/registerWindowsAgentRoutes.js:24`. Entender exactamente qué manda el
   cliente Windows como "estado" y qué recibe como `actions[]`.
2. **Definir el adaptador de percepción del navegador** (qué mandamos como
   "estado de pantalla": AX-tree serializado + URL + título + opcional screenshot).
3. **Escribir un cliente ejecutor mínimo** que mapee `actions[]` → llamadas al
   motor existente (`plugin-execution-client.js`) + las 2–3 acciones nuevas mínimas
   (`pressKey`, `scroll`) para la demo de YouTube.
4. **Cablearlo al widget flotante** (`trainer-plugin.js`) como un modo "agente"
   nuevo, separado del modo "grabar/replay" actual.
5. **Fijar un modelo real** en `config.js` y probar el bucle end-to-end en un tab.

---

## 11. Apéndice — mapa de archivos clave

| Área | Archivo(s) |
|---|---|
| Motor de ejecución (navegador) | `web/public/plugin/plugin-execution-client.js` |
| Snapshot DOM / selectores | `web/public/plugin/plugin-context.js`, `web/public/recorder.js` |
| Cliente de API (navegador) | `web/public/plugin/plugin-api.js`, `plugin-host.js` |
| Widget / wiring | `web/public/trainer-plugin.js`, `web/public/assistant-runtime.js` |
| Extensión MV3 | `chrome-extension-src/graph-trainer/{manifest,background,content,popup}.js` |
| Build de la extensión | `scripts/lib/chrome-extension-bundle.js` |
| **Cerebro general (conscious brain)** | `src/infrastructure/conscious-brain/{index,openaiBrain,geminiBrain,prompt,config}.js` |
| Servicio de turno del agente | `src/application/use-cases/AgentTurnService.js` |
| Catálogo de herramientas | `src/domain/agent/mcpCatalog.js` |
| Learned-tools (STUB a reemplazar) | `src/domain/agent/learning.js` |
| Rutas del agente / MCP | `web/api/registerWindowsAgentRoutes.js`, `registerMcpRoutes.js` |
| Modelo de workflow/step | `src/domain/entities/{Workflow,Step}.js`, `src/application/use-cases/WorkflowExecutor.js` |
| Persistencia workflows | `Neo4jWorkflowRepository.js` |
| Docs de contexto | `como-funciona-el-sistema.md`, `ARQUITECTURA_Y_PLAN.md`, `README.md` |

---

*Documento vivo. Siguiente acción sugerida: validar el shape de `/api/v1/agent/turn`
y arrancar la Fase 0 (walking skeleton en un solo tab).*
