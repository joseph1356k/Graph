from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class VoiceStreamSession:
    provider: str
    access_token: str
    auth_scheme: str
    expires_in: int
    websocket_url: str
    model: str
    language: str
    timeslice_ms: int
    endpointing_ms: int

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
