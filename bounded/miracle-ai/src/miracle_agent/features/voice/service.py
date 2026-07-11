from __future__ import annotations

from typing import Protocol

from ...config import MiracleSettings
from ...integrations.deepgram.streaming import DeepgramStreamingAdapter
from ...integrations.soniox.streaming import SonioxStreamingAdapter
from .contracts import VoiceStreamSession


class VoiceStreamingProvider(Protocol):
    def create_stream_session(self) -> VoiceStreamSession:
        ...


class VoiceStreamingError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


class VoiceStreamingService:
    def __init__(
        self,
        settings: MiracleSettings,
        *,
        provider: VoiceStreamingProvider | None = None,
    ) -> None:
        self._settings = settings
        self._provider = provider

    @classmethod
    def from_settings(cls, settings: MiracleSettings) -> "VoiceStreamingService":
        provider: VoiceStreamingProvider | None = None
        if settings.voice_stt_provider == "deepgram":
            provider = DeepgramStreamingAdapter(settings)
        elif settings.voice_stt_provider == "soniox":
            provider = SonioxStreamingAdapter(settings)
        return cls(settings, provider=provider)

    def create_stream_session(self) -> VoiceStreamSession:
        if self._provider is None:
            raise VoiceStreamingError(self._missing_provider_message())
        try:
            return self._provider.create_stream_session()
        except RuntimeError as exc:
            raise VoiceStreamingError(str(exc), status_code=503) from exc

    def _missing_provider_message(self) -> str:
        if self._settings.voice_stt_provider == "deepgram":
            return "Deepgram streaming is not configured"
        if self._settings.voice_stt_provider == "soniox":
            return "Soniox streaming is not configured"
        if self._settings.voice_stt_provider == "disabled":
            return "Voice streaming is disabled"
        return f"Voice streaming provider '{self._settings.voice_stt_provider}' is not supported"
