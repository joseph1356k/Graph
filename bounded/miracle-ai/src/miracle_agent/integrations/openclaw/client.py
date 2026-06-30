from __future__ import annotations

import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import OpenclawSettings


class OpenclawClientError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenclawGatewayClient:
    def __init__(self, settings: OpenclawSettings) -> None:
        self._settings = settings

    def call_response_api(self, payload: dict[str, object]) -> dict[str, object]:
        if not self._settings.responses_url:
            raise OpenclawClientError(
                f"{self._settings.runtime_label} no está configurado con una base URL upstream.",
                status_code=503,
            )

        request = Request(
            self._settings.responses_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )

        try:
            with urlopen(request, timeout=self._settings.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            raise OpenclawClientError(self._error_message(exc.read().decode("utf-8")), status_code=exc.code) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise OpenclawClientError(
                f"{self._settings.runtime_label} tardó demasiado en responder.",
                status_code=504,
            ) from exc
        except URLError as exc:
            raise OpenclawClientError(f"No se pudo conectar con {self._settings.runtime_label}: {exc.reason}") from exc

        try:
            decoded = json.loads(body)
        except json.JSONDecodeError as exc:
            raise OpenclawClientError(f"{self._settings.runtime_label} devolvió una respuesta JSON inválida.") from exc

        if not isinstance(decoded, dict):
            raise OpenclawClientError(f"{self._settings.runtime_label} devolvió un payload inesperado.")
        return decoded

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.auth_token:
            headers["Authorization"] = f"Bearer {self._settings.auth_token}"
        if self._settings.agent_id:
            headers["x-openclaw-agent-id"] = self._settings.agent_id
        if self._settings.backend_model:
            headers["x-openclaw-model"] = self._settings.backend_model
        return headers

    @staticmethod
    def _error_message(body: str) -> str:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                message = error.get("message")
                if isinstance(message, str) and message.strip():
                    return message
        return "El runtime upstream rechazó la solicitud."
