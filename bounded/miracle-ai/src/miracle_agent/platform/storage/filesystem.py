from __future__ import annotations

from pathlib import Path


def safe_workspace_path(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if root.resolve() not in (candidate, *candidate.parents):
        raise ValueError(f"Path escapes workspace: {relative_path}")
    return candidate


def write_markdown(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")
    return path
