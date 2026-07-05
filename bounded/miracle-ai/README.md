# Miracle runtime (voz → nota)

Runtime Python del backend Graph. Expone la **transcripción de voz (Deepgram)**
y la **organización de la nota con un LLM** (`product_llm`). El borde Node
(`web/server.js`) actúa como proxy autenticado hacia este runtime; en Vercel se
despliega como `api/miracle_runtime.py`.

## Qué vive aquí

- `src/miracle_agent/app/web_app.py` — composición HTTP (ASGI / Starlette).
- `src/miracle_agent/features/`
  - `notes/` — workspace de notas Markdown.
  - `voice/` — sesión de streaming de transcripción (Deepgram).
  - `voice_orchestration/` — organiza cada segmento transcrito en la nota vía `product_llm`.
  - `runtime/` — setup/status del provider `product_llm`.
- `src/miracle_agent/integrations/`
  - `deepgram/` — streaming de transcripción.
  - `product_llm/` — cliente OpenAI-compatible que estructura la nota.
- `src/miracle_agent/platform/` — almacenamiento de notas y captura de contexto.
- `workspaces/miracle/` — knowledge y memory del producto.

## Setup

Requiere Python `3.10+`.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

## Ejecutar la app local

```bash
source .venv/bin/activate
PYTHONPATH=src python -m miracle_agent notes --host 127.0.0.1 --port 8765
```

La app trabaja sobre `workspaces/miracle/knowledge/` y conserva estado de sesión
en `workspaces/miracle/memory/`.

## Endpoints principales

- `POST /api/voice/stream-session` — token + websocket para transcripción cruda (Deepgram).
- `POST /api/voice/orchestrator/events` — segmento transcrito → nota organizada (`product_llm`).
- `GET  /api/setup/status`, `POST /api/setup/product-llm` — configuración del provider LLM.

## Boundaries

- El navegador no habla directamente con el runtime Python: pasa por el proxy Node autenticado.
- La organización de la nota se hace exclusivamente a través de los adapters de `product_llm`.
