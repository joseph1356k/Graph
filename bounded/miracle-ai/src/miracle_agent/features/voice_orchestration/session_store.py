from __future__ import annotations

import json
from pathlib import Path

from ...context import MiracleContext
from .contracts import VoiceOrchestratorSessionState


def _session_dir(context: MiracleContext) -> Path:
    return context.memory_root / "voice_orchestration"


def _session_path(context: MiracleContext, voice_session_id: str) -> Path:
    return _session_dir(context) / f"{voice_session_id}.json"


def load_voice_orchestration_session(
    context: MiracleContext,
    *,
    voice_session_id: str,
    note_path: str | None,
    note_title: str,
    note_content: str,
) -> VoiceOrchestratorSessionState:
    path = _session_path(context, voice_session_id)
    if not path.exists():
        return VoiceOrchestratorSessionState(
            voice_session_id=voice_session_id,
            note_path=note_path,
            note_title=note_title,
            last_note_content=note_content,
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    return VoiceOrchestratorSessionState(
        voice_session_id=payload.get("voice_session_id", voice_session_id),
        note_path=payload.get("note_path", note_path),
        note_title=payload.get("note_title", note_title),
        transcript_history=list(payload.get("transcript_history", [])),
        processed_segment_ids=list(payload.get("processed_segment_ids", [])),
        last_sequence=int(payload.get("last_sequence", 0)),
        last_note_content=payload.get("last_note_content", note_content),
        last_applied_note_block=payload.get("last_applied_note_block"),
        pending_agent_tasks=list(payload.get("pending_agent_tasks", [])),
        product_llm_conversation_id=payload.get("product_llm_conversation_id"),
        openclaw_conversation_id=payload.get("openclaw_conversation_id"),
    )


def save_voice_orchestration_session(context: MiracleContext, session: VoiceOrchestratorSessionState) -> Path:
    path = _session_path(context, session.voice_session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path
