# Miracle OpenClaw Workspace

This directory is the official OpenClaw agent workspace for Miracle.

Use these files as the runtime-facing workspace files for the Miracle profile.
Do not use the repository root as the OpenClaw agent workspace.

Repo-level coding and product guardrails still live in `/Users/felipemaldonado/Documents/Miracle/AGENTS.md`.

Product user content and memory for Miracle live separately under:

- `workspaces/miracle/knowledge/`
- `workspaces/miracle/memory/`

Keep this separation:

- OpenClaw workspace files here
- Miracle product data in `workspaces/miracle/`
- Application code in `src/`
