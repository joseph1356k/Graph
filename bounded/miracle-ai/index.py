from __future__ import annotations

import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
SRC_ROOT = REPO_ROOT / "src"

if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from miracle_agent.app.web_app import create_notes_app
from miracle_agent.config import MiracleSettings
from miracle_agent.context import MiracleContext


def _ensure_runtime_env() -> None:
    # Vercel bundles the repo read-only, so keep mutable voice-session state in
    # a writable temp directory while leaving docs/knowledge in the repo bundle.
    os.environ.setdefault("MIRACLE_MEMORY_ROOT", "/tmp/miracle-memory")


_ensure_runtime_env()
settings = MiracleSettings.from_env(REPO_ROOT)
context = MiracleContext.from_workspace(REPO_ROOT)
context.ensure_layout()
app = create_notes_app(settings, context)
