# Plan — Fase 1: build step en el frontend

> Plan de la Fase 1 de la reconstrucción incremental. Alcance cerrado con el
> usuario: **solo bundler, comportamiento idéntico**. La conversión a
> `import`/`export` es Fase 2 y no entra aquí.

## El problema

`npm run build:vercel` es literalmente `fs.cpSync` (`scripts/build-vercel.js:9`). No hay bundler, no hay módulos, no hay minificación. Consecuencias medidas:

1. **Tres listas de carga en orden, sincronizadas a mano.** Agregar un módulo al runtime hoy obliga a editar las tres o algo se rompe en silencio:
   - `<script src>` en los HTML (19 en `emr-workspace.html`, 18 en `page1`/`page2`)
   - `content_scripts.js` en `chrome-extension-src/graph-trainer/manifest.json` (16 entradas)
   - la lista de precache en `web/public/service-worker.js` (22 rutas)
2. **Helpers duplicados por necesidad.** Sin `import`, compartir código entre archivos solo se puede copiando: `escapeHtml`, `ensureStyles`, `apiClient`, `executeWorkflowPlan`, `normalizeSemanticTargetText`, `emitExtensionLog` y ~10 más están duplicadas entre `assistant-runtime.js`, `trainer-plugin.js`, `plugin/plugin-execution-client.js` y `recorder.js`.
3. **Archivos de 2.500 líneas.** Partirlos hoy no mejora nada: solo agrega otro `<script>` al orden frágil.
4. **19 requests sin minificar** en la superficie principal.

El punto 2 y 3 son *consecuencia* del 1. Esta fase ataca la causa.

## Restricciones duras (verificadas en el código, no asumidas)

1. **Los content scripts de MV3 no pueden ser módulos ES.** `manifest.json` carga 16 archivos como `content_scripts`, y Chrome no soporta `type: "module"` ahí. **El artefacto distribuido tiene que ser script clásico.** Esto descarta servir ESM nativo y fuerza salida **IIFE**.
2. **`web/server.js:952` arma el ZIP de la extensión al vuelo** con `collectExtensionFiles()` leyendo de `web/public/`. Al bundlear, ese endpoint pasa a depender de artefactos construidos.
3. **`service-worker.js` no puede entrar a un bundle de página**: se registra por URL propia. Se queda standalone; solo cambia su lista de precache.

## El hallazgo que hace esto seguro

**Todos los scripts clásicos ya están envueltos en su propio IIFE** y exportan vía `window.X`. Verificado archivo por archivo en los 25 de `web/public/*.js`, `plugin/*.js` y `shared/*.js`: el primer statement real es `(function () {` o `window.X = (() => {`. Además **ningún archivo tiene `'use strict'` a nivel top**, ninguno usa `document.currentScript`, `import.meta`, ni se busca a sí mismo con `querySelector('script[src...]')`, y ninguno hace `return` a nivel top-level real.

Consecuencia: **concatenar N scripts clásicos en orden de ejecución es semánticamente idéntico a que el navegador los cargue como N `<script>`.** Ambos comparten un único scope global, y cada archivo ya aísla lo suyo.

El único con declaraciones top-level desnudas es `service-worker.js` (`const CACHE`), que por diseño nunca entra a un bundle de página.

Ya existe además un sistema de módulos de facto: **22 namespaces `window.GraphX`/`window.MiracleX` con exports explícitos**. Eso es lo que en Fase 2 se convierte a `import`/`export` de forma mecánica.

## Corrección crítica: el orden textual NO es el orden de ejecución

Una revisión senior del plan encontró un error que invalidaba la mitigación principal. **Dos HTML mezclan `defer` con scripts clásicos**, y ahí el orden textual y el de ejecución difieren:

`web/public/windows-lab.html`:

| | orden |
|---|---|
| Textual (lo que concatenaría ingenuamente) | `miracle-bg`, `auth-gate`, `windows-live`, `studio-docs`, `windows-lab` |
| **Real hoy** (clásicos primero, luego los `defer`) | `auth-gate`, `studio-docs`, `miracle-bg`, `windows-live`, `windows-lab` |

`web/public/provider-studio.html`: `miracle-bg` tiene `defer` en la línea 9 y los otros 4 son clásicos al final del body — hoy `miracle-bg` corre **último**; concatenado textualmente correría **primero**.

Y no es teórico: `web/public/windows-live.js:17` hace `const ROOT = document.getElementById('windows-live'); if (!ROOT) return;` — depende de que el DOM exista, o sea de `defer`. Además bifurca por `document.readyState`, cuyo valor **cambia** según defer/no-defer. Un bundle sin `defer` dejaría `windows-lab` muerto en silencio.

### Regla de diseño resultante

**Agrupar por semántica de carga, no por archivo.** Para cada entry point:

1. Clasificar sus scripts en grupos: `clásico`, `defer`, `async`, `module`.
2. Emitir **un bundle por grupo**, concatenando dentro del grupo en orden de documento.
3. El bundle hereda el atributo de su grupo (el bundle `defer` lleva `defer`).

Eso preserva la semántica **exactamente**, sin tener que auditar cada `readyState` a mano. Coste: los entry points mixtos quedan con 2 bundles en vez de 1. Sigue siendo 76 → ~16 tags.

| Entry point | Hoy | Después |
|---|---|---|
| `emr-workspace` | 19 clásicos | 1 bundle clásico |
| `page1` / `page2` | 18 clásicos | 1 bundle clásico cada uno |
| `windows-lab` | 2 clásicos + 3 `defer` | 2 bundles (clásico + defer) |
| `provider-studio` | 4 clásicos + 1 `defer` | 2 bundles (clásico + defer) |
| `miracle/index` | 3 clásicos + 1 `module` | 2 bundles (clásico + module→IIFE) |

### Scripts inline: se quedan donde están

`emr-workspace.html` tiene inline en `:1246` (entre externos) y `:1270` (al final); `provider-studio.html` en `:729`. **No se tocan ni se mueven.** El de `:1246` registra el service worker dentro de `window.addEventListener('load')`, así que es independiente del orden; el de `:1270` declara `const views` y funciones en scope global que el resto de la página usa. El bundle reemplaza solo los `<script src>`, preservando la posición relativa de los inline.

## Diseño

### Fuente única de verdad

Un módulo nuevo, `scripts/lib/frontend-bundles.js`, declara los entry points y sus archivos en orden. **Es el único lugar donde vive esa lista.** Lo consumen:

- el build de producción (`scripts/build-vercel.js`)
- el middleware de dev en `web/server.js`
- el manifiesto de la extensión (`scripts/lib/chrome-extension-bundle.js`)
- la lista de precache del service worker (generada, no escrita a mano)

Eso convierte "editar 3 listas" en "editar 1".

### Dos modos de bundle, por entry point

| Modo | Para | Cómo |
|---|---|---|
| `concat` | scripts clásicos IIFE (`web/public/*.js`, `plugin/`, `shared/`) | concatenar en orden + minificar con esbuild. Semánticamente idéntico a hoy |
| `module` | `web/public/miracle/**` (ya es ESM real) | `esbuild --bundle --format=iife` resolviendo los `import` |

Que ambos modos convivan es lo que permite que Fase 2 migre entry points de `concat` a `module` **de a uno**, sin un big bang.

### Salida

- `web/public/dist/<entry>.js` — un archivo por entry point, minificado, con sourcemap.
- Los HTML pasan de N `<script src>` a uno solo.
- El content script de la extensión pasa de 16 entradas a 1.

### Desarrollo (decisión: middleware, un solo proceso)

`web/server.js` en modo dev intercepta `/dist/*.js` y bundlea al vuelo. `npm start` sigue siendo un comando y guardar+refrescar sigue funcionando igual que hoy. Detalles que la revisión senior obligó a precisar:

- **Señal de dev:** `process.env.NODE_ENV !== 'production' && !process.env.VERCEL`. Hoy no existe ninguna señal de modo dev en `web/server.js`; se introduce con este cambio.
- **Orden de registro:** el middleware va **antes** de `express.static('web/public')` (`web/server.js:298`), o un `/dist` rancio en disco le gana al bundle fresco.
- **Concurrencia:** caché de promesas por entry point, no solo por mtime. Dos requests simultáneos al mismo bundle comparten un único build en vuelo en vez de dispararlo dos veces.

### El endpoint de ZIP de la extensión: bundlea in-process

La mitigación original era incorrecta. `web/server.js:927` (el endpoint arranca ahí; `:952` es solo el `for`) llama `collectExtensionFiles()`, que en `scripts/lib/chrome-extension-bundle.js:60-84` lee `absPath` **directamente del filesystem** — no pasa por Express ni por ningún middleware, así que "el endpoint pide el bundle" no era cierto.

Además el destino natural del build (`web/public/dist/`) **está gitignoreado** (`.gitignore:15`, verificado con `git check-ignore`), y no está confirmado que el `includeFiles` de `vercel.json` capture archivos creados por el `buildCommand`. Apostar a que sí es apostar el endpoint en producción.

**Decisión:** `collectExtensionFiles()` pasa de devolver `{absPath, archivePath}` a `{archivePath, getContent()}`, donde `getContent` lee un archivo del disco **o** devuelve los bytes del bundle generado en memoria. El endpoint y `scripts/build-chrome-extension.js` siguen compartiendo una sola fuente de verdad, y no dependen de que exista `/dist` en el filesystem del serverless.

**Coste explícito:** esbuild pasa de `devDependencies` a `dependencies`, porque el server lo necesita en runtime. Si más adelante confirmamos empíricamente que `includeFiles` sí captura la salida del build, se puede revertir a leer artefactos y sacar esbuild de producción.

Nota: el `manifest.json` lista **17** entradas, no 16 — la 17ª es `content.js`, que vive en `chrome-extension-src/`, no en `web/public/`. El bundle de la extensión cruza los dos árboles.

### Versionado y caché

Hoy el cache-busting es manual y por archivo: `provider-studio.js?v=3`, `windows-live.js?v=2`, `miracle/app.js?v=8`. Esa disciplina se cae sola si no la reemplazamos.

**Decisión para Fase 1:** nombre estable `/dist/<entry>.<grupo>.js` + header `Cache-Control: no-cache, must-revalidate` para `/dist/*` en `vercel.json`, más bump de `CACHE` en el service worker. El navegador revalida siempre (un 304 es barato) y desaparece el `?v=N` a mano. Caché inmutable con hash en el nombre es una optimización de Fase 2, no de esta.

### ESLint no debe lintear la salida

Verificado empíricamente: el ignore `dist/**` de `eslint.config.js` solo matchea el `dist/` de la raíz — `npx eslint .` **sí** lintea `web/public/dist/`. Con salida minificada eso llena `npm run verify` de ruido. Se agrega `web/public/dist/**` a los ignores.

`tsconfig.json` no se ve afectado: su `include` es solo `src/**` y `web/api/**`.

## Métrica de éxito y baseline

**Métrica primaria:** requests JS y KB en la superficie principal (`emr-workspace`).

Baseline **medido con `node scripts/measure-frontend-payload.js`** el 2026-07-26, guardado en `docs/baseline-frontend-payload.json`. No copiar estos números a mano: re-correr el script.

| Página | Baseline (hoy) | Objetivo |
|---|---|---|
| `emr-workspace` | 19 requests / 450 KB | 1 request / < 200 KB |
| `page1` / `page2` | 18 requests / 429 KB | 1 request / < 200 KB |
| `provider-studio` | 5 requests / 133 KB | 1 request |
| `windows-lab` | 5 requests / 123 KB | 1 request |
| `miracle/index` | 4 requests / 66 KB | 1 request |
| **Total frontend** | **76 `<script src>`** | **~14 (uno por página)** |

**Métrica secundaria (la que importa para la disciplina del equipo):** listas de carga sincronizadas a mano: **3 → 1**.
- HTML con >5 scripts: 3 páginas
- `manifest.json` `content_scripts`: 17 entradas
- `service-worker.js` precache: 20 rutas `.js`

**Métrica de guardia (no debe moverse):** cero regresiones. Verificable por:
- los 22 `window.X` presentes tras cargar la página (script de verificación)
- `npm run verify` en verde (42 verificaciones clínicas)
- la extensión sigue cargando e inyectando en una página real

**Instrumentación:** `scripts/measure-frontend-payload.js` mide requests y KB por entry point, para poder re-correr la métrica y no depender de números copiados a mano en este documento.

## Resultado (Fase 1 completa)

Medido con `node scripts/measure-frontend-payload.js`:

| Métrica | Baseline | Después |
|---|---|---|
| `<script src>` en todo el frontend | 76 | **16** |
| `emr-workspace` | 19 req / 450 KB | **2 req / 229 KB** |
| `page1` / `page2` | 18 req / 429 KB | **1 req / 216 KB** |
| `windows-lab` | 5 req / 123 KB | **2 req / 67 KB** |
| `manifest.json` `content_scripts` | 17 entradas | **1** |
| `service-worker.js` precache | 20 rutas | **2** (y con test que falla si se desincroniza) |
| **Listas a sincronizar a mano** | **3** | **1** |
| Archivos del paquete de la extensión | 22 | **6** |

Verificado: `npm run verify` en verde, 46 verificaciones en `npm run test:frontend-bundles`, ZIP de la extensión generado correctamente **sin `/dist` en disco** (valida el diseño para el serverless), y todas las páginas sirviendo sus bundles con 200 contra el server real.

## Plan de ejecución

1. ✅ `scripts/measure-frontend-payload.js` + baseline en `docs/baseline-frontend-payload.json`.
2. `scripts/lib/frontend-bundles.js` — fuente única de verdad, **derivada de los HTML** (parsea los `<script>` y los agrupa por semántica de carga) para que no haya una segunda lista que se desincronice.
3. Motor de bundling sobre esbuild: modo `concat` (clásicos IIFE) y modo `module` (ESM de `miracle/`), con caché de promesas.
4. `scripts/build-vercel.js` genera `/dist` antes del `cpSync`.
5. Middleware de dev en `web/server.js`, registrado antes de `express.static`.
6. Reescribir los `<script src>` de los HTML a bundles por grupo, preservando los inline en su posición.
7. `manifest.json` + `chrome-extension-bundle.js` con `getContent()` y bundle in-process.
8. Generar la lista de precache del service worker desde la fuente única + bump de `CACHE`.
9. `web/public/dist/**` a los ignores de ESLint; header de caché en `vercel.json`.
10. Verificación: script que valida los 22 `window.X` presentes, `npm run verify`, extensión cargada a mano en Chrome, medición final vs baseline.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| **`defer` mezclado cambia el orden de ejecución** | Un bundle por grupo de semántica de carga. Preserva el orden real, no el textual. Es el riesgo que la revisión senior encontró y el que define el diseño |
| El endpoint de ZIP falla en producción por falta de `/dist` | `getContent()` bundlea in-process; no depende del filesystem del serverless |
| Un archivo dependía del orden de forma no obvia | El orden **dentro de cada grupo** se preserva exacto. Verificado que no hay `currentScript`, `readyState` fuera de los 4 casos auditados, ni auto-búsqueda por `src` |
| El service worker sirve caché vieja | Bump de `CACHE = 'miracle-shell-vN'` + precache generado, no escrito a mano |
| ESLint lintea la salida minificada | `web/public/dist/**` en ignores (verificado que hoy sí la lintearía) |
| Se pierde el cache-busting manual `?v=N` | `Cache-Control: no-cache, must-revalidate` en `/dist/*` |
| esbuild entra al bundle serverless de producción | Aceptado y documentado. Reversible si se confirma que `includeFiles` captura la salida del build |
| Rompemos la extensión sin darnos cuenta | `npm run build:chrome-extension` + carga manual en Chrome antes de cerrar la fase |

## Fuera de alcance (explícito)

- Convertir `window.X` a `import`/`export` → **Fase 2**
- Deduplicar los ~15 helpers copiados → **Fase 2** (requiere módulos reales)
- Partir los archivos de +1000 líneas → **Fase 2**
- Tests del motor de workflows → **Fase 0**, independiente
- Decidir qué features matar → **Fase 3**, decisión de producto
