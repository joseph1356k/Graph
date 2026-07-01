# Graph → Backend central + Dashboard: contexto y plan de arquitectura

> Documento de referencia del refactor. Captura el análisis del repositorio,
> las decisiones tomadas, la estructura destino y el estado de ejecución.
> Escrito durante la sesión de limpieza y reorganización del backend.

---

## 1. El hallazgo principal: dos productos en un mismo repo

El repositorio es la acumulación de dos etapas de desarrollo que hoy conviven mezcladas:

| | **"Graph" (motor de aprendizaje)** | **"Miracle" (flujo clínico)** |
|---|---|---|
| Qué hace | Aprende el mapa de campos de cada EMR: graba interacciones (clicks/inputs/selects) como `Workflow` + `Step`, y luego puede reproducirlas / usarlas para autofill | Voz → transcripción en tiempo real → nota médica organizada → autofill |
| Persistencia | Neo4j (`Workflow`, `Step`, `WorkflowBranch`, `SurfaceProfile`) | Sesiones en archivo / Supabase (`encounters`) |
| Ejecución | Playwright (server) / execution-client (browser) | Deepgram streaming + Product-LLM orchestrator (Python) |

**IMPORTANTE — corrección clave del análisis:** el motor de aprendizaje de
workflows **NO es código legado**. Es la innovación central: gracias al
aprendizaje de workflows, el sistema sabe *dónde* colocar los datos de la nota
en cada sistema médico. **Sin el aprendizaje de workflows, el autofill no
funciona.** Las cuatro capacidades son **un solo producto encadenado**:

```
aprender campos del EMR (workflow learning)  ──┐
transcribir voz (Deepgram)                     ├─→ autofill correcto (+ replay)
organizar la nota (Product-LLM)                ──┘
```

Lo que sí estaba desordenado no era "código muerto", sino **organización**:
dos productos históricos mezclados, el flujo de voz duplicado, un mega-archivo
de 4285 líneas (`trainer-plugin.js`) y una frontera difusa entre "backend" y
"cliente".

---

## 2. Cómo funciona HOY el flujo central (voz → nota → autofill)

Arquitectura **híbrida Node + Python**: Express en el borde (auth, proxy,
rate-limit, autofill) y un runtime Python (`bounded/miracle-ai/`, desplegado
como `api/miracle_runtime.py`) para voz y organización de la nota.

```
1. ACTIVAR TRANSCRIPCIÓN
   Cliente → POST /api/voice/stream-session
   Node (proxy) → Python (features/voice) → Deepgram: token + websocket_url
   ← { provider, access_token, websocket_url, model, language }

2. TRANSCRIPCIÓN EN CRUDO (streaming real, client-direct)
   El navegador abre WebSocket DIRECTO a wss://api.deepgram.com
   - parciales → se muestran solo local (no pasan por backend)
   - finales   → disparan la etapa 3

3. NOTA ORGANIZADA
   Por cada segmento final: POST /api/voice/orchestrator/events
   Node (proxy) → Python (voice_orchestration/service.py) → Product-LLM
   ← { resolved_note_content, note_updates, agent_tasks, usage }

4. AUTOFILL
   POST /api/workflows/:id/note-field-matches
   Node → NoteFieldMatcher (LLM) → { matches:[{stepOrder,value,confidence}], readyToSubmit }
   (los `fields` los aporta la capa de detección del cliente / el workflow aprendido)
```

### Estado del streaming (importante)
- **No existe** hoy un endpoint único que emita las 3 etapas por streaming (SSE).
  Son 3 mecanismos separados.
- La transcripción cruda **la hace el navegador directo contra Deepgram** (el
  backend solo entrega un token). Para exponer la transcripción cruda como API
  del backend a clientes, esto habría que **invertirlo**: el audio entra al
  backend y el backend re-emite por streaming.
- La nota se genera por `POST` por-segmento, no en streaming continuo.

### Archivos núcleo del flujo central (conservar)
- **Python:** `bounded/miracle-ai/src/miracle_agent/features/{voice,voice_orchestration,notes}`,
  `integrations/deepgram/streaming.py`, `integrations/product_llm/note_orchestrator_adapter.py`.
- **Node:** `web/api/registerMedicalRoutes.js`, `registerClinicalRoutes.js`,
  `src/application/use-cases/{NoteFieldMatcher,ClinicalRawTranscriptionService,ClinicalDiagnosisSuggestionService}.js`.
- **Frontend nota:** `web/public/miracle/` (workspace) y el panel de nota +
  botón "grabar" dentro de `trainer-plugin.js` (`miracleNoteState`).

---

## 3. Decisiones tomadas

1. **Proveedor STT canónico: Deepgram.** Se elimina por completo **OpenAI
   Realtime** (era la voz del asistente flotante). El asistente flotante queda
   "mudo"; se conserva únicamente el botón **"grabar" de la nota** (Deepgram).
2. **Micrófono remoto por teléfono / QR: eliminado** junto con OpenAI Realtime.
3. **El motor Graph (learning/replay/Neo4j/Playwright) se conserva** — es núcleo.
4. **Marketing: eliminado.** El repo es backend + dashboard, no landing pages.
   Se conserva el **EMR expandido** (`page1/page2.html`, `emr-workspace.html`)
   como superficie de pruebas.
5. **Backend híbrido Node + Python: se mantiene y se formaliza** la frontera
   (Node = tronco de API / auth; Python = runtime de voz/nota).
6. **Clientes:** la **extensión Chrome** es una aplicación cliente (vive en el
   repo, se distribuirá desde el dashboard). La **app de Windows** irá en **otro
   repo** y consumirá la API. La **web app** también consume la API.

---

## 4. Estructura destino propuesta (monorepo)

Principio rector: **el backend es el cerebro lógico; los clientes son capas de
captura + presentación que consumen la misma API pública.** Una capacidad se
implementa una vez en el backend y todos los clientes la consumen igual.

```
Graph/
├── backend/                         # el cerebro (hoy src/ + web/api + bounded)
│   ├── capabilities/                # una carpeta por capacidad de negocio
│   │   ├── learning/                # captura de workflows (el mapa de campos del EMR)
│   │   ├── workflows/               # catálogo, entidades, branches, ejecución/replay
│   │   ├── transcription/           # Deepgram streaming (crudo)
│   │   ├── notes/                   # organización de la nota (Product-LLM)
│   │   ├── autofill/                # NoteFieldMatcher (usa workflows aprendidos)
│   │   ├── clinical/                # diagnosis suggestions
│   │   ├── voice/                   # gateway / sesiones
│   │   ├── accounts/                # auth, Supabase, doble-conexión/sync
│   │   └── usage/                   # ledger, métricas, costos
│   ├── runtime-python/              # = bounded/miracle-ai (motor voz/nota)
│   ├── engine/                      # Neo4j, Playwright, LLMProvider (infra)
│   ├── api/                         # capa HTTP: routers v1 + pipeline SSE
│   │   └── openapi.yaml             # CONTRATO — fuente de verdad de la API pública
│   └── server.js                    # composition root delgado
│
├── dashboard/                       # centro de control (SPA protegida por auth)
│   ├── workspace (EMR)              # emr-workspace
│   ├── provider-studio              # config LLM/STT
│   ├── usage                        # métricas/costos
│   ├── workflows                    # ver/gestionar workflows aprendidos
│   └── extension-releases           # build + versionar + publicar la extensión
│
├── clients/
│   └── chrome-extension/            # el asistente flotante (hoy chrome-extension-src/)
│
├── shared/
│   ├── runtime/                     # asistente flotante compartido (extraído de trainer-plugin.js)
│   └── sdk/                         # cliente generado del openapi.yaml
│
└── docs/
```

### El tronco de API pública (`/api/v1`)

```
# Aprendizaje (enseñar los campos de un EMR)
POST /api/v1/learning/sessions            iniciar captura
POST /api/v1/learning/sessions/:id/steps  registrar paso
POST /api/v1/learning/sessions/:id/finish cerrar → workflow aprendido

# Workflows (el mapa aprendido)
GET  /api/v1/workflows
POST /api/v1/workflows/:id/execute        replay (server o plan para el cliente)

# Transcripción / Nota / Autofill
POST /api/v1/transcription/sessions        token+ws para streaming crudo
POST /api/v1/notes/organize                transcripción → nota organizada
POST /api/v1/autofill/match                nota + campos → matches

# Pipeline unificado en streaming (SSE) — un solo llamado, etapas progresivas
POST /api/v1/pipeline/stream
   → event: transcription.partial  { text }
   → event: transcription.final    { text }
   → event: note.updated           { content }
   → event: autofill.matches       { matches, readyToSubmit }
```

Un cliente puede pedir cada etapa suelta **o** el flujo completo
(`/pipeline/stream`) y recibir crudo → nota → autofill en tiempo real.

### Deploy de la extensión desde el dashboard (NUEVO)

Hoy **no existe** mecanismo para distribuir la extensión (solo
`npm run build:chrome-extension` manual + "load unpacked"). Destino:

```
Dashboard → Extension Releases
   [Build] → backend empaqueta la extensión → artefacto versionado (bucket)
   [Publicar] → Chrome Web Store API  ó  self-host (.crx + update.xml)
   [Historial] → versiones, rollback, descargar .crx
```

---

## 5. Estado de ejecución

### Completado (rama `claude/backend-architecture-cleanup-bpysm9`)

- **`chore: remove marketing pages and dev junk`**
  - Borradas 7 landing pages (`producto/seguridad/confianza/casos/evidencia/presentacion*.html`),
    `site.css`, `site-nav.js`, `presentation-assets/`.
  - Borrados logs (`.codex-*.log`, `debug.log`).
  - Conservado: `index.html` (login), `page1/page2.html` (EMR pruebas),
    `emr-workspace.html`, dashboards.

- **`refactor(voice): remove OpenAI Realtime ... (backend)`**
  - Borrados: `VoiceRealtimeGateway.js`, `registerVoiceRoutes.js`,
    `phoneVoiceStore.js`, `web/phone/buildPhoneMicPage.js`.
  - `server.js` limpiado (imports, middlewares de token de teléfono,
    rate-limiter de `openai`, `voiceGatewayUrl`, gateway attach).

- **`refactor(voice): remove OpenAI Realtime mic ... (frontend)`**
  - `trainer-plugin.js`: ~1.900 líneas fuera (todo `voiceState`, WebRTC/realtime,
    phone polling, function-calls de voz, acoplamientos en `mount()`).
  - `assistant-runtime.js`: eliminado el botón de ícono de micrófono flotante +
    re-layout de 3→2 botones (chat + nota).
  - `plugin-api.js` (métodos openai/phone), `plugin-voice-client.js` (borrado),
    manifest de la extensión, bootstrap/content, CSS y test clínico.

Verificado: `node --check` en todos los archivos + cero referencias residuales
a realtime/phone/mic en el repo.

### Conservado intacto
- Botón "grabar" de la nota → Deepgram (`/api/voice/stream-session`),
  orquestación (`/api/voice/orchestrator/events`), autofill, diagnóstico.
- Motor de aprendizaje de workflows (habilita el autofill) — **sin tocar**.

### Pendiente
- Deploy en Vercel + promover a `main` (con backup de `main` antes del refactor).
- Reorganización estructural: `backend/capabilities/`, `shared/runtime/`,
  `clients/chrome-extension/`, contrato `openapi.yaml`.
- Endpoint único de pipeline en streaming (SSE).
- Sección "Extension Releases" en el dashboard.
- Unificar el frontend de nota (dashboard `web/public/miracle/` vs panel en
  `trainer-plugin.js`) sobre una sola implementación Deepgram.

---

## 6. Fases de ejecución

- **Fase 0** — `openapi.yaml` (contrato v1) + fachada `/api/v1` enrutando a los servicios actuales.
- **Fase 1** — Reorganizar `backend/capabilities/` (mover, no reescribir) + composition root delgado.
- **Fase 2** — Extraer `shared/runtime/` desde `trainer-plugin.js` + `shared/sdk/`.
- **Fase 3** — Endpoint único de pipeline en streaming (SSE).
- **Fase 4** — Separar `clients/chrome-extension/` consumiendo el SDK.
- **Fase 5** — Dashboard "Extension Releases" + pipeline de deploy.
- **Fase 6** — Limpieza final (docs consolidados, dedup Miracle).
