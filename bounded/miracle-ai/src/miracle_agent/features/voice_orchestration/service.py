from __future__ import annotations

from dataclasses import replace

from ...config import MiracleSettings
from ...context import MiracleContext
from ...integrations.product_llm.note_orchestrator_adapter import ProductLLMAdapterError, ProductLLMOrchestratorAdapter
from ...integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment
from .contracts import (
    VoiceOrchestratorEvent,
    VoiceOrchestratorResponse,
    VoiceOrchestratorSessionState,
)
from .session_store import load_voice_orchestration_session, save_voice_orchestration_session


class VoiceOrchestrationError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class VoiceOrchestrationService:
    def __init__(
        self,
        settings: MiracleSettings,
        context: MiracleContext,
        *,
        adapter: ProductLLMOrchestratorAdapter | None = None,
    ) -> None:
        self._settings = settings
        self._context = context
        self._adapter = adapter or ProductLLMOrchestratorAdapter(settings.product_llm)

    @classmethod
    def from_settings(cls, settings: MiracleSettings, context: MiracleContext) -> "VoiceOrchestrationService":
        return cls(settings, context)

    def status(self) -> dict[str, object]:
        provider = self._settings.product_llm.provider
        if provider == "disabled":
            status = "disabled"
        elif provider == "openai" and self._settings.product_llm.is_configured:
            status = "configured"
        else:
            status = "heuristic"
        return {
            "status": status,
            "provider": provider,
            "configured": self._settings.product_llm.is_configured,
            "scratchpad_heading": self._settings.product_llm.scratchpad_heading,
            "execution_enabled": False,
            "model": self._settings.product_llm.model,
        }

    def apply_settings(self, settings: MiracleSettings) -> None:
        self._settings = settings
        self._adapter = ProductLLMOrchestratorAdapter(settings.product_llm)

    def orchestrate_event(self, event: VoiceOrchestratorEvent) -> VoiceOrchestratorResponse:
        if not event.voice_session_id.strip():
            raise VoiceOrchestrationError("Missing voice_session_id")
        if not event.event_id.strip():
            raise VoiceOrchestrationError("Missing event_id")
        if not event.segment.transcript.strip():
            raise VoiceOrchestrationError("Missing transcript segment")

        session = load_voice_orchestration_session(
            self._context,
            voice_session_id=event.voice_session_id,
            note_path=event.note_path,
            note_title=event.note_title,
            note_content=event.note_content,
        )
        if event.segment.segment_id in session.processed_segment_ids:
            return VoiceOrchestratorResponse(
                accepted_event_id=event.event_id,
                session_state=_serialize_session_state(session),
                note_updates=[],
                agent_tasks=[],
                resolved_note_content=session.last_note_content or event.note_content,
                backend_status="duplicate-segment",
                usage=None,
            )

        next_history = [*session.transcript_history, event.segment.transcript.strip()]
        request = ProductLLMOrchestratorInput(
            voice_session_id=event.voice_session_id,
            note_path=event.note_path,
            note_title=event.note_title,
            note_content=event.note_content,
            last_applied_note_block=session.last_applied_note_block,
            transcript_history=next_history,
            segment=VoiceTranscriptSegment(
                segment_id=event.segment.segment_id,
                kind=event.segment.kind,
                transcript=event.segment.transcript,
                start_ms=event.segment.start_ms,
                end_ms=event.segment.end_ms,
                language=event.segment.language,
            ),
        )
        try:
            decision = self._adapter.orchestrate(request)
        except ProductLLMAdapterError as exc:
            raise VoiceOrchestrationError(str(exc), status_code=exc.status_code) from exc

        resolved_note_content, last_applied_note_block = self._apply_note_updates(
            base_content=event.note_content,
            previous_note_block=session.last_applied_note_block,
            note_updates=decision.note_updates,
        )
        agent_tasks, pending_agent_tasks, openclaw_conversation_id = self._resolve_agent_tasks(
            tasks=decision.agent_tasks,
            voice_session_id=event.voice_session_id,
            note_path=event.note_path,
            note_title=event.note_title,
            previous_response_id=session.openclaw_conversation_id,
            existing_pending=session.pending_agent_tasks,
        )
        next_session = replace(
            session,
            note_path=event.note_path,
            note_title=event.note_title,
            transcript_history=next_history,
            processed_segment_ids=[*session.processed_segment_ids, event.segment.segment_id][-100:],
            last_sequence=max(session.last_sequence, event.sequence),
            last_note_content=resolved_note_content,
            last_applied_note_block=last_applied_note_block,
            pending_agent_tasks=pending_agent_tasks[-50:],
            openclaw_conversation_id=openclaw_conversation_id,
        )
        save_voice_orchestration_session(self._context, next_session)
        return VoiceOrchestratorResponse(
            accepted_event_id=event.event_id,
            session_state=_serialize_session_state(next_session),
            note_updates=[item.to_dict() for item in decision.note_updates],
            agent_tasks=agent_tasks,
            resolved_note_content=resolved_note_content,
            backend_status=decision.backend_status,
            usage=decision.usage.to_dict() if decision.usage else None,
        )

    def _resolve_agent_tasks(
        self,
        *,
        tasks: list[object],
        voice_session_id: str,
        note_path: str | None,
        note_title: str,
        previous_response_id: str | None,
        existing_pending: list[dict[str, object]],
    ) -> tuple[list[dict[str, object]], list[dict[str, object]], str | None]:
        resolved_tasks: list[dict[str, object]] = []
        pending_tasks = [*existing_pending]
        response_id = previous_response_id

        for item in tasks:
            task = item.to_dict() if hasattr(item, "to_dict") else dict(item)
            task["status"] = "planned"
            pending_tasks.append(task)
            resolved_tasks.append(task)

        return resolved_tasks, pending_tasks[-50:], response_id

    def _apply_note_updates(
        self,
        *,
        base_content: str,
        previous_note_block: str | None,
        note_updates: list[object],
    ) -> tuple[str, str | None]:
        content = base_content
        latest_note_block = previous_note_block
        for item in note_updates:
            update_type = getattr(item, "type", "")
            target = getattr(item, "target", {}) or {}
            update_content = getattr(item, "content", "")
            if update_type == "replace_active_note_session_block":
                content, latest_note_block = _replace_active_note_session_block(
                    content,
                    previous_block=latest_note_block,
                    next_block=update_content,
                )
                continue
            if update_type == "replace_voice_scratchpad":
                heading_path = target.get("heading_path") if isinstance(target, dict) else None
                heading = heading_path[0] if isinstance(heading_path, list) and heading_path else self._settings.product_llm.scratchpad_heading
                content = _replace_or_append_top_level_section(content, heading, update_content)
                latest_note_block = None
        return content, latest_note_block


def _serialize_session_state(session: VoiceOrchestratorSessionState) -> dict[str, object]:
    return {
        "voice_session_id": session.voice_session_id,
        "note_path": session.note_path,
        "note_title": session.note_title,
        "mode": "segment-based",
        "segments_processed": len(session.transcript_history),
        "last_sequence": session.last_sequence,
        "pending_agent_tasks": len(session.pending_agent_tasks),
        "has_active_note_block": bool(session.last_applied_note_block),
        "openclaw_conversation_id": session.openclaw_conversation_id,
    }


def _replace_or_append_top_level_section(content: str, heading: str, section_body: str) -> str:
    normalized_body = section_body.strip()
    heading_line = f"## {heading}"
    lines = content.splitlines()
    start_index = None
    end_index = None
    for index, line in enumerate(lines):
        if line.strip() == heading_line:
            start_index = index
            end_index = len(lines)
            for cursor in range(index + 1, len(lines)):
                if lines[cursor].startswith("## ") or lines[cursor].startswith("# "):
                    end_index = cursor
                    break
            break

    replacement = [heading_line]
    if normalized_body:
        replacement.extend(normalized_body.splitlines())

    if start_index is None:
        clean_content = content.rstrip()
        if not clean_content:
            return "\n".join(replacement).strip() + "\n"
        return f"{clean_content}\n\n" + "\n".join(replacement).strip() + "\n"

    next_lines = [*lines[:start_index], *replacement, *lines[end_index:]]
    return "\n".join(next_lines).rstrip() + "\n"


def _replace_active_note_session_block(
    content: str,
    *,
    previous_block: str | None,
    next_block: str,
) -> tuple[str, str | None]:
    clean_next = next_block.strip()
    if not clean_next:
        return content, previous_block

    base = content
    base_trimmed = base.rstrip()
    previous_clean = previous_block.strip() if isinstance(previous_block, str) and previous_block.strip() else None
    if previous_clean:
        if previous_clean in base:
            updated = base.replace(previous_clean, clean_next, 1)
            return updated.rstrip() + "\n", clean_next
        compact_previous = previous_clean.replace("\n\n", "\n")
        if compact_previous in base:
            updated = base.replace(compact_previous, clean_next, 1)
            return updated.rstrip() + "\n", clean_next

    if base_trimmed:
        if clean_next == base_trimmed or clean_next in base:
            return base_trimmed + "\n", clean_next
        if clean_next.startswith(base_trimmed):
            return clean_next.rstrip() + "\n", clean_next

    if not base_trimmed:
        return f"{clean_next}\n", clean_next
    return f"{base_trimmed}\n\n{clean_next}\n", clean_next
