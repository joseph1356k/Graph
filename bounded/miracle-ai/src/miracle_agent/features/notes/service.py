from __future__ import annotations

from ...context import MiracleContext
from ...platform.context.notes import build_context_packet, build_history_entry
from ...platform.storage.knowledge import (
    create_knowledge_file,
    ensure_knowledge_base,
    list_knowledge_files,
    read_knowledge_file,
    write_knowledge_file,
)
from .contracts import NoteTabSession, NotesSessionState
from .session_store import load_notes_session, save_notes_session


class NotesWorkspaceService:
    def __init__(self, context: MiracleContext) -> None:
        self._context = context
        ensure_knowledge_base(context)

    def list_files(self) -> list[dict[str, object]]:
        return [file.__dict__ for file in list_knowledge_files(self._context)]

    def read_file(self, relative_path: str) -> str:
        return read_knowledge_file(self._context, relative_path)

    def write_file(self, relative_path: str, content: str) -> None:
        write_knowledge_file(self._context, relative_path, content)

    def create_file(self, relative_path: str, template: str = "") -> str:
        return create_knowledge_file(self._context, relative_path, template)

    def load_session(self) -> dict[str, object]:
        return load_notes_session(self._context).to_dict()

    def save_session(self, payload: dict[str, object]) -> None:
        open_tabs = [NoteTabSession(**item) for item in payload.get("open_tabs", [])]
        session = NotesSessionState(
            open_tabs=open_tabs,
            active_tab_id=payload.get("active_tab_id"),
            untitled_count=payload.get("untitled_count", 0),
            previous_response_id=payload.get("previous_response_id"),
        )
        save_notes_session(self._context, session)

    def build_context(self, payload: dict[str, object]) -> dict[str, object]:
        content = payload.get("content", "")
        note_path = payload.get("path")
        note_title = payload.get("title", "Untitled")
        cursor_start = int(payload.get("cursor_start", 0))
        cursor_end = int(payload.get("cursor_end", cursor_start))
        previous_content = payload.get("previous_content", content)
        baseline_content = payload.get("baseline_content", content)
        packet = build_context_packet(
            note_path=note_path,
            note_title=note_title,
            content=content,
            cursor_start=cursor_start,
            cursor_end=cursor_end,
            previous_content=previous_content,
            baseline_content=baseline_content,
        )
        return packet.to_dict()

    def build_history_change(self, payload: dict[str, object]) -> dict[str, object]:
        current_content = payload.get("content", "")
        previous_content = payload.get("previous_content", current_content)
        note_path = payload.get("path")
        note_title = payload.get("title", "Untitled")
        cursor_start = int(payload.get("cursor_start", 0))
        cursor_end = int(payload.get("cursor_end", cursor_start))
        return build_history_entry(
            note_path=note_path,
            note_title=note_title,
            previous_content=previous_content,
            current_content=current_content,
            cursor_start=cursor_start,
            cursor_end=cursor_end,
        )

