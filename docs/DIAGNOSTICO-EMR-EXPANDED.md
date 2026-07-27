# Diagnóstico técnico y visual — EMR Expanded

**Alcance:** auditoría de solo lectura. No se rediseñó, no se reemplazó ni se
eliminó nada. No se tocó producción ni se hizo merge.

**Fecha:** 2026-07-27
**Base auditada:** `main` @ `bc484ac` (idéntica al HEAD de la rama de auditoría)
**Superficie:** `web/public/emr-workspace.html` — *"Miracle EMR Workspace Expanded"*
**Instrumentación:** [`tools/audit/emr-expanded/`](../tools/audit/emr-expanded/) (reproducible, aislada, desechable)

Cada afirmación de este documento tiene una de dos marcas:

- **Verificado** — comprobado ejecutando la app y midiendo el DOM real. La corrida
  está en `tools/audit/emr-expanded/evidencia/`.
- **Leído en el código** — se sigue del código con referencia a archivo y línea,
  pero no se ejecutó el camino completo.

Lo que **no** se pudo verificar está marcado explícitamente como tal en §1.4.

---

## 1. Estado de Git y de las ramas

### 1.1 Repositorio

| Dato | Valor |
|---|---|
| Repositorio | `joseph1356k/Graph` |
| Remote `origin` | `github.com/joseph1356k/Graph` (en esta sesión se accede vía proxy local) |
| Rama por defecto | `main` |
| `main` @ | `bc484ac` — *"docs: valores dinámicos — reglas, verificación en vivo y runbook para el equipo"*, Jeronimo114, 2026-07-26 |
| Protección de `main` | **ninguna** (`protected: false` en la API de GitHub) |
| CI | **no existe** — no hay `.github/` en el repo |
| Rama local de trabajo | `claude/emr-expanded-audit-7zu10e` |
| Commit local | `bc484ac` (idéntico a `origin/main` al iniciar la auditoría) |
| `git status` | limpio, sin archivos modificados |
| Commits locales sin subir | ninguno al iniciar |
| Diferencia local vs `origin/main` | `0 / 0` |

**Nota sobre el nombre de la rama.** La tarea sugería `audit/emr-expanded-diagnosis`.
La configuración de esta sesión fija la rama de trabajo en
`claude/emr-expanded-audit-7zu10e` y prohíbe empujar a otra sin permiso explícito,
así que el diagnóstico se desarrolló ahí. El propósito es el mismo: una rama
aislada, sin cambios funcionales. Si prefieren el nombre sugerido, es un
`git branch -m` / re-push, no hay nada atado al nombre.

### 1.2 ¿Existen varias implementaciones del EMR en ramas distintas?

**No.** Verificado comparando el blob de `web/public/emr-workspace.html` en las 16
ramas remotas:

```
15 de 16 ramas          → blob 385b770b  (idéntico byte a byte)
frontend-build-step     → blob e0f785a0  (única distinta)
```

La única divergencia es `frontend-build-step` (6 commits por delante de `main`,
7 por detrás), y el cambio al EMR es **exclusivamente** de carga de scripts:
reemplaza las 19 etiquetas `<script>` sueltas por dos bundles
(`/dist/emr-workspace.classic.1.js` y `.2.js`). El HTML, el CSS y la lógica del
EMR son los mismos. Esa rama además trae `CLAUDE.md`, gate de lint + typecheck,
hooks y CI. **Es un intento previo, sin mergear, de darle build al frontend** —
directamente relevante para la recomendación (§6).

Otras ramas que conviene conocer:

| Rama | Estado | Observación |
|---|---|---|
| `claude/emr-emoji-form-bug-9ce3bl` | 0 adelante / 19 atrás | ya integrada; es un ancestro de `main` |
| `feature/dynamic-values`, `feature/explicit-value-modes`, `feature/tree-node-steps` | 0 adelante | ya mergeadas (PRs #8, #9, #10) |
| `fix/remove-clinical-consent-gate` | 0 adelante / 53 atrás | ya integrada |
| `claude/clinical-assistant-provider-studio` | 227 adelante / 54 atrás | **rama de origen del EMR**; su historia real vive aquí |
| `claude/google-gemini-provider`, `claude/provider-key-memory-eye-toggle`, `claude/soniox-provider-integration-m41b2o`, `claude/token-usage-button-n0oc8s`, `claude/vercel-redeploy-api-key-dgqsd7` | 216–225 adelante / 54 atrás | ramas viejas y muy divergentes; probablemente muertas |

### 1.3 Historia del EMR

`emr-workspace.html` tiene **un solo commit en `main`**: el merge `39cc89a` que trajo
`claude/clinical-assistant-provider-studio`. Desde entonces **nunca se modificó en
`main`**. Su historia real son 5 commits en la rama de origen:

```
ab40da8  Deploy secure clinical assistant platform          (nace el archivo)
2219603  fix(emr): remove mandatory patient picker
86b973a  refactor(voice): remove OpenAI Realtime mic and remote phone mic
01f4248  refactor(voice): floating assistant on the shared dictation engine
a29e8f1  Remove Supabase entirely; drop clinical persistence
```

Esto explica mucho del estado actual: **el EMR se escribió de una vez y después
solo se le quitaron cosas** (el picker de paciente, el micrófono realtime, Supabase,
la persistencia clínica). Los restos de esas amputaciones siguen en el archivo (§4.6).

Los commits que sí tocaron el comportamiento del EMR viven en los archivos vecinos:

```
6403f7e  fix(emr): stop the assistant overlay from drifting around the page
e797db0  EMR: la carita deja de temblar al llenar campos
febdd26  feat(asistente): vidrio visible en la carita, burbuja fija, nota abajo-izquierda
7e0f220  fix(asistente): nota fija en esquina + etiqueta de estado sin salto de tamaño
```

Cuatro de los últimos commits relacionados con el EMR son **correcciones de
posicionamiento de capas flotantes**. Es la huella de un problema estructural, no
de cuatro bugs independientes.

### 1.4 Deployment — lo que NO se pudo verificar

La documentación del repo dice:

- `docs/AGENTE-WORKFLOWS-CONTEXTO.md:25` — *"Deploy: Vercel `graph-eight-pied.vercel.app`,
  auto-deploy al pushear `main`"*, y *"Trabajamos directo en producción (no hay usuarios)"*.
- `docs/API_GUIDE.md:10` y `docs/MIGRATION_AWS_AZURE.md` mencionan un segundo host,
  `graph-five-orpin.vercel.app`, y describen un incidente en el que **un alias apuntaba
  a un deployment anterior** con variables de entorno viejas horneadas.
- `chrome-extension-src/graph-trainer/content.js:1` y `bootstrap.js:33` apuntan por
  defecto a un **tercer** host: `https://miracle-zeta.vercel.app`.

**No pude alcanzar ninguno de los tres.** La política de red de este entorno rechaza
CONNECT a hosts externos (403 en el proxy). Por lo tanto **no puedo afirmar** qué
commit está sirviendo el EMR hoy, ni si el deployment coincide con `main`.

Lo que sí queda establecido:

- No hay CI, no hay protección de rama y el flujo documentado es *push a `main` →
  deploy automático*. **La rama que despliega es `main`**, y cualquiera que empuje a
  `main` despliega.
- Como el archivo del EMR es idéntico en 15 de 16 ramas, la probabilidad de que el
  EMR desplegado difiera del de `main` es baja — pero **hay tres hostnames en juego
  y un antecedente documentado de alias apuntando a deployments viejos**, así que
  esto se debe confirmar en el panel de Vercel antes de tocar nada.

**Acción pendiente para ustedes (5 minutos, no la puedo hacer yo):** en Vercel,
confirmar para cada proyecto qué rama tiene conectada como Production, y comparar
el "Deployment commit" con `bc484ac`.

---

## 2. Qué es realmente el EMR Expanded

### 2.1 Anatomía del archivo

`web/public/emr-workspace.html` — **1.531 líneas**, todo en un archivo:

| Tramo | Líneas | Contenido |
|---|---|---|
| `<style>` en línea | 14–643 | **630 líneas de CSS**, sin hoja externa |
| Markup | 645–1241 | topbar, ribbon, 4 tabs, 4 `<section data-view>` con 8 tarjetas de formulario |
| Etiquetas `<script src>` | 1243–1269 | **19 scripts externos** |
| Lógica en línea | 1270–1529 | **260 líneas de JS**: navegación de vistas, habilitación de botones, handlers |

No hay build, no hay módulos, no hay framework. Todo es global.

### 2.2 Los 19 scripts que carga y qué hace cada uno

Se cargan en orden, todos síncronos y bloqueantes. **455 KB de JavaScript**
(verificado; `arranque` en `evidencia/probe2-report.json`):

| # | Script | KB | Responsabilidad |
|---|---|---|---|
| 1 | `page-state.js` | 8 | Persistencia de campos en `localStorage` + evento `miracle-field-change` |
| 2 | `auth-gate.js` | 19 | **Overlay de login a pantalla completa** |
| 3 | `clinical-review.js` | 5 | Marca campos escritos por IA y **bloquea clics de finalización** |
| 4 | `recorder.js` | 36 | Grabador de workflows (listeners en captura sobre `document`) |
| 5 | `assistant-runtime.js` | **105** | La carita, burbujas, hoja de notas, spotlight, arrastre, cara SVG |
| 6–16 | `plugin/*.js` | 152 | Host, adaptadores, contexto/DOM, API, aprendizaje, perfil de superficie, **motor de ejecución (97 KB)**, overlay de workflows |
| 17 | `shared/deepgram-dictation.js` | 17 | Micrófono + WebSocket a Deepgram |
| 18 | `trainer-plugin.js` | 72 | Consola de enseñanza, panel de workflows, chat, orquestación del dictado |
| 19 | `admin-workspace.js` | 23 | **Panel "Developer workspace"** flotante |

Y expone **20 objetos globales** en `window` (verificado): `PageState`, `EMRState`,
`TrainerPlugin`, `WorkflowRecorder`, `MiracleAuth`, `MiracleReview`,
`MiracleAssistantRuntime`, `GraphAssistantRuntime`, `MiracleAdminWorkspace`,
`MiracleDeepgramDictation`, `GraphPluginContext`, `GraphPluginApi`, `GraphPluginHost`,
`GraphPluginEvents`, `GraphPluginAdapters`, `GraphPluginLearningClient`,
`GraphLearningBridge`, `GraphPluginTrainerShell`, `GraphPluginSurfaceProfileClient`,
`GraphWorkflowOverlayBridge`.

### 2.3 Respuesta directa: ¿de qué depende cada función?

Esta era una de las preguntas centrales. **Respuesta: de nada fuera del navegador.**

| Función | Quién la controla | Evidencia |
|---|---|---|
| **Dictado / voz** | 100 % navegador: `getUserMedia` + `WebSocket` directo a Deepgram desde la página. El servidor solo emite un token temporal. | `web/public/shared/deepgram-dictation.js:151,157,313` · orquestado por `trainer-plugin.js:1115` |
| **Escritura automática en campos** | 100 % DOM: `document.querySelector` → `element.value` → `dispatchEvent(input/change)` | `page-state.js:162-188`, `plugin-execution-client.js:1799-1875` |
| **Clics automáticos** | 100 % DOM: `element.click()`. **No hay automatización por coordenadas.** Cero usos de `elementFromPoint`, `MouseEvent` con `clientX/Y` sintético, `pyautogui` o similares en la ruta del EMR. | verificado por búsqueda exhaustiva |
| **Detección de campos** | `document.querySelectorAll` sobre un selector fijo de controles | `plugin/plugin-context.js:2-13, 313` |
| **Extensión de navegador** | **No es necesaria** para el EMR… pero si está instalada, **duplica todo el runtime**. Ver §3.5. | `chrome-extension-src/graph-trainer/manifest.json` |
| **App de Windows / Android** | **Ninguna dependencia.** `windows-live.js` pertenece a `windows-lab.html` y a Provider Studio; el EMR no lo carga. | verificado |
| **iframe** | **No hay ninguno.** Cero iframes creados o declarados en toda la superficie. | verificado |
| **`<canvas>`** | Sí, dos — pero ninguno interfiere: el de `auth-gate.js` es `pointer-events: none` dentro del overlay de login; `miracle-bg.js` no lo carga el EMR. | verificado |

**Conclusión de esta sección:** la hipótesis de "automatización por coordenadas",
"iframe" o "dependencia de una app nativa" queda **descartada**. El problema es
otro, y es peor de diagnosticar porque está repartido entre siete archivos que
comparten el mismo DOM global.

---

## 3. Causa raíz de cada síntoma reportado

### 3.1 «Los clics a veces se ejecutan en lugares equivocados» — **CONFIRMADO, causa identificada**

Hay **dos causas distintas**, y ambas están verificadas.

#### Causa A — `clinical-review.js` se come clics en silencio

`web/public/clinical-review.js:98-105` instala un listener de clic **en fase de
captura sobre `document`**:

```js
document.addEventListener('click', (event) => {
    if (unconfirmed.size === 0) return;
    if (looksLikeFinalize(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        stepToNext();                 // ← mueve el foco a OTRO campo
    }
}, true);
```

`looksLikeFinalize` (líneas 75-80) decide con una **expresión regular sobre el texto
visible del botón**:

```js
return /finaliz|firmar|cerrar\s*caso|guardar\s*nota|enviar\s*nota|enviar\s*orden/.test(text);
```

Efecto medido (con **un solo** campo escrito por la IA sin confirmar):

| Botón | ¿Se ejecutó su acción? |
|---|---|
| Firmar nota clínica | **NO** — clic descartado |
| Guardar nota médica | **NO** — clic descartado |
| Cerrar encuentro | sí (la regex no lo captura: dice `cerrar caso`, el botón dice "Cerrar encuentro") |
| Guardar admisión | sí |

Dos de los cuatro botones principales **dejan de funcionar sin decirle nada al
usuario**. No hay mensaje, no hay cambio visual, no hay log. El `feedback` queda
vacío. Desde fuera esto se ve exactamente como *"le doy clic y no pasa nada"* o
*"el clic se fue a otro lado"*.

Y peor: `stepToNext()` (líneas 63-72) hace `scrollIntoView` + `focus()` sobre el
primer campo sin confirmar, **que puede estar en una vista oculta**. En la corrida
el campo marcado estaba en `intake` mientras el usuario estaba en `orders`: el
`focus()` sobre un elemento `display:none` no hace nada, y el clic simplemente se
evapora. Cuando el campo **sí** está visible, la página salta a otro sitio — que es
literalmente *"el clic se ejecutó en un lugar equivocado"*.

> El acoplamiento es de texto: cambiar la etiqueta de un botón de "Firmar nota
> clínica" a "Firmar" o a "Finalizar atención" cambia silenciosamente si el botón
> se bloquea o no. Ese es el tipo de fragilidad que hace que *"modificar elementos
> aparentemente sencillos resulte más complejo de lo esperado"*.

#### Causa A-bis — la automatización se bloquea a sí misma

Esto es consecuencia directa y **está verificado**:

1. Miracle escribe un campo por la ruta oficial (`applyProgrammaticField` con
   `source: 'ai'`, `page-state.js:162`).
2. `clinical-review.js` lo marca como *no confirmado*.
3. El motor de ejecución llama `element.click()` sobre "Firmar nota clínica"
   (`plugin-execution-client.js:1581` y `:1855`).
4. Ese clic sintético **atraviesa el mismo listener en captura** y es descartado.

Resultado medido: `clicDelMotorEjecutado: false`. **La capa de seguridad clínica
bloquea al propio asistente que la alimenta.** El motor no recibe error; cree que
hizo clic.

#### Causa B — capas flotantes que tapan campos físicamente

Hit-testing real (`document.elementFromPoint` en el centro de cada control visible,
1440×900). Campos del EMR que **no reciben su propio clic**:

| Módulo | Campo | Lo tapa |
|---|---|---|
| Registro | `intake-payer-class` (Clase de cobertura) | `aside.miracle-admin-workspace` |
| Registro | `intake-sex` (Sexo biológico) | `div.miracle-admin-body` |
| Anamnesis | `anamnesis-pain-location` | `aside.miracle-admin-workspace` |
| Órdenes | `assessment-secondary-diagnosis` | `aside.miracle-admin-workspace` |
| Cierre | `disposition-status` (Disposición) | `aside.miracle-admin-workspace` |
| Cierre | `closure-final-check` | `div.miracle-admin-body` |

El culpable es el panel **"Developer workspace"** que inyecta `admin-workspace.js:465`:

```js
const root = document.createElement('aside');      // ← sin id
root.className = 'miracle-admin-workspace';
```
```css
.miracle-admin-workspace {
    position: fixed; right: 18px; bottom: 18px;
    z-index: 2147482500; width: min(330px, calc(100vw - 32px));
}
```

Es opaco, `pointer-events: auto`, y se monta **siempre que haya sesión**
(`admin-workspace.js:530-535`) — es decir, **también en una demo frente a un cliente**.
Aparece con el correo del usuario y botones "Logs", "Crear workflow", "Providers",
"Grafo y globales", "Cerrar sesion".

`evidencia/view-intake.png` lo muestra: el panel de desarrollador tapando la columna
derecha del formulario de admisión, con la carita encima de él.

### 3.2 «Detecta o crea campos donde visualmente no existen» — **CONFIRMADO, causa identificada**

`plugin-context.js:313-323` construye el snapshot que se le manda al modelo:

```js
const allControls = Array.from(document.querySelectorAll(CONTROL_SELECTOR))
    .filter((element, index, entries) => entries.indexOf(element) === index)
    .filter((element) => !isExcludedControl(element))
    .map((element, index) => ({ ...buildControlSnapshot(element, index), __index: index }))
    .sort(/* prioriza los visibles, pero NO descarta los invisibles */);
const controls = allControls.slice(0, 120)...
```

`controlPriority` (líneas 288-294) **ordena** por visibilidad pero **no filtra**.
El EMR mantiene las cuatro vistas en el DOM y solo oculta tres con `hidden`
(`emr-workspace.html:1275-1277`), así que el snapshot incluye todos los campos de
los módulos que no están en pantalla.

Medido, por módulo activo:

| Vista activa | Controles reportados al modelo | De ellos, **invisibles** |
|---|---|---|
| Registro | 95 | **49** |
| Anamnesis | 95 | **65** |
| Órdenes | 95 | **59** |
| Cierre | 95 | **70** |

En el módulo de Cierre, **70 de los 95 controles que el modelo "ve" no existen en
pantalla**, y llegan con `editable: true` y su etiqueta humana ("Alergias",
"Medicamentos actuales", "Frecuencia cardíaca"…).

El prompt del servidor le dice al modelo
*"Never invent selectors or option values that are not visible in
currentPage.pageSnapshot"* (`src/application/use-cases/RuntimeExecutionPolicy.js:19`)
— pero como el snapshot **sí los contiene**, el modelo está obedeciendo la
instrucción cuando elige un campo que el usuario no puede ver. **No es una
alucinación del modelo: es lo que le mandamos.**

Consumidores del snapshot (verificado): `SurfaceProfileService.generateProfile` y
`ExecutionIntelligenceService`, vía `plugin-surface-profile-client.js:110` y
`plugin-execution-client.js:1185`.

**Consecuencia comprobada:** una escritura programática en un campo de una vista
oculta **se acepta**. Verificado: estando en Registro, escribir en
`closure-billing-code` (módulo Cierre) devuelve `true`, guarda el valor, lo marca
como *no confirmado* y su rect es `0×0`. El dato queda en la historia clínica
**sin que nadie lo haya podido ver ni revisar**. En un EMR esto no es un bug de UI.

*(Matiz importante y a favor del código actual: la ruta de "llenar desde la nota
dictada" **sí** cambia de módulo antes de escribir, vía `ensureSurfaceSection`
en `plugin-execution-client.js:267`. El agujero está en el snapshot genérico y en
`applyProgrammaticField`, no en el `dynamic fill`.)*

#### Además: 7 controles que no son del EMR se reportan como si lo fueran

`EXCLUDED_SURFACE_SELECTOR` (`plugin-context.js:14-27`) excluye las 11 superficies
del asistente… **pero no incluye `admin-workspace`**. Resultado medido: los 7
controles del panel de desarrollador entran al snapshot clínico:

```
"Mostrar u ocultar workspace admin", "Logs (1)", "Crear workflow",
"Providers", "Mis workflows", "Grafo y globales", "Cerrar sesion"
```

El mismo hueco existe en el grabador (`recorder.js:666` `isAssistantSurface`), así
que **un clic en "Cerrar sesion" se puede grabar como un paso de workflow clínico**.

### 3.3 «La carita se va a lugares que no corresponden» — **CONFIRMADO, causa identificada**

`assistant-runtime.js:2381-2411` (`moveToSelector`) resuelve el elemento y llama
directo a `positionNearRect(element.getBoundingClientRect())`. Para un elemento
oculto ese rect es `{0,0,0,0}`, y `positionNearRect` (línea 1708) lo trata como una
posición válida.

Medido: con el módulo Registro abierto, `moveToSelector('#closure-billing-code')`
(campo del módulo Cierre, oculto) mueve la carita de `(1261, 661)` a **`(34, 28)`** —
la esquina superior izquierda, sobre el título de la página.

Lo notable es que **la mitad del arreglo ya está hecha**: el commit `6403f7e`
introdujo `isSpotlightTargetUsable` (línea 1948) que protege correctamente al
spotlight — en la misma corrida el recuadro se mantuvo oculto. Pero esa guarda
**solo se aplicó al spotlight, no al desplazamiento de la carita**. Los dos
consumidores del mismo dato tienen criterios distintos.

### 3.4 «Una capa / hoja en blanco invisible interfiriendo con los clics» — **CONFIRMADO, y es la más grave**

Existe y la encontré: **`#miracle-auth-gate`**.

```css
#miracle-auth-gate {
    position: fixed; inset: 0;
    z-index: 2147483000;      /* el más alto de la página */
    display: grid; background: #000;
}
```
(`auth-gate.js:23-33`, `pointer-events: auto`)

El problema es que **hay dos sistemas de autenticación independientes que no se
hablan**:

| Capa | De qué depende | Archivo |
|---|---|---|
| Puerta del **servidor** | cookie `miracle_admin_session` **o** header `Authorization` | `web/server.js:260-282` |
| Puerta del **cliente** | **solo** `localStorage['miracle-admin-session-v1']` | `auth-gate.js:483-504` |

Cuando divergen, el servidor entrega el HTML del EMR completo y el cliente monta
encima un overlay a pantalla completa. **Verificado**: con la cookie válida y sin
`localStorage`, la página renderizó entera y `elementFromPoint` devolvió
`div#miracle-auth-gate` para **24 de 24 controles probados** — todos los campos,
todos los botones, todos los tabs, incluida la consola del asistente.

Formas realistas de caer en ese estado: abrir el EMR en otro perfil o en incógnito
con la cookie viva; limpiar datos del sitio sin cerrar sesión; que expire uno de
los dos y no el otro (TTLs distintos); un navegador que bloquee `localStorage` de
terceros. En una demo, se ve como *"la página está ahí pero no responde"*.

Hay además un camino roto verificable de punta a punta: `POST /api/auth/local-anonymous`
(`web/server.js:313-318`) devuelve un `accessToken` válido pero **nunca hace
`Set-Cookie`**, a diferencia de `local-admin/login` que sí llama `setAdminSessionCookie`.
Y `requireProtectedPageSession` **ignora** `TEMPORARY_DISABLE_AUTH` y
`ALLOW_LOCAL_ANONYMOUS` (a diferencia de `authenticateRequest`, que sí los honra en
`requireAuth.js:281`). Consecuencia medida: **el modo invitado no puede abrir el EMR
jamás** — siempre 302 al login. Para una superficie cuyo propósito declarado es *"la
demostración segura y estable cuando otros entornos no estén disponibles"*, esto es
un defecto de primer orden.

### 3.5 La extensión de Chrome duplica todo el runtime — **CONFIRMADO** (hallazgo no reportado por ustedes)

`chrome-extension-src/graph-trainer/manifest.json` inyecta como *content scripts*
**exactamente los mismos 17 archivos** que el EMR carga por su cuenta, sobre
`"matches": ["<all_urls>"]`, **sin excluir los dominios de Graph**.

Las únicas guardas en `content.js:563-577` son `window.top !== window`,
`settings.enabled` y `globalThis.__graphTrainerExtensionMounted` — y esta última
vive en el **mundo aislado** de la extensión, así que no puede impedir que la
página también monte el suyo.

Verificado cargando la extensión real (compilada con `npm run build:chrome-extension`)
en Chromium y abriendo el EMR:

- **Una sola pulsación de tecla en un campo produce DOS eventos `miracle-field-change`.**
  Dos `PageState` distintos (con claves de `localStorage` distintas:
  `graph-emr-form-state-v1` y `graph-extension-state-<host>`) escuchan el mismo input.
  Todo lo que cuelga de ese evento se ejecuta doble: la revisión clínica, la auditoría,
  el grabador.
- La extensión inyecta **otro widget flotante**, `#graph-trainer-auth-widget`, que
  tapa `intake-first-name` y `intake-phone`.
- Con la extensión puesta, **4 campos del módulo de Registro dejan de ser clicables**
  (los 2 del panel de desarrollador + estos 2).
- Los nodos singleton (`#graph-assistant-shell`, `#teaching-console`, las hojas de
  estilo) **no se duplican** porque las guardas `ensure*` son por `id` en el DOM
  compartido — pero eso significa algo peor: **dos runtimes con estado interno
  independiente manejando el mismo nodo**. Dos gestores de arrastre, dos temporizadores
  de spotlight, dos máquinas de estado de la cara sobre el mismo elemento.

Esta es la respuesta concreta a *"no sabemos con certeza si algunas funciones
dependen de una extensión"*: **no dependen de ella, pero si está instalada, todo
corre dos veces.** Cualquiera del equipo con la extensión puesta ve un EMR que se
comporta distinto al de un cliente sin ella — lo cual hace que los bugs parezcan
intermitentes e irreproducibles.

### 3.6 Otros focos de fragilidad (leídos en el código)

**`window.onload` asignado, no escuchado** — `emr-workspace.html:1518`:
```js
window.onload = () => { PageState.init(...); TrainerPlugin.mount(...); ... };
```
Una asignación, no un `addEventListener`. Hoy funciona (verificado:
`pageStateInicializado: true`, `trainerMontado: true`) porque ninguno de los otros
18 scripts usa `window.onload`. Pero **cualquier script futuro que lo asigne rompe
la inicialización completa del EMR en silencio**, y el orden depende del orden de
las etiquetas `<script>`. Los mismos `page1.html:466` y `page2.html:484` repiten el
patrón.

**Lógica del EMR incrustada en el motor genérico** — `plugin-execution-client.js:236-265`:
```js
if (/(^|[^a-z])(intake|triage)([^a-z]|$)/.test(haystack))       return 'intake';
if (/(^|[^a-z])(anamnesis|exam)([^a-z]|$)/.test(haystack))      return 'anamnesis';
if (/(^|[^a-z])(assessment|orders|rx|plan)([^a-z]|$)/.test(haystack)) return 'orders';
if (/(^|[^a-z])(closure|disposition)([^a-z]|$)/.test(haystack)) return 'closure';
```
Los **prefijos de los `id` del EMR están hardcodeados dentro del motor de ejecución
genérico** (97 KB, el que también debe manejar SAP, superficies de cliente, etc.).
Renombrar `intake-*` a otra cosa rompe la navegación automática entre módulos, y el
error aparecería en un archivo que nadie asociaría con el EMR. Igual pasa con
`resetSurfaceStateForFreshExecution` (línea 335), que busca `window.EMRState`.

**Estado global compartido sin fronteras.** 20 globales, 5 hojas de estilo inyectadas
sin ámbito (`miracle-auth-style`, `miracle-review-styles`, `trainer-plugin-styles`,
`graph-assistant-runtime-styles` + el `<style>` en línea), **6 listeners en fase de
captura sobre `document`** (5 del grabador: `click`, `change`, `input`, `focusin`,
`focusout`; + 1 de la revisión clínica) más 2 sobre `window`, y `z-index` de
`2147482499` a `2147483005` repartidos entre cuatro archivos que se desconocen. No
hay Shadow DOM, ni prefijos de CSS obligatorios, ni un registro único de capas.

*(A favor del grabador: sus 5 listeners salen inmediatamente con `if (!isRecording)
return`, así que no cuestan nada cuando no se está grabando — `recorder.js:891`.)*

**Un temporizador permanente:** `assistant-runtime.js:1977` re-mide el spotlight con
`setInterval(..., 120)` mientras haya un objetivo resaltado. Es una decisión
consciente y documentada (`rAF` se pausa en pestañas de fondo), pero es un
`getBoundingClientRect` cada 120 ms mientras Miracle trabaja.

---

## 4. Diagnóstico visual

Medido sobre el módulo de Registro a 1440×900 (`evidencia/metrics.json`).

### 4.1 Uso del espacio vertical

| Métrica | Valor |
|---|---|
| Alto del documento — Registro | **2.354 px** = **2,6 pantallas** |
| Alto del documento — Anamnesis | 1.897 px = 2,1 pantallas |
| Alto del documento — Órdenes | 2.124 px = 2,4 pantallas |
| Alto del documento — Cierre | 1.404 px = 1,6 pantallas |
| **En móvil (390×844) — Registro** | **5.029 px = 6,0 pantallas** |
| Densidad | 14,1 campos por cada 1.000 px |

**589 px se consumen antes del primer campo** (topbar 97 + ribbon 152 + tabs 42 +
cabecera de vista 148 + cabeceras de tarjeta 150). Es **el 65 % de la primera
pantalla dedicado a texto explicativo**, no a trabajo clínico. Hay 1.388 caracteres
de prosa descriptiva en párrafos que un médico lee una vez y nunca más
("Versión extendida del intake con más datos demográficos…").

Peso muerto medible: `.workspace-body { display: block; min-height: 920px }`
(`emr-workspace.html:175-178`) impone 920 px de alto mínimo a un contenedor que
ya no necesita reservarlos.

### 4.2 Ruido visual

| Elemento (módulo de Registro visible) | Cuenta |
|---|---|
| Elementos visibles en el panel principal | 146 |
| Cajas con borde | **51** |
| Cajas con sombra | **38** |
| Cajas con esquinas redondeadas | **52** |
| Etiquetas de campo (29 en Registro, 67 en los 4 módulos) | **el 100 % en MAYÚSCULAS con `letter-spacing`** |
| Colores de fondo distintos en una sola pantalla | 8 |

Cinco niveles de anidamiento de cajas para llegar a un input:
`.surface-card` → `.workspace-shell` → `.workspace-body` → `.main-panel` → `.form-card`.
Los tres primeros no aportan nada visual distinguible; son restos de un layout de dos
columnas que ya no existe (§4.6).

Las 67 etiquetas de campo (regla única `label { text-transform: uppercase }` en
`emr-workspace.html:416-424`, con `letter-spacing: 0.05em` y `font-size: 0.78rem`)
son el patrón que hace que esto *"se sienta como un formulario administrativo largo"*:
son más difíciles de escanear que texto en caja baja y compiten en peso visual con
los valores. Reparto: Registro 29 · Anamnesis 12 · Órdenes 18 · Cierre 8.

### 4.3 Jerarquía rota en los tabs

Medido: los 4 tabs son **azul brillante `rgb(47,140,255)` con texto blanco**, y el
activo es azul oscuro `rgb(20,94,168)`. En una interfaz que por lo demás es gris
claro y blanco, **el elemento más llamativo de la pantalla es la barra de navegación,
no el contenido clínico ni lo que hace Miracle**. Y como todos los tabs son igual de
llamativos, el estado activo casi no se distingue (ver `evidencia/view-intake.png`).

### 4.4 El asistente tapa zonas importantes — cuantificado

Con la hoja de notas abierta (`evidencia/nota-abierta.png`):

- Ocupa **360×560 px = 15,6 % del viewport**, anclada abajo a la izquierda.
- Solapa 5 campos del formulario y **bloquea físicamente 3**:
  `intake-patient-id` (Número de historia clínica), `intake-first-name` (Nombre),
  `intake-phone` (Teléfono móvil) — es decir, **tres de los siete campos obligatorios
  para guardar la admisión**.

Peor que eso: en el cuadrante inferior derecho conviven **cinco capas flotantes
independientes**, cada una posicionada por un archivo distinto:

| Capa | Origen | `z-index` |
|---|---|---|
| Carita (`graph-assistant-shell`) | `assistant-runtime.js` | 2147483000 |
| Burbuja de estado | `assistant-runtime.js` | +1 |
| Botones de chat y nota | `assistant-runtime.js` | +3 |
| Consola de enseñanza (`.console`) | `trainer-plugin.js` | 50 |
| Developer workspace (`aside`) | `admin-workspace.js` | 2147482500 |

En `evidencia/nota-abierta.png` se ve la burbuja de estado de Miracle cayendo
**encima** del panel de desarrollador, con la carita a medias sobre ambos. Nadie
coordina estas posiciones: `positionBubbleNearShell` (`assistant-runtime.js:1845`)
recalcula 5 cajas a mano con `clamp`, y no sabe que el `aside` ni la consola existen.

### 4.5 No comunica qué está haciendo Miracle

Lo que sí existe hoy (y funciona): estados `Escuchando / Organizando / Llenando
campos / Necesita revisión / Ejecutando` en una pastilla junto a la cara
(`assistant-runtime.js:84-90`), un punto de color por tipo de actividad, el spotlight
sobre el campo activo, y el marcado ámbar/rojo de campos propuestos por IA
(`clinical-review.js:15-16`).

Lo que falta, y es lo que hace que *"no represente todo el valor del producto"*:

- **Ningún resumen agregado.** No hay en ninguna parte un "Miracle completó 12 de 34
  campos, 3 necesitan tu revisión". La cuenta existe internamente (`unconfirmed`) pero
  el único indicador que la mostraba **fue eliminado a propósito**: `updateChip()`
  (`clinical-review.js:21-26`) hoy solo borra el chip, con el comentario *"Bottom review
  chip removed by design"*. Se quitó el indicador y no se puso nada en su lugar.
- **La evidencia está escondida en un `title`.** El *por qué* Miracle escribió cada
  valor (`"Propuesto por IA · <evidencia> · confianza 87%"`) solo se ve pasando el
  ratón por encima (`clinical-review.js:44`). En una demo, nadie hace hover; el valor
  diferencial del producto es invisible.
- **El bloqueo de firma no se explica.** Cuando `clinical-review` descarta un clic
  (§3.1), el usuario no recibe **ningún** mensaje. La intención del código era buena —
  no dejar firmar con valores sin revisar — pero se implementó como un silencio.

### 4.6 Código muerto — medido, no supuesto

De las 77 reglas del `<style>` en línea, **17 selectores no corresponden a ningún
elemento de la página** (verificado ejecutando `querySelectorAll` de cada selector
contra el DOM real):

```
.workspace-top   .workspace-top strong   .workspace-top span
.workspace-badges   .badge   .grid-two
.side-card   .side-card h3   .side-card p   .side-card li   .side-card ul
.side-stat-grid   .side-stat   .side-stat strong   .side-stat span
.side-note   .activity-list
```

Es un **layout de dos columnas con barra lateral, cabecera de workspace y lista de
actividad que fue eliminado sin limpiar su CSS** — coherente con la historia del
archivo (§1.3: cinco commits, casi todos quitando cosas). A eso se suma
`@media (max-width: 1280px) { }`, un bloque **completamente vacío**
(`emr-workspace.html:571-572`), donde vivían las reglas de esa barra lateral, y una
regla duplicada `.main-panel, .main-panel { padding: 16px }` (líneas 601-604).

Esto responde la pregunta implícita de *"no eliminar código que parezca obsoleto sin
demostrar primero que lo es"*: **estos 17 selectores están demostrados como muertos**,
con el método reproducible en `tools/audit/emr-expanded/probe3.js`.

### 4.7 Detalle menor pero real

`.action-btn:hover { transform: translateY(-1px) }` (`emr-workspace.html:472-474`).
Todos los botones de acción **se desplazan 1 px al pasar el ratón**. Para un humano es
invisible; para cualquier automatización que mida y luego actúe, el objetivo se mueve
entre la medición y el clic. No es la causa de los síntomas reportados (la
automatización actual es por DOM, no por coordenadas), pero es exactamente el tipo de
detalle que rompería una integración con un HIS real que sí use coordenadas.

---

## 5. Qué está bien y hay que conservar

Sería un error tratar todo esto como "hay que rehacerlo". Lo siguiente está bien
diseñado y **no debe tocarse**:

1. **El modelo de datos del formulario.** 88 controles, **83 con `data-testid`** y
   **75 con `id` estable** (`intake-patient-id`, `triage-temperature`,
   `assessment-icd10`…), `<label for>` correcto en todos los campos, `aria-label` y
   `title` en todos los botones de navegación. Es un contrato de automatización
   **excelente**, mejor que el de la mayoría de HIS reales. Toda la capa de aprendizaje
   y ejecución depende de él. **Cualquier rediseño debe preservar estos identificadores
   uno a uno.**
   *(Única inconsistencia detectada: `closure-complete` — "Cerrar encuentro" — es la
   acción principal del último módulo y es la única que no tiene `data-testid`;
   `clear-emr` tampoco. Vale la pena añadírselos antes de cualquier rediseño.)*
2. **`page-state.js`.** 227 líneas, una sola responsabilidad, API limpia
   (`applyProgrammaticField` con `source`/`evidence`/`confidence`, `beginProgrammatic`/
   `endProgrammatic` para atribución, guarda contra pisar el campo que el usuario está
   editando). Es la mejor pieza del conjunto.
3. **La intención de `clinical-review.js`.** Marcar lo que escribió la IA, exigir
   confirmación y bloquear la firma es **exactamente lo correcto** para un producto
   clínico. Lo que está mal es la implementación (regex sobre texto visible +
   `stopPropagation` silencioso), no la idea. Hay que arreglarla, no quitarla.
4. **El motor de dictado.** `deepgram-dictation.js` está bien encapsulado, es la única
   fuente de verdad de voz, y el audio va del navegador directo a Deepgram sin pasar por
   el backend. Correcto operativa y económicamente.
5. **`ensureSurfaceSection`** (`plugin-execution-client.js:267`) — la ruta de llenado
   dinámico cambia de módulo antes de escribir y espera confirmación. Es la solución
   correcta; el problema es que las **otras** rutas no la usan.
6. **`isSpotlightTargetUsable`** (`assistant-runtime.js:1948`) — la guarda de
   visibilidad está bien escrita y bien comentada. Solo falta aplicarla también al
   movimiento de la carita.
7. **Las decisiones de estabilidad ya tomadas y comentadas** en `assistant-runtime.js`:
   burbuja de tamaño fijo, hoja de altura fija, pastilla de estado de ancho fijo,
   `MIN_MOVE_INTERVAL_MS`. Cada una resuelve un temblor real y está documentada con su
   porqué. Son conocimiento ganado con dolor; no perderlo.

---

## 6. Recomendación

### El diagnóstico en una frase

El EMR Expanded **no está roto por dentro; está roto en las costuras**. El formulario
en sí es sólido y perfectamente automatizable. Los fallos vienen, sin excepción, de
**siete módulos independientes que comparten un DOM global sin fronteras**: se pisan en
`z-index`, en listeners de `document` en captura, en `window.onload`, en globales, en
hojas de estilo sin ámbito y en dos sistemas de autenticación que no se hablan.

### Recomendación: **opción 5 + opción 2, en ese orden — y explícitamente NO la 4**

De las seis opciones planteadas:

| # | Opción | Veredicto |
|---|---|---|
| 5 | **Separar responsabilidades mezcladas** | **SÍ — primero y con prioridad.** Es donde están todos los bugs. |
| 2 | **Rehacer solo la capa visual** | **SÍ — después**, sobre el HTML, preservando `id` y `data-testid` uno a uno. |
| 1 | Refactorizar el EMR actual | Parcialmente: es lo que es la opción 5. No hace falta más. |
| 6 | **Mantener partes sin cambios** | **SÍ**, las siete de §5. |
| 3 | Crear un EMR V2 paralelo | **No.** Duplicaría 88 identificadores de los que depende toda la capa de aprendizaje, y habría que mantener dos demos. |
| 4 | Reconstruir interfaz **y** lógica | **No.** La lógica del EMR son 260 líneas y funcionan. Reconstruirlas es riesgo sin retorno, sobre la superficie que debe ser el plan B cuando todo lo demás falla. |

### Por qué en ese orden

Rediseñar primero sería el error caro: el rediseño se haría sobre una base donde
los clics se pierden, los campos fantasma existen y las capas se pisan. Se
arrastrarían los mismos problemas, con la interfaz nueva encima — que es
exactamente cómo se llegó al estado actual (*"la interfaz se deforma al hacer
cambios"*). **Primero se arreglan las costuras; entonces el rediseño es seguro y
barato.**

### Plan sugerido

**Fase 0 — Confirmar el deployment (antes de cualquier cambio).** Verificar en
Vercel qué rama y qué commit sirven `graph-eight-pied`, `graph-five-orpin` y
`miracle-zeta`. Es lo único que no pude cerrar (§1.4) y es un prerrequisito para
tocar `main` con confianza, dado que no hay CI ni protección de rama.

**Fase 1 — Separar responsabilidades (sin cambiar una sola línea de UI).**
Ordenada por relación impacto/riesgo:

1. **Una sola verdad de sesión.** Que la puerta del cliente consulte al servidor en
   vez de a `localStorage`, o que el servidor emita la cookie que el cliente ya tiene.
   Arreglar de paso `local-anonymous` (que ponga `Set-Cookie`) y hacer que
   `requireProtectedPageSession` honre `TEMPORARY_DISABLE_AUTH` /
   `ALLOW_LOCAL_ANONYMOUS` como hace `authenticateRequest`. **Elimina la capa
   invisible que bloquea todos los clics y desbloquea el modo demo sin login.**
2. **Que la revisión clínica hable.** Sustituir la regex sobre texto visible por una
   marca explícita (`data-finalize="true"` en los botones que deben bloquearse), y que
   al bloquear **muestre un mensaje** en vez de descartar el clic en silencio. Y que
   **exima los clics del propio motor** (o que el motor confirme antes de firmar) para
   romper el auto-bloqueo. **Elimina "los clics no hacen nada".**
3. **Un solo registro de capas flotantes.** Un módulo que sepa dónde está cada cosa
   (carita, burbuja, botones, consola, panel admin, hoja de notas) y las coloque sin
   solaparse. Y **esconder el "Developer workspace" detrás de un flag**, porque hoy
   aparece en cualquier demo y tapa campos clínicos.
4. **Que el snapshot no reporte lo invisible.** Filtrar por `visible` en
   `capturePageSnapshot`, o marcar los campos ocultos con su módulo y exigir el cambio
   de módulo antes de escribir. Añadir `admin-workspace` a `EXCLUDED_SURFACE_SELECTOR`
   y a `isAssistantSurface`. Que `applyProgrammaticField` rechace campos con rect
   `0×0`. **Elimina los campos fantasma y las escrituras invisibles.**
5. **Aplicar `isSpotlightTargetUsable` también a `moveToSelector`.** Una línea; la
   guarda ya existe y está probada.
6. **Excluir los dominios de Graph del `manifest.json` de la extensión**, o que la
   página marque `document.documentElement.dataset.miracleRuntimeMounted` y la
   extensión lo respete. **Elimina el doble montaje y los bugs "intermitentes".**
7. **Sacar los prefijos del EMR del motor genérico.** Que `inferSurfaceSectionFromStep`
   lea el módulo del propio DOM (`closest('[data-view]')`, que ya existe y es fiable)
   en vez de tener `intake|triage|anamnesis|...` hardcodeado.
8. **`window.addEventListener('load', ...)`** en lugar de `window.onload =`. Trivial,
   elimina una bomba de relojería.

**Fase 2 — Rehacer la capa visual.** Con las costuras arregladas, sobre el mismo
markup y **preservando los 88 `id` y `data-testid` uno a uno** (esa preservación debe
ser un test automático, no una promesa). Objetivos medibles derivados de §4:

| Métrica | Hoy | Objetivo |
|---|---|---|
| Alto del módulo de Registro | 2.354 px (2,6 pantallas) | ≤ 1 pantalla + 1 scroll |
| Píxeles antes del primer campo | 589 px | ≤ 200 px |
| Cajas con borde | 51 | ≤ 15 |
| Cajas con sombra | 38 | ≤ 5 |
| Etiquetas en MAYÚSCULAS | 67 | 0 |
| Campos bloqueados por capas flotantes | 4–6 | **0** |
| Selectores CSS muertos | 17 | 0 |

Y lo que hoy falta y es el punto entero del producto: **un panel permanente y visible
de "qué hizo Miracle"** — cuántos campos completó, cuáles necesitan revisión, con qué
evidencia y con qué confianza. Todos esos datos ya existen en memoria
(`unconfirmed`, `evidence`, `confidence`); hoy solo se muestran en un `title` al pasar
el ratón, y el único indicador agregado que existía se eliminó a propósito.

**Fase 3 — Red de seguridad.** Antes de la Fase 2, un test que abra el EMR, recorra
los 4 módulos y falle si (a) algún control visible no recibe su propio clic
(`elementFromPoint`), o (b) desaparece algún `id`/`data-testid`. `probe2.js` y
`probe3.js` ya hacen las dos cosas; convertirlos en test es trabajo de una tarde y
convierte "la interfaz se deforma al hacer cambios" en un fallo que salta solo.

**Sobre `frontend-build-step`:** esa rama ya trae bundling, gate de lint + typecheck y
CI. Decidir pronto si se integra o se descarta — el trabajo de la Fase 1 se hará dos
veces si esa rama entra después.

### Riesgo de no hacer nada

El EMR Expanded es el plan B de las demos. Hoy, en una demo delante de un cliente y
sin tocar nada, puede pasar que: aparezca un panel negro de login sobre un EMR ya
cargado; el panel "Developer workspace" con el correo del vendedor tape campos
clínicos; el botón "Firmar nota clínica" no haga nada y nadie sepa por qué; y Miracle
escriba un valor en un campo que nadie ve. Todo eso está **verificado en este
diagnóstico**, no supuesto.
