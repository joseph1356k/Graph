from __future__ import annotations

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .service import VoiceStreamingError, VoiceStreamingService


def create_voice_routes(service: VoiceStreamingService) -> list[Route]:
    async def create_voice_stream_session(_: Request):
        try:
            session = await run_in_threadpool(service.create_stream_session)
        except VoiceStreamingError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(session.to_dict())

    return [
        Route("/api/voice/stream-session", endpoint=create_voice_stream_session, methods=["POST"]),
    ]
