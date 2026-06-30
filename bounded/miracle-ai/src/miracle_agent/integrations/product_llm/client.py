from __future__ import annotations

import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import ProductLLMSettings


class ProductLLMClientError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenAICompatibleProductLLMClient:
    def __init__(self, settings: ProductLLMSettings) -> None:
        self._settings = settings

    def call_responses_api(self, payload: dict[str, object]) -> dict[str, object]:
        if not self._settings.base_url:
            raise ProductLLMClientError("Miracle product LLM no tiene base URL configurada.", status_code=503)
        request = Request(
            f"{self._settings.base_url.rstrip('/')}/v1/responses",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )

        try:
            with urlopen(request, timeout=self._settings.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            raise ProductLLMClientError(self._error_message(exc.read().decode("utf-8")), status_code=exc.code) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ProductLLMClientError("Miracle product LLM tardó demasiado en responder.", status_code=504) from exc
        except URLError as exc:
            raise ProductLLMClientError(f"No se pudo conectar con Miracle product LLM: {exc.reason}") from exc

        try:
            decoded = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ProductLLMClientError("Miracle product LLM devolvió una respuesta JSON inválida.") from exc
        if not isinstance(decoded, dict):
            raise ProductLLMClientError("Miracle product LLM devolvió un payload inesperado.")
        return decoded

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._settings.api_key:
            headers["Authorization"] = f"Bearer {self._settings.api_key}"
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
        return "El product LLM rechazó la solicitud."
