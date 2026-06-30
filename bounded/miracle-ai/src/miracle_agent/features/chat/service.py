from __future__ import annotations

from ...config import MiracleSettings
from ...integrations.openclaw.chat_adapter import OpenclawChatAdapter, OpenclawProtocolError
from ...integrations.openclaw.client import OpenclawClientError, OpenclawGatewayClient
from .contracts import ChatBackendResponse


class ChatBackendError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ContextualChatBackend:
    def __init__(
        self,
        settings: MiracleSettings,
        *,
        adapter: OpenclawChatAdapter | None = None,
    ) -> None:
        self._settings = settings
        self._adapter = adapter

    @classmethod
    def from_settings(
        cls,
        settings: MiracleSettings,
        *,
        gateway_client: OpenclawGatewayClient | None = None,
    ) -> "ContextualChatBackend":
        adapter: OpenclawChatAdapter | None = None
        if settings.openclaw.is_configured:
            client = gateway_client or OpenclawGatewayClient(settings.openclaw)
            adapter = OpenclawChatAdapter(client, settings.openclaw)
        return cls(settings, adapter=adapter)

    def apply_settings(
        self,
        settings: MiracleSettings,
        *,
        gateway_client: OpenclawGatewayClient | None = None,
    ) -> None:
        self._settings = settings
        self._adapter = None
        if settings.openclaw.is_configured:
            client = gateway_client or OpenclawGatewayClient(settings.openclaw)
            self._adapter = OpenclawChatAdapter(client, settings.openclaw)

    def status(self) -> dict[str, object]:
        if self._settings.openclaw.enabled and not self._settings.openclaw.is_configured:
            status = "misconfigured"
        elif self._settings.openclaw.enabled and self._adapter is not None:
            status = "configured"
        else:
            status = "not-configured"
        return {
            "status": status,
            "enabled": self._settings.openclaw.enabled,
            "configured": self._settings.openclaw.is_configured,
            "mode": "upstream-adapter" if self._adapter is not None else "boundary-only",
            "runtime": self._settings.openclaw.runtime,
            "runtime_label": self._settings.openclaw.runtime_label,
            "agent_id": self._settings.openclaw.agent_id,
            "security_posture": self._settings.openclaw.security_posture(),
            "expected_adapters": [
                "OpenclawGatewayClient",
                "OpenclawChatAdapter",
                "OpenclawAgentAdapter",
                "OpenclawEventsAdapter",
                "OpenclawCapabilityRegistry",
            ],
        }

    def chat(
        self,
        *,
        message: str,
        context_packet: dict[str, object] | None = None,
        conversation_id: str | None = None,
    ) -> ChatBackendResponse:
        if self._settings.openclaw.enabled:
            if self._adapter is None:
                raise ChatBackendError(
                    f"{self._settings.openclaw.runtime_label} está habilitado pero falta la base URL del gateway upstream.",
                    status_code=503,
                )
            try:
                response = self._adapter.chat(
                    message=message,
                    previous_response_id=conversation_id,
                    context_packet=context_packet,
                )
            except OpenclawClientError as exc:
                raise ChatBackendError(str(exc), status_code=exc.status_code) from exc
            except OpenclawProtocolError as exc:
                raise ChatBackendError(str(exc), status_code=502) from exc
            return ChatBackendResponse(
                reply=response.reply,
                conversation_id=response.response_id,
                backend_status=self._settings.openclaw.runtime,
            )
        return self._fallback_response(message=message, context_packet=context_packet, conversation_id=conversation_id)

    def _fallback_response(
        self,
        *,
        message: str,
        context_packet: dict[str, object] | None,
        conversation_id: str | None,
    ) -> ChatBackendResponse:
        active_block = context_packet.get("active_block") if isinstance(context_packet, dict) else None
        heading_path = []
        if isinstance(active_block, dict):
            heading_path = [str(item) for item in active_block.get("heading_path", []) if item]

        scope = " > ".join(heading_path) if heading_path else "sin bloque contextual detectado"
        reply = (
            f"El chat contextual sigue disponible en Miracle, pero {self._settings.openclaw.runtime_label} no está configurado todavía. "
            f"Mensaje recibido para el bloque {scope}: {message}\n\n"
            "Configura la base URL del gateway upstream para enrutar `/api/chat` sin tocar la UX del editor."
        )
        return ChatBackendResponse(reply=reply, conversation_id=conversation_id)

