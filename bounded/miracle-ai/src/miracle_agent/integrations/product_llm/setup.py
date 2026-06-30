from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ...config import MiracleSettings
from ...context import MiracleContext


@dataclass(frozen=True)
class ProductLLMProviderSpec:
    id: str
    label: str
    description: str
    requires_api_key: bool = True
    requires_base_url: bool = False
    requires_model: bool = False
    default_base_url: str | None = None
    default_model: str | None = None
    recommended: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "requires_api_key": self.requires_api_key,
            "requires_base_url": self.requires_base_url,
            "requires_model": self.requires_model,
            "default_base_url": self.default_base_url,
            "default_model": self.default_model,
            "recommended": self.recommended,
        }


PRODUCT_LLM_PROVIDERS: dict[str, ProductLLMProviderSpec] = {
    "openai": ProductLLMProviderSpec(
        id="openai",
        label="OpenAI Responses API",
        description="LLM propio de Miracle para estructurar notas y planear acciones.",
        requires_api_key=True,
        requires_base_url=False,
        requires_model=True,
        default_base_url="https://api.openai.com",
        default_model="gpt-4.1-mini",
        recommended=True,
    ),
    "disabled": ProductLLMProviderSpec(
        id="disabled",
        label="Deshabilitado",
        description="Apaga el product LLM y deja solo el fallback heurístico.",
        requires_api_key=False,
        requires_base_url=False,
        requires_model=False,
    ),
}


class ProductLLMSetupError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ProductLLMSetupPayload:
    provider: str
    api_key: str
    base_url: str | None = None
    model: str | None = None


class ProductLLMSetupService:
    def __init__(self, settings: MiracleSettings, context: MiracleContext, *, workspace_env_path: Path | None = None) -> None:
        self._settings = settings
        self._context = context
        self._workspace_env_path = workspace_env_path or (context.workspace_root / ".env")

    def status(self) -> dict[str, object]:
        current = None
        if self._settings.product_llm.provider != "heuristic" or self._settings.product_llm.is_configured:
            current = {
                "provider": self._settings.product_llm.provider,
                "label": PRODUCT_LLM_PROVIDERS.get(self._settings.product_llm.provider, PRODUCT_LLM_PROVIDERS["disabled"]).label,
                "base_url": self._settings.product_llm.base_url,
                "model": self._settings.product_llm.model,
                "configured": self._settings.product_llm.is_configured,
            }
        return {
            "providers": [spec.to_dict() for spec in PRODUCT_LLM_PROVIDERS.values()],
            "recommended_provider": next((spec.id for spec in PRODUCT_LLM_PROVIDERS.values() if spec.recommended), None),
            "current_setup": current,
            "status": {
                "provider": self._settings.product_llm.provider,
                "configured": self._settings.product_llm.is_configured,
                "model": self._settings.product_llm.model,
                "base_url": self._settings.product_llm.base_url,
                "execution_enabled": self._settings.product_llm.execution_enabled,
            },
        }

    def apply_settings(self, settings: MiracleSettings) -> None:
        self._settings = settings

    def provision(self, payload: ProductLLMSetupPayload) -> dict[str, object]:
        spec = PRODUCT_LLM_PROVIDERS.get(payload.provider)
        if spec is None:
            raise ProductLLMSetupError("Product LLM provider no soportado.")
        if spec.requires_api_key and not payload.api_key.strip():
            raise ProductLLMSetupError("La API key del product LLM es obligatoria.")
        if spec.requires_model and not (payload.model or spec.default_model):
            raise ProductLLMSetupError("El modelo del product LLM es obligatorio.")

        updates = {
            "MIRACLE_PRODUCT_LLM_PROVIDER": spec.id,
            "MIRACLE_PRODUCT_LLM_MODEL": (payload.model or spec.default_model or "").strip(),
            "MIRACLE_PRODUCT_LLM_BASE_URL": (payload.base_url or spec.default_base_url or "").strip(),
            "MIRACLE_PRODUCT_LLM_API_KEY": payload.api_key.strip(),
        }
        self._update_env_file(self._workspace_env_path, updates)
        return {
            "ok": True,
            "provider": spec.id,
            "summary": {
                "provider": spec.id,
                "model": updates["MIRACLE_PRODUCT_LLM_MODEL"] or None,
                "base_url": updates["MIRACLE_PRODUCT_LLM_BASE_URL"] or None,
            },
        }

    @staticmethod
    def _update_env_file(path: Path, updates: dict[str, str]) -> None:
        lines: list[str] = []
        if path.exists():
            lines = path.read_text(encoding="utf-8").splitlines()
        existing = {
            line.split("=", 1)[0].strip(): index
            for index, line in enumerate(lines)
            if "=" in line and not line.strip().startswith("#")
        }
        for key, value in updates.items():
            rendered = f"{key}={json.dumps(value)}"
            if key in existing:
                lines[existing[key]] = rendered
            else:
                lines.append(rendered)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
