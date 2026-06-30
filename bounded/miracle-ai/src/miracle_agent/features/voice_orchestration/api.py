from __future__ import annotations

import json

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .contracts import VoiceOrchestratorEvent, VoiceOrchestratorSegment
from .service import VoiceOrchestrationError, VoiceOrchestrationService


def create_voice_orchestration_routes(service: VoiceOrchestrationService) -> list[Route]:
    async def voice_orchestrator_status(_: Request):
        return JSONResponse(service.status())

    async def orchestrate_voice_event(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        segment_payload = payload.get("segment") or {}
        try:
            event = VoiceOrchestratorEvent(
                voice_session_id=str(payload.get("voice_session_id", "")).strip(),
                note_path=payload.get("note_path"),
                note_title=str(payload.get("note_title") or "Untitled"),
                note_content=str(payload.get("note_content") or ""),
                tab_id=payload.get("tab_id"),
                event_id=str(payload.get("event_id", "")).strip(),
                sequence=int(payload.get("sequence", 0)),
                segment=VoiceOrchestratorSegment(
                    segment_id=str(segment_payload.get("segment_id", "")).strip(),
                    kind=str(segment_payload.get("kind", "final")).strip(),
                    transcript=str(segment_payload.get("transcript", "")).strip(),
                    start_ms=int(segment_payload["start_ms"]) if segment_payload.get("start_ms") is not None else None,
                    end_ms=int(segment_payload["end_ms"]) if segment_payload.get("end_ms") is not None else None,
                    language=segment_payload.get("language"),
                ),
            )
            response = await run_in_threadpool(service.orchestrate_event, event)
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid voice orchestration payload"}, status_code=400)
        except VoiceOrchestrationError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(response.to_dict())

    return [
        Route("/api/voice/orchestrator/status", endpoint=voice_orchestrator_status, methods=["GET"]),
        Route("/api/voice/orchestrator/events", endpoint=orchestrate_voice_event, methods=["POST"]),
    ]
