from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class NoteTabSession:
    id: str
    path: str | None
    title: str
    content: str
    baseline_content: str = ""
    session_snapshot_content: str | None = None
    session_snapshot_at: str | None = None
    is_dirty: bool = False
    cursor_start: int = 0
    cursor_end: int = 0
    recent_change: dict[str, object] | None = None
    context_packet: dict[str, object] | None = None
    change_log: list[dict[str, object]] | None = None
    session_diff: dict[str, object] | None = None
    checkpoints: list[dict[str, object]] | None = None


@dataclass
class NotesSessionState:
    open_tabs: list[NoteTabSession]
    active_tab_id: str | None
    untitled_count: int = 0
    previous_response_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "open_tabs": [asdict(tab) for tab in self.open_tabs],
            "active_tab_id": self.active_tab_id,
            "untitled_count": self.untitled_count,
            "previous_response_id": self.previous_response_id,
        }

