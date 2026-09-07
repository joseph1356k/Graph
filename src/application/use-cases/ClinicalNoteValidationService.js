const { clinicalError } = require('./ClinicalErrors');
const text = require('../../domain/clinical/textNormalize');
const grounding = require('../../domain/clinical/grounding');

// Valida y repara note_json contra el template_snapshot de la consulta, y
// VERIFICA lo que el prompt promete. Regla del módulo clínico: toda promesa de
// un prompt necesita un verificador; lo que no se comprueba se incumple en algún
// porcentaje de casos.
//
//   - cada fragmento de `evidence` debe estar, literal, en la transcripción;
//   - una sección con contenido y sin evidencia superviviente es `inferred`;
//   - una sección LITERAL cuyo contenido no sale del dictado recibe warning;
//   - `evidence_spans` da los offsets reales en la transcripción persistida.
//
// El snapshot manda: mismas keys, mismos labels, mismo orden.
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
const MAX_EVIDENCE_FRAGMENTS = 4;
const MAX_EVIDENCE_FRAGMENT_LENGTH = 200;
const MAX_WARNINGS = 20;
const EVIDENCE_JOINER = ' … ';
// Por debajo de esto, una sección literal no "sale del dictado". Tolera lo que
// el STT cambia (números como palabra, puntuación dictada) porque la
// normalización literal ya iguala esos casos.
const VERBATIM_COVERAGE_MIN = 0.85;

function normalizeComparable(value = '') {
  // Comparación de labels y frases prudentes: además de la normalización común,
  // se ignoran los puntos finales ("No referido." == "No referido").
  return text.normalizeComparable(value).replace(/[.\s]+$/g, '');
}

// Eleva a mayúscula la primera letra de la casilla (requisito de patología:
// cada casilla empieza con mayúscula). No toca números (p. ej. rótulos como
// "26-3456"), signos ni el resto del texto; respeta espacios iniciales.
function capitalizeFirst(content = '') {
  return `${content || ''}`.replace(
    /^(\s*)(\p{Ll})/u,
    (_, space, letter) => `${space}${letter.toUpperCase()}`
  );
}

function isPrudentEmptyContent(content = '') {
  const normalized = normalizeComparable(content);
  if (!normalized) {
    return true;
  }
  return PRUDENT_EMPTY_PHRASES.some((phrase) => normalized === normalizeComparable(phrase));
}

function snapshotSections(templateSnapshot) {
  const sections = Array.isArray(templateSnapshot?.sections) ? templateSnapshot.sections : [];
  return sections
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

// `evidence` llega como array (contrato nuevo) o como string (contrato viejo,
// notas persistidas). Siempre se trabaja con fragmentos.
function evidenceFragments(raw) {
  const list = Array.isArray(raw)
    ? raw
    : `${raw ?? ''}`.split(EVIDENCE_JOINER);
  return list
    .map((item) => `${item ?? ''}`.trim().slice(0, MAX_EVIDENCE_FRAGMENT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_FRAGMENTS);
}

function joinEvidence(fragments) {
  return fragments.join(EVIDENCE_JOINER).slice(0, MAX_EVIDENCE_LENGTH);
}

/**
 * Sección cuyo contenido no cambió respecto a la nota anterior: conserva su
 * grounding, confidence, evidence y evidence_spans tal como se persistieron.
 * La comparten validateAndRepair (ajustes del asistente) y validateEditedNote
 * (ediciones del médico). Devuelve null si cambió o no hay nota previa.
 */
function untouchedSection(expectedSection, content, prior) {
  if (!prior || typeof prior.content !== 'string') {
    return null;
  }
  if (normalizeComparable(prior.content) !== normalizeComparable(content)) {
    return null;
  }
  const level = grounding.normalizeGrounding(prior.grounding)
    || grounding.groundingFromConfidence(prior.confidence)
    || 'entailed';
  return {
    key: expectedSection.key,
    label: expectedSection.label,
    content: capitalizeFirst(content).slice(0, MAX_SECTION_CONTENT_LENGTH),
    grounding: level,
    confidence: grounding.confidenceFromGrounding(level),
    evidence: joinEvidence(evidenceFragments(prior.evidence)),
    evidence_spans: Array.isArray(prior.evidence_spans) ? prior.evidence_spans : []
  };
}

class ClinicalNoteValidationService {
  /**
   * Repara la salida del modelo (secciones omitidas, extras, keys mal) y
   * verifica grounding contra la transcripción cuando se le pasa.
   *
   * @param {object} parsed salida del modelo
   * @param {object} templateSnapshot snapshot de la consulta
   * @param {{transcript?: string, modes?: object}} [options] transcripción para
   *   verificar evidencia y modos por sección (NoteModeResolver.resolve) para
   *   comprobar las literales. Sin transcript no se verifica nada.
   */
  /**
   * @param {object} options
   * @param {string} options.transcript  Texto contra el que se verifican las citas.
   * @param {object} options.modes       Resultado de NoteModeResolver.resolve.
   * @param {{sectionKey: string}|null} options.dictation
   *   Sólo en un ajuste de tipo `dictation`: la única sección donde el
   *   centinela «[dictado del médico]» vale como evidencia. En cualquier otra
   *   ruta el centinela es una cita que no existe en la transcripción.
   * @param {object|null} options.previous
   *   Nota anterior: las secciones cuyo contenido no cambió conservan su
   *   grounding/evidencia sin volver a verificarse (una reescritura del plan
   *   no puede degradar una sección dictada la semana pasada).
   */
  validateAndRepair(parsed, templateSnapshot, { transcript = '', modes = null, dictation = null, previous = null } = {}) {
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

    const transcriptText = `${transcript || ''}`;
    const canVerify = transcriptText.trim().length > 0;
    const index = canVerify ? text.buildNormalizedIndex(transcriptText) : null;
    const verbatimKeys = new Set(Array.isArray(modes?.verbatimKeys) ? modes.verbatimKeys : []);
    let evidenceDropped = 0;
    const dictationKey = dictation && typeof dictation === 'object' ? `${dictation.sectionKey || ''}`.trim() : '';
    const previousByKey = new Map(
      (Array.isArray(previous?.sections) ? previous.sections : [])
        .map((section) => [`${section?.key || ''}`.trim(), section])
    );

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
      let level = grounding.normalizeGrounding(raw?.grounding)
        || grounding.groundingFromConfidence(raw?.confidence)
        || null;
      let fragments = evidenceFragments(raw?.evidence);
      let spans = [];

      if (!raw) {
        warnings.push(`El modelo omitió la sección "${expectedSection.label}"; se marcó como no mencionada.`);
        content = MISSING_CONTENT_PHRASE;
      } else if (!content) {
        warnings.push(`La sección "${expectedSection.label}" llegó vacía; se marcó como no mencionada.`);
        content = MISSING_CONTENT_PHRASE;
      }

      const carried = untouchedSection(expectedSection, content, previousByKey.get(expectedSection.key));
      if (carried) {
        return carried;
      }

      // El centinela de dictado sólo vale en un ajuste `dictation` y sólo en la
      // sección que el médico indicó. Fuera de ahí (generación, reescritura,
      // otra sección) es una cita inexistente: se descarta y la sección se
      // verifica como cualquier otra. Antes se aceptaba en todas las rutas, y
      // bastaba con que el modelo lo copiara para saltarse la verificación.
      const dictatedHere = Boolean(dictationKey) && expectedSection.key === dictationKey;
      if (!dictatedHere && fragments.includes(grounding.DICTATION_EVIDENCE)) {
        evidenceDropped += fragments.filter((fragment) => fragment === grounding.DICTATION_EVIDENCE).length;
        fragments = fragments.filter((fragment) => fragment !== grounding.DICTATION_EVIDENCE);
        if (!canVerify && fragments.length === 0 && (level === 'explicit' || level === 'entailed')) {
          warnings.push(`Sección "${expectedSection.label}": cita de dictado fuera de un dictado; se trató como no verificada.`);
          level = 'inferred';
        }
      }

      const prudent = isPrudentEmptyContent(content);
      if (prudent) {
        level = 'absent';
        fragments = [];
      } else if (canVerify) {
        // Cada cita tiene que estar, literal, en la transcripción. La que no
        // está se descarta: el modelo puede alucinar el contenido Y la cita.
        const kept = [];
        for (const fragment of fragments) {
          if (fragment === grounding.DICTATION_EVIDENCE) {
            kept.push(fragment);
            continue;
          }
          const hit = text.locateFragment(transcriptText, fragment, index);
          if (hit) {
            kept.push(fragment);
            spans.push(hit);
          } else {
            evidenceDropped += 1;
          }
        }
        fragments = kept;

        if (fragments.length === 0) {
          if (level !== 'inferred') {
            warnings.push(`Sección "${expectedSection.label}": sin evidencia literal en la transcripción; revisar.`);
          }
          level = 'inferred';
        }

        if (verbatimKeys.has(expectedSection.key)) {
          const coverage = text.verbatimCoverage(content, transcriptText);
          if (coverage < VERBATIM_COVERAGE_MIN) {
            warnings.push(`Sección literal "${expectedSection.label}": el contenido no coincide con el dictado (${Math.round(coverage * 100)}% reconocido); revisar.`);
            level = 'inferred';
          }
        }
      }

      if (!level) {
        // Sin grounding del modelo y sin transcripción para comprobar: se
        // asume deducido si trae cita, interpretado si no.
        level = fragments.length > 0 ? 'entailed' : 'inferred';
      }

      return {
        key: expectedSection.key,
        label: expectedSection.label,
        content: capitalizeFirst(content).slice(0, MAX_SECTION_CONTENT_LENGTH),
        grounding: level,
        confidence: grounding.confidenceFromGrounding(level),
        evidence: joinEvidence(fragments),
        evidence_spans: spans
      };
    });

    const extraSections = rawSections.filter((section) => {
      const key = `${section?.key || ''}`.trim() || `label:${normalizeComparable(section?.label)}`;
      return !matchedKeys.has(key);
    });
    if (extraSections.length > 0) {
      warnings.push(`El modelo devolvió ${extraSections.length} sección(es) fuera de la plantilla; fueron ignoradas.`);
    }
    if (evidenceDropped > 0) {
      warnings.push(`${evidenceDropped} cita(s) del modelo no aparecen en la transcripción y fueron descartadas.`);
    }

    let summary = typeof source.summary === 'string' ? source.summary.trim() : '';
    if (!summary) {
      warnings.push('El modelo no devolvió summary; se dejó un resumen mínimo.');
      summary = 'Resumen no disponible; revisar secciones de la nota.';
    }

    const missingRequired = sections
      .filter((section, position) => expected[position].required && isPrudentEmptyContent(section.content))
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

  /**
   * Validación estricta de notas editadas por el médico (PUT /note): la
   * estructura ya debe coincidir con el snapshot; aquí no se inventa ni rellena.
   * Con `previous` (la nota anterior), las secciones cuyo contenido no cambió
   * conservan su grounding; las que sí, pasan a 'edited' (la fuente más fuerte:
   * el médico lo escribió).
   */
  validateEditedNote(noteJson, templateSnapshot, { previous = null } = {}) {
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

    const previousByKey = new Map(
      (Array.isArray(previous?.sections) ? previous.sections : [])
        .map((section) => [`${section?.key || ''}`.trim(), section])
    );

    const sections = expected.map((expectedSection) => {
      const raw = provided.get(expectedSection.key);
      if (!raw) {
        throw clinicalError('NOTE_JSON_INVALID', `Falta la sección "${expectedSection.key}" en note_json.`);
      }
      if (typeof raw.content !== 'string') {
        throw clinicalError('NOTE_JSON_INVALID', `La sección "${expectedSection.key}" debe tener content de tipo string.`);
      }
      const content = capitalizeFirst(raw.content).slice(0, MAX_SECTION_CONTENT_LENGTH);
      const prior = previousByKey.get(expectedSection.key);
      const carried = untouchedSection(expectedSection, content, prior);
      if (carried) {
        return carried;
      }

      if (prior) {
        // Cambió respecto a la nota anterior: lo escribió el médico.
        return {
          key: expectedSection.key,
          label: expectedSection.label,
          content,
          grounding: grounding.EDITED,
          confidence: grounding.confidenceFromGrounding(grounding.EDITED),
          evidence: '',
          evidence_spans: []
        };
      }

      // Sin nota previa (llamadores antiguos): se respeta lo que llega.
      const level = grounding.normalizeGrounding(raw.grounding)
        || grounding.groundingFromConfidence(raw.confidence)
        || grounding.EDITED;
      return {
        key: expectedSection.key,
        label: expectedSection.label,
        content,
        grounding: level,
        confidence: grounding.confidenceFromGrounding(level),
        evidence: joinEvidence(evidenceFragments(raw.evidence)),
        evidence_spans: Array.isArray(raw.evidence_spans) ? raw.evidence_spans : []
      };
    });

    const warnings = (Array.isArray(noteJson.warnings) ? noteJson.warnings : [])
      .map((warning) => `${warning || ''}`.trim())
      .filter(Boolean)
      .slice(0, MAX_WARNINGS);

    const missingRequired = sections
      .filter((section, position) => expected[position].required && isPrudentEmptyContent(section.content))
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
ClinicalNoteValidationService.VERBATIM_COVERAGE_MIN = VERBATIM_COVERAGE_MIN;
ClinicalNoteValidationService.EVIDENCE_JOINER = EVIDENCE_JOINER;
ClinicalNoteValidationService.isPrudentEmptyContent = isPrudentEmptyContent;

module.exports = ClinicalNoteValidationService;
