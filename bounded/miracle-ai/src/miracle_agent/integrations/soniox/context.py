"""Builds the Soniox `context` object that specializes stt-rt-v5 for medicine.

Soniox does not ship a separate medical model: the same real-time model is
steered toward a domain by passing a `context` block in the initial WebSocket
config frame (general metadata + a `terms` glossary). We assemble that block
from a base medical glossary, a per-specialty preset, and the operator's own
custom vocabulary, then cap it to Soniox's ~10,000 character limit.

See https://soniox.com/docs/stt/concepts/context
"""
from __future__ import annotations

# Soniox rejects a context larger than ~8,000 tokens / ~10,000 characters. We
# budget against characters and leave headroom for the rest of the config.
MAX_CONTEXT_CHARS = 9000

# Always-on medical vocabulary (common meds, labs, exam wording) added whenever
# the domain is medical, regardless of specialty. Kept compact on purpose.
MEDICAL_BASE_TERMS = [
    "anamnesis", "exploración física", "diagnóstico diferencial", "tratamiento",
    "hipertensión arterial", "diabetes mellitus", "dislipidemia", "obesidad",
    "paracetamol", "ibuprofeno", "amoxicilina", "omeprazol", "metformina",
    "enalapril", "losartán", "atorvastatina", "salbutamol", "corticoide",
    "hemoglobina", "hematocrito", "leucocitos", "plaquetas", "creatinina",
    "glucemia", "colesterol", "triglicéridos", "HbA1c", "TSH", "PCR",
    "cefalea", "disnea", "astenia", "náuseas", "fiebre", "prurito",
]

# id -> preset. The same ids are mirrored (label only) in the Node registry
# (MiracleSttProviderConfigService.SPECIALTIES) so the UI dropdown stays in sync.
SPECIALTY_PRESETS = {
    "general": {
        "label": "Medicina General / Familiar",
        "topic": "Consulta de medicina general",
        "terms": [
            "atención primaria", "control de crónicos", "cuadro viral",
            "faringitis", "lumbalgia", "gastroenteritis", "infección urinaria",
            "índice de masa corporal", "signos vitales", "tensión arterial",
        ],
    },
    "cardiologia": {
        "label": "Cardiología",
        "topic": "Consulta de cardiología",
        "terms": [
            "fibrilación auricular", "insuficiencia cardíaca", "infarto agudo de miocardio",
            "angina de pecho", "electrocardiograma", "ecocardiograma", "soplo sistólico",
            "disnea de esfuerzo", "taquicardia", "bradicardia", "troponina",
            "betabloqueante", "anticoagulante", "estenosis aórtica", "arritmia",
        ],
    },
    "pediatria": {
        "label": "Pediatría",
        "topic": "Consulta pediátrica",
        "terms": [
            "percentil", "lactancia materna", "calendario de vacunación", "otitis media",
            "bronquiolitis", "exantema", "deshidratación", "desarrollo psicomotor",
            "peso al nacer", "fontanela", "reflujo gastroesofágico", "convulsión febril",
        ],
    },
    "ginecologia": {
        "label": "Ginecología y Obstetricia",
        "topic": "Consulta de ginecología y obstetricia",
        "terms": [
            "embarazo", "gestación", "ecografía obstétrica", "amenorrea", "dismenorrea",
            "citología cervical", "Papanicolaou", "preeclampsia", "trimestre",
            "fecha de última regla", "cesárea", "menopausia", "endometriosis",
        ],
    },
    "dermatologia": {
        "label": "Dermatología",
        "topic": "Consulta de dermatología",
        "terms": [
            "dermatitis atópica", "psoriasis", "melanoma", "eccema", "urticaria",
            "lesión pigmentada", "nevo", "prurito", "biopsia cutánea",
            "corticoide tópico", "acné", "rosácea", "carcinoma basocelular",
        ],
    },
}

DEFAULT_SPECIALTY = "general"


def list_specialties() -> list[dict[str, str]]:
    """Public catalog (id + label) for UI dropdowns."""
    return [{"id": key, "label": value["label"]} for key, value in SPECIALTY_PRESETS.items()]


def parse_custom_terms(raw: str | None) -> list[str]:
    """One term per line (newlines), with commas as a secondary separator."""
    if not raw:
        return []
    terms: list[str] = []
    for line in str(raw).replace("\r", "\n").split("\n"):
        for chunk in line.split(","):
            term = chunk.strip()
            if term:
                terms.append(term)
    return terms


def _dedupe_preserving_order(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for term in terms:
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            ordered.append(term)
    return ordered


def build_soniox_context(
    *,
    domain: str,
    specialty: str | None = None,
    custom_terms: list[str] | None = None,
    session_terms: list[str] | None = None,
    session_general: list[dict[str, str]] | None = None,
    session_text: str | None = None,
) -> dict[str, object] | None:
    """Assemble the Soniox context block, or None when medicine is not active.

    Precedence for `terms` (highest kept first when trimming): custom operator
    vocabulary, per-session terms, specialty preset, then the medical base.
    """
    if (domain or "").strip().lower() != "medical":
        return None

    specialty_id = (specialty or DEFAULT_SPECIALTY).strip().lower()
    preset = SPECIALTY_PRESETS.get(specialty_id) or SPECIALTY_PRESETS[DEFAULT_SPECIALTY]

    general: list[dict[str, str]] = [
        {"key": "domain", "value": "Healthcare"},
        {"key": "topic", "value": preset["topic"]},
    ]
    for entry in session_general or []:
        key = str(entry.get("key", "")).strip()
        value = str(entry.get("value", "")).strip()
        if key and value:
            general.append({"key": key, "value": value})

    # Highest-priority terms first so the trim keeps the most specific ones.
    ordered_terms = _dedupe_preserving_order(
        [*(custom_terms or []), *(session_terms or []), *preset["terms"], *MEDICAL_BASE_TERMS]
    )

    context: dict[str, object] = {"general": general}
    text = (session_text or "").strip()
    if text:
        context["text"] = text

    kept_terms = _cap_terms(context, ordered_terms)
    if kept_terms:
        context["terms"] = kept_terms
    return context


def _context_char_length(context: dict[str, object]) -> int:
    total = 0
    for entry in context.get("general", []):  # type: ignore[assignment]
        total += len(str(entry.get("key", ""))) + len(str(entry.get("value", "")))
    total += len(str(context.get("text", "")))
    for term in context.get("terms", []):  # type: ignore[assignment]
        total += len(str(term)) + 1
    return total


def _cap_terms(context_without_terms: dict[str, object], ordered_terms: list[str]) -> list[str]:
    """Keep as many high-priority terms as fit under MAX_CONTEXT_CHARS."""
    base = _context_char_length(context_without_terms)
    kept: list[str] = []
    used = base
    for term in ordered_terms:
        cost = len(term) + 1
        if used + cost > MAX_CONTEXT_CHARS:
            break
        kept.append(term)
        used += cost
    return kept
