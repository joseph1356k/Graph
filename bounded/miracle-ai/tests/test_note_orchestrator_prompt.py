"""El prompt del orquestador de voz lleva las políticas compartidas y se declara
como bloque provisional, no como nota clínica. Y su versión de cláusulas coincide
con la del backend Node, que es la fuente de verdad."""
from __future__ import annotations

from pathlib import Path

from miracle_agent.integrations.product_llm import prompt_clauses
from miracle_agent.integrations.product_llm.note_orchestrator_adapter import (
    _build_orchestrator_instructions,
)

GRAPH_ROOT = Path(__file__).resolve().parents[3]


def test_prompt_has_shared_clauses_and_provisional_label() -> None:
    text = _build_orchestrator_instructions()
    assert "ROLE BOUNDARY:" in text
    assert "NO INVENTION:" in text
    assert "CRITICAL DATA FIDELITY:" in text
    assert "Provisional VOICE SESSION BLOCK" in text
    assert "NOT the final clinical note" in text
    # Las ocho secciones siguen ahí (con tilde: las ve el médico).
    assert text.count("\n## ") == 8
    assert "## Identificación" in text


def test_clauses_version_matches_javascript_source_of_truth() -> None:
    js = (GRAPH_ROOT / "src" / "application" / "prompts" / "PromptClauses.js").read_text(encoding="utf-8")
    assert f"const CLAUSES_VERSION = '{prompt_clauses.CLAUSES_VERSION}';" in js


def test_markers_rule_only_when_the_request_carries_markers() -> None:
    from miracle_agent.integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment

    def req(text: str) -> ProductLLMOrchestratorInput:
        seg = VoiceTranscriptSegment(segment_id="s", kind="final", transcript=text)
        return ProductLLMOrchestratorInput(
            voice_session_id="v", note_path=None, note_title="n", note_content="",
            last_applied_note_block=None, transcript_history=[text], segment=seg,
        )

    assert "PRIVACY:" in _build_orchestrator_instructions(req("Paciente [PACIENTE_NOMBRE_1] con tos"))
    assert "PRIVACY:" not in _build_orchestrator_instructions(req("Paciente con tos"))
    # Ninguna cláusula pide warnings: el schema no los tiene.
    assert "warning" not in _build_orchestrator_instructions(req("x")).lower()


def test_truncated_output_degrades_instead_of_failing() -> None:
    from miracle_agent.integrations.product_llm.config import ProductLLMSettings
    from miracle_agent.integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment
    from miracle_agent.integrations.product_llm.note_orchestrator_adapter import ProductLLMOrchestratorAdapter

    adapter = ProductLLMOrchestratorAdapter(ProductLLMSettings(provider="openai", base_url="https://x", api_key="k", model="m"))
    adapter._planner._client.call_responses_api = lambda payload: {  # type: ignore[attr-defined]
        "status": "incomplete",
        "output": [{"content": [{"type": "output_text", "text": '{"note_updates":[{"content":"## Motivo'}]}],
    }
    seg = VoiceTranscriptSegment(segment_id="s", kind="final", transcript="dolor torácico")
    out = adapter.orchestrate(ProductLLMOrchestratorInput(
        voice_session_id="v", note_path=None, note_title="n", note_content="",
        last_applied_note_block=None, transcript_history=["dolor torácico"], segment=seg,
    ))
    assert out.backend_status.startswith("heuristic-fallback")
    assert ProductLLMSettings().max_output_tokens == 2000


def test_truncated_output_keeps_the_structured_block_and_records_the_spend() -> None:
    """Con un bloque ya estructurado, una salida truncada no lo aplana con el
    volcado de todo el dictado: lo conserva y le añade solo el segmento nuevo. Y
    lo que costó la respuesta inservible queda en usage."""
    from miracle_agent.integrations.product_llm.config import ProductLLMSettings
    from miracle_agent.integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment
    from miracle_agent.integrations.product_llm.note_orchestrator_adapter import ProductLLMOrchestratorAdapter

    adapter = ProductLLMOrchestratorAdapter(ProductLLMSettings(provider="openai", base_url="https://x", api_key="k", model="m"))
    adapter._planner._client.call_responses_api = lambda payload: {  # type: ignore[attr-defined]
        "status": "incomplete",
        "output": [{"content": [{"type": "output_text", "text": '{"note_updates":[{"content":"## Motivo'}]}],
        "usage": {"input_tokens": 900, "output_tokens": 2000, "total_tokens": 2900},
    }
    block = "## Motivo de consulta\nDolor torácico de dos días."
    seg = VoiceTranscriptSegment(segment_id="s2", kind="final", transcript="  irradiado al brazo   izquierdo ")
    out = adapter.orchestrate(ProductLLMOrchestratorInput(
        voice_session_id="v", note_path=None, note_title="n", note_content=block,
        last_applied_note_block=block, transcript_history=["dolor torácico de dos días", "irradiado al brazo izquierdo"],
        segment=seg,
    ))
    assert out.backend_status.startswith("heuristic-fallback")
    [update] = out.note_updates
    assert update.content == block + "\n\nirradiado al brazo izquierdo"
    assert out.usage is not None and out.usage.output_tokens == 2000


def test_reasoning_model_gets_low_effort_and_room_to_think() -> None:
    """gpt-5.6-luna o gpt-6-luna en la hoja en blanco: esfuerzo bajo (no el
    «medium» de OpenAI) y un tope de salida que no se coma el razonamiento. A
    un modelo que no razona no se le manda `reasoning`: la API respondería 400."""
    import os
    from miracle_agent.integrations.product_llm.config import ProductLLMSettings
    from miracle_agent.integrations.product_llm.models import ProductLLMOrchestratorInput, VoiceTranscriptSegment
    from miracle_agent.integrations.product_llm.note_orchestrator_adapter import ProductLLMOrchestratorAdapter

    seg = VoiceTranscriptSegment(segment_id="s", kind="final", transcript="dolor torácico")
    req = ProductLLMOrchestratorInput(
        voice_session_id="v", note_path=None, note_title="n", note_content="",
        last_applied_note_block=None, transcript_history=["dolor torácico"], segment=seg,
    )

    def payload_for(model: str) -> dict:
        adapter = ProductLLMOrchestratorAdapter(ProductLLMSettings(provider="openai", base_url="https://x", api_key="k", model=model))
        return adapter._planner._build_payload(req)  # type: ignore[attr-defined]

    for model in ("gpt-5.6-luna", "gpt-6-luna", "gpt-5-mini", "o4-mini"):
        payload = payload_for(model)
        assert payload["reasoning"] == {"effort": "low"}, model
        assert payload["max_output_tokens"] >= 8000, model
        assert "temperature" not in payload, model
    for model in ("gpt-4.1", "gpt-4.1-mini", "gpt-4o"):
        payload = payload_for(model)
        assert "reasoning" not in payload, model
        assert payload["max_output_tokens"] == 2000, model

    env = {"MIRACLE_PRODUCT_LLM_PROVIDER": "openai", "MIRACLE_PRODUCT_LLM_API_KEY": "k", "MIRACLE_PRODUCT_LLM_MODEL": "gpt-5.6-luna"}
    saved = {k: os.environ.get(k) for k in [*env, "MIRACLE_PRODUCT_LLM_REASONING_EFFORT", "MIRACLE_PRODUCT_LLM_TIMEOUT_SECONDS"]}
    try:
        os.environ.update(env)
        os.environ.pop("MIRACLE_PRODUCT_LLM_TIMEOUT_SECONDS", None)
        os.environ["MIRACLE_PRODUCT_LLM_REASONING_EFFORT"] = "medium"
        settings = ProductLLMSettings.from_env()
        assert settings.reasoning_effort == "medium"
        assert settings.timeout_seconds == 40.0
        os.environ["MIRACLE_PRODUCT_LLM_MODEL"] = "gpt-4.1"
        assert ProductLLMSettings.from_env().timeout_seconds == 20.0
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
