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
