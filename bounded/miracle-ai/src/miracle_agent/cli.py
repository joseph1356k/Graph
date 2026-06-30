from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from .config import MiracleSettings
from .context import MiracleContext
from .app.web_app import create_notes_app
from .platform.storage.knowledge import ensure_knowledge_base


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Miracle local tools.")
    parser.add_argument("--workspace", default=".", help="Workspace root to use.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    notes = subparsers.add_parser("notes", help="Start the local notes app.")
    notes.add_argument("--host", default="127.0.0.1", help="Host to bind.")
    notes.add_argument("--port", default=8765, type=int, help="Port to bind.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    workspace = Path(args.workspace).resolve()
    settings = MiracleSettings.from_env(workspace)
    context = MiracleContext.from_workspace(workspace)
    context.ensure_layout()

    if args.command == "notes":
        ensure_knowledge_base(context)
        app = create_notes_app(settings, context)
        uvicorn.run(app, host=args.host, port=args.port)
        return 0
    parser.error(f"Unsupported command: {args.command}")
    return 1
