from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ...context import MiracleContext
from .filesystem import safe_workspace_path, write_markdown


@dataclass(frozen=True)
class KnowledgeFile:
    path: str
    name: str
    group: str


def ensure_knowledge_base(context: MiracleContext) -> None:
    context.knowledge_root.mkdir(parents=True, exist_ok=True)
    for relative_dir in ("raw", "wiki"):
        (context.knowledge_root / relative_dir).mkdir(parents=True, exist_ok=True)


def knowledge_path(context: MiracleContext, relative_path: str) -> Path:
    if not relative_path.endswith(".md"):
        raise ValueError("Only markdown files are supported.")
    return safe_workspace_path(context.knowledge_root, relative_path)


def list_knowledge_files(context: MiracleContext) -> list[KnowledgeFile]:
    files: list[KnowledgeFile] = []
    for path in sorted(context.knowledge_root.rglob("*.md")):
        rel = path.relative_to(context.knowledge_root).as_posix()
        group = rel.split("/", 1)[0] if "/" in rel else "root"
        files.append(
            KnowledgeFile(
                path=rel,
                name=path.stem.replace("-", " ").replace("_", " ").title(),
                group=group,
            )
        )
    return files


def read_knowledge_file(context: MiracleContext, relative_path: str) -> str:
    path = knowledge_path(context, relative_path)
    return path.read_text(encoding="utf-8")


def write_knowledge_file(context: MiracleContext, relative_path: str, content: str) -> None:
    path = knowledge_path(context, relative_path)
    write_markdown(path, content)


def create_knowledge_file(context: MiracleContext, relative_path: str, template: str = "") -> str:
    path = knowledge_path(context, relative_path)
    if path.exists():
        raise FileExistsError(relative_path)
    write_markdown(path, template or f"# {Path(relative_path).stem.replace('-', ' ').title()}\n")
    return relative_path
