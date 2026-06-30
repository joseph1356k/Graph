from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class VoiceTranscriptSegment:
    segment_id: str
    kind: str
    transcript: str
    start_ms: int | None = None
    end_ms: int | None = None
    language: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProductLLMOrchestratorInput:
    voice_session_id: str
    note_path: str | None
    note_title: str
    note_content: str
    last_applied_note_block: str | None
    transcript_history: list[str]
    segment: VoiceTranscriptSegment

    def to_dict(self) -> dict[str, object]:
        return {
            "voice_session_id": self.voice_session_id,
            "note_path": self.note_path,
            "note_title": self.note_title,
            "note_content": self.note_content,
            "last_applied_note_block": self.last_applied_note_block,
            "transcript_history": self.transcript_history,
            "segment": self.segment.to_dict(),
        }


@dataclass(frozen=True)
class ProductLLMNoteUpdate:
    type: str
    target: dict[str, object]
    content: str
    reason: str
    confidence: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProductLLMAgentTask:
    intent: str
    priority: str
    mode: str
    payload: dict[str, object]
    confidence: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProductLLMUsageMetrics:
    provider: str
    api_family: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProductLLMOrchestratorOutput:
    note_updates: list[ProductLLMNoteUpdate] = field(default_factory=list)
    agent_tasks: list[ProductLLMAgentTask] = field(default_factory=list)
    backend_status: str = "heuristic"
    usage: ProductLLMUsageMetrics | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "note_updates": [item.to_dict() for item in self.note_updates],
            "agent_tasks": [item.to_dict() for item in self.agent_tasks],
            "backend_status": self.backend_status,
            "usage": self.usage.to_dict() if self.usage else None,
        }
