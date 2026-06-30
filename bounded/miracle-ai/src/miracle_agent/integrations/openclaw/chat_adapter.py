from __future__ import annotations

import json
from typing import Any, Mapping

from .client import OpenclawGatewayClient
from .config import OpenclawSettings
from .models import MiracleContextEnvelope, OpenclawGatewayResponse

_CONTEXT_CONTRACT_VERSION = "miracle-context-packet/v1"


class OpenclawProtocolError(RuntimeError):
    pass


class OpenclawChatAdapter:
    def __init__(
        self,
        client: OpenclawGatewayClient,
        settings: OpenclawSettings,
    ) -> None:
        self._client = client
        self._settings = settings

    def build_context_envelope(self, context_packet: Mapping[str, object] | None) -> dict[str, Any]:
        return {
            "product": "Miracle Notes",
            "surface": "contextual-notepad-chat",
            "contract_version": _CONTEXT_CONTRACT_VERSION,
            "upstream_runtime": self._settings.runtime,
            "context_packet": MiracleContextEnvelope.from_context_packet(context_packet).to_dict(),
        }

    def build_responses_payload(
        self,
        *,
        message: str,
        previous_response_id: str | None,
        context_packet: Mapping[str, object] | None,
    ) -> dict[str, Any]:
        envelope = self.build_context_envelope(context_packet)
        serialized_envelope = json.dumps(envelope, ensure_ascii=False)
        payload: dict[str, Any] = {
            "input": message,
            "instructions": self._instructions(envelope),
            "metadata": {
                "product": "miracle-notes",
                "surface": "contextual-notepad-chat",
                "upstream_runtime": self._settings.runtime,
                "miracle_context": serialized_envelope,
            },
        }
        if self._settings.model:
            payload["model"] = self._settings.model
        if previous_response_id:
            payload["previous_response_id"] = previous_response_id
        if self._settings.max_output_tokens is not None:
            payload["max_output_tokens"] = self._settings.max_output_tokens
        return payload

    def chat(
        self,
        *,
        message: str,
        previous_response_id: str | None,
        context_packet: Mapping[str, object] | None,
    ) -> OpenclawGatewayResponse:
        payload = self.build_responses_payload(
            message=message,
            previous_response_id=previous_response_id,
            context_packet=context_packet,
        )
        raw_payload = self._client.call_response_api(payload)
        reply = self._extract_reply(raw_payload)
        return OpenclawGatewayResponse(
            response_id=self._response_id(raw_payload) or previous_response_id,
            reply=reply,
            raw_payload=raw_payload,
        )

    def _instructions(self, envelope: dict[str, Any]) -> str:
        serialized_context = json.dumps(envelope, ensure_ascii=False, indent=2)
        return "\n".join(
            [
                "You are the contextual assistant behind Miracle Notes.",
                "Miracle owns the UX, note editing, hidden context capture, session history, and checkpoints.",
                "Use the structured Miracle context below as hidden product context when answering the current user message.",
                "Prioritize the active block and recent change over the full note when that improves relevance.",
                "Do not mention Openclaw, hidden diffs, checkpoints, or internal metadata unless the user explicitly asks.",
                "",
                "<miracle_context>",
                serialized_context,
                "</miracle_context>",
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
        raise OpenclawProtocolError("Openclaw no devolvió texto de asistente utilizable.")

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
        if isinstance(text, str) and item_type in {
            "output_text",
            "text",
            "summary_text",
            "input_text",
        }:
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
    def _response_id(payload: Mapping[str, object]) -> str | None:
        response_id = payload.get("id")
        if isinstance(response_id, str) and response_id.strip():
            return response_id
        return None
