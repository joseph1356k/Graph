# Telemetría de consumo de IA — tokens, costos y atribución

Cómo se mide lo que Miracle gasta en modelos, de dónde sale cada cifra del
dashboard, y qué hay que tocar para agregar un proveedor, un modelo, una app o
un módulo nuevo.

---

## 1. Arquitectura encontrada (antes de este trabajo)

| Pieza | Dónde estaba | Qué hacía |
|---|---|---|
| Dashboard | `web/public/usage-dashboard.html` | Pintaba totales, gráfica por hora y tabla |
| Servicio | `UsageDashboardService` | Leía TODO el ledger en memoria y agregaba en Node |
| Almacén | `UsageLedgerStore` | Un JSONL en `generated/usage/ai-usage-events.jsonl` |
| Ingesta | `POST /api/usage/events` | **Sin autenticación** |
| Instrumentación | 8 llamadas a mano en 3 archivos de rutas | Solo el camino feliz |

Proveedores en uso, encontrados recorriendo el código:

- **OpenAI** — vía `LLMProvider` (Chat Completions) y `conscious-brain/openaiBrain.js` (Responses API, computer-use).
- **Google Gemini** — vía capa compatible con OpenAI, vía `geminiBrain.js` nativo y vía `teach/GeminiVideoClient.js`.
- **Anthropic** — una sola llamada, en el portal: `app/api/parse-schedule/route.ts`.
- **Deepgram** — `ClinicalRawTranscriptionService` (audio, se cobra por minuto).
- **Azure Foundry / OpenRouter** — configurables en `LLMProvider`.

---

## 2. Problemas detectados

1. **El almacén era efímero, y por eso el dashboard marcaba cero.** En Vercel,
   `resolveGeneratedRoot()` apunta a `/tmp`, que es privado por invocación de
   lambda y se borra. El evento se escribía y la siguiente petición leía un
   archivo vacío. Es la causa raíz de la captura del enunciado.

2. **La instrumentación era manual y parcial.** Se anotaba en 8 rutas; los ~15
   servicios que llaman a un modelo por debajo (AgentChat, SurfaceProfile,
   ClinicalNoteGenerator, sugerencias diagnósticas, ExecutionIntelligence,
   WorkflowLearner, los dos cerebros conscientes, Deepgram, vídeo) no anotaban
   nada.

3. **Solo se registraba el éxito.** Todas las llamadas tenían `status: 'ok'`
   cableado. Una llamada que gasta el prompt y luego falla —o que se reintenta—
   no dejaba rastro, así que la medición estaba estructuralmente por debajo de
   la factura.

4. **No había atribución.** El evento no tenía `user_id` ni `organization_id`.
   El único eje era `sourceRepo: 'graph'`, cableado a mano en todas partes.

5. **Aplicación y funcionalidad estaban colapsadas** en el campo `feature`.

6. **Ingesta pública sin autenticación:** cualquiera podía inyectar consumo
   falso en el ledger con un `POST`.

7. **Los costos se calculaban con precios embebidos** en el servicio, sin
   versión ni vigencia, y **un modelo sin tarifa costaba 0** — indistinguible de
   una llamada gratis.

8. **La agregación era en memoria**, incompatible con crecer.

---

## 3. Decisión técnica

> **Un choke point por superficie + contexto implícito + agregación en la base.**

**a) Se mide donde se llama al proveedor, no donde se sirve la ruta.**
`LLMProvider.postChatCompletions()` es el paso obligado de casi todo el texto:
instrumentarlo cubre de golpe los ~15 servicios y, sobre todo, cubre los
errores. Los cuatro clientes que no pasan por ahí (los dos cerebros, Deepgram,
vídeo) se instrumentan en su propia función de transporte.

**b) La identidad viaja por `AsyncLocalStorage`, no por parámetro.**
La llamada al modelo está a tres o cuatro saltos de la ruta que conoce al
usuario. Pasar `{userId, orgId, app, feature}` a mano exigía tocar la firma de
~15 servicios y de todos sus llamadores; y bastaba con que **uno** se olvidara
para que ese consumo quedara sin atribuir en silencio — el modo de fallo más
caro, porque no se nota. Con ALS, el middleware abre el contexto una vez por
petición y todo lo que ocurra dentro lo hereda.

**c) El ledger vive en Postgres y las sumas las hace Postgres.**
Es el único almacenamiento compartido entre lambdas. Las RPC son
`security definer` y comparten con la política RLS **una sola función de
alcance**, para que no haya dos jueces que puedan discrepar.

**d) El costo se congela en el evento.** Se calcula al escribir, con la tarifa
vigente, y se guarda junto a un `pricing_snapshot`. Así el total del dashboard
es la suma de lo almacenado —coinciden por construcción— y un cambio de precios
no reescribe la historia.

*Alternativas descartadas:* un middleware de proxy HTTP (no ve el modelo ni el
módulo); pasar el contexto por parámetro (huecos silenciosos, ~40 archivos);
agregar en Node (no escala y obliga a bajarse el ledger entero).

---

## 4. Cambios de base de datos

Migración: **`supabase/migrations/20260804000000_ai_usage_telemetry.sql`**

- **`public.ai_usage_events`** — el ledger. `idempotency_key` única; tiempo;
  atribución (`organization_id`, `user_id`, `actor_type`, `attribution_source`);
  `app` y `feature` **separados**; proveedor, familia de API, modelo solicitado y
  servido; tokens de entrada/salida/caché/razonamiento, segundos de audio;
  `cost_usd` **nullable** + `cost_status`; estado, latencia, `attempt`,
  `fallback_from_model`, entorno y `metadata` saneada.
- **`public.ai_model_prices`** — tarifas con vigencia (`effective_from/to`) y
  versión. Espejo auditable del catálogo de código.
- **RLS**: activada. **Sin políticas de escritura** ⇒ solo service-role escribe.
  Lectura por alcance (§7).
- **RPC**: `ai_usage_summary`, `ai_usage_series`, `ai_usage_breakdown`,
  `ai_usage_events_page`, `ai_usage_missing_rates`.
- **Índices**: por tiempo, y por (organización|usuario|app|feature|modelo) +
  tiempo. Parcial para las tarifas faltantes.

### Ejecutar la migración

```bash
# Opción A — CLI de Supabase (recomendada)
supabase link --project-ref zyvfamlhlmztliexvmej
supabase db push

# Opción B — psql directo
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260804000000_ai_usage_telemetry.sql
```

Es **puramente aditiva**: crea dos tablas, cinco funciones y sus políticas. No
altera ni borra nada existente. Para revertir: `drop table public.ai_usage_events,
public.ai_model_prices cascade;` más el `drop function` de las cinco RPC.

> ✅ **Aplicada a producción** (`miracle-app`, ref `zyvfamlhlmztliexvmej`) el
> 2026-08-04, en cuatro pasos: tablas → alcance+RLS+RPC de resumen/serie → RPC
> de desglose/detalle/tarifas + semilla → endurecimiento de permisos.

**Endurecimiento aplicado tras revisar el linter de seguridad.** Supabase
concede permisos amplios por defecto en `public`, y dos de esos defaults
quedaban abiertos sobre piezas nuevas:

- `authenticated` tenía INSERT/UPDATE/DELETE sobre el ledger y `anon` tenía
  SELECT. RLS ya bloqueaba las filas, pero se revocaron los GRANT igualmente.
- `anon` podía **invocar** las cinco RPC vía `/rest/v1/rpc/...`: `revoke all
  ... from public` no revoca de `anon`, que recibe EXECUTE por separado. No
  devolvían datos (el alcance responde `'none'` a los anónimos), pero eso
  dejaba la seguridad colgando de una sola comprobación dentro de la función.
  Se revocó el EXECUTE.

Estado final verificado: `anon` no lee, no escribe y no puede invocar nada;
`authenticated` solo tiene SELECT y sus RPC, acotadas por su alcance.

---

## 5. Cambios de backend (Graph)

| Archivo | Qué es |
|---|---|
| `src/domain/usage/vocabulary.js` | Apps, módulos, actores, estados. Ejes abiertos vs. cerrados |
| `src/domain/usage/pricing.js` | **Catálogo único de tarifas** + cálculo de costo |
| `src/domain/usage/providerUsage.js` | Normaliza el `usage` de cada proveedor + acumulador de streaming |
| `src/domain/usage/UsageEvent.js` | Normalización, **allowlist de metadata**, clave de idempotencia |
| `src/infrastructure/usage/UsageContext.js` | `AsyncLocalStorage`: `runWithContext`, `withFeature`, `runAsSystem` |
| `src/infrastructure/usage/SupabaseUsageEventStore.js` | Persistencia + respaldo JSONL + RPC |
| `src/application/use-cases/AiUsageRecorder.js` | Grabador central; `measure()` cronometra y registra éxito **y** error |
| `src/application/use-cases/UsageAttributionResolver.js` | Resuelve identidad **en servidor** |
| `src/application/use-cases/UsageDashboardService.js` | Reescrito: filtros + RPC agregadas |
| `web/api/attachUsageContext.js` | Middleware que abre el contexto por petición |
| `web/api/registerUsageRoutes.js` | Reescrito: consultas con alcance, CSV, ingesta interna |
| `web/api/recordUsageBestEffort.js` | Reescrito: **solo** consumo reportado aguas arriba |

**Instrumentado**: `LLMProvider.postChatCompletions` (éxito y error, con
`attempt`), `openaiBrain.oaHttp`, `geminiBrain.gemHttp` (un evento por intento),
`ClinicalRawTranscriptionService` (audio, incluidos los fallos).

**Módulo por servicio**: cada servicio envuelve su llamada con
`withFeature(FEATURES.X, ...)`. Se hizo en el servicio y no en la ruta para que
una ruta nueva no pueda olvidarse de etiquetarlo.

**Doble conteo evitado**: las 8 anotaciones manuales que ahora quedarían
duplicadas por la instrumentación central fueron eliminadas. Solo sobrevive el
reporte del runtime de Miracle (Python), que llama al modelo por su cuenta.

---

## 6. Cambios en las apps cliente

**Web App (`Pagina-web-clientes-final`)**
- `lib/ai-usage.ts` (nuevo): reporta al ledger. Usuario **de la sesión
  verificada**; organización derivada del perfil; nunca envía contenido.
- `app/api/parse-schedule/route.ts`: instrumentada la llamada a Anthropic
  (éxito y error). Es la única llamada del portal que no pasa por Graph.
- `app/api/clinical/note-from-photo/route.ts` y `app/api/stt/session/route.ts`:
  cabeceras `X-Miracle-App`, `X-Miracle-Feature` y la identidad del usuario.

**Windows App (`U-Windows-App`)**
- `GraphConfig.OperatorEmail` (nuevo) + cabeceras en `GraphClient` y
  `BackendClient`: `X-Miracle-App: windows_app`, `X-Miracle-Feature`,
  `X-Miracle-User-Email` / `X-Miracle-Device-Id`.

**Android App** — escribe directo a Supabase con la anon key y no llama a
modelos por sí misma; su consumo pasa por `/api/v1` de Graph y se atribuye con
las mismas cabeceras. No requirió cambios de código.

> Las cabeceras **no autorizan nada**: quien autoriza es la API key o el JWT.
> Graph resuelve el correo/uuid contra `profiles` con service-role antes de
> imputar. Si no existe, el gasto queda `unattributed` en vez de asignarse a
> quien lo pida.

---

## 7. Permisos y aislamiento

Una única función, `private.ai_usage_scope()`, que comparten la política RLS y
las cinco RPC:

| Rol | Alcance |
|---|---|
| `superadmin` | Todas las organizaciones |
| `admin` (institucional) | Su organización |
| `medico`, `secretaria` | Solo sus propios eventos |
| service-role (Graph) | Todo — es el operador interno del panel |
| `anon` | Nada |

Cuando la petición trae el JWT de un usuario, la RPC se ejecuta **con ese
token**: el aislamiento lo aplica Postgres y el backend no puede ampliarlo
aunque quisiera. Filtrar por otra organización dentro de un alcance restringido
**no amplía** el alcance: devuelve vacío (probado en
`tests/sql/03-ai-usage-rls.sql`).

---

## 8. Privacidad

El ledger guarda cifras y etiquetas técnicas. `metadata` pasa por una
**allowlist** (`METADATA_ALLOWLIST` en `UsageEvent.js`), no por una denylist:
una denylist falla abierta, y basta una clave nueva para filtrar contenido
clínico. Objetos y arrays anidados se descartan aunque la clave esté permitida.

No se almacena: prompts, respuestas, transcripciones, notas, audio, nombres de
paciente, documentos, credenciales ni llaves. Verificado en el test
«el evento persistido no lleva ningún campo de contenido».

---

## 9. Pruebas

```bash
npm run test:ai-usage        # 62 comprobaciones, sin base de datos
npm test                     # suite completa del repo
GRAPH_TEST_DATABASE_URL=... npm run test:ai-usage-rls   # aislamiento en SQL
```

**Resultado:** `verify-ai-usage-telemetry.js` 41 OK ·
`verify-ai-usage-pricing.js` 21 OK · suite previa del repo sin regresiones.

Cubre: fórmulas de costo (incluidas las cifras pequeñas que no deben
redondearse a cero), tarifa ausente vs. consumo no reportado, los cuatro
formatos de `usage`, streaming, ausencia de datos clínicos, atribución por las
cuatro vías, rechazo de identidades no verificadas, idempotencia, reintentos
como consumo real, fallback entre modelos, registro de errores, filtros
combinados, alcance por credencial, y el escenario A/B/interno del enunciado.

El aislamiento entre organizaciones se prueba en **SQL** porque lo aplica
Postgres: probarlo desde Node solo demostraría que el backend hace lo que dice,
no que la base impida lo demás.

### Verificar el tracking en vivo

```bash
# 1. Salud de la telemetría (sesión de administrador)
curl -s https://graph-eight-pied.vercel.app/api/usage/health -b "$COOKIE" | jq

# 2. Provocar consumo real y ver el evento
curl -s -X POST .../api/v1/assistant/chat -H "X-API-Key: $KEY" \
  -H 'X-Miracle-App: windows_app' -H 'X-Miracle-User-Email: ana@hospital.co' \
  -d '{"message":"hola"}'
curl -s ".../api/usage/events?range=1h&limit=5" -b "$COOKIE" | jq '.events[0]'

# 3. Contrastar contra la base
#    select count(*), sum(total_tokens), sum(cost_usd) from ai_usage_events ...
```

---

## 10. Cómo agregar cosas

**Un modelo o proveedor** → añade la tarifa en `src/domain/usage/pricing.js`
**y** la fila equivalente en el `insert` de la migración.
`npm run test:ai-usage` falla si se separan. Mientras no exista la tarifa, el
consumo se registra igual y aparece en el aviso «tarifa no configurada» del
dashboard — nunca como coste cero.

**Una aplicación o un módulo** → añade el valor en
`src/domain/usage/vocabulary.js`. No hace falta migración: son ejes abiertos
(TEXT sin CHECK) justamente para que medir algo nuevo no requiera tocar la base.
En el cliente, mándalo en `X-Miracle-App` / `X-Miracle-Feature`; en el servidor,
envuelve la llamada con `withFeature(FEATURES.X, () => ...)`.

**Un cliente de proveedor nuevo que no pase por `LLMProvider`** → llama a
`LLMProvider.getUsageRecorder()?.measure(...)` en su función de transporte, como
hacen `openaiBrain` y `geminiBrain`.

---

## 11. Limitaciones (lo que todavía no se puede medir)

1. **No hay histórico.** El JSONL vivía en `/tmp` y se perdía en cada
   invocación; no existe evidencia verificable del consumo anterior. **La
   medición confiable empieza cuando se despliegue esto.** No se rellenan
   periodos anteriores con estimaciones: serían inventadas.

2. **Quedan avisos del linter que NO son de este trabajo**: varias funciones
   `superadmin_*`, `graph_upsert_*` y `agent_values_for_code` son
   `security definer` invocables por `anon`/`authenticated`. Son anteriores y
   quedan fuera de alcance; se dejan señaladas, no tocadas.

3. **`GeminiVideoClient` (enseñanza por vídeo) no está instrumentado.** La API
   de Files + `generateContent` de vídeo no reporta tokens de forma comparable
   con el resto; medirlo bien exige decidir antes la unidad. Queda declarado
   como hueco en vez de fabricar una cifra.

4. **Streaming**: el acumulador está construido y probado, pero hoy ninguna ruta
   de Graph consume respuestas en streaming del proveedor — cuando se añada,
   la pieza ya está.

5. **El costo es una estimación**, no la factura. No modela descuentos por
   volumen, créditos, ni precios negociados.

6. **Android** no tiene medición propia de consumo local; solo se ve lo que pasa
   por Graph.

7. **La caché de perfiles dura 5 minutos**: un cambio de organización de un
   usuario tarda hasta ese tiempo en reflejarse en la atribución.

---

## 12. Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Graph | Escribir el ledger y servir el panel interno |
| `GRAPH_USAGE_INGEST_KEY` | Graph + portal | Ingesta interna autenticada |
| `GRAPH_BASE_URL` | portal | A dónde reporta el portal |
| `MIRACLE_USAGE_ENVIRONMENT` | opcional | Fuerza el entorno; si no, se deduce de `VERCEL_ENV`/`NODE_ENV` |
