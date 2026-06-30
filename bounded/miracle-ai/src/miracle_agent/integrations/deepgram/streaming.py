from __future__ import annotations

import json
from urllib.error import HTTPError
from urllib import parse, request

from ...config import MiracleSettings
from ...features.voice.contracts import VoiceStreamSession


class DeepgramStreamingAdapter:
    def __init__(self, settings: MiracleSettings) -> None:
        self._settings = settings

    def create_stream_session(self) -> VoiceStreamSession:
        if not self._settings.deepgram_api_key:
            raise RuntimeError("Deepgram streaming is not configured. Set DEEPGRAM_API_KEY first.")

        model = _select_deepgram_model(self._settings)
        access_token, expires_in = _issue_deepgram_token(
            api_key=self._settings.deepgram_api_key,
            ttl_seconds=self._settings.deepgram_stream_token_ttl_seconds,
        )
        return VoiceStreamSession(
            provider="deepgram",
            access_token=access_token,
            auth_scheme="bearer",
            expires_in=expires_in,
            websocket_url=_build_deepgram_websocket_url(self._settings, model=model),
            model=model,
            language=self._settings.voice_transcription_language,
            timeslice_ms=self._settings.voice_stream_timeslice_ms,
            endpointing_ms=self._settings.deepgram_stream_endpointing_ms,
        )


def _issue_deepgram_token(*, api_key: str, ttl_seconds: int) -> tuple[str, int]:
    payload = json.dumps({"ttl_seconds": ttl_seconds}).encode("utf-8")
    req = request.Request(
        "https://api.deepgram.com/v1/auth/grant",
        data=payload,
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        message = _deepgram_http_error_message(exc)
        raise RuntimeError(message) from exc
    except Exception as exc:  # pragma: no cover - depends on network/provider availability
        raise RuntimeError(f"Unable to create Deepgram streaming token: {exc}") from exc

    access_token = body.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise RuntimeError("Deepgram auth response did not include an access_token")
    expires_in = body.get("expires_in", ttl_seconds)
    try:
        normalized_expires = int(expires_in)
    except (TypeError, ValueError):
        normalized_expires = ttl_seconds
    return access_token, normalized_expires


def _deepgram_http_error_message(exc: HTTPError) -> str:
    raw_body = exc.read().decode("utf-8", errors="replace")
    error_payload: dict[str, object] | None = None
    try:
        decoded = json.loads(raw_body)
        if isinstance(decoded, dict):
            error_payload = decoded
    except json.JSONDecodeError:
        error_payload = None

    if exc.code == 403:
        return (
            "Deepgram rechazo la creacion del token temporal (403). "
            "La API key necesita permisos Member o superiores para usar /v1/auth/grant."
        )
    if exc.code == 401:
        return "Deepgram rechazo la API key (401). Verifica que DEEPGRAM_API_KEY sea valida."

    detail = None
    if error_payload:
        err_msg = error_payload.get("err_msg")
        if isinstance(err_msg, str) and err_msg.strip():
            detail = err_msg.strip()

    if detail:
        return f"Deepgram devolvio HTTP {exc.code}: {detail}"
    return f"Deepgram devolvio HTTP {exc.code} al crear el token temporal."


def _build_deepgram_websocket_url(settings: MiracleSettings, *, model: str | None = None) -> str:
    params = {
        "model": model or _select_deepgram_model(settings),
        "language": settings.voice_transcription_language,
        "interim_results": "true",
        "endpointing": str(settings.deepgram_stream_endpointing_ms),
        "punctuate": "true",
        "smart_format": "true",
    }
    return f"wss://api.deepgram.com/v1/listen?{parse.urlencode(params)}"


def _select_deepgram_model(settings: MiracleSettings) -> str:
    model = settings.voice_transcription_model.strip()
    if model.startswith("nova") or model.startswith("flux"):
        return model
    return "nova-3"
