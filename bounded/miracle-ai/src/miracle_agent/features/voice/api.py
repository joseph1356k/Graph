from __future__ import annotations

import json

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .contracts import DEFAULT_AUDIO_SOURCE, UnsupportedAudioSourceError, parse_audio_source
from .service import VoiceStreamingError, VoiceStreamingService


async def _read_audio_source(request: Request) -> str:
    """
    Lee `audio_source` del body. Un body vacio o no-JSON cae en el default
    (microfono del navegador): el proxy de la web manda `{}` desde antes de que
    Omi existiera y no puede empezar a fallar por eso.
    """
    try:
        raw_body = await request.body()
    except Exception:  # pragma: no cover - cliente que corta la conexion
        return DEFAULT_AUDIO_SOURCE
    if not raw_body:
        return DEFAULT_AUDIO_SOURCE
    try:
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return DEFAULT_AUDIO_SOURCE
    if not isinstance(payload, dict):
        return DEFAULT_AUDIO_SOURCE
    return parse_audio_source(payload.get("audio_source"))


def create_voice_routes(service: VoiceStreamingService) -> list[Route]:
    async def create_voice_stream_session(request: Request):
        try:
            audio_source = await _read_audio_source(request)
        except UnsupportedAudioSourceError as exc:
            # 400 y no 503: el entorno esta bien, lo que vino mal es la peticion.
            return JSONResponse({"error": str(exc)}, status_code=400)
        try:
            session = await run_in_threadpool(
                service.create_stream_session,
                audio_source=audio_source,
            )
        except VoiceStreamingError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(session.to_dict())

    return [
        Route("/api/voice/stream-session", endpoint=create_voice_stream_session, methods=["POST"]),
    ]
