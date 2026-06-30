from __future__ import annotations

import json

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .service import NotesWorkspaceService


def create_notes_routes(service: NotesWorkspaceService) -> list[Route]:
    async def tree(_: Request):
        return JSONResponse({"files": service.list_files()})

    async def read_file(request: Request):
        relative_path = request.query_params.get("path", "")
        if not relative_path:
            return JSONResponse({"error": "Missing path"}, status_code=400)
        try:
            content = service.read_file(relative_path)
        except FileNotFoundError:
            return JSONResponse({"error": "File not found"}, status_code=404)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        return JSONResponse({"path": relative_path, "content": content})

    async def write_file(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        relative_path = payload.get("path", "")
        content = payload.get("content", "")
        if not relative_path:
            return JSONResponse({"error": "Missing path"}, status_code=400)
        try:
            service.write_file(relative_path, content)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        return JSONResponse({"ok": True, "path": relative_path})

    async def create_file(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        relative_path = payload.get("path", "")
        template = payload.get("template", "")
        if not relative_path:
            return JSONResponse({"error": "Missing path"}, status_code=400)
        try:
            created = service.create_file(relative_path, template)
        except FileExistsError:
            return JSONResponse({"error": "File already exists"}, status_code=409)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        return JSONResponse({"ok": True, "path": created}, status_code=201)

    async def read_session(_: Request):
        return JSONResponse(service.load_session())

    async def write_session(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        service.save_session(payload)
        return JSONResponse({"ok": True})

    async def resolve_context(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        return JSONResponse(service.build_context(payload))

    async def build_history_change(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        return JSONResponse(service.build_history_change(payload))

    return [
        Route("/api/tree", endpoint=tree),
        Route("/api/file", endpoint=read_file, methods=["GET"]),
        Route("/api/file", endpoint=write_file, methods=["PUT"]),
        Route("/api/files", endpoint=create_file, methods=["POST"]),
        Route("/api/session", endpoint=read_session, methods=["GET"]),
        Route("/api/session", endpoint=write_session, methods=["PUT", "POST"]),
        Route("/api/context", endpoint=resolve_context, methods=["POST"]),
        Route("/api/history-change", endpoint=build_history_change, methods=["POST"]),
    ]

