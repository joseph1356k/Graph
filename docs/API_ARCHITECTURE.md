# Arquitectura de la API publica (`/api/v1`)

`/api/v1` es la unica superficie publica para aplicaciones cliente. Las rutas
internas (`/api/workflow`, `/api/step`, `/api/workflows`, `/api/voice`, etc.)
siguen existiendo para dashboard/demo, pero los clientes externos deben consumir
el contrato versionado.

```txt
Cliente externo
  -> /api/v1 + X-API-Key
  -> web/api/registerPublicApiRoutes.js
  -> servicios existentes
```

## Componentes

| Pieza | Archivo | Rol |
| --- | --- | --- |
| Fachada publica | `web/api/registerPublicApiRoutes.js` | Define discovery, transcription, pipeline, autofill, learning y workflows. |
| Composition root | `web/server.js` | Aplica auth/rate limit e inyecta servicios. |
| Auth publica | `web/api/requireAuth.js` | `requireApiKey` valida `MIRACLE_API_KEYS`. |
| Nota/transcripcion | `bounded/miracle-ai/` + `callMiracleRuntime()` | Deepgram y Product-LLM. |
| Autofill | `src/application/use-cases/NoteFieldMatcher.js` | Mapea nota a campos detectados. |
| Learning | `src/application/use-cases/LearningSessionService.js` | Inicia sesiones y registra pasos. |
| Workflows | `WorkflowCatalog` + `WorkflowExecutor` | Lista workflows y genera planes client-side. |

## Endpoints publicos

```txt
GET  /api/v1
POST /api/v1/transcription/session
POST /api/v1/pipeline
POST /api/v1/autofill/match

POST /api/v1/learning/sessions
POST /api/v1/learning/sessions/:id/steps
POST /api/v1/learning/sessions/:id/context-notes
POST /api/v1/learning/sessions/:id/finish

GET  /api/v1/workflows
GET  /api/v1/workflows/:id
POST /api/v1/workflows/:id/plan
```

## Auth y ownership

`/api/v1` usa solo API key permanente. No hay fallback al login del dashboard.
Cuando una key valida entra, `requireApiKey` crea:

```js
req.user.id = `api-client:${label}`;
req.workflowAccess = {
  ownerId: req.user.id,
  includeGlobal: true,
  canManageGlobalWorkflows: false
};
```

Esto hace que cada cliente API key vea sus workflows privados y los globales,
sin poder mutar workflows globales.

## Flujo de autofill

```txt
nota organizada + fields detectados por cliente
  -> POST /api/v1/autofill/match
  -> NoteFieldMatcher
  -> matches por stepOrder
  -> cliente llena su UI localmente
```

Tambien puede correr dentro de `POST /api/v1/pipeline` activando
`stages.autofill`.

## Flujo de entrenamiento

```txt
POST /learning/sessions
  -> LearningSessionService.startSession()

POST /learning/sessions/:id/steps
  -> WorkflowLearner.recordStep()
  -> Neo4jWorkflowRepository.addStep()

POST /learning/sessions/:id/finish
  -> WorkflowLearner.finishSession()
  -> workflow persistido en Neo4j
```

El cliente no necesita conocer Neo4j. Solo envia contexto de superficie, pasos y
campos detectados.

## Flujo de ejecucion

```txt
GET /workflows
POST /workflows/:id/plan
  -> WorkflowExecutor.getExecutionPlanById()
  -> plan client-side
  -> cliente ejecuta selectors/actions en su entorno
```

La ejecucion server-side se mantiene fuera de la API publica. El backend entrega
planes y decisiones; la app cliente controla su DOM, WebView o UI nativa.

## Rate limits

Los endpoints que pueden gastar LLM tienen `costlyLimiter`:

- `/api/v1/pipeline`
- `/api/v1/autofill/match`

## Compatibilidad

- Cambios incompatibles deben ir a `/api/v2`.
- Agregar campos opcionales a request/response es compatible.
- El contrato publico acepta snake_case y camelCase en puntos criticos para
  facilitar clientes web/nativos.
