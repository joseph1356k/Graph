from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ChatBackendResponse:
    reply: str
    conversation_id: str | None = None
    backend_status: str = "not-configured"

