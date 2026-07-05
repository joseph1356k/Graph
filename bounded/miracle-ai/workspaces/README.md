# Workspaces

This repo keeps runtime-facing workspace files and product data inside `workspaces/`
so the repository root stays focused on source code, docs, tests, and operational scripts.

## Layout

- `miracle/knowledge/`
  User-facing Markdown content for the Miracle notes app.

- `miracle/memory/`
  Product-side local state such as sessions, checkpoints, and setup metadata.

## Rule of thumb

- If it is Miracle product data, put it in `miracle/`.
- If it is application code, it belongs in `src/`.
