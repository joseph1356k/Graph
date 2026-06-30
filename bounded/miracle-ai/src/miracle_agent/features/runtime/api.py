from __future__ import annotations

import json

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ...config import MiracleSettings
from ...context import MiracleContext
from ...features.chat.service import ContextualChatBackend
from ...features.voice_orchestration.service import VoiceOrchestrationService
from ...integrations.product_llm.setup import (
    ProductLLMSetupError,
    ProductLLMSetupPayload,
    ProductLLMSetupService,
)
from ...integrations.openclaw.setup import OpenclawSetupService, SetupPayload, SetupProvisioningError


def create_runtime_routes(
    context: MiracleContext,
    backend: ContextualChatBackend,
    onboarding: OpenclawSetupService,
    voice_orchestrator: VoiceOrchestrationService,
    product_llm_setup: ProductLLMSetupService,
) -> list[Route]:
    async def openclaw_boundary(_: Request):
        return JSONResponse(backend.status())

    async def openclaw_status(_: Request):
        return JSONResponse(backend.status())

    async def nemoclaw_status(_: Request):
        return JSONResponse(backend.status())

    async def setup_status(_: Request):
        return JSONResponse(onboarding.status(backend.status()))

    async def setup_openclaw(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        try:
            result = await run_in_threadpool(
                onboarding.provision,
                SetupPayload(
                    provider=str(payload.get("provider", "")).strip(),
                    api_key=str(payload.get("api_key", "")),
                    base_url=str(payload.get("base_url", "")).strip() or None,
                    model=str(payload.get("model", "")).strip() or None,
                ),
            )
            refreshed = MiracleSettings.from_env(context.workspace_root, override=True)
            backend.apply_settings(refreshed)
            voice_orchestrator.apply_settings(refreshed)
            product_llm_setup.apply_settings(refreshed)
        except SetupProvisioningError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(
            {
                **result,
                "setup": onboarding.status(backend.status()),
            }
        )

    async def product_llm_status(_: Request):
        return JSONResponse(product_llm_setup.status())

    async def setup_product_llm(request: Request):
        payload = json.loads((await request.body()) or b"{}")
        try:
            result = await run_in_threadpool(
                product_llm_setup.provision,
                ProductLLMSetupPayload(
                    provider=str(payload.get("provider", "")).strip(),
                    api_key=str(payload.get("api_key", "")),
                    base_url=str(payload.get("base_url", "")).strip() or None,
                    model=str(payload.get("model", "")).strip() or None,
                ),
            )
            refreshed = MiracleSettings.from_env(context.workspace_root, override=True)
            voice_orchestrator.apply_settings(refreshed)
            product_llm_setup.apply_settings(refreshed)
        except ProductLLMSetupError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
        return JSONResponse(
            {
                **result,
                "setup": product_llm_setup.status(),
            }
        )

    return [
        Route("/api/setup/status", endpoint=setup_status, methods=["GET"]),
        Route("/api/setup/openclaw", endpoint=setup_openclaw, methods=["POST"]),
        Route("/api/product-llm/status", endpoint=product_llm_status, methods=["GET"]),
        Route("/api/setup/product-llm", endpoint=setup_product_llm, methods=["POST"]),
        Route("/api/openclaw/boundary", endpoint=openclaw_boundary, methods=["GET"]),
        Route("/api/openclaw/status", endpoint=openclaw_status, methods=["GET"]),
        Route("/api/nemoclaw/status", endpoint=nemoclaw_status, methods=["GET"]),
    ]
