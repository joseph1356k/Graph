from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib import request

from ...config import MiracleSettings
from ...features.voice.contracts import VoiceStreamSession

SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SONIOX_TEMPORARY_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key"
DEFAULT_SONIOX_MODEL = "stt-rt-v5"


class SonioxStreamingAdapter:
    def __init__(self, settings: MiracleSettings) -> None:
        self._settings = settings

    def create_stream_session(self) -> VoiceStreamSession:
        if not self._settings.soniox_api_key:
            raise RuntimeError("Soniox streaming is not configured. Set SONIOX_API_KEY first.")

        model = _select_soniox_model(self._settings)
        temporary_key, expires_in = _issue_soniox_temporary_key(
            api_key=self._settings.soniox_api_key,
            ttl_seconds=self._settings.soniox_stream_token_ttl_seconds,
        )
        language = self._settings.voice_transcription_language
        start_message = _build_soniox_start_message(
            self._settings,
            api_key=temporary_key,
            model=model,
            language=language,
        )
        return VoiceStreamSession(
            provider="soniox",
            access_token=temporary_key,
            # Soniox authenticates via the first JSON config frame, not a WebSocket
            # subprotocol/header, so the browser opens a plain socket and sends
            # `start_message`. `auth_scheme="message"` flags that path for the client.
            auth_scheme="message",
            expires_in=expires_in,
            websocket_url=SONIOX_WEBSOCKET_URL,
            model=model,
            language=language,
            timeslice_ms=self._settings.voice_stream_timeslice_ms,
            endpointing_ms=self._settings.soniox_stream_endpoint_delay_ms,
            start_message=start_message,
        )


def _issue_soniox_temporary_key(*, api_key: str, ttl_seconds: int) -> tuple[str, int]:
    payload = json.dumps(
        {
            "usage_type": "transcribe_websocket",
            "expires_in_seconds": ttl_seconds,
        }
    ).encode("utf-8")
    req = request.Request(
        SONIOX_TEMPORARY_KEY_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        message = _soniox_http_error_message(exc)
        raise RuntimeError(message) from exc
    except Exception as exc:  # pragma: no cover - depends on network/provider availability
        raise RuntimeError(f"Unable to create Soniox streaming token: {exc}") from exc

    temporary_key = body.get("api_key")
    if not isinstance(temporary_key, str) or not temporary_key.strip():
        raise RuntimeError("Soniox auth response did not include an api_key")
    return temporary_key, ttl_seconds


def _soniox_http_error_message(exc: HTTPError) -> str:
    raw_body = exc.read().decode("utf-8", errors="replace")
    error_payload: dict[str, object] | None = None
    try:
        decoded = json.loads(raw_body)
        if isinstance(decoded, dict):
            error_payload = decoded
    except json.JSONDecodeError:
        error_payload = None

    if exc.code == 401:
        return "Soniox rechazo la API key (401). Verifica que SONIOX_API_KEY sea valida."
    if exc.code == 403:
        return (
            "Soniox rechazo la creacion de la clave temporal (403). "
            "La API key necesita permisos para usar /v1/auth/temporary-api-key."
        )

    detail = None
    if error_payload:
        for key in ("message", "error", "error_message"):
            value = error_payload.get(key)
            if isinstance(value, str) and value.strip():
                detail = value.strip()
                break

    if detail:
        return f"Soniox devolvio HTTP {exc.code}: {detail}"
    return f"Soniox devolvio HTTP {exc.code} al crear la clave temporal."


def _build_soniox_start_message(
    settings: MiracleSettings,
    *,
    api_key: str,
    model: str,
    language: str,
) -> dict[str, object]:
    message: dict[str, object] = {
        "api_key": api_key,
        "model": model,
        # "auto" lets Soniox detect the container the browser MediaRecorder
        # produces (webm/opus), matching the Deepgram flow's raw audio frames.
        "audio_format": "auto",
        "enable_endpoint_detection": True,
        "max_endpoint_delay_ms": settings.soniox_stream_endpoint_delay_ms,
    }
    normalized_language = (language or "").strip()
    if normalized_language:
        message["language_hints"] = [normalized_language]
    return message


def _select_soniox_model(settings: MiracleSettings) -> str:
    model = settings.voice_transcription_model.strip()
    if model.startswith("stt-rt"):
        return model
    return DEFAULT_SONIOX_MODEL
