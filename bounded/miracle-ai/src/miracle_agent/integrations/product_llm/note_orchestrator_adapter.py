from __future__ import annotations

import json
from dataclasses import replace
from typing import Protocol

from .client import OpenAICompatibleProductLLMClient, ProductLLMClientError
from .config import ProductLLMSettings
from .models import (
    ProductLLMAgentTask,
    ProductLLMNoteUpdate,
    ProductLLMOrchestratorInput,
    ProductLLMOrchestratorOutput,
    ProductLLMUsageMetrics,
)


class ProductLLMAdapterError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ProductLLMPlanner(Protocol):
    def orchestrate(self, request: ProductLLMOrchestratorInput) -> ProductLLMOrchestratorOutput:
        ...


class ProductLLMOrchestratorAdapter:
    def __init__(
        self,
        settings: ProductLLMSettings,
        *,
        planner: ProductLLMPlanner | None = None,
    ) -> None:
        self._settings = settings
        self._planner = planner or self._planner_from_settings(settings)
        # Whether the primary planner is a remote LLM (vs. already heuristic).
        # Only in that case do we degrade to heuristic on a provider failure.
        self._uses_remote_llm = isinstance(
            self._planner, (_OpenAICompatiblePlanner, _GeminiChatPlanner)
        )

    def orchestrate(self, request: ProductLLMOrchestratorInput) -> ProductLLMOrchestratorOutput:
        try:
            return self._planner.orchestrate(request)
        except ProductLLMClientError as exc:
            # If the remote LLM is unavailable (quota/429, 5xx, timeout), degrade
            # gracefully to the heuristic planner so dictation still fills the note
            # instead of failing outright. The note is unstructured until the LLM
            # recovers; backend_status makes the degraded mode visible.
            if self._uses_remote_llm:
                fallback = _HeuristicPlanner(self._settings).orchestrate(request)
                return replace(
                    fallback,
                    backend_status=f"heuristic-fallback:{exc.status_code}",
                )
            raise ProductLLMAdapterError(str(exc), status_code=exc.status_code) from exc

    def _planner_from_settings(self, settings: ProductLLMSettings) -> ProductLLMPlanner:
        if settings.provider == "openai" and settings.is_configured:
            return _OpenAICompatiblePlanner(settings, OpenAICompatibleProductLLMClient(settings))
        if settings.provider == "google" and settings.is_configured:
            return _GeminiChatPlanner(settings, OpenAICompatibleProductLLMClient(settings))
        return _HeuristicPlanner(settings)


class _HeuristicPlanner:
    def __init__(self, settings: ProductLLMSettings) -> None:
        self._settings = settings

    def orchestrate(self, request: ProductLLMOrchestratorInput) -> ProductLLMOrchestratorOutput:
        note_updates = [
            ProductLLMNoteUpdate(
                type="replace_active_note_session_block",
                target={"mode": "active_note", "scope": "voice_session_block"},
                content=_normalize_session_block(request.transcript_history),
                reason="voice_session_consolidation",
                confidence=0.42,
            )
        ]

        latest = request.segment.transcript.lower()
        task = None
        if any(token in latest for token in ("abrir", "buscar", "consulta", "revisar", "orden", "llamar", "enviar")):
            task = ProductLLMAgentTask(
                intent="prepare_openclaw_task",
                priority="normal",
                mode="planned_only",
                payload={"summary": request.segment.transcript.strip()},
                confidence=0.22,
            )
        agent_tasks = [] if note_updates else ([task] if task else [])
        return ProductLLMOrchestratorOutput(
            note_updates=note_updates,
            agent_tasks=agent_tasks,
            backend_status="heuristic",
        )


class _OpenAICompatiblePlanner:
    def __init__(self, settings: ProductLLMSettings, client: OpenAICompatibleProductLLMClient) -> None:
        self._settings = settings
        self._client = client

    def orchestrate(self, request: ProductLLMOrchestratorInput) -> ProductLLMOrchestratorOutput:
        payload = self._build_payload(request)
        raw = self._client.call_responses_api(payload)
        return self._extract_output(raw, request)

    def _build_payload(self, request: ProductLLMOrchestratorInput) -> dict[str, object]:
        payload: dict[str, object] = {
            "input": _build_orchestrator_input(request),
            "instructions": _build_orchestrator_instructions(),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "voice_orchestrator_response",
                    "strict": True,
                    "schema": _structured_output_schema(),
                }
            },
        }
        if self._settings.model:
            payload["model"] = self._settings.model
        if self._settings.max_output_tokens is not None:
            payload["max_output_tokens"] = self._settings.max_output_tokens
        return payload

    def _extract_output(
        self,
        payload: dict[str, object],
        request: ProductLLMOrchestratorInput,
    ) -> ProductLLMOrchestratorOutput:
        text = _extract_response_text(payload)
        decoded = _decode_structured_text(text)
        note_updates, agent_tasks = _note_and_task_lists(decoded)
        return ProductLLMOrchestratorOutput(
            note_updates=note_updates,
            agent_tasks=agent_tasks,
            backend_status="product-llm",
            usage=_extract_usage_metrics(payload, fallback_model=self._settings.model),
        )


class _GeminiChatPlanner:
    # Google Gemini exposes Chat Completions (not the Responses API) through its
    # OpenAI-compatible layer, and it honors `response_format` json_schema, so the
    # same strict structured output is preserved. Only the request/response
    # envelope differs from _OpenAICompatiblePlanner.
    def __init__(self, settings: ProductLLMSettings, client: OpenAICompatibleProductLLMClient) -> None:
        self._settings = settings
        self._client = client

    def orchestrate(self, request: ProductLLMOrchestratorInput) -> ProductLLMOrchestratorOutput:
        payload = self._build_payload(request)
        raw = self._client.call_chat_completions(payload)
        return self._extract_output(raw, request)

    def _build_payload(self, request: ProductLLMOrchestratorInput) -> dict[str, object]:
        payload: dict[str, object] = {
            "messages": [
                {"role": "system", "content": _build_orchestrator_instructions()},
                {"role": "user", "content": _build_orchestrator_input(request)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "voice_orchestrator_response",
                    "strict": True,
                    "schema": _structured_output_schema(),
                },
            },
        }
        if self._settings.model:
            payload["model"] = self._settings.model
        if self._settings.max_output_tokens is not None:
            payload["max_tokens"] = self._settings.max_output_tokens
        return payload

    def _extract_output(
        self,
        payload: dict[str, object],
        request: ProductLLMOrchestratorInput,
    ) -> ProductLLMOrchestratorOutput:
        text = _extract_chat_completion_text(payload)
        decoded = _decode_structured_text(text)
        note_updates, agent_tasks = _note_and_task_lists(decoded)
        return ProductLLMOrchestratorOutput(
            note_updates=note_updates,
            agent_tasks=agent_tasks,
            backend_status="product-llm",
            usage=_extract_chat_usage_metrics(payload, fallback_model=self._settings.model),
        )


def _build_orchestrator_input(request: ProductLLMOrchestratorInput) -> str:
    return json.dumps({"request": request.to_dict()}, ensure_ascii=False)


def _build_orchestrator_instructions() -> str:
    preferred_structure = "\n".join(
        [
            "Preferred note structure for medical dictation:",
            "## Identificacion",
            "- Name, age, sex/gender, and other core demographic facts only when explicitly known.",
            "## Motivo de consulta",
            "- The main reason for consultation in one or two lines.",
            "## Hallazgos y sintomas relevantes",
            "- The most important current symptoms, duration, severity, and associated findings.",
            "## Antecedentes relevantes",
            "- Prior conditions, surgeries, chronic diseases, or medically relevant background.",
            "## Medicacion y alergias",
            "- Current medications, allergies, intolerances, and adherence details when available.",
            "## Evaluacion o impresion clinica",
            "- Clinician assessment, likely interpretation, or diagnostic framing if it is actually dictated.",
            "## Plan y seguimiento",
            "- Tests, treatments, referrals, follow-up steps, or explicit next actions for care.",
            "## Otros datos relevantes",
            "- Use only for medically useful information that does not fit the sections above.",
        ]
    )
    return "\n".join(
        [
            "You are Miracle's product LLM for clinician voice orchestration in a medical workflow.",
            "Your job is to decide, from the spoken transcript, what belongs in the active note and what deserves an autonomous task.",
            "Do not rewrite the whole note.",
            "When you decide content belongs in the active note, prefer `replace_active_note_session_block`.",
            "That update must contain the full latest version of the voice session block, not only the newest fragment.",
            "Use the provided `last_applied_note_block` and transcript history to consolidate, deduplicate, and improve the block over time.",
            "Do not echo filler, greetings, microphone checks, repeated fragments, or obvious STT duplication.",
            "In medical use cases, prefer writing only clinically relevant patient facts into the active note, such as full name, age, gender, symptoms, health conditions, medications, allergies, assessment-relevant history, and explicit clinician dictation intended for the note.",
            preferred_structure,
            "Write the note block in concise Markdown that is easy to scan in a few seconds.",
            "Prefer short headings, short paragraphs, and bullets where that improves clarity.",
            "Omit empty sections instead of keeping placeholders.",
            "Do not invent facts. Only include information grounded in the transcript or already-established session block.",
            "When new information changes an existing section, merge it into the right section instead of repeating the same fact elsewhere.",
            "If important information does not fit the default structure, create a short custom section with a clear title and place the information there.",
            "If the content is clearly non-medical but the speaker explicitly wants it written, still structure it cleanly with a concise custom heading.",
            "If the transcript is not yet relevant enough for the note, it is valid to emit no note_updates.",
            "Only emit `agent_tasks` when the speaker is explicitly asking for an external action, computer action, lookup, navigation, search, review, or follow-up beyond note writing.",
            "It is valid to emit both note_updates and agent_tasks in the same response when both are needed.",
            "Do not emit agent_tasks for simple dictation unless there is also a clear operational request.",
            "If the user says to write exactly what follows, preserve the dictated content faithfully, but still return the full latest consolidated session block.",
            "Use `execute_if_enabled` when the speaker is clearly asking to perform a direct computer action now, such as opening an application, navigating, searching, or reviewing something on the computer.",
            "Use `planned_only` for suggestions, background follow-up ideas, or tasks that should be queued rather than executed immediately.",
            "Use `requires_confirmation` for sensitive, ambiguous, or potentially disruptive actions.",
            "Return only content that is appropriate for the structured schema.",
        ]
    )


def _decode_structured_text(text: str | None) -> dict[str, object]:
    if not isinstance(text, str) or not text.strip():
        raise ProductLLMAdapterError("Miracle product LLM no devolvió texto utilizable.")
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError as exc:
        snippet = text[:240].replace("\n", " ")
        raise ProductLLMAdapterError(f"Miracle product LLM devolvió JSON inválido: {snippet}") from exc
    if not isinstance(decoded, dict):
        raise ProductLLMAdapterError("Miracle product LLM devolvió un payload inesperado.")
    return decoded


def _note_and_task_lists(
    decoded: dict[str, object],
) -> tuple[list[ProductLLMNoteUpdate], list[ProductLLMAgentTask]]:
    note_updates = [
        ProductLLMNoteUpdate(
            type=str(item.get("type", "replace_active_note_session_block")),
            target=dict(item.get("target", {})),
            content=str(item.get("content", "")),
            reason=str(item.get("reason", "dictation_capture")),
            confidence=float(item.get("confidence", 0.0)),
        )
        for item in decoded.get("note_updates", [])
        if isinstance(item, dict)
    ]
    agent_tasks = [
        ProductLLMAgentTask(
            intent=str(item.get("intent", "prepare_openclaw_task")),
            priority=str(item.get("priority", "normal")),
            mode=str(item.get("mode", "planned_only")),
            payload=dict(item.get("payload", {})),
            confidence=float(item.get("confidence", 0.0)),
        )
        for item in decoded.get("agent_tasks", [])
        if isinstance(item, dict)
    ]
    return note_updates, agent_tasks


def _extract_chat_completion_text(payload: dict[str, object]) -> str | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    # Some OpenAI-compatible layers return content as a list of parts.
    if isinstance(content, list):
        parts: list[str] = []
        for chunk in content:
            if isinstance(chunk, dict):
                text = chunk.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        if parts:
            return "\n".join(parts)
    return None


def _extract_chat_usage_metrics(
    payload: dict[str, object], *, fallback_model: str | None = None
) -> ProductLLMUsageMetrics | None:
    raw_usage = payload.get("usage")
    if not isinstance(raw_usage, dict):
        return None

    input_tokens = _coerce_int(raw_usage.get("prompt_tokens"))
    output_tokens = _coerce_int(raw_usage.get("completion_tokens"))
    total_tokens = _coerce_int(raw_usage.get("total_tokens"))

    if total_tokens <= 0:
        total_tokens = max(0, input_tokens) + max(0, output_tokens)

    if input_tokens <= 0 and output_tokens <= 0 and total_tokens <= 0:
        return None

    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        model = fallback_model or ""

    return ProductLLMUsageMetrics(
        provider="google",
        api_family="chat.completions",
        model=model.strip(),
        input_tokens=max(0, input_tokens),
        output_tokens=max(0, output_tokens),
        total_tokens=max(0, total_tokens),
    )


def _normalize_session_block(segments: list[str]) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for segment in segments:
        clean = " ".join(segment.split()).strip()
        if not clean:
            continue
        lowered = clean.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        parts.append(clean)

    merged = " ".join(parts).strip()
    if not merged:
        return ""
    if not merged.endswith((".", "!", "?")):
        merged = f"{merged}."
    return merged


def _structured_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "note_updates": {
                "type": "array",
                "items": {
                    "anyOf": [
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "type": {"type": "string", "enum": ["replace_active_note_session_block"]},
                                "target": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "properties": {
                                        "mode": {"type": "string", "enum": ["active_note"]},
                                        "scope": {"type": "string", "enum": ["voice_session_block"]},
                                    },
                                    "required": ["mode", "scope"],
                                },
                                "content": {"type": "string"},
                                "reason": {"type": "string"},
                                "confidence": {"type": "number"},
                            },
                            "required": ["type", "target", "content", "reason", "confidence"],
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "type": {"type": "string", "enum": ["replace_voice_scratchpad"]},
                                "target": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "properties": {
                                        "heading_path": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                        }
                                    },
                                    "required": ["heading_path"],
                                },
                                "content": {"type": "string"},
                                "reason": {"type": "string"},
                                "confidence": {"type": "number"},
                            },
                            "required": ["type", "target", "content", "reason", "confidence"],
                        },
                    ]
                },
            },
            "agent_tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "intent": {"type": "string"},
                        "priority": {"type": "string"},
                        "mode": {"type": "string"},
                        "payload": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "summary": {"type": "string"},
                            },
                            "required": ["summary"],
                        },
                        "confidence": {"type": "number"},
                    },
                    "required": ["intent", "priority", "mode", "payload", "confidence"],
                },
            },
        },
        "required": ["note_updates", "agent_tasks"],
    }


def _extract_response_text(payload: dict[str, object]) -> str | None:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    output = payload.get("output")
    if not isinstance(output, list):
        return None

    parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for chunk in content:
            if not isinstance(chunk, dict):
                continue
            if chunk.get("type") != "output_text":
                continue
            text = chunk.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    if parts:
        return "\n".join(parts)
    return None


def _extract_usage_metrics(payload: dict[str, object], *, fallback_model: str | None = None) -> ProductLLMUsageMetrics | None:
    raw_usage = payload.get("usage")
    if not isinstance(raw_usage, dict):
        return None

    input_tokens = _coerce_int(raw_usage.get("input_tokens"))
    output_tokens = _coerce_int(raw_usage.get("output_tokens"))
    total_tokens = _coerce_int(raw_usage.get("total_tokens"))

    if input_tokens <= 0 and output_tokens <= 0 and total_tokens <= 0:
        input_tokens = _coerce_int(raw_usage.get("prompt_tokens"))
        output_tokens = _coerce_int(raw_usage.get("completion_tokens"))
        total_tokens = _coerce_int(raw_usage.get("total_tokens"))

    if total_tokens <= 0:
        total_tokens = max(0, input_tokens) + max(0, output_tokens)

    if input_tokens <= 0 and output_tokens <= 0 and total_tokens <= 0:
        return None

    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        model = fallback_model or ""

    return ProductLLMUsageMetrics(
        provider="openai",
        api_family="responses",
        model=model.strip(),
        input_tokens=max(0, input_tokens),
        output_tokens=max(0, output_tokens),
        total_tokens=max(0, total_tokens),
    )


def _coerce_int(value: object) -> int:
    try:
        numeric = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return numeric if numeric > 0 else 0
