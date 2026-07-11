from __future__ import annotations

from dataclasses import asdict, dataclass, field


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
    # Providers that authenticate/configure via the first WebSocket frame
    # (e.g. Soniox: auth_scheme="message") carry the JSON config the browser must
    # send once the socket opens. Deepgram leaves this empty and authenticates via
    # the WebSocket subprotocol instead.
    start_message: dict[str, object] | None = field(default=None)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
