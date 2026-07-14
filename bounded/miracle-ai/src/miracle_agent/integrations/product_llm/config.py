from __future__ import annotations

import os
from dataclasses import dataclass


def _env_str(name: str, default: str | None = None) -> str | None:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip()
    return value or default


@dataclass(frozen=True)
class ProductLLMSettings:
    provider: str = "heuristic"
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    timeout_seconds: float = 20.0
    max_output_tokens: int | None = 500
    scratchpad_heading: str = "Notas dictadas"
    execution_enabled: bool = False

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    @classmethod
    def from_env(cls) -> "ProductLLMSettings":
        base_url = _env_str("MIRACLE_PRODUCT_LLM_BASE_URL")
        api_key = _env_str("MIRACLE_PRODUCT_LLM_API_KEY")
        default_provider = "openai" if base_url and api_key else "heuristic"
        provider = (_env_str("MIRACLE_PRODUCT_LLM_PROVIDER", default_provider) or default_provider).lower()
        if provider not in {"heuristic", "openai", "google", "disabled"}:
            provider = "heuristic"
        if provider == "openai" and not base_url:
            base_url = "https://api.openai.com"
        if provider == "google" and not base_url:
            base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
        if provider == "openai":
            default_model = "gpt-4.1-mini"
        elif provider == "google":
            default_model = "gemini-3.5-flash"
        else:
            default_model = None

        raw_max_tokens = _env_str("MIRACLE_PRODUCT_LLM_MAX_OUTPUT_TOKENS", "500")
        max_output_tokens = int(raw_max_tokens) if raw_max_tokens is not None else None
        execution_enabled = (_env_str("MIRACLE_VOICE_AGENT_EXECUTION_ENABLED", "false") or "false").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        return cls(
            provider=provider,
            model=_env_str("MIRACLE_PRODUCT_LLM_MODEL", default_model),
            base_url=base_url.rstrip("/") if base_url else None,
            api_key=api_key,
            timeout_seconds=float(_env_str("MIRACLE_PRODUCT_LLM_TIMEOUT_SECONDS", "20.0") or "20.0"),
            max_output_tokens=max_output_tokens,
            scratchpad_heading=_env_str("MIRACLE_VOICE_SCRATCHPAD_HEADING", "Notas dictadas") or "Notas dictadas",
            execution_enabled=execution_enabled,
        )
