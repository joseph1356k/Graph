from __future__ import annotations

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from ..config import MiracleSettings
from ..context import MiracleContext
from ..features.notes.api import create_notes_routes
from ..features.notes.service import NotesWorkspaceService
from ..features.runtime.api import create_runtime_routes
from ..features.voice.api import create_voice_routes
from ..features.voice.service import VoiceStreamingService
from ..features.voice_orchestration.api import create_voice_orchestration_routes
from ..features.voice_orchestration.service import VoiceOrchestrationService
from ..integrations.product_llm.setup import ProductLLMSetupService


def create_notes_app(
    settings: MiracleSettings,
    context: MiracleContext,
    *,
    voice_service: VoiceStreamingService | None = None,
    voice_orchestration_service: VoiceOrchestrationService | None = None,
) -> Starlette:
    notes_service = NotesWorkspaceService(context)
    voice = voice_service or VoiceStreamingService.from_settings(settings)
    voice_orchestrator = voice_orchestration_service or VoiceOrchestrationService.from_settings(settings, context)
    product_llm_setup = ProductLLMSetupService(settings, context)

    routes = [
        *create_notes_routes(notes_service),
        *create_runtime_routes(context, voice_orchestrator, product_llm_setup),
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
