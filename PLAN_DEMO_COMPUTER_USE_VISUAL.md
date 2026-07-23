# Plan — Demo de Computer Use **visual** (Miracle en el navegador)

> **Contexto.** La prioridad cambió: se necesita una **demo funcional mañana** en la
> que, desde una instrucción en lenguaje natural, el sistema resuelva tres tareas
> reales **por Computer Use visual puro** — screenshot → el modelo mira SOLO la
> imagen → decide una acción de mouse/teclado → el cliente la ejecuta → nueva
> captura → se repite. **Nada de DOM, selectores, AX-tree, OCR propio, APIs de los
> sitios, MCP que resuelva la tarea, workflows ni replay.** Este documento reemplaza
> al `PLAN_AGENTE_NAVEGADOR.md` para efectos de la demo (ese queda como visión de
> largo plazo).
>
> **Rama:** `claude/browser-control-agent-plan` · **Repo:** `Graph`
> **Estado:** plan verificado contra el código + spike de CDP ejecutado. Listo para implementar.

Las tres pruebas objetivo (usuario ya logueado en Google y ChatGPT):
1. **YouTube** — abrir, buscar "cómo hacer pan", abrir un resultado, reproducir.
2. **Google Calendar** — crear evento "Reunión de prueba Miracle", martes próximo 3:00 p. m., 30 min, guardar.
3. **ChatGPT** — escribir el prompt del gato astronauta, enviar, esperar a que la imagen aparezca.

---

## 1. Decisión de arquitectura (con evidencia)

**Extensión Chrome + `chrome.debugger`/CDP como "manos y ojos", `chrome.tabs` solo
como transporte de navegación.** No se cambia de repo (no hay cliente Windows en el
workspace: cero archivos `.cs`).

**Por qué — spike de CDP ejecutado** (`scratchpad/cdp_spike.js`, Chromium 1194 vía Playwright/CDP, DPR=1):

| Capacidad probada | Resultado | Conclusión |
|---|---|---|
| `Page.captureScreenshot` | ✅ PNG 1000×700 | Ojos: sirve. A **DPR=1**, px de imagen == px CSS. |
| `Input.dispatchMouseEvent` (click en 280,150) | ✅ `clientX/clientY` = 280,150 exactos | Click por coordenada: sirve, sistema de referencia = px CSS del viewport. |
| `Input.insertText` + `dispatchKeyEvent` | ✅ texto escrito | Teclado/escritura: sirve. |
| `mouseWheel` (deltaY 900) | ✅ `scrollY` = 900 | Scroll: sirve. |
| **`Ctrl+T` despachado al target de página** | ❌ **no abre pestaña** (páginas/targets antes=después=1) | **El input de página NO alcanza el chrome del navegador.** |

Más lo **documentado y no refutado**: `Page.captureScreenshot` y
`chrome.tabs.captureVisibleTab` capturan **solo el web contents** (viewport),
nunca la barra de direcciones ni las pestañas. Y `chrome.debugger` adjunta a un
**target de tab**, así que su `Input.*` tiene el mismo alcance renderer que el
spike.

➡️ **Consecuencia:** el agente **no puede** ver ni operar la barra de direcciones,
`Ctrl+L`, `Ctrl+T` ni las pestañas de forma visual. Por eso:

- `chrome.tabs.create` / `update` / `query` se usan **solo como transporte** para
  crear/seleccionar/navegar pestañas. El **URL destino lo decide el agente** (acción
  `navigate`, ver §4), **no** una regla por escenario.
- **Todo lo demás — dentro del sitio — es 100 % visual** (screenshot + coordenadas + mouse + teclado). No DOM, no selectores, no scripts inyectados que toquen la página.

> ⚠️ **Fidelidad del spike.** Se corrió en este contenedor **headless** con el CDP a
> nivel navegador de Playwright, no con una extensión real sobre el Chrome del
> usuario. Prueba los primitivos y el alcance del input; la limitación del chrome
> del navegador se apoya además en comportamiento documentado de Chrome. **La
> validación final debe hacerse en el Chrome real del usuario con la extensión
> cargada** (ver §11).

---

## 2. El contrato REAL de `/api/v1/agent/turn` (verificado en código)

Fuente autoritativa (no el MD viejo): `web/api/registerWindowsAgentRoutes.js:24`,
`src/application/use-cases/AgentTurnService.js:75-134`,
`src/infrastructure/conscious-brain/openaiBrain.js:76-301`.

**Request**
```
Primer turno:   { goal, state, userId? }              // sin `session`
Turnos siguientes: { session, state, results?[], inform? }   // `session` = blob opaco
```
`state` (requerido; `state.screen` debe ser string no vacío):
```
{ screen, uiContext, width, height, screenshot?, apps?,
  surfaceId?, surfaceOrigin?, surfacePathname? }
```
- `screenshot`: **PNG en base64 sin prefijo** (el backend le antepone `data:image/png;base64,`).
- `width`/`height`: dimensiones de referencia de la pantalla/screenshot.

**Response** (`{ session, ...BrainTurn }` o `{ error }`)
```
{ session, actions[], question?, done, text, needsScreenshot, narration, speech?, intents[] }
```
Códigos: **400** request inválido (falta `state`/`goal`) · **500** provider sin
configurar · **502** error del cerebro.

**`actions[]` — forma REAL** (normalizada en `openaiBrain.js:176-214`). Cada acción es:
```
{ kind: 'tap',   x, y }
{ kind: 'type',  x, y, text }
{ kind: 'key',   key }              // 'enter' | 'back'(=Escape) | <tecla>
{ kind: 'scroll', down }            // booleano (sin magnitud)
{ kind: 'swipe', x1, y1, x2, y2, ms }
{ kind: 'wait',  ms }
{ kind: 'mcp',   tool, args }       // function-calling; lo evitamos en modo visual (§4)
```
- **Coordenadas: píxeles ABSOLUTOS del screenshot enviado, escala 1**
  (`openaiBrain.js:158-167`, `sx = sy = 1`). El cliente Windows captura a resolución
  real; nosotros forzamos **DPR=1** para conservar esa escala 1 (§5).
- **Continuidad entre turnos:** la mantiene **OpenAI** vía `previous_response_id`,
  guardado dentro del `session` **opaco**. El cliente solo re-envía `session` + el
  screenshot nuevo; **no** acarrea historial ni ve el prompt.
- `done` = no quedan llamadas pendientes (`pending.length === 0`). `question` = el
  modelo llamó `ask_user`. Errores = HTTP 400/500/502 con `{ error }`.
- **Reparto cliente/backend:** el **backend decide** (prompt, catálogo, modelo,
  memoria viven solo en el server); el **cliente ejecuta** gestos y captura pantalla.

**Dónde se emiten MCP/function calls:** `AgentTurnService.assembleTools`
(`:59-68`) arma `tools = baseCatalog() + aprendidas + workflows`, y
`openaiBrain.js:119-123` declara `{type:'computer'}` **+ una función por tool** +
`ask_user`/`speak`/`list_apps`. Es decir, **por defecto el modelo SÍ puede llamar
`open_url`/`create_event`/`web_search`** — justo lo prohibido. Ver §4 para forzar
visual puro.

---

## 3. El loop visual (definición estricta)

Un solo navegador, **una sola tarea activa** a la vez.

```
Usuario escribe la instrucción en el popup  →  START
        │
        ▼
[background] abre/selecciona 1 pestaña (transporte)  ─┐
        │                                             │
        ▼                                             │
[background] chrome.debugger.attach(tabId, "1.3")     │  (una vez por tarea)
        │                                             │
        ▼                                             │
┌─────────────────── LOOP (hasta done / cap / STOP) ──┴────────────────┐
│ 1. CAPTURAR   Page.captureScreenshot (PNG base64, DPR=1)             │
│ 2. DECIDIR    POST /api/v1/agent/turn { goal|session, state{shot} }  │
│ 3. EJECUTAR   por cada action: navigate | tap | type | key | scroll  │
│               | swipe | wait   → CDP Input.* / chrome.tabs.update     │
│ 4. ASENTAR    espera fija corta (settleMs); si el modelo pidió `wait`,│
│               respeta ms                                             │
│ 5. LOG        turno #, acciones, screenshot, texto/narración, timing │
│ 6. si turn.done → FIN;  si turn.question → mostrar y pausar          │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
[background] chrome.debugger.detach(tabId)   (en done / STOP / error)
```

El modelo **solo** recibe: la imagen + el objetivo + la continuidad opaca. **No**
recibe DOM, AX-tree, ni texto extraído de la página.

---

## 4. Forzar modo **visual puro** (quitar MCP como ruta de ejecución)

Tres cambios quirúrgicos en el backend, aditivos y compatibles hacia atrás. El
disparador es un campo nuevo **`state.mode = 'browser-visual'`** en el request.

1. **Sin catálogo que resuelva la tarea.** En `AgentTurnService.handleTurn`,
   cuando `state.mode === 'browser-visual'`, **no** llamar `baseCatalog()` ni
   aprendidas/workflows. El único tool expuesto es el **transporte `navigate`**:
   ```
   navigate(url)   // el modelo decide el URL; el runner hace chrome.tabs.update
   ```
   `navigate` **no resuelve** la tarea (buscar/reproducir/agendar sigue siendo 100 %
   visual); es el único puente permitido por la frontera de §1 ("el URL debe venir
   de la decisión del agente"). Llega al runner como `{ kind:'mcp', tool:'navigate', args:{url} }`.

2. **Prompt de navegador, no de Windows.** El actual (`prompt.js:37`) dice "controla
   una PC con Windows", "árbol de UI con UIA", `launch_app`, menú Inicio — todo
   inaplicable. Añadir `browserGoalPrompt({goal, stateBlock})` que instruya:
   *"Controlas UN navegador por visión. Ves solo un screenshot del contenido de la
   página (no la barra de direcciones ni las pestañas). Para ir a un sitio usa
   `navigate(url)`. Todo lo demás hazlo con click/type/scroll sobre el screenshot,
   en coordenadas de píxel. Persiste: si la pantalla no cambió, vuelve a mirar."*
   Sin enumerar herramientas, sin jerga.

3. **Selección del prompt.** En `openaiBrain.js`, cuando la sesión es visual usar
   `browserGoalPrompt` en vez de `goalPrompt`. Como `tools` va vacío, el modelo solo
   ve `{type:'computer'}` + `navigate` + `ask_user`/`speak` → **computer-use es la
   única vía de actuar dentro de la página.**

> Fuera de alcance de la demo (explícitamente eliminado): seguridad, confirmaciones,
> políticas, análisis de riesgo, y **selección/comparación de modelos**. El modelo y
> la key se toman de las env vars existentes (`MIRACLE_CONSCIOUS_LLM_*`).

---

## 5. Coordenadas, viewport y DPR (el detalle que rompe demos)

- Capturamos con **DPR forzado a 1**: `Emulation.setDeviceMetricsOverride({ width,
  height, deviceScaleFactor: 1, mobile: false })` antes de capturar. Así:
  **px del PNG == px CSS del viewport == coordenadas de `Input.dispatchMouseEvent`.**
  Se conserva la **escala 1** que ya asume `openaiBrain.js` (`sx=sy=1`). Verificado en el spike.
- En `state` mandamos `width`/`height` = **dimensiones del PNG capturado** (para que
  el modelo razone en ese espacio).
- **Fallback** si algún día no se puede forzar DPR=1: dividir cada coordenada del
  modelo por `devicePixelRatio` antes de despachar (`cssX = imgX / dpr`).
- El screenshot es del **viewport visible**. Si el objetivo está fuera de vista, el
  modelo debe emitir `scroll` y volver a mirar (no hay scroll-into-view por selector).

---

## 6. El runner y su contrato de ejecución (cliente = extensión)

Mapa **acción → CDP** (consumimos la forma `kind:*` real; no inventamos contrato):

| `action.kind` | Ejecución en el runner |
|---|---|
| `navigate` (`{tool:'navigate',args:{url}}`) | `chrome.tabs.update(tabId,{url})` + esperar `webNavigation.onCompleted` (transporte) |
| `tap` `{x,y}` | `Input.dispatchMouseEvent` press+release (`button:'left'`, `clickCount:1`) |
| `type` `{x,y?,text}` | si hay `x,y`: click primero; luego `Input.insertText({text})` |
| `key` `{key}` | `Input.dispatchKeyEvent` keyDown/keyUp (`enter`→Enter, `back`→Escape, etc.) |
| `scroll` `{down}` | `Input.dispatchMouseEvent` `mouseWheel` deltaY = `down ? +600 : -600` |
| `swipe` `{x1,y1,x2,y2,ms}` | mouse press → moves interpolados → release |
| `wait` `{ms}` | `setTimeout(ms)` |

**Estado mínimo que guarda el runner** (en memoria del service worker + espejo en
`chrome.storage.session` por si el SW se duerme):
```
{ taskId, tabId, goal, session (blob opaco), turnIndex, running,
  lastScreenshotB64, startedAt, log[] }
```

**Esperar tras una acción:** `settleMs` fijo corto (arranque: 700 ms). Si el modelo
emite `wait{ms}`, se respeta. No se inspecciona la página para "saber si cargó"
(prohibido); si hace falta más tiempo, el modelo mira otra vez y decide.

**Límites por ejecución:** `MAX_TURNS` (arranque: 40) y `MAX_MS` (arranque: 5 min).
Al excederlos: detach + log + fin con estado `timeout`.

**Cancelación manual:** botón **STOP** en el popup → mensaje al background → baja
`running` → el loop corta entre turnos → `chrome.debugger.detach`.

**Logging para depurar mañana:** por turno se guarda `{ turnIndex, tSent, actions,
brainText, narration, done, question, ms, screenshotB64 }` en `log[]`, visible en el
popup (miniatura + acciones) y exportable como JSON. Es la caja negra de la demo.

---

## 7. Autenticación del endpoint (a verificar en implementación)

`/api/v1/*` está gated con **`X-API-Key`** (`requireApiKey` en `web/server.js`),
**no** con el Bearer que hoy inyecta el proxy del service worker
(`background.js:110`). El runner debe mandar **`X-API-Key`** al llamar
`/api/v1/agent/turn`. Verificar `requireApiKey` y de dónde sale la key (env/almacén
de la extensión). *(Inferencia a confirmar — ver §10.)*

---

## 8. Archivos EXACTOS que tocará el Prompt 2 (implementación)

**Extensión (cliente ejecutor — lo nuevo):**
- ✏️ `chrome-extension-src/graph-trainer/manifest.json` — agregar permiso
  **`debugger`** (mantener `tabs`). **No** agregar `scripting` (no se inyectan
  scripts a la página).
- ➕ `chrome-extension-src/graph-trainer/visual-agent.js` — **el runner**: attach/detach
  de `chrome.debugger`, `Emulation.setDeviceMetricsOverride`, captura, mapa
  acción→CDP, transporte de pestañas, loop de turnos contra `/api/v1/agent/turn`,
  caps, cancelación, log. *(Se empaqueta solo: `chrome-extension-bundle.js` copia todo `graph-trainer/*`.)*
- ✏️ `chrome-extension-src/graph-trainer/background.js` — mensajes `start`/`stop`,
  estado de la tarea, header `X-API-Key` para `/api/v1`.
- ✏️ `chrome-extension-src/graph-trainer/popup.html` + `popup.js` — textarea de
  instrucción, botones **Start/Stop**, log de turnos en vivo (miniatura + acciones).

**Backend (modo visual — cambios quirúrgicos y aditivos):**
- ✏️ `src/application/use-cases/AgentTurnService.js` — si `state.mode==='browser-visual'`:
  `tools` = solo `navigate` (saltar `baseCatalog`/aprendidas/workflows); pasar flag visual al cerebro.
- ✏️ `src/infrastructure/conscious-brain/prompt.js` — añadir `browserGoalPrompt`.
- ✏️ `src/infrastructure/conscious-brain/openaiBrain.js` — usar `browserGoalPrompt` en
  modo visual; exponer `navigate`; **asegurar que el tool `{type:'computer'}` lleve
  `display_width`/`display_height`/`environment:'browser'`** si el modelo real lo exige (§10).
- 🔎 `web/server.js` — verificar `requireApiKey` y el envío de `X-API-Key` desde la extensión.

---

## 9. Iteraciones de implementación (4)

1. **Núcleo visual end-to-end (walking skeleton).** Manifest+`debugger`; runner con
   captura + `tap/type/key/scroll/wait` + `navigate` + loop a `/api/v1/agent/turn` +
   caps + STOP + log; backend modo visual + `browserGoalPrompt` + tools vacío.
   🎯 *Prueba mínima:* en UNA página simple ya abierta, "haz click en el botón X y
   escribe Y en la caja" → el loop cierra de punta a punta.
2. **Estabilización de YouTube.** `navigate` a youtube.com → buscar "cómo hacer pan"
   (click en la barra de búsqueda de la página + type + `key:enter`) → abrir un
   resultado → reproducir. Ajustar `settleMs`, magnitud de scroll, manejo de Enter, reintentos.
3. **Calendar + ChatGPT.** Calendar: crear evento, fijar martes 3:00 p. m., 30 min,
   guardar (pickers de fecha/hora por visión). ChatGPT: escribir el prompt, enviar,
   **esperar** hasta que la imagen aparezca (el modelo emite `wait` y vuelve a mirar).
4. **Estabilización final de las tres pruebas.** Tuning de caps/settle, log listo
   para la demo, correr las tres de forma repetible.

---

## 10. Hechos verificados vs inferencias vs inexistente

**✅ Verificado (código citado + spike):**
- Contrato HTTP y forma real de `actions[]` (`kind:*`), coords px escala 1, continuidad por `previous_response_id`, códigos 400/500/502.
- El endpoint ofrece MCP por defecto (`baseCatalog` en `assembleTools`) → hay que apagarlo.
- El prompt actual está acoplado a Windows (`prompt.js:37-80`).
- Spike CDP: screenshot/click/type/scroll funcionan a DPR=1; **Ctrl+T no abre pestaña** desde input de página; screenshots excluyen el chrome (documentado).
- **No hay cliente Windows** en el workspace (0 `.cs`) ni cliente navegador que consuma `/agent/turn`.

**🟡 Inferencias / a confirmar en implementación:**
- El tool `{type:'computer'}` en `openaiBrain.js:119` **no** setea
  `display_width/height/environment`. El computer-use real de OpenAI suele exigirlos;
  hay que verificarlo contra el **modelo configurado** (las env `MIRACLE_CONSCIOUS_LLM_MODEL`
  con defaults `gpt-5.6`/`gemini-3.5-flash` parecen placeholders).
- `/api/v1` requiere `X-API-Key`; el proxy del SW hoy inyecta Bearer, no esa key (§7).
- Ruta OpenAI es la de referencia para computer-use; `geminiBrain.js` no se auditó a fondo aquí.
- El banner "está depurando este navegador" de `chrome.debugger` aparecerá (cosmético; aceptable para demo).

**🔴 Inexistente — hay que construirlo (Prompt 2):**
- El runner visual en la extensión (attach debugger + loop).
- El `browserGoalPrompt` y el modo `browser-visual` (tools vacío + `navigate`).
- La UI de control de la demo (popup Start/Stop + log de turnos).

---

## 11. Verificación end-to-end (cómo se prueba mañana)

1. Configurar en el backend la env del cerebro (`MIRACLE_CONSCIOUS_LLM_PROVIDER` +
   key + modelo con computer-use) y la `X-API-Key` de `/api/v1`.
2. `npm run build:chrome-extension` → cargar la carpeta generada como **extensión
   desempaquetada** en el **Chrome real del usuario** (ya logueado en Google y ChatGPT).
3. Abrir el popup, escribir la instrucción, **Start**.
4. Observar el loop y el log de turnos; correr las tres pruebas (§9) y validar el
   resultado visible en pantalla (video reproduciendo, evento guardado, imagen generada).
5. Si el modelo se atasca: revisar el log (screenshot + acción del turno) — es la
   caja negra para depurar coordenadas, esperas y prompts.

> El spike de este documento se corrió en contenedor headless; **la prueba real es
> el paso 2-4 en el navegador del usuario.** Ese es el único entorno donde el
> `chrome.debugger` de la extensión y las sesiones logueadas existen de verdad.

---

*Documento listo para que la siguiente iteración implemente de inmediato. No incluye
arquitectura futura: solo el camino a la demo de las tres pruebas por visión.*
