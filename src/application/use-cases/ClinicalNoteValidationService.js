const { clinicalError } = require('./ClinicalErrors');

// Validates and repairs note_json against the encounter's template_snapshot.
// The snapshot is the source of truth: same keys, same labels, same order.
const MISSING_CONTENT_PHRASE = 'No mencionado en la consulta.';
const PRUDENT_EMPTY_PHRASES = [
  'no referido',
  'no referidos',
  'no mencionado en la consulta',
  'no documentado en la transcripcion',
  'no documentado en la transcripción'
];
const MAX_SUMMARY_LENGTH = 2000;
const MAX_SECTION_CONTENT_LENGTH = 8000;
const MAX_EVIDENCE_LENGTH = 500;
const MAX_WARNINGS = 20;

function normalizeComparable(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s]+$/g, '')
    .trim()
    .toLowerCase();
}

function isPrudentEmptyContent(content = '') {
  const normalized = normalizeComparable(content);
  if (!normalized) {
    return true;
  }
  return PRUDENT_EMPTY_PHRASES.some((phrase) => normalized === normalizeComparable(phrase));
}

function clampConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}

function snapshotSections(templateSnapshot) {
  const sections = Array.isArray(templateSnapshot?.sections) ? templateSnapshot.sections : [];
  return sections
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

class ClinicalNoteValidationService {
  // Repairs LLM output: fills omitted sections, drops extras, restores
  // key/label/order from the snapshot, clamps confidence, rebuilds the
  // missing_required_sections list.
  validateAndRepair(parsed, templateSnapshot) {
    const expected = snapshotSections(templateSnapshot);
    if (expected.length === 0) {
      throw clinicalError('TEMPLATE_INVALID', 'El template_snapshot de la consulta no tiene secciones.');
    }

    const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const warnings = [];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push('La respuesta del modelo no fue un objeto JSON válido; se reconstruyó la nota.');
    }

    const modelWarnings = (Array.isArray(source.warnings) ? source.warnings : [])
      .map((warning) => `${warning || ''}`.trim())
      .filter(Boolean);

    const rawSections = Array.isArray(source.sections) ? source.sections : [];
    const byKey = new Map();
    rawSections.forEach((section) => {
      const key = `${section?.key || ''}`.trim();
      if (key && !byKey.has(key)) {
        byKey.set(key, section);
      }
    });
    const byLabel = new Map();
    rawSections.forEach((section) => {
      const label = normalizeComparable(section?.label);
      if (label && !byLabel.has(label)) {
        byLabel.set(label, section);
      }
    });

    const matchedKeys = new Set();
    const sections = expected.map((expectedSection) => {
      let raw = byKey.get(expectedSection.key) || null;
      if (!raw) {
        raw = byLabel.get(normalizeComparable(expectedSection.label)) || null;
        if (raw && `${raw.key || ''}`.trim() && `${raw.key}`.trim() !== expectedSection.key) {
          warnings.push(`La sección "${expectedSection.label}" llegó con key incorrecta y fue corregida.`);
        }
      }
      if (raw) {
        matchedKeys.add(`${raw.key || ''}`.trim() || `label:${normalizeComparable(raw.label)}`);
      }

      let content = typeof raw?.content === 'string' ? raw.content.trim() : '';
      let confidence = clampConfidence(raw?.confidence);
      let evidence = typeof raw?.evidence === 'string' ? raw.evidence.trim() : '';

      if (!raw) {
        warnings.push(`El modelo omitió la sección "${expectedSection.label}"; se marcó como no mencionada.`);
        content = MISSING_CONTENT_PHRASE;
        confidence = 0;
        evidence = '';
      } else if (!content) {
        warnings.push(`La sección "${expectedSection.label}" llegó vacía; se marcó como no mencionada.`);
        content = MISSING_CONTENT_PHRASE;
        confidence = 0;
        evidence = '';
      }

      if (isPrudentEmptyContent(content)) {
        confidence = 0;
        evidence = '';
      }

      return {
        key: expectedSection.key,
        label: expectedSection.label,
        content: content.slice(0, MAX_SECTION_CONTENT_LENGTH),
        confidence,
        evidence: evidence.slice(0, MAX_EVIDENCE_LENGTH)
      };
    });

    const extraSections = rawSections.filter((section) => {
      const key = `${section?.key || ''}`.trim() || `label:${normalizeComparable(section?.label)}`;
      return !matchedKeys.has(key);
    });
    if (extraSections.length > 0) {
      warnings.push(`El modelo devolvió ${extraSections.length} sección(es) fuera de la plantilla; fueron ignoradas.`);
    }

    let summary = typeof source.summary === 'string' ? source.summary.trim() : '';
    if (!summary) {
      warnings.push('El modelo no devolvió summary; se dejó un resumen mínimo.');
      summary = 'Resumen no disponible; revisar secciones de la nota.';
    }

    const missingRequired = sections
      .filter((section, index) => expected[index].required && isPrudentEmptyContent(section.content))
      .map((section) => section.key);
    if (missingRequired.length > 0) {
      warnings.push(`Secciones obligatorias sin información en la transcripción: ${missingRequired.join(', ')}.`);
    }

    return {
      summary: summary.slice(0, MAX_SUMMARY_LENGTH),
      sections,
      warnings: [...modelWarnings, ...warnings].slice(0, MAX_WARNINGS),
      missing_required_sections: missingRequired
    };
  }

  // Strict validation for doctor-edited notes (PUT /note): the structure must
  // already match the snapshot; nothing is invented or filled here.
  validateEditedNote(noteJson, templateSnapshot) {
    const expected = snapshotSections(templateSnapshot);
    if (expected.length === 0) {
      throw clinicalError('TEMPLATE_INVALID', 'El template_snapshot de la consulta no tiene secciones.');
    }
    if (!noteJson || typeof noteJson !== 'object' || Array.isArray(noteJson)) {
      throw clinicalError('NOTE_JSON_INVALID', 'note_json debe ser un objeto.');
    }
    if (typeof noteJson.summary !== 'string') {
      throw clinicalError('NOTE_JSON_INVALID', 'note_json.summary debe ser un string.');
    }
    if (!Array.isArray(noteJson.sections)) {
      throw clinicalError('NOTE_JSON_INVALID', 'note_json.sections debe ser una lista.');
    }

    const provided = new Map();
    noteJson.sections.forEach((section) => {
      const key = `${section?.key || ''}`.trim();
      if (!key) {
        throw clinicalError('NOTE_JSON_INVALID', 'Cada sección editada debe incluir su key.');
      }
      if (provided.has(key)) {
        throw clinicalError('NOTE_JSON_INVALID', `La sección "${key}" está duplicada en note_json.`);
      }
      provided.set(key, section);
    });

    const expectedKeys = new Set(expected.map((section) => section.key));
    for (const key of provided.keys()) {
      if (!expectedKeys.has(key)) {
        throw clinicalError('NOTE_JSON_INVALID', `La sección "${key}" no pertenece a la plantilla de esta consulta.`);
      }
    }

    const sections = expected.map((expectedSection) => {
      const raw = provided.get(expectedSection.key);
      if (!raw) {
        throw clinicalError('NOTE_JSON_INVALID', `Falta la sección "${expectedSection.key}" en note_json.`);
      }
      if (typeof raw.content !== 'string') {
        throw clinicalError('NOTE_JSON_INVALID', `La sección "${expectedSection.key}" debe tener content de tipo string.`);
      }
      return {
        key: expectedSection.key,
        label: expectedSection.label,
        content: raw.content.slice(0, MAX_SECTION_CONTENT_LENGTH),
        confidence: clampConfidence(raw.confidence, 1),
        evidence: typeof raw.evidence === 'string' ? raw.evidence.slice(0, MAX_EVIDENCE_LENGTH) : ''
      };
    });

    const warnings = (Array.isArray(noteJson.warnings) ? noteJson.warnings : [])
      .map((warning) => `${warning || ''}`.trim())
      .filter(Boolean)
      .slice(0, MAX_WARNINGS);

    const missingRequired = sections
      .filter((section, index) => expected[index].required && isPrudentEmptyContent(section.content))
      .map((section) => section.key);

    return {
      summary: noteJson.summary.trim().slice(0, MAX_SUMMARY_LENGTH),
      sections,
      warnings,
      missing_required_sections: missingRequired
    };
  }
}

ClinicalNoteValidationService.MISSING_CONTENT_PHRASE = MISSING_CONTENT_PHRASE;

module.exports = ClinicalNoteValidationService;
