from __future__ import annotations

import json
from pathlib import Path

from ...context import MiracleContext
from .contracts import NoteTabSession, NotesSessionState


def _session_path(context: MiracleContext) -> Path:
    return context.memory_root / "notes" / "session.json"


def load_notes_session(context: MiracleContext) -> NotesSessionState:
    path = _session_path(context)
    if not path.exists():
        return NotesSessionState(open_tabs=[], active_tab_id=None)

    payload = json.loads(path.read_text(encoding="utf-8"))
    tabs = [NoteTabSession(**item) for item in payload.get("open_tabs", [])]
    return NotesSessionState(
        open_tabs=tabs,
        active_tab_id=payload.get("active_tab_id"),
        untitled_count=payload.get("untitled_count", 0),
        previous_response_id=payload.get("previous_response_id"),
    )


def save_notes_session(context: MiracleContext, session: NotesSessionState) -> Path:
    path = _session_path(context)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path

