from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class VoiceOrchestratorSegment:
    segment_id: str
    kind: str
    transcript: str
    start_ms: int | None = None
    end_ms: int | None = None
    language: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class VoiceOrchestratorEvent:
    voice_session_id: str
    note_path: str | None
    note_title: str
    note_content: str
    tab_id: str | None
    event_id: str
    sequence: int
    segment: VoiceOrchestratorSegment


@dataclass(frozen=True)
class VoiceOrchestratorNoteUpdate:
    type: str
    target: dict[str, object]
    content: str
    reason: str
    confidence: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class VoiceOrchestratorAgentTask:
    intent: str
    priority: str
    mode: str
    payload: dict[str, object]
    confidence: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class VoiceOrchestratorSessionState:
    voice_session_id: str
    note_path: str | None
    note_title: str
    transcript_history: list[str] = field(default_factory=list)
    processed_segment_ids: list[str] = field(default_factory=list)
    last_sequence: int = 0
    last_note_content: str = ""
    last_applied_note_block: str | None = None
    pending_agent_tasks: list[dict[str, object]] = field(default_factory=list)
    product_llm_conversation_id: str | None = None
    openclaw_conversation_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class VoiceOrchestratorResponse:
    accepted_event_id: str
    session_state: dict[str, object]
    note_updates: list[dict[str, object]]
    agent_tasks: list[dict[str, object]]
    resolved_note_content: str
    backend_status: str
    usage: dict[str, object] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "accepted_event_id": self.accepted_event_id,
            "session_state": self.session_state,
            "note_updates": self.note_updates,
            "agent_tasks": self.agent_tasks,
            "resolved_note_content": self.resolved_note_content,
            "backend_status": self.backend_status,
            "usage": self.usage,
        }
