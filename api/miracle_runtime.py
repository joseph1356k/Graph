from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode


REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLED_MIRACLE_ROOT = REPO_ROOT / "bounded" / "miracle-ai"
RUNTIME_ROOT = Path("/tmp/graph-miracle-runtime")
RUNTIME_SRC_ROOT = RUNTIME_ROOT / "src"
RUNTIME_MEMORY_ROOT = Path("/tmp/miracle-memory")


def _sync_dir(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    shutil.copytree(source, destination, dirs_exist_ok=True)


def _ensure_runtime_root() -> Path:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    _sync_dir(BUNDLED_MIRACLE_ROOT / "src", RUNTIME_ROOT / "src")

    knowledge_target = RUNTIME_ROOT / "workspaces" / "miracle" / "knowledge"
    if not knowledge_target.exists():
        _sync_dir(BUNDLED_MIRACLE_ROOT / "workspaces", RUNTIME_ROOT / "workspaces")

    (RUNTIME_ROOT / "docs" / "features").mkdir(parents=True, exist_ok=True)
    (RUNTIME_ROOT / "docs" / "adrs").mkdir(parents=True, exist_ok=True)
    return RUNTIME_ROOT


def _build_runtime_app():
    runtime_root = _ensure_runtime_root()
    os.environ.setdefault("MIRACLE_MEMORY_ROOT", str(RUNTIME_MEMORY_ROOT))
    if str(RUNTIME_SRC_ROOT) not in sys.path:
        sys.path.insert(0, str(RUNTIME_SRC_ROOT))

    from miracle_agent.app.web_app import create_notes_app
    from miracle_agent.config import MiracleSettings
    from miracle_agent.context import MiracleContext

    settings = MiracleSettings.from_env(runtime_root)
    context = MiracleContext.from_workspace(runtime_root)
    context.ensure_layout()
    return create_notes_app(settings, context)


MIRACLE_APP = _build_runtime_app()


def _rewrite_scope(scope: dict[str, object]) -> dict[str, object]:
    query_pairs = parse_qsl((scope.get("query_string") or b"").decode("utf-8"), keep_blank_values=True)
    target_path = ""
    filtered_pairs: list[tuple[str, str]] = []

    for key, value in query_pairs:
        if key == "__miracle_target" and not target_path:
            target_path = value
            continue
        filtered_pairs.append((key, value))

    resolved_path = "/" + target_path.lstrip("/") if target_path else "/"
    rewritten = dict(scope)
    rewritten["path"] = resolved_path
    rewritten["raw_path"] = resolved_path.encode("utf-8")
    rewritten["query_string"] = urlencode(filtered_pairs, doseq=True).encode("utf-8")
    return rewritten


def _expected_internal_token() -> str:
    return (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SECRET_KEY")
        or ""
    ).strip()


def _is_authorized_internal_request(scope: dict[str, object]) -> bool:
    expected = _expected_internal_token()
    if not expected:
        return True
    headers = scope.get("headers") or []
    for key, value in headers:
        if key == b"x-graph-internal-token":
            return value.decode("utf-8") == expected
    return False


async def _send_json(send, status_code: int, payload: str) -> None:
    body = payload.encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", str(len(body)).encode("utf-8")],
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def app(scope, receive, send):
    if scope["type"] != "http":
        await MIRACLE_APP(scope, receive, send)
        return

    if not _is_authorized_internal_request(scope):
        await _send_json(send, 401, '{"error":"Unauthorized internal runtime request"}')
        return

    await MIRACLE_APP(_rewrite_scope(scope), receive, send)
