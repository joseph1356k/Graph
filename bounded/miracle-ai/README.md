# Miracle

Miracle es un producto propio de notas contextualizadas que usa `OpenClaw` como runtime upstream.

La historia correcta del repo hoy es esta:

- `Miracle` posee la UX de producto
- `OpenClaw` se trata como infraestructura upstream
- `orchestration/` es tooling del equipo, no parte del producto

## Qué vive en este repo

- una app local de notas Markdown con tabs
- captura de contexto alrededor de la nota activa
- chat contextual detrás de `POST /api/chat`
- setup de providers y runtime upstream desde Miracle
- una superficie de voz integrada para captura y transcripción
- documentación, ADRs y runbooks del producto
- tooling de orquestación interna del equipo en `orchestration/`

## Estructura actual

- [AGENTS.md](/Users/felipemaldonado/Documents/Miracle/AGENTS.md): entrypoint del repo y redirección a la orquestación del equipo
- [orchestration/AGENTS.md](/Users/felipemaldonado/Documents/Miracle/orchestration/AGENTS.md): fuente de verdad de colaboración interna
- [ARCHITECTURE.md](/Users/felipemaldonado/Documents/Miracle/ARCHITECTURE.md): guía arquitectónica actual del producto
- [docs/README.md](/Users/felipemaldonado/Documents/Miracle/docs/README.md): mapa de documentación viva
- `src/miracle_agent/app/`: composición HTTP y wiring principal
- `src/miracle_agent/features/`: vertical slices de producto
- `src/miracle_agent/platform/`: capacidades compartidas del producto
- `src/miracle_agent/integrations/`: adapters hacia OpenClaw, Deepgram y otros bordes
- `src/miracle_agent/web/`: shell frontend simple para desarrollar rápido
- `workspaces/miracle/`: knowledge y memory del producto
- `workspaces/openclaw/agent/`: workspace aislado del perfil upstream de Miracle

## Arquitectura real hoy

Miracle ya no está organizado como un paquete flat.

La forma actual del código es la de un modular monolith pequeño:

```text
web shell
  -> app/web_app.py
    -> features/
      -> platform/
        -> integrations/
          -> OpenClaw / Deepgram / storage
```

Flujo principal de producto:

`note editing -> context packet -> /api/chat -> OpenClaw adapter -> upstream runtime -> normalized reply`

## Qué no es parte del producto

`orchestration/` no define la UX ni la arquitectura de Miracle.

Esa carpeta existe para colaborar con agentes y documentar reglas operativas del equipo. Es importante para desarrollar el repo, pero no debe confundirse con la arquitectura del producto.

## Setup

Usa Python `3.10+`. En esta máquina ya existe `python3.12`, así que la ruta simple es:

```bash
uv venv --python /opt/homebrew/bin/python3.12
source .venv/bin/activate
UV_CACHE_DIR=/tmp/uv-cache uv sync --extra dev
cp .env.example .env
```

## Ejecutar la app

```bash
source .venv/bin/activate
PYTHONPATH=src python -m miracle_agent notes --host 127.0.0.1 --port 8765
```

Luego abre [http://127.0.0.1:8765](http://127.0.0.1:8765).

La app trabaja sobre `workspaces/miracle/knowledge/` y conserva estado de sesión en `workspaces/miracle/memory/`.

La UI es deliberadamente simple en esta etapa:

- barra básica con `Nuevo`, `Abrir`, `Guardar`
- tabs tipo bloc de notas
- editor Markdown/plain text
- preview simple
- drawer de chat contextual
- overlay de setup de provider

## Boundaries importantes

- el browser no habla directamente con OpenClaw
- la UI no consume payloads crudos upstream
- Miracle mantiene el contrato de producto (`ContextPacket`, checkpoints, session diff)
- OpenClaw se usa detrás de adapters propios en `src/miracle_agent/integrations/openclaw/`

## Runtime upstream y providers

Miracle configura OpenClaw desde su propio flujo de setup y mantiene un profile aislado para no mezclar el producto con otros runtimes del sistema.

Documentación relevante:

- [docs/openclaw/02-openclaw-product-architecture.md](/Users/felipemaldonado/Documents/Miracle/docs/openclaw/02-openclaw-product-architecture.md)
- [docs/openclaw/03-openclaw-boundaries-and-contracts.md](/Users/felipemaldonado/Documents/Miracle/docs/openclaw/03-openclaw-boundaries-and-contracts.md)
- [docs/openclaw/06-openclaw-runtime-implementation-and-maintenance.md](/Users/felipemaldonado/Documents/Miracle/docs/openclaw/06-openclaw-runtime-implementation-and-maintenance.md)

## Tooling adicional

Este repo también incluye tooling operativo para casos específicos:

- `bin/restart-miracle`
- `bin/status-miracle`
- `bin/gemma-local-provider`
- `bin/bahmni`

Para ver la descarga de Gemma en vivo:

```bash
bin/gemma-local-provider pull-live
```

Runbooks:

- [docs/operations/bahmni-isolated-runtime.md](/Users/felipemaldonado/Documents/Miracle/docs/operations/bahmni-isolated-runtime.md)
- [docs/adrs/adr-002-bahmni-isolated-runtime.md](/Users/felipemaldonado/Documents/Miracle/docs/adrs/adr-002-bahmni-isolated-runtime.md)
