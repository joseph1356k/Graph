from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .integrations.product_llm.config import ProductLLMSettings


def _parse_custom_terms_env(raw: str) -> tuple[str, ...]:
    """Custom STT vocabulary env value: one term per line (commas also split)."""
    terms: list[str] = []
    for line in (raw or "").replace("\r", "\n").split("\n"):
        for chunk in line.split(","):
            term = chunk.strip()
            if term:
                terms.append(term)
    return tuple(terms)


@dataclass(frozen=True)
class MiracleSettings:
    workspace_root: Path
    product_llm: ProductLLMSettings = field(default_factory=ProductLLMSettings)
    deepgram_api_key: str | None = None
    soniox_api_key: str | None = None
    cors_allow_origins: tuple[str, ...] = field(default_factory=tuple)
    voice_stt_provider: str = "disabled"
    voice_transcription_model: str = "gpt-4o-mini-transcribe"
    voice_transcription_language: str = "es"
    voice_stream_timeslice_ms: int = 250
    deepgram_stream_endpointing_ms: int = 300
    deepgram_stream_token_ttl_seconds: int = 30
    soniox_stream_endpoint_delay_ms: int = 2000
    soniox_stream_token_ttl_seconds: int = 60
    # Medical specialization for Soniox (context/vocabulary). "general" | "medical".
    voice_stt_domain: str = "general"
    voice_stt_specialty: str = "general"
    voice_stt_custom_terms: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_env(cls, workspace_root: Path | None = None, *, override: bool = False) -> "MiracleSettings":
        root = (workspace_root or Path.cwd()).resolve()
        load_dotenv(root / ".env", override=override)
        deepgram_api_key = os.getenv("DEEPGRAM_API_KEY")
        soniox_api_key = os.getenv("SONIOX_API_KEY")
        default_cors_origins = (
            "https://graph-1-hap6.onrender.com",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        )
        raw_cors_origins = os.getenv("MIRACLE_CORS_ALLOW_ORIGINS", "").strip()
        cors_allow_origins = tuple(
            origin
            for origin in (
                item.strip()
                for item in raw_cors_origins.split(",")
            )
            if origin
        ) or default_cors_origins
        if deepgram_api_key:
            default_provider = "deepgram"
        elif soniox_api_key:
            default_provider = "soniox"
        else:
            default_provider = "disabled"
        voice_stt_provider = os.getenv("MIRACLE_STT_PROVIDER", default_provider).strip().lower()
        if voice_stt_provider == "deepgram":
            default_model = "nova-3"
        elif voice_stt_provider == "soniox":
            default_model = "stt-rt-v5"
        else:
            default_model = "gpt-4o-mini-transcribe"
        return cls(
            workspace_root=root,
            product_llm=ProductLLMSettings.from_env(),
            deepgram_api_key=deepgram_api_key,
            soniox_api_key=soniox_api_key,
            cors_allow_origins=cors_allow_origins,
            voice_stt_provider=voice_stt_provider,
            voice_transcription_model=os.getenv("MIRACLE_STT_MODEL", default_model).strip(),
            voice_transcription_language=os.getenv("MIRACLE_STT_LANGUAGE", "es").strip(),
            voice_stream_timeslice_ms=max(100, int(os.getenv("MIRACLE_AUDIO_STREAM_TIMESLICE_MS", "250"))),
            deepgram_stream_endpointing_ms=max(10, int(os.getenv("MIRACLE_DEEPGRAM_ENDPOINTING_MS", "300"))),
            deepgram_stream_token_ttl_seconds=max(
                1,
                min(3600, int(os.getenv("MIRACLE_DEEPGRAM_TOKEN_TTL_SECONDS", "30"))),
            ),
            soniox_stream_endpoint_delay_ms=max(
                500,
                min(3000, int(os.getenv("MIRACLE_SONIOX_ENDPOINT_DELAY_MS", "2000"))),
            ),
            soniox_stream_token_ttl_seconds=max(
                10,
                min(3600, int(os.getenv("MIRACLE_SONIOX_TOKEN_TTL_SECONDS", "60"))),
            ),
            voice_stt_domain=os.getenv("MIRACLE_STT_DOMAIN", "general").strip().lower() or "general",
            voice_stt_specialty=os.getenv("MIRACLE_STT_SPECIALTY", "general").strip().lower() or "general",
            voice_stt_custom_terms=_parse_custom_terms_env(os.getenv("MIRACLE_STT_CUSTOM_TERMS", "")),
        )
