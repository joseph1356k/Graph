# Guía de migración (Vercel → AWS/Azure) y notas de configuración crítica

> Objetivo: dejar por escrito los detalles de infraestructura que **no son
> obvios en el código** y que causaron incidencias reales en producción, para
> que la migración a AWS/Azure (u otro host) no los repita.

---

## 1. Arquitectura de dos runtimes (Node trunk + Python sidecar)

El backend es un monorepo híbrido desplegado como **dos funciones hermanas**:

- **Node/Express** (`api/index.js` → `web/server.js`): tronco de la API (auth,
  rate-limit, CORS, workflows, matching LLM, administración de providers).
- **Python/Starlette** (`api/miracle_runtime.py` → `bounded/miracle-ai`):
  runtime de voz/nota (STT: Deepgram/Soniox, y organización de la nota con el
  Product LLM).

El Node **no resuelve** las rutas de voz en proceso: las **proxya** al runtime
Python. La URL destino se resuelve en `web/server.js` →
`resolveMiracleRuntimeUrl(req)`:

```
MIRACLE_RUNTIME_URL            (si está definida)  → se usa tal cual
else, en Vercel:               `${PUBLIC_BASE_URL || req.host}/api/miracle-runtime`
```

Rutas afectadas (todas se proxyan al runtime Python):
`/api/voice/stream-session`, `/api/voice/orchestrator/*`, `/api/tree`,
`/api/file(s)`, `/api/session`, `/api/context`, `/api/history-change`.

---

## 2. ⚠️ Incidente resuelto: STT servía el provider equivocado (Deepgram en vez de Soniox)

**Síntoma:** tras seleccionar Soniox en Provider Studio y redeployar, el botón
"Grabar" en `/miracle` seguía conectándose a `wss://api.deepgram.com`. El log de
`POST /api/voice/stream-session` devolvía `"provider":"deepgram"` incluso en
navegador de incógnito (descartando caché).

**Causa raíz:** `PUBLIC_BASE_URL` apuntaba a un **alias viejo** de Vercel
(`graph-five-orpin.vercel.app`) que estaba fijado a una **deployment anterior**
al cambio de Soniox. El proxy del Node (paso 1) enviaba el tráfico de voz a esa
deployment vieja, cuyo runtime Python tenía `MIRACLE_STT_PROVIDER=deepgram`
horneado. Es decir: se guardaba `MIRACLE_STT_PROVIDER=soniox` en la deployment
nueva, pero el tráfico se desviaba a la vieja.

Dos hechos que lo hacían difícil de ver:

1. **En Vercel las env vars se hornean por deployment**: cambiar una variable no
   afecta a deployments existentes; hay que redeployar.
2. El desvío era **silencioso**: `graph-eight-pied.vercel.app` (dominio nuevo)
   servía el código nuevo, pero delegaba la voz a `graph-five-orpin` (viejo) vía
   `PUBLIC_BASE_URL`.

**Fix aplicado:** `PUBLIC_BASE_URL = https://graph-eight-pied.vercel.app` (el
dominio de producción que auto-promueve a la deployment más nueva) + limpieza de
env huérfanas `MIRACLE_STT_*` con target `development` + redeploy. Verificado con
`GET /api/public-config` → `miracleBaseUrl` ya apunta al dominio correcto.

---

## 3. Qué hacer al migrar a AWS/Azure

- **Definir `MIRACLE_RUNTIME_URL` de forma explícita** apuntando a la URL
  **interna real** del servicio Python (p. ej. el DNS interno del contenedor/App
  Service). **No dependas de `PUBLIC_BASE_URL` ni de la auto-referencia por
  `req.host`** fuera de Vercel: en AWS/Azure el proxy debe ir directo al sidecar,
  no dar la vuelta por el dominio público. Esto elimina de raíz la clase de bug
  del punto 2.
- **Propagar las env vars a AMBOS runtimes** (Node y Python). Las que consume el
  Python (`MIRACLE_STT_PROVIDER`, `SONIOX_API_KEY`, `DEEPGRAM_API_KEY`,
  `MIRACLE_PRODUCT_LLM_*`, etc.) deben existir en el contenedor Python, no solo
  en el Node. En Vercel ambos comparten el env del proyecto; en AWS/Azure hay que
  inyectarlas en las dos cargas de trabajo.
- **Recordar que el estado de config vive en env vars**: Provider Studio escribe
  la configuración vía la API de Vercel (`VercelProjectEnvService`) y dispara un
  redeploy. Al migrar, ese servicio debe reemplazarse por el mecanismo del nuevo
  host (p. ej. AWS SSM Parameter Store / Secrets Manager + nueva deployment, o
  Azure App Configuration / Key Vault + restart). Mientras eso no exista, la
  config se cambia por variables de entorno del host y un reinicio.
- **Render está obsoleto.** Cualquier referencia histórica a
  `graph-1-hap6.onrender.com` (p. ej. `VOICE_GATEWAY_URL`, CORS por defecto) es
  legado y **no debe** usarse como destino en la nueva infra.
- **WebSocket del gateway de voz por teléfono**: las funciones serverless no
  sirven como servidor WebSocket persistente. En AWS/Azure conviene un servicio
  persistente (ECS/Fargate, App Service, o similar) para `VoiceRealtimeGateway`.

---

## 4. Providers LLM (incluye Google Gemini)

Los providers de LLM se configuran por env vars y se administran desde Provider
Studio. Catálogo por superficie:

**Field Matching (Graph)** — `src/application/use-cases/GraphProviderConfigService.js`,
consumido por `src/infrastructure/LLMProvider.js`:

| Provider | Env `GRAPH_LLM_PROVIDER` | Notas |
|---|---|---|
| Azure Foundry | `azure-foundry` | Recomendado; header `api-key`. |
| OpenRouter | `openrouter` | Bearer. |
| OpenAI | `openai` | Chat Completions, Bearer. |
| **Google Gemini** | `google` | Capa compatible-OpenAI de Google. Base URL `https://generativelanguage.googleapis.com/v1beta/openai`, Bearer con la API key de Google. **Soporta `response_format` json_schema**, así que el matching estructurado mantiene la misma fiabilidad. |

Variables: `GRAPH_LLM_PROVIDER`, `GRAPH_LLM_MODEL`, `GRAPH_LLM_BASE_URL`,
`GRAPH_LLM_API_KEY`.

**Organizador / Product LLM** —
`src/application/use-cases/MiracleProductLlmProviderConfigService.js`, consumido
por `bounded/miracle-ai/src/miracle_agent/integrations/product_llm/*`:

| Provider | Env `MIRACLE_PRODUCT_LLM_PROVIDER` | API usada |
|---|---|---|
| OpenAI | `openai` | **Responses API** (`/v1/responses`) con `text.format` json_schema. |
| **Google Gemini** | `google` | **Chat Completions** (`/chat/completions`) con `response_format` json_schema. Google **no** implementa la Responses API, por eso el cliente Python enruta a Chat Completions cuando el provider es `google` (`client.py::call_chat_completions`, planner `_GeminiChatPlanner`). |

Variables: `MIRACLE_PRODUCT_LLM_PROVIDER`, `MIRACLE_PRODUCT_LLM_MODEL`,
`MIRACLE_PRODUCT_LLM_BASE_URL`, `MIRACLE_PRODUCT_LLM_API_KEY`.

> Nota sobre el modelo: el ID por defecto usado es `gemini-3.5-flash`. Verificar
> el string exacto contra Google AI Studio / el catálogo vigente de Google; si el
> ID no existe, la API responde 404. El campo de modelo es editable y ofrece
> `gemini-2.5-flash` / `gemini-2.5-pro` como alternativas.

### Salidas estructuradas con Gemini

Gemini soporta salidas estructuradas por dos vías:

1. **Capa compatible-OpenAI**: `response_format: {type:"json_schema", json_schema:{...}}`
   (lo que usa este código) o `{type:"json_object"}`.
2. **API nativa**: `generationConfig.responseSchema` + `responseMimeType:"application/json"`.

El esquema del matching (`NoteFieldMatchingPolicy.js`) es simple (object/array/
string/number/boolean con `required` y `additionalProperties:false`) y es
totalmente compatible. El esquema del Product LLM usa `anyOf`; si algún modelo de
Gemini lo rechazara, aplanar ese `anyOf` sin perder la estructura.
