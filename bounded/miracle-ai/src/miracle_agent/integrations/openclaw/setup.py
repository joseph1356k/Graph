from __future__ import annotations

import json
import os
import secrets
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ...config import MiracleSettings
from ...context import MiracleContext


class SetupProvisioningError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    description: str
    auth_choice: str
    env_var: str
    requires_api_key: bool = True
    requires_base_url: bool = False
    requires_model: bool = False
    compatibility: str | None = None
    requires_accept_risk: bool = False
    recommended: bool = False
    supports_model_override: bool = False
    default_model: str | None = None
    default_api_key: str | None = None
    default_base_url: str | None = None
    model_options: tuple[tuple[str, str], ...] = ()
    temporary: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "requires_api_key": self.requires_api_key,
            "requires_base_url": self.requires_base_url,
            "requires_model": self.requires_model,
            "recommended": self.recommended,
            "supports_model_override": self.supports_model_override,
            "default_model": self.default_model,
            "temporary": self.temporary,
            "model_options": [{"value": value, "label": label} for value, label in self.model_options],
        }


PROVIDERS: dict[str, ProviderSpec] = {
    "openrouter": ProviderSpec(
        id="openrouter",
        label="OpenRouter",
        description="Más simple para arrancar con una sola API key y catálogo grande de modelos.",
        auth_choice="openrouter-api-key",
        env_var="OPENROUTER_API_KEY",
        recommended=True,
        supports_model_override=True,
        default_model="openrouter/auto",
        model_options=(
            ("openrouter/auto", "OpenRouter Auto"),
            ("openrouter/nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (free)"),
        ),
    ),
    "anthropic": ProviderSpec(
        id="anthropic",
        label="Anthropic",
        description="Conecta OpenClaw directo a Anthropic para usar Claude Sonnet u Opus con tu API key.",
        auth_choice="anthropic-api-key",
        env_var="ANTHROPIC_API_KEY",
        supports_model_override=True,
        default_model="anthropic/claude-sonnet-4-6",
        model_options=(
            ("anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6"),
            ("anthropic/claude-opus-4-6", "Claude Opus 4.6"),
        ),
    ),
    "openai": ProviderSpec(
        id="openai",
        label="OpenAI",
        description="Conecta OpenClaw directo a OpenAI con una API key estándar.",
        auth_choice="openai-api-key",
        env_var="OPENAI_API_KEY",
    ),
    "gemma4-local": ProviderSpec(
        id="gemma4-local",
        label="Gemma 4 E4B (local temporal)",
        description="Usa Ollama local y aislado como endpoint OpenAI-compatible para un experimento temporal fuera del core.",
        auth_choice="custom-api-key",
        env_var="CUSTOM_API_KEY",
        requires_api_key=False,
        compatibility="openai",
        requires_accept_risk=True,
        default_model="gemma4:e4b",
        default_api_key="ollama",
        default_base_url="http://127.0.0.1:11434/v1",
        temporary=True,
    ),
    "custom-openai": ProviderSpec(
        id="custom-openai",
        label="Custom OpenAI-Compatible",
        description="Usa un endpoint compatible con OpenAI propio o de terceros.",
        auth_choice="custom-api-key",
        env_var="CUSTOM_API_KEY",
        requires_base_url=True,
        requires_model=True,
        compatibility="openai",
        requires_accept_risk=True,
    ),
}


def _quote_env_value(value: str) -> str:
    return json.dumps(value)


def _parse_env_file(path: Path) -> tuple[list[str], dict[str, str]]:
    if not path.exists():
        return [], {}
    lines = path.read_text(encoding="utf-8").splitlines()
    mapping: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        value = raw_value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        mapping[key.strip()] = value
    return lines, mapping


def _update_env_file(path: Path, updates: dict[str, str]) -> None:
    lines, _ = _parse_env_file(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {
        line.split("=", 1)[0].strip(): index
        for index, line in enumerate(lines)
        if "=" in line and not line.strip().startswith("#")
    }

    for key, value in updates.items():
        rendered = f"{key}={_quote_env_value(value)}"
        if key in existing:
            lines[existing[key]] = rendered
        else:
            lines.append(rendered)

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


@dataclass(frozen=True)
class SetupPayload:
    provider: str
    api_key: str
    base_url: str | None = None
    model: str | None = None


class OpenclawSetupService:
    def __init__(
        self,
        settings: MiracleSettings,
        context: MiracleContext,
        *,
        runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
        workspace_env_path: Path | None = None,
        openclaw_env_path: Path | None = None,
    ) -> None:
        self._settings = settings
        self._context = context
        self._runner = runner or self._default_runner
        self._workspace_env_path = workspace_env_path or (context.workspace_root / ".env")
        self._profile = os.getenv("MIRACLE_OPENCLAW_PROFILE", "miracle").strip() or "miracle"
        self._state_dir = openclaw_env_path.parent if openclaw_env_path is not None else self._resolve_state_dir()
        self._openclaw_env_path = openclaw_env_path or self._state_dir / ".env"

    def status(self, upstream_status: dict[str, object]) -> dict[str, object]:
        metadata = self._read_setup_metadata()
        cli_binary = self._resolve_openclaw_binary()
        needs_setup = upstream_status.get("status") != "configured"
        return {
            "needs_setup": needs_setup,
            "method": "openclaw-onboard-cli",
            "cli_available": bool(cli_binary),
            "cli_binary": cli_binary,
            "profile": self._profile,
            "state_dir": str(self._state_dir),
            "providers": [spec.to_dict() for spec in PROVIDERS.values()],
            "recommended_provider": next((spec.id for spec in PROVIDERS.values() if spec.recommended), None),
            "current_setup": metadata,
            "upstream": upstream_status,
        }

    def provision(self, payload: SetupPayload) -> dict[str, object]:
        spec = PROVIDERS.get(payload.provider)
        if spec is None:
            raise SetupProvisioningError("Provider no soportado en el setup inicial.")

        api_key = self._resolved_api_key(spec, payload)
        base_url = self._resolved_base_url(spec, payload)
        selected_model = self._selected_model(spec, payload)

        if spec.requires_api_key and not api_key:
            raise SetupProvisioningError("La API key es obligatoria.")
        if spec.requires_base_url and not base_url:
            raise SetupProvisioningError("La URL base es obligatoria para este provider.")
        if spec.requires_model and not selected_model:
            raise SetupProvisioningError("El model id es obligatorio para este provider.")

        binary = self._resolve_openclaw_binary()
        if not binary:
            raise SetupProvisioningError(
                "No se encontró `openclaw` en PATH. Instala OpenClaw o define MIRACLE_OPENCLAW_BIN antes de usar el setup inicial.",
                status_code=503,
            )

        gateway_token = self._current_gateway_token() or secrets.token_hex(24)
        if api_key:
            _update_env_file(self._openclaw_env_path, {spec.env_var: api_key})

        command = self._build_onboard_command(
            binary=binary,
            spec=spec,
            gateway_token=gateway_token,
            base_url=base_url,
            selected_model=selected_model,
        )
        env = os.environ.copy()
        if api_key:
            env[spec.env_var] = api_key

        completed = self._runner(
            command,
            cwd=str(self._context.workspace_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or "OpenClaw no pudo completar el onboarding inicial."
            raise SetupProvisioningError(message, status_code=502)

        if selected_model:
            self._set_default_model(binary, selected_model, env)
        self._enable_gateway_http_responses(binary)
        self._restart_gateway(binary, gateway_token)
        self._reconcile_gateway_process(binary, gateway_token)
        self._write_workspace_env(gateway_token)
        self._write_setup_metadata(
            spec=spec,
            base_url=base_url,
            selected_model=selected_model,
        )
        return {
            "ok": True,
            "method": "openclaw-onboard-cli",
            "provider": spec.id,
            "summary": self._parse_summary(completed.stdout),
        }

    def _build_onboard_command(
        self,
        *,
        binary: str,
        spec: ProviderSpec,
        gateway_token: str,
        base_url: str | None,
        selected_model: str | None,
    ) -> list[str]:
        command = [
            binary,
            "--profile",
            self._profile,
            "onboard",
            "--non-interactive",
            "--accept-risk",
            "--json",
            "--mode",
            "local",
            "--reset",
            "--reset-scope",
            "config",
            "--skip-health",
            "--auth-choice",
            spec.auth_choice,
            "--secret-input-mode",
            "ref",
            "--gateway-bind",
            "loopback",
            "--gateway-port",
            str(self._desired_gateway_port()),
            "--gateway-auth",
            "token",
            "--gateway-token",
            gateway_token,
            "--install-daemon",
            "--daemon-runtime",
            "node",
            "--skip-skills",
            "--workspace",
            str(self._context.openclaw_workspace_root),
        ]
        if base_url:
            command.extend(["--custom-base-url", base_url])
        if selected_model and (spec.requires_model or spec.compatibility is not None or spec.id == "gemma4-local"):
            command.extend(["--custom-model-id", selected_model])
        if spec.compatibility:
            command.extend(["--custom-compatibility", spec.compatibility])
        if spec.requires_accept_risk:
            command.append("--accept-risk")
        return command

    def _write_workspace_env(self, gateway_token: str) -> None:
        updates = {
            "MIRACLE_UPSTREAM_RUNTIME": "openclaw",
            "OPENCLAW_ENABLED": "true",
            "OPENCLAW_BASE_URL": self._desired_gateway_base_url(),
            "OPENCLAW_AUTH_TOKEN": gateway_token,
            "OPENCLAW_AGENT_ID": "main",
            "OPENCLAW_TIMEOUT_SECONDS": str(self._settings.openclaw.timeout_seconds),
            "MIRACLE_OPENCLAW_PROFILE": self._profile,
        }
        _update_env_file(self._workspace_env_path, updates)

    def _write_setup_metadata(
        self,
        *,
        spec: ProviderSpec,
        base_url: str | None,
        selected_model: str | None,
    ) -> None:
        path = self._setup_metadata_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "provider": spec.id,
            "label": spec.label,
            "base_url": base_url,
            "model": selected_model,
            "configured_at": datetime.now(timezone.utc).isoformat(),
            "method": "openclaw-onboard-cli",
            "profile": self._profile,
            "state_dir": str(self._state_dir),
            "workspace_env_path": str(self._workspace_env_path),
            "openclaw_env_path": str(self._openclaw_env_path),
            "temporary": spec.temporary,
            "responses_endpoint_strategy": "openclaw-cli-config-set",
            "responses_endpoint_path": "gateway.http.endpoints.responses.enabled",
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _read_setup_metadata(self) -> dict[str, object] | None:
        path = self._setup_metadata_path()
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def _setup_metadata_path(self) -> Path:
        return self._context.memory_root / "setup" / "openclaw.json"

    def _current_gateway_token(self) -> str | None:
        _, current = _parse_env_file(self._workspace_env_path)
        if current.get("OPENCLAW_AUTH_TOKEN"):
            return current["OPENCLAW_AUTH_TOKEN"]
        _, shared = _parse_env_file(self._openclaw_env_path)
        return shared.get("OPENCLAW_GATEWAY_TOKEN")

    def _resolve_openclaw_binary(self) -> str | None:
        configured = os.getenv("MIRACLE_OPENCLAW_BIN") or os.getenv("OPENCLAW_BIN")
        if configured:
            return configured
        bundled = self._context.workspace_root / "bin" / "openclaw-iu"
        if bundled.exists():
            return str(bundled)
        return shutil.which("openclaw")

    def _resolve_state_dir(self) -> Path:
        configured = os.getenv("MIRACLE_OPENCLAW_STATE_DIR")
        if configured:
            return Path(configured).expanduser()
        if self._profile == "default":
            return Path.home() / ".openclaw"
        return Path.home() / f".openclaw-{self._profile}"

    def _desired_gateway_base_url(self) -> str:
        configured = (self._settings.openclaw.base_url or "").strip()
        if configured and not configured.endswith(":18789"):
            return configured
        return f"http://127.0.0.1:{self._desired_gateway_port()}"

    def _desired_gateway_port(self) -> int:
        configured = os.getenv("MIRACLE_OPENCLAW_PORT", "").strip()
        if configured.isdigit():
            return int(configured)
        return 19001

    def _resolved_api_key(self, spec: ProviderSpec, payload: SetupPayload) -> str:
        provided = payload.api_key.strip()
        if provided:
            return provided
        return spec.default_api_key or ""

    def _resolved_base_url(self, spec: ProviderSpec, payload: SetupPayload) -> str | None:
        provided = (payload.base_url or "").strip()
        if provided:
            return provided
        return spec.default_base_url

    def _selected_model(self, spec: ProviderSpec, payload: SetupPayload) -> str | None:
        requested = (payload.model or "").strip()
        if spec.supports_model_override:
            return requested or spec.default_model
        return requested or spec.default_model

    def _set_default_model(self, binary: str, model: str, env: dict[str, str]) -> None:
        completed = self._runner(
            [binary, "--profile", self._profile, "models", "set", model],
            cwd=str(self._context.workspace_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or f"OpenClaw no pudo fijar el modelo por defecto: {model}"
            raise SetupProvisioningError(message, status_code=502)

    def _enable_gateway_http_responses(self, binary: str) -> None:
        completed = self._runner(
            [
                binary,
                "--profile",
                self._profile,
                "config",
                "set",
                "gateway.http.endpoints.responses.enabled",
                "true",
                "--strict-json",
            ],
            cwd=str(self._context.workspace_root),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = (
                stderr
                or stdout
                or "OpenClaw no pudo habilitar el endpoint HTTP de responses usando la configuración oficial."
            )
            raise SetupProvisioningError(message, status_code=502)

    def _restart_gateway(self, binary: str, gateway_token: str) -> None:
        env = os.environ.copy()
        env["OPENCLAW_GATEWAY_TOKEN"] = gateway_token
        completed = self._runner(
            [binary, "--profile", self._profile, "gateway", "restart", "--json"],
            cwd=str(self._context.workspace_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or "OpenClaw no pudo reiniciar el gateway después del setup."
            raise SetupProvisioningError(message, status_code=502)

    def _reconcile_gateway_process(self, binary: str, gateway_token: str) -> None:
        for _ in range(3):
            status = self._gateway_status(binary)
            if self._gateway_ready(status):
                return

            stale_pids = self._stale_gateway_pids(status)
            if stale_pids:
                self._stop_gateway(binary)
                self._terminate_processes(stale_pids)
                time.sleep(1.0)
                self._start_gateway(binary, gateway_token)

                for _ in range(5):
                    time.sleep(1.0)
                    status = self._gateway_status(binary)
                    if self._gateway_ready(status):
                        return
                    if self._stale_gateway_pids(status):
                        break
                continue

            time.sleep(1.0)

        raise SetupProvisioningError(
            "OpenClaw quedó con listeners stale después del setup; Miracle no logró reconciliar el gateway local automáticamente.",
            status_code=502,
        )

    def _gateway_status(self, binary: str) -> dict[str, object]:
        completed = self._runner(
            [binary, "--profile", self._profile, "gateway", "status", "--json"],
            cwd=str(self._context.workspace_root),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or "OpenClaw no pudo reportar el estado del gateway."
            raise SetupProvisioningError(message, status_code=502)

        payload = self._parse_summary(completed.stdout)
        if not isinstance(payload, dict):
            raise SetupProvisioningError("OpenClaw devolvió un estado inválido del gateway.", status_code=502)
        return payload

    @staticmethod
    def _stale_gateway_pids(status: dict[str, object]) -> list[int]:
        health = status.get("health")
        if not isinstance(health, dict):
            return []
        raw = health.get("staleGatewayPids")
        if not isinstance(raw, list):
            return []
        return [value for value in raw if isinstance(value, int)]

    def _start_gateway(self, binary: str, gateway_token: str) -> None:
        env = os.environ.copy()
        env["OPENCLAW_GATEWAY_TOKEN"] = gateway_token
        completed = self._runner(
            [binary, "--profile", self._profile, "gateway", "start", "--json"],
            cwd=str(self._context.workspace_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or "OpenClaw no pudo iniciar el gateway después de limpiar listeners stale."
            raise SetupProvisioningError(message, status_code=502)

    def _stop_gateway(self, binary: str) -> None:
        completed = self._runner(
            [binary, "--profile", self._profile, "gateway", "stop", "--json"],
            cwd=str(self._context.workspace_root),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            message = stderr or stdout or "OpenClaw no pudo detener el gateway antes de limpiar listeners stale."
            raise SetupProvisioningError(message, status_code=502)

    def _terminate_processes(self, pids: list[int]) -> None:
        for pid in pids:
            self._terminate_process(pid, signal.SIGTERM)
        time.sleep(1.0)
        for pid in pids:
            if self._is_process_alive(pid):
                self._terminate_process(pid, signal.SIGKILL)

    @staticmethod
    def _is_process_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    @staticmethod
    def _gateway_ready(status: dict[str, object]) -> bool:
        if OpenclawSetupService._stale_gateway_pids(status):
            return False
        rpc = status.get("rpc")
        return isinstance(rpc, dict) and rpc.get("ok") is True

    @staticmethod
    def _terminate_process(pid: int, sig: signal.Signals) -> None:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            return
        except PermissionError as exc:
            raise SetupProvisioningError(
                f"No se pudo terminar el listener stale de OpenClaw (pid {pid}).",
                status_code=502,
            ) from exc

    @staticmethod
    def _parse_summary(stdout: str | None) -> dict[str, object] | None:
        if not stdout:
            return None
        text = stdout.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"raw": text}

    @staticmethod
    def _default_runner(*args, **kwargs) -> subprocess.CompletedProcess[str]:
        return subprocess.run(*args, **kwargs)
