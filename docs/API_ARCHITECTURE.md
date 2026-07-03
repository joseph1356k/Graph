# Arquitectura de las APIs (`/api/v1`) en el repositorio

Este documento explica **cómo está construida** la capa de exposición de APIs
dentro del repo: dónde vive cada pieza, cómo fluye una petición y cómo
extenderla. Para el uso desde un cliente, ver [API_GUIDE.md](./API_GUIDE.md).

---

## 1. Principio

El backend es el **cerebro lógico**; las apps cliente son consumidoras. Una
capacidad se implementa **una vez** en el backend y se expone por una **única
central de APIs versionada** (`/api/v1`). Los clientes nunca hablan con los
servicios internos directamente: pasan siempre por el contrato `/api/v1`.

```
Cliente (extensión / Windows / web)
        │  HTTPS  Authorization: Bearer <token>
        ▼
/api/v1  ── registerPublicApiRoutes.js  (la central de exposición)
        │
        ├── transcription  → runtime Python (Deepgram token)
        ├── note           → runtime Python (voice_orchestration + Product-LLM)
        └── autofill       → NoteFieldMatcher (LLM)  [opcional]
```

---

## 2. Dónde vive cada pieza

| Pieza | Archivo | Rol |
|---|---|---|
| Central de exposición | `web/api/registerPublicApiRoutes.js` | Define `/api/v1`, `/api/v1/pipeline`, `/api/v1/transcription/session`. |
| Composition root | `web/server.js` | Importa y registra la central; aplica auth + rate limit. |
| Auth | `web/api/requireAuth.js` | `requireAccountAuth` valida el token (local-admin o Supabase). |
| Motor de nota (backend real) | `bounded/miracle-ai/` (Python) | `voice_orchestration` + `integrations/product_llm` organizan la nota. |
| Autofill | `src/application/use-cases/NoteFieldMatcher.js` | Mapea la nota a los campos del cliente vía LLM. |
| Proxy al runtime Python | `web/server.js` → `callMiracleRuntime()` | Reenvía al runtime Python con el token interno. |

---

## 3. El endpoint unificado: `/api/v1/pipeline`

Un solo handler orquesta las etapas. La clave del diseño: **las flags
`stages` deciden qué se ejecuta**, así el backend solo procesa (y solo cobra en
LLM) lo que el cliente realmente pide.

```
POST /api/v1/pipeline
        │
        ├─ stages.transcription → devuelve el transcript recibido (eco)
        │
        ├─ stages.note → callMiracleRuntime(req, '/api/voice/orchestrator/events')
        │                 → runtime Python → Product-LLM → resolved_note_content
        │
        └─ stages.autofill → noteFieldMatcher.match({ noteContent, fields })
                             (solo si el cliente envía `fields`)
```

La respuesta contiene **solo** las claves de las etapas activadas. Cada etapa
falla de forma aislada (`status: skipped | unavailable | error`) sin tumbar el
resto.

### Estado (sesiones)

El endpoint es **stateless desde el backend**: el cliente envía la `note.content`
actual y (opcionalmente) reutiliza `session_id` + `sequence`. El runtime Python
acumula la nota sobre lo que se le envía; no hay estado propio en `/api/v1`.

---

## 4. Cableado en `server.js`

Tres puntos, todos en `web/server.js`:

```js
// 1) import
const registerPublicApiRoutes = require('./api/registerPublicApiRoutes');

// 2) rate limit en la etapa costosa (gasta LLM)
app.use('/api/v1/pipeline', costlyLimiter);

// 3) auth: /api/v1 exige cuenta real
[ ..., '/api/providers', '/api/v1' ].forEach((routePrefix) => {
  app.use(routePrefix, requireAccountAuth, attachWorkflowAccess);
});

// 4) registro (callMiracleRuntime y noteFieldMatcher ya existen en el server)
registerPublicApiRoutes(app, { callMiracleRuntime, noteFieldMatcher });
```

`registerPublicApiRoutes` recibe por **inyección de dependencias** lo que
necesita (`callMiracleRuntime`, `noteFieldMatcher`), sin acoplarse a cómo se
construyen.

---

## 5. Autenticación

`/api/v1` usa `requireApiKey` (en `requireAuth.js`): **solo API key**, sin
fallback de token de sesión.

- **API key permanente** — cadena secreta en la env var `MIRACLE_API_KEYS`
  (`label:key,label2:key2`), enviada por el cliente como `X-API-Key` o
  `Authorization: Bearer`. No expira. `verifyApiKey()` compara en tiempo
  constante; si no matchea (o falta), responde `401`.

El login del dashboard (`/api/auth/local-admin/login`, token de sesión) sigue
existiendo **solo para las páginas del dashboard** (zonas de prueba), separado
de la API pública. El sistema aún no tiene usuarios reales.

### Secretos por env (no en el código)

Para no exponer credenciales en el repo (público), estos valores se leen de
variables de entorno (con fallback temporal para no romper producción):

| Env var | Para qué |
|---|---|
| `MIRACLE_API_KEYS` | API keys permanentes de los clientes. |
| `LOCAL_ADMIN_PASSWORD` | Clave del login de dashboard. |
| `LOCAL_ADMIN_USERS` | Usuarios admin permitidos (coma-separados). |
| `LOCAL_ADMIN_SECRET` | Secreto HMAC que firma los tokens de sesión admin. |

> Una vez configuradas en Vercel, las credenciales viejas del código dejan de
> autenticar. Conviene eliminar los fallbacks hardcodeados en un commit posterior.

---

## 6. Por qué la transcripción cruda va aparte

La transcripción en vivo es un **flujo bidireccional en tiempo real** (audio →
parciales/finales), que no cabe en un request/response único. Por eso hoy:

- `/api/v1/transcription/session` entrega credenciales de streaming (Deepgram).
- El cliente abre el WebSocket a Deepgram y, por cada final, llama a
  `/api/v1/pipeline` para la nota.

La implementación de referencia del cliente es el **motor único**
`web/public/shared/deepgram-dictation.js` (usado por la SPA y el asistente
flotante).

---

## 7. Cómo extender

- **Autofill completo:** ya está la etapa; al refactorizar la capa de detección
  de campos del cliente, el cliente enviará `fields` y la etapa se activa sin
  cambiar el contrato.
- **Pipeline en streaming (SSE/WS):** añadir un endpoint que ingiera audio en el
  backend y reemita `transcription.partial → note.updated → autofill.matches` en
  un solo canal. Reutilizaría `callMiracleRuntime` + `noteFieldMatcher`.
- **API keys por cliente:** un middleware de auth alterno para `/api/v1` que
  valide claves emitidas por cliente, sin depender del token de sesión del
  dashboard.
- **Nueva capacidad:** se agrega como etapa/endpoint dentro de
  `registerPublicApiRoutes.js`, inyectando su caso de uso desde `server.js`.

---

## 8. Contrato y compatibilidad

- Todo va bajo `/api/v1`. Cambios incompatibles → `/api/v2` (no romper clientes).
- Agregar una etapa nueva a `stages` es retrocompatible (default desactivada).
- Referencia de uso: [API_GUIDE.md](./API_GUIDE.md).
