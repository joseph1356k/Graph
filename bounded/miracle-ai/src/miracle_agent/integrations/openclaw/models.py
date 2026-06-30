from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


def _as_dict(value: object) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return {str(key): inner for key, inner in value.items()}
    return None


def _as_list(value: object) -> list[Any]:
    if isinstance(value, list):
        return value
    return []


def _selection(value: object) -> dict[str, int]:
    if not isinstance(value, Mapping):
        return {"start": 0, "end": 0}
    start = value.get("start", 0)
    end = value.get("end", start)
    try:
        return {"start": int(start), "end": int(end)}
    except (TypeError, ValueError):
        return {"start": 0, "end": 0}


@dataclass(frozen=True)
class MiracleContextEnvelope:
    note: dict[str, Any] | None
    active_block: dict[str, Any] | None
    previous_block: dict[str, Any] | None
    next_block: dict[str, Any] | None
    recent_change: dict[str, Any] | None
    session_diff: dict[str, Any] | None
    session_history: list[Any]
    session_checkpoints: list[Any]
    selection: dict[str, int]

    @classmethod
    def from_context_packet(cls, context_packet: Mapping[str, object] | None) -> "MiracleContextEnvelope":
        packet = context_packet or {}
        return cls(
            note=_as_dict(packet.get("note")),
            active_block=_as_dict(packet.get("active_block")),
            previous_block=_as_dict(packet.get("previous_block")),
            next_block=_as_dict(packet.get("next_block")),
            recent_change=_as_dict(packet.get("recent_change")),
            session_diff=_as_dict(packet.get("session_diff")),
            session_history=_as_list(packet.get("session_history")),
            session_checkpoints=_as_list(packet.get("session_checkpoints")),
            selection=_selection(packet.get("selection")),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class OpenclawGatewayResponse:
    response_id: str | None
    reply: str
    raw_payload: dict[str, Any]

