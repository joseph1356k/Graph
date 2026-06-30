from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

RuntimeKind = str


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str | None = None) -> str | None:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip()
    return value or default


def _first_env(names: list[str], default: str | None = None) -> str | None:
    for name in names:
        value = _env_str(name)
        if value is not None:
            return value
    return default


def _first_env_bool(names: list[str], default: bool = False) -> bool:
    for name in names:
        raw = os.getenv(name)
        if raw is not None:
            return _env_bool(name, default)
    return default


def _is_local_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    host = parsed.hostname or ""
    return host in {"127.0.0.1", "localhost", "::1"}


def _url_scheme(value: str | None) -> str | None:
    if not value:
        return None
    return urlparse(value).scheme or None


@dataclass(frozen=True)
class OpenclawSettings:
    enabled: bool
    runtime: RuntimeKind = "openclaw"
    base_url: str | None = None
    auth_token: str | None = None
    agent_id: str = "main"
    model: str | None = None
    backend_model: str | None = None
    timeout_seconds: float = 30.0
    max_output_tokens: int | None = 700
    chat_ui_url: str | None = None
    alpha_runtime: bool = False

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url)

    @property
    def runtime_label(self) -> str:
        return "NemoClaw" if self.runtime == "nemoclaw" else "OpenClaw"

    @property
    def responses_url(self) -> str | None:
        if not self.base_url:
            return None
        return f"{self.base_url.rstrip('/')}/v1/responses"

    @property
    def base_url_scheme(self) -> str | None:
        return _url_scheme(self.base_url)

    @property
    def chat_ui_scheme(self) -> str | None:
        return _url_scheme(self.chat_ui_url)

    @property
    def is_local_base_url(self) -> bool:
        return _is_local_url(self.base_url)

    def security_posture(self) -> dict[str, object]:
        warnings: list[str] = []
        notes: list[str] = []

        if self.runtime == "nemoclaw":
            notes.append("NemoClaw agrega controles de infraestructura; la seguridad de aplicación sigue en OpenClaw.")
            if self.alpha_runtime:
                warnings.append("NemoClaw sigue en alpha; úsalo con rollout controlado y no como producción estable por defecto.")
            if self.base_url:
                if self.base_url_scheme == "https":
                    notes.append("El gateway upstream usa HTTPS.")
                elif self.is_local_base_url and self.base_url_scheme == "http":
                    notes.append("Gateway upstream en HTTP local; aceptable para desarrollo local.")
                else:
                    warnings.append("Usa HTTPS para el gateway de NemoClaw fuera de localhost.")
            if self.chat_ui_url:
                if self.chat_ui_scheme == "https":
                    notes.append("CHAT_UI_URL usa HTTPS, alineado con autenticación segura fuera de localhost.")
                elif not _is_local_url(self.chat_ui_url):
                    warnings.append("NEMOCLAW_CHAT_UI_URL debería usar HTTPS fuera de localhost.")
            else:
                notes.append("No se configuró CHAT_UI_URL; valida device auth y rutas operador en el despliegue real.")
        else:
            if self.base_url:
                if self.base_url_scheme == "https":
                    notes.append("OpenClaw gateway usa HTTPS.")
                elif self.is_local_base_url and self.base_url_scheme == "http":
                    notes.append("OpenClaw gateway en HTTP local para desarrollo.")
                else:
                    warnings.append("Usa HTTPS para OpenClaw fuera de localhost.")

        return {
            "runtime": self.runtime,
            "runtime_label": self.runtime_label,
            "base_url_scheme": self.base_url_scheme,
            "base_url_is_local": self.is_local_base_url,
            "chat_ui_url": self.chat_ui_url,
            "chat_ui_scheme": self.chat_ui_scheme,
            "warnings": warnings,
            "notes": notes,
        }

    @classmethod
    def from_env(cls) -> "OpenclawSettings":
        runtime = (_first_env(["MIRACLE_UPSTREAM_RUNTIME", "MIRACLE_AGENT_RUNTIME"], "openclaw") or "openclaw").lower()
        if runtime not in {"openclaw", "nemoclaw"}:
            runtime = "openclaw"

        if runtime == "nemoclaw":
            base_url = _first_env(["NEMOCLAW_BASE_URL", "OPENCLAW_BASE_URL"])
            enabled = _first_env_bool(["NEMOCLAW_ENABLED", "OPENCLAW_ENABLED"], default=bool(base_url))
            auth_token = _first_env(["NEMOCLAW_AUTH_TOKEN", "OPENCLAW_AUTH_TOKEN", "OPENCLAW_GATEWAY_TOKEN"])
            agent_id = _first_env(["NEMOCLAW_AGENT_ID", "OPENCLAW_AGENT_ID"], "main") or "main"
            backend_model = _first_env(["NEMOCLAW_BACKEND_MODEL", "OPENCLAW_BACKEND_MODEL"])
            chat_ui_url = _first_env(["NEMOCLAW_CHAT_UI_URL"])
        else:
            base_url = _first_env(["OPENCLAW_BASE_URL", "NEMOCLAW_BASE_URL"])
            enabled = _first_env_bool(["OPENCLAW_ENABLED", "NEMOCLAW_ENABLED"], default=bool(base_url))
            auth_token = _first_env(["OPENCLAW_AUTH_TOKEN", "OPENCLAW_GATEWAY_TOKEN", "NEMOCLAW_AUTH_TOKEN"])
            agent_id = _first_env(["OPENCLAW_AGENT_ID", "NEMOCLAW_AGENT_ID"], "main") or "main"
            backend_model = _first_env(["OPENCLAW_BACKEND_MODEL", "NEMOCLAW_BACKEND_MODEL"])
            chat_ui_url = _first_env(["NEMOCLAW_CHAT_UI_URL"])

        max_output_tokens = _first_env(["NEMOCLAW_MAX_OUTPUT_TOKENS", "OPENCLAW_MAX_OUTPUT_TOKENS"], "700")
        return cls(
            enabled=enabled,
            runtime=runtime,
            base_url=base_url.rstrip("/") if base_url else None,
            auth_token=auth_token,
            agent_id=agent_id,
            model=_first_env(["OPENCLAW_MODEL", "NEMOCLAW_MODEL"]),
            backend_model=backend_model,
            timeout_seconds=float(_first_env(["NEMOCLAW_TIMEOUT_SECONDS", "OPENCLAW_TIMEOUT_SECONDS"], "30.0") or "30.0"),
            max_output_tokens=int(max_output_tokens) if max_output_tokens is not None else None,
            chat_ui_url=chat_ui_url.rstrip("/") if chat_ui_url else None,
            alpha_runtime=runtime == "nemoclaw",
        )
