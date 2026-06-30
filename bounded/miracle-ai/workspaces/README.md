# Workspaces

This repo keeps runtime-facing workspace files and product data inside `workspaces/`
so the repository root stays focused on source code, docs, tests, and operational scripts.

## Layout

- `openclaw/agent/`
  Official OpenClaw agent workspace for the Miracle profile.
  This is where workspace files such as `AGENTS.md`, `SOUL.md`, `USER.md`,
  `IDENTITY.md`, `TOOLS.md`, and `HEARTBEAT.md` live.

- `miracle/knowledge/`
  User-facing Markdown content for the Miracle notes app.

- `miracle/memory/`
  Product-side local state such as sessions, checkpoints, and setup metadata.

## Rule of thumb

- If it is OpenClaw workspace state, put it in `openclaw/agent/`.
- If it is Miracle product data, put it in `miracle/`.
- If it is application code, it belongs in `src/`.
