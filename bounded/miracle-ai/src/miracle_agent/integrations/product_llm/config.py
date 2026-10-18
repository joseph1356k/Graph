from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Modelos de OpenAI que razonan (gpt-5…, gpt-5.6-luna, gpt-6…, o1, o3…): misma
# regla que LLMProvider.usesCompletionTokens en Graph. Su razonamiento cuenta
# dentro de max_output_tokens, y `reasoning` lo rechazan los que no razonan.
_REASONING_MODEL = re.compile(r"^(?:openai/)?(?:gpt-(?:[5-9]|\d{2,})(?:[.-]|$)|o\d)", re.IGNORECASE)
REASONING_EFFORTS = ("minimal", "low", "medium", "high")
# Con 2 000 tokens el razonamiento se come la salida y el JSON llega cortado.
REASONING_OUTPUT_FLOOR = 8000


def is_reasoning_model(model: str | None) -> bool:
    return bool(_REASONING_MODEL.match((model or "").strip()))


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
    # 500 cortaba el bloque consolidado de una consulta media y el JSON estricto
    # llegaba truncado (ProductLLMAdapterError, sin degradar).
    max_output_tokens: int | None = 2000
    scratchpad_heading: str = "Notas dictadas"
    execution_enabled: bool = False
    # Solo se manda a un modelo que razona. «low» y no el «medium» de OpenAI:
    # en las notas de Graph rindió igual y en menos tiempo (spec 026).
    reasoning_effort: str = "low"

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

        raw_max_tokens = _env_str("MIRACLE_PRODUCT_LLM_MAX_OUTPUT_TOKENS", "2000")
        max_output_tokens = int(raw_max_tokens) if raw_max_tokens is not None else None
        execution_enabled = (_env_str("MIRACLE_VOICE_AGENT_EXECUTION_ENABLED", "false") or "false").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        model = _env_str("MIRACLE_PRODUCT_LLM_MODEL", default_model)
        effort = (_env_str("MIRACLE_PRODUCT_LLM_REASONING_EFFORT", "low") or "low").lower()
        # Un modelo que razona tarda más: 40 s en vez de 20 antes de caer al
        # modo heurístico (la función tiene 60 s en vercel.json).
        default_timeout = "40.0" if is_reasoning_model(model) else "20.0"
        return cls(
            provider=provider,
            model=model,
            base_url=base_url.rstrip("/") if base_url else None,
            api_key=api_key,
            timeout_seconds=float(_env_str("MIRACLE_PRODUCT_LLM_TIMEOUT_SECONDS", default_timeout) or default_timeout),
            reasoning_effort=effort if effort in REASONING_EFFORTS else "low",
            max_output_tokens=max_output_tokens,
            scratchpad_heading=_env_str("MIRACLE_VOICE_SCRATCHPAD_HEADING", "Notas dictadas") or "Notas dictadas",
            execution_enabled=execution_enabled,
        )
