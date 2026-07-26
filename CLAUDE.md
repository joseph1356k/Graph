# CLAUDE.md

Guía de trabajo para agentes en este repo. Si algo aquí contradice al código, gana el código: corrige este archivo.

## Qué es Graph

Motor de aprendizaje y reproducción de workflows para aplicaciones web, más un flujo clínico de voz → nota → autofill. **No son dos productos**: el aprendizaje de workflows es lo que le dice al sistema *dónde* colocar cada dato de la nota en cada EMR. Sin él, el autofill no funciona.

```
aprender campos del EMR (workflow learning)  ──┐
transcribir voz (Deepgram / Soniox)            ├─→ autofill correcto (+ replay)
organizar la nota (Product-LLM, Python)        ──┘
```

Las páginas médicas de `web/public/` son **superficie de validación**, no el producto. El producto es el runtime reusable + el host de extensión.

## Comandos

```bash
npm ci                        # instalar (node_modules no está versionado)
npm start                     # Express en :3000  (= node web/server.js)
npm run verify                # lint + typecheck + test  ← el gate
npm run lint                  # ESLint sobre src, web, api, scripts, extensión
npm run lint:fix              # ESLint con --fix
npm run typecheck             # tsc --noEmit (chequeo gradual, ver abajo)
npm test                      # batería clínica: catálogo + workflow + assistant
npm run audit:readiness       # auditoría de readiness del sistema
npm run build:vercel          # build de despliegue
npm run build:chrome-extension  # extensión desempaquetada en generated/chrome-extension/
```

**Antes de decir "listo"** (paso 11 de `build-feature`): `npm run verify`, y pega la salida. Nunca reportes una tarea como completa sin la evidencia.

Estado base del gate, para que reconozcas una regresión: **lint 0 errores** (los avisos existentes son deuda conocida — `no-var`, `no-unused-vars`, `eqeqeq` en código antiguo — corre `npm run lint` para ver el conteo actual, no lo asumas de este documento), **typecheck 0 errores**, **tests todos OK**. Los avisos no bloquean, pero si tocas un archivo, deja sus avisos en cero.

Además hay un hook `PostToolUse` (`.claude/hooks/lint-archivo-editado.js`) que corre ESLint sobre cada `.js` que editas y te devuelve los errores en el momento. Si te llega ese feedback, arréglalo antes de continuar; no lo silencies con `eslint-disable`.

Comandos disponibles: `/verificar` (gate completo con criterios de reporte), `/tipar <archivo>` (meter un archivo al chequeo de tipos), `/build-feature` (el loop de feature completo).

## Arquitectura y reglas de capas

```
src/domain/            entidades y lógica pura. NO importa nada de fuera de src/domain.
src/application/       use-cases. Reciben sus dependencias por constructor/params.
src/infrastructure/    Neo4j, Supabase REST, LLM providers, filesystem, teach/video.
web/server.js          COMPOSITION ROOT: instancia infraestructura + use-cases y los
                       inyecta en los register*Routes. Todo el wiring vive aquí.
web/api/register*.js   `registerXRoutes(app, deps)`. Sin `new` de infraestructura dentro.
web/public/            runtime de navegador (recorder, plugin, assistant, studio).
bounded/miracle-ai/    runtime Python (voz + organización de nota), Starlette.
api/                   entrypoints serverless de Vercel (index.js, miracle_runtime.py).
```

Reglas al escribir código nuevo:

- Un use-case nuevo recibe sus colaboradores inyectados; no hace `require` de un cliente concreto de Supabase/Neo4j/LLM.
- Una ruta nueva es un `registerXRoutes(app, deps)` en `web/api/`, y su wiring va en `web/server.js`.
- **Desviación conocida:** `AgentTurnService`, `ConsciousProviderConfigService`, `TeachVideoService` y `TeachVideoProviderConfigService` importan `infrastructure` directamente. Es deuda, no patrón: no la copies.

## Convenciones

- **Commits:** `tipo(ámbito): descripción en minúscula`, en español. Tipos: `feat`, `fix`, `docs`, `refactor`, `chore`. Ej: `feat(studio): logs en vivo por SSE`. El historial viejo mezcla estilos; sigue este.
- **Idioma:** código, nombres y APIs en inglés. Comentarios y documentación en español.
- **CommonJS** en todo el Node (`require`/`module.exports`). No hay ESM ni bundler; los archivos de `web/public/` se sirven tal cual.
- **Sin dependencias nuevas** sin decirlo primero. El runtime tiene 9 y conviene que siga así (las devDeps son solo `eslint`, `typescript`, `@types/node`).
- **Secretos:** todo por env. Cualquier variable nueva se documenta en `.env.example` en el mismo commit.

## Archivos que NO debes editar

- `WORKFLOWS.md` en la raíz — generado en runtime por `MarkdownCatalogWriter`, está en `.gitignore`.
- `generated/`, `public/` (salida de build), `package-lock.json` salvo al cambiar deps a propósito.
- `.agents/skills/` — skills instaladas vía `npx skills add`; se actualizan con la herramienta, no a mano.

## Seguridad de `.claude/settings.json` (léelo como es, no como parece)

- `deny` bloquea el tool `Read` sobre archivos `.env*` y ciertos patrones exactos de `Bash` (`git push`, `vercel`, `cat .env*`). **No es un sandbox**: cualquier comando de `Bash` permitido puede leer un `.env` por otra vía (`node -e "require('fs').readFileSync(...)"`, por ejemplo). Es una barrera de intención, no una garantía. La garantía real de que un secreto no se commitea es que `.env*` está en `.gitignore` — eso es lo que hay que mantener correcto, no la lista de deny.
- Antes de cualquier `git add`/commit, revisa `git status` y el contenido de lo que vas a stagear. `git add:*` **no** está en el allowlist a propósito: cada staging pide confirmación, para que nunca se cuele un `git add -A` silencioso (regla dura de `build-feature`, ver más abajo).

## Compatibilidad Windows (el repo se usa en Windows — ver nota del README)

- El hook de lint (`.claude/hooks/lint-archivo-editado.js`) invoca `node_modules/eslint/bin/eslint.js` directamente con `process.execPath`, nunca `npx`/`eslint` por PATH — así evita el problema de que en Windows el binario real es `npx.cmd`/`eslint.cmd`.
- `.claude/skills/build-feature` es un **symlink** a `.agents/skills/build-feature`. Git en Windows sin `core.symlinks=true` (o sin Developer Mode/permisos de admin) lo materializa como un archivo de texto plano con la ruta destino, y la skill deja de cargar **en silencio**. Si en un checkout de Windows `/build-feature` no aparece disponible: corre `git config core.symlinks true` **antes** de clonar (o vuelve a clonar tras activarlo), o simplemente re-ejecuta `npx skills add maleonro/startup-product-skills --skill build-feature` localmente — regenera el symlink en segundos.

## Dónde leer según la tarea

No leas toda la documentación: son ~25 archivos. Elige.

| Tarea | Lee |
|---|---|
| Panorama y frontera del producto | `README.md` |
| Backend, flujo voz→nota→autofill, plan de refactor | `ARQUITECTURA_Y_PLAN.md` |
| Infra, despliegue, entorno | `architecture-infrastructure.md` |
| Explicación funcional de alto nivel | `como-funciona-el-sistema.md` |
| Contratos de API pública | `docs/API.md`, `docs/API_GUIDE.md`, `docs/API_ARCHITECTURE.md` |
| Flujo clínico (contrato, nota, asistente) | `docs/clinical-*.md` |
| Agente + workflows | `docs/AGENTE-WORKFLOWS-CONTEXTO.md` |
| Motores internos (superficies, ejecución, tiempos) | `web/public/studio-docs/*.md` (índice en `index.json`) |
| Esquema de datos | `supabase/migrations/*.sql` (7 migraciones, orden cronológico) |

## Construir una feature

Para cualquier cosa que no sea un fix trivial, usa la skill **`build-feature`** (`/build-feature`). Resumen del loop y cómo aterriza en este repo:

1. Rebase sobre `main` antes de tocar código.
2. Brainstorm → **grill** hasta que no queden ramas abiertas del árbol de decisión. No escribas el plan antes.
3. **Define la métrica de éxito y su baseline** antes de construir. En este repo la telemetría vive en `WindowsTelemetryService` / `UsageLedgerStore` / las tablas `windows_live_*` y `android_telemetry_*`; si la métrica no es consultable hoy, instrumentarla es un ítem del plan.
4. El plan se guarda como `.md` en `docs/`. Si toca base de datos, valida el SQL contra datos reales antes de construir.
5. Revisión senior del plan con contexto fresco; revisión de UI sobre mockup si hay superficie nueva (reusar los componentes y la identidad visual existentes, no inventar estilos).
6. Implementación con `Workflow` por fases y **agentes con propiedad disjunta de archivos**.
7. Levanta la app de verdad y úsala como usuario. Evidencia, no suposiciones.
8. `npm run lint && npm run typecheck && npm test` con salida pegada.
9. **Un PR, solo código.** Sin docs, sin tooling, sin feature flags salvo que se pidan. `git add` con rutas explícitas, nunca `-A`. No abras el PR ni hagas push sin que te lo pidan.
10. Cierra el ticket y **vuelve a medir la métrica** contra el baseline. El merge no es la meta; el número moviéndose sí.

Detalle en `.agents/skills/build-feature/` (`GRILLING.md`, `METRICS.md`, `WORKFLOWS.md`).

## Estado de los tests (sé honesto sobre esto)

`npm test` cubre **solo el camino clínico** con fakes en memoria de Supabase y del LLM, levantando las rutas reales de Express. Está bien hecho, pero:

- **Sin cobertura:** el motor de workflows (`WorkflowExecutor`, `WorkflowLearner`, `WorkflowBranchPlanner`, `Neo4jWorkflowRepository`), `conscious-brain`, y la mayoría de los ~45 use-cases.
- **Sin cobertura:** todo `web/public/` (~20k líneas de navegador).
- `bounded/miracle-ai/pyproject.toml` declara `testpaths = ["tests"]` y ese directorio no existe: pytest no corre nada.

Si tocas algo de esa lista, no hay red de seguridad: añade un test junto al cambio. Los tests nuevos siguen el patrón de `scripts/verify-*.js` (assert de `node:assert`, fakes en memoria, rutas reales) o `node:test`.

## Archivos grandes: cuidado al editar

Por encima de ~1000 líneas, un `Edit` es riesgoso (patrones repetidos) y leerlos completos quema contexto. Lee por rangos y usa anclas únicas:

`web/public/assistant-runtime.js` (2563) · `web/public/plugin/plugin-execution-client.js` (2224) · `web/public/trainer-plugin.js` (1877) · `web/public/provider-studio.js` (1744) · `web/public/emr-workspace.html` (1531) · `web/public/windows-live.js` (1406) · `web/server.js` (1079) · `web/public/recorder.js` (1073)

## Chequeo de tipos gradual

El repo es JS sin tipos. `npm run typecheck` corre `tsc --noEmit` sobre `src/` y `web/api/`, pero **`checkJs` está apagado**: un archivo entra al chequeo poniendo `// @ts-check` en su primera línea.

- Archivo nuevo en `src/` o `web/api/`: **empiézalo con `// @ts-check`** y con JSDoc en los contratos públicos. Es lo que le da valor al check.
- Para ver qué archivos aún no están dentro del chequeo (la lista cambia con el tiempo, no la copies a mano):
  ```bash
  grep -rL '@ts-check' src web/api --include='*.js'
  ```
  Casi todos los que faltan fallan por JSDoc `@param {object}`, que es opaco para `tsc`. Usa `/tipar <archivo>` para incorporarlos de a uno.
- `types/globals.d.ts` declara el idiom del repo de adjuntar `statusCode`/`code` a los `Error`. Si aparece otro patrón global, documéntalo ahí en vez de esparcir `@ts-ignore`.

**Detalle que sorprende:** `web/public/miracle/**` son módulos ES nativos (`import`/`export`); el resto de `web/public/` son scripts clásicos servidos tal cual. ESLint ya lo distingue por bloque de config — respeta esa frontera al mover código entre ambos.
