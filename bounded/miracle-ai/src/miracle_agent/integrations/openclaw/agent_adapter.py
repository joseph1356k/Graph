from __future__ import annotations
from dataclasses import dataclass
from typing import Any

from .client import OpenclawGatewayClient
from .config import OpenclawSettings


@dataclass(frozen=True)
class OpenclawAgentExecutionResult:
    response_id: str | None
    summary: str
    raw_payload: dict[str, Any]


class OpenclawAgentProtocolError(RuntimeError):
    pass


class OpenclawAgentAdapter:
    def __init__(self, client: OpenclawGatewayClient, settings: OpenclawSettings) -> None:
        self._client = client
        self._settings = settings

    def build_responses_payload(
        self,
        *,
        intent: str,
        summary: str,
        note_path: str | None,
        note_title: str,
        voice_session_id: str,
        previous_response_id: str | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "input": self._input_message(
                intent=intent,
                summary=summary,
                note_path=note_path,
                note_title=note_title,
            ),
            "instructions": self._instructions(),
            "metadata": {
                "product": "miracle-notes",
                "surface": "voice-agent-execution",
                "upstream_runtime": self._settings.runtime,
                "voice_session_id": voice_session_id,
            },
            "user": f"miracle-voice:{voice_session_id}",
        }
        if self._settings.model:
            payload["model"] = self._settings.model
        if previous_response_id:
            payload["previous_response_id"] = previous_response_id
        if self._settings.max_output_tokens is not None:
            payload["max_output_tokens"] = self._settings.max_output_tokens
        return payload

    def execute_task(
        self,
        *,
        intent: str,
        summary: str,
        note_path: str | None,
        note_title: str,
        voice_session_id: str,
        previous_response_id: str | None,
    ) -> OpenclawAgentExecutionResult:
        payload = self.build_responses_payload(
            intent=intent,
            summary=summary,
            note_path=note_path,
            note_title=note_title,
            voice_session_id=voice_session_id,
            previous_response_id=previous_response_id,
        )
        raw_payload = self._client.call_response_api(payload)
        summary_text = self._extract_reply(raw_payload)
        return OpenclawAgentExecutionResult(
            response_id=self._response_id(raw_payload) or previous_response_id,
            summary=summary_text,
            raw_payload=raw_payload,
        )

    def _instructions(self) -> str:
        return "\n".join(
            [
                "You are the autonomous OpenClaw operator behind Miracle voice actions.",
                "Execute the requested computer task using your available tools when possible.",
                "Do not merely restate or plan the task when it is feasible to perform it now.",
                "For requests like opening an application, actually open the application.",
                "Prefer the smallest successful action that satisfies the request.",
                "Do not modify the Miracle note unless the task explicitly asks for note editing.",
                "If execution is blocked by missing permissions, missing tools, or ambiguity, say that clearly and briefly.",
                "After attempting execution, return a concise operator summary in past tense.",
            ]
        )

    @staticmethod
    def _input_message(*, intent: str, summary: str, note_path: str | None, note_title: str) -> str:
        note_label = note_path or note_title or "untitled note"
        return "\n".join(
            [
                "Execute this Miracle voice task now.",
                f"Intent: {intent}",
                f"Task: {summary.strip()}",
                f"Source note: {note_label}",
            ]
        )

    def _extract_reply(self, payload: dict[str, Any]) -> str:
        direct = payload.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        parts: list[str] = []
        for item in payload.get("output", []) if isinstance(payload.get("output"), list) else []:
            parts.extend(self._collect_text(item))

        reply = "\n".join(part.strip() for part in parts if part and part.strip()).strip()
        if reply:
            return reply
        raise OpenclawAgentProtocolError("OpenClaw no devolvió un resumen utilizable para la tarea ejecutada.")

    def _collect_text(self, value: object) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            parts: list[str] = []
            for item in value:
                parts.extend(self._collect_text(item))
            return parts
        if not isinstance(value, dict):
            return []

        item_type = value.get("type")
        text = value.get("text")
        if isinstance(text, str) and item_type in {"output_text", "text", "summary_text", "input_text"}:
            return [text]

        content = value.get("content")
        if content is not None:
            return self._collect_text(content)

        if isinstance(text, dict):
            nested_value = text.get("value")
            if isinstance(nested_value, str):
                return [nested_value]

        nested_output = value.get("output")
        if nested_output is not None:
            return self._collect_text(nested_output)
        return []

    @staticmethod
    def _response_id(payload: dict[str, Any]) -> str | None:
        response_id = payload.get("id")
        if isinstance(response_id, str) and response_id.strip():
            return response_id
        return None
