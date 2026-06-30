from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from ...context import MiracleContext


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "item"


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def safe_workspace_path(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if root.resolve() not in (candidate, *candidate.parents):
        raise ValueError(f"Path escapes workspace: {relative_path}")
    return candidate


def write_markdown(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")
    return path


def write_note(context: MiracleContext, category: str, title: str, content: str) -> Path:
    if category not in {"notes", "decisions"}:
        raise ValueError("category must be 'notes' or 'decisions'")
    filename = f"{timestamp_slug()}-{slugify(title)}.md"
    body = f"# {title}\n\n{content.strip()}\n"
    return write_markdown(context.memory_root / category / filename, body)


def write_feature_brief(
    context: MiracleContext,
    name: str,
    user: str,
    problem: str,
    outcome: str,
    success_criteria: str,
    constraints: str,
    out_of_scope: str,
    risks: str,
) -> Path:
    filename = f"{slugify(name)}-brief.md"
    body = f"""# Feature Brief: {name}

## Usuario
{user}

## Problema
{problem}

## Resultado esperado
{outcome}

## Criterio de éxito
{success_criteria}

## Restricciones
{constraints}

## Out of scope
{out_of_scope}

## Riesgos o dudas
{risks}
"""
    return write_markdown(context.features_root / filename, body)


def write_mini_adr(
    context: MiracleContext,
    title: str,
    status: str,
    problem_context: str,
    decision: str,
    rationale: str,
    consequences: str,
    alternatives: str,
) -> Path:
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d')}-{slugify(title)}.md"
    body = f"""# {title}

## Estado
{status}

## Contexto
{problem_context}

## Decisión
{decision}

## Por qué
{rationale}

## Consecuencias
{consequences}

## Alternativas descartadas
{alternatives}
"""
    return write_markdown(context.adrs_root / filename, body)


def summarize_directory(path: Path, limit: int = 10) -> str:
    if not path.exists():
        return "No hay archivos todavía."
    files = sorted((item for item in path.glob("*.md") if item.is_file()), reverse=True)[:limit]
    if not files:
        return "No hay archivos todavía."
    return "\n".join(f"- {item.name}" for item in files)

