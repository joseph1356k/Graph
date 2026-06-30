from __future__ import annotations

from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from ..config import MiracleSettings
from ..context import MiracleContext
from ..features.chat.api import create_chat_routes
from ..features.chat.service import ContextualChatBackend
from ..features.notes.api import create_notes_routes
from ..features.notes.service import NotesWorkspaceService
from ..features.runtime.api import create_runtime_routes
from ..features.voice.api import create_voice_routes
from ..features.voice.service import VoiceStreamingService
from ..features.voice_orchestration.api import create_voice_orchestration_routes
from ..features.voice_orchestration.service import VoiceOrchestrationService
from ..integrations.product_llm.setup import ProductLLMSetupService
from ..integrations.openclaw.setup import OpenclawSetupService


def _asset_path() -> Path:
    return Path(__file__).resolve().parents[1] / "web"


def create_notes_app(
    settings: MiracleSettings,
    context: MiracleContext,
    *,
    chat_backend: ContextualChatBackend | None = None,
    setup_service: OpenclawSetupService | None = None,
    voice_service: VoiceStreamingService | None = None,
    voice_orchestration_service: VoiceOrchestrationService | None = None,
) -> Starlette:
    assets = _asset_path()
    no_cache_headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    notes_service = NotesWorkspaceService(context)
    backend = chat_backend or ContextualChatBackend.from_settings(settings)
    onboarding = setup_service or OpenclawSetupService(settings, context)
    voice = voice_service or VoiceStreamingService.from_settings(settings)
    voice_orchestrator = voice_orchestration_service or VoiceOrchestrationService.from_settings(settings, context)
    product_llm_setup = ProductLLMSetupService(settings, context)

    async def index(_):
        return FileResponse(assets / "index.html", headers=no_cache_headers)

    async def app_css(_):
        return FileResponse(assets / "styles.css", headers=no_cache_headers)

    async def app_js(_):
        return FileResponse(assets / "app.js", headers=no_cache_headers)

    async def asset_file(request):
        requested = request.path_params.get("asset_path", "")
        target = (assets / requested).resolve()
        try:
            target.relative_to(assets.resolve())
        except ValueError:
            return PlainTextResponse("Asset not found", status_code=404, headers=no_cache_headers)
        if not target.is_file():
            return PlainTextResponse("Asset not found", status_code=404, headers=no_cache_headers)
        return FileResponse(target, headers=no_cache_headers)

    async def voice_index(_):
        return FileResponse(assets / "voice.html", headers=no_cache_headers)

    async def voice_css(_):
        return FileResponse(assets / "voice.css", headers=no_cache_headers)

    async def voice_js(_):
        return FileResponse(assets / "voice.js", headers=no_cache_headers)

    routes = [
        Route("/", endpoint=index),
        Route("/voice-lab", endpoint=voice_index),
        Route("/styles.css", endpoint=app_css),
        Route("/app.js", endpoint=app_js),
        Route("/assets/{asset_path:path}", endpoint=asset_file),
        Route("/voice.css", endpoint=voice_css),
        Route("/voice.js", endpoint=voice_js),
        *create_notes_routes(notes_service),
        *create_chat_routes(backend),
        *create_runtime_routes(context, backend, onboarding, voice_orchestrator, product_llm_setup),
        *create_voice_routes(voice),
        *create_voice_orchestration_routes(voice_orchestrator),
    ]
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_allow_origins),
            allow_methods=["GET", "POST", "PUT", "OPTIONS"],
            allow_headers=["*"],
        )
    ]
    return Starlette(debug=True, routes=routes, middleware=middleware)
