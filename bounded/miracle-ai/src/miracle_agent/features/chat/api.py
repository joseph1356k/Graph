from __future__ import annotations

import json

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .service import ChatBackendError, ContextualChatBackend


def create_chat_routes(backend: ContextualChatBackend) -> list[Route]:
    async def chat_with_assistant(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        message = payload.get("message", "").strip()
        previous_response_id = payload.get("previous_response_id")
        context_packet = payload.get("context_packet")
        if not message:
            return JSONResponse({"error": "Missing message"}, status_code=400)

        try:
            response = await run_in_threadpool(
                backend.chat,
                message=message,
                context_packet=context_packet,
                conversation_id=previous_response_id,
            )
        except ChatBackendError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(
            {
                "reply": response.reply,
                "previous_response_id": response.conversation_id,
                "backend_status": response.backend_status,
            }
        )

    return [
        Route("/api/chat", endpoint=chat_with_assistant, methods=["POST"]),
    ]

