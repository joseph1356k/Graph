// Métricas determinísticas sobre una nota clínica generada (note_json ya
// validado) contra las expectativas de una fixture de tests/fixtures/note-evals.
//
// No hay LLM aquí: todo se calcula con las mismas utilidades de texto que usa
// el validador (domain/clinical/textNormalize), así una métrica que pasa en
// modo grabado significa lo mismo en modo vivo.
const text = require('../../src/domain/clinical/textNormalize');

const PRUDENT_EMPTY = /^(no (referid|mencionad|document|registrad|consignad|explorad|interrogad|evaluad|realizad)|sin (dato|informaci|hallazg)|no se (menciona|refiere|document|registra|interrog)|pendiente)/i;

function isPrudentEmpty(content = '') {
  const clean = `${content || ''}`.trim();
  return !clean || PRUDENT_EMPTY.test(text.normalizeComparable(clean));
}

function noteText(note = {}) {
  const sections = Array.isArray(note.sections) ? note.sections : [];
  return [`${note.summary || ''}`, ...sections.map((section) => `${section?.content || ''}`)].join('\n');
}

function sentencesOf(value = '') {
  return `${value || ''}`.split(/(?<=[.;:!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Evalúa `note` contra `fixture.expect`. Devuelve { metrics, failures }.
 * `failures` vacío = la nota cumple todas las expectativas de la fixture.
 */
function evaluateNote(note, fixture, { transcript = '', modes = null } = {}) {
  const expect = fixture.expect || {};
  const sections = Array.isArray(note?.sections) ? note.sections : [];
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const fullText = noteText(note);
  const comparable = text.normalizeComparable(fullText);
  const failures = [];
  const metrics = {};

  // 1. Modo resuelto.
  if (expect.note_mode && modes) {
    const actual = modes.allVerbatim ? 'verbatim' : (modes.mixed ? 'mixed' : 'interpretive');
    metrics.note_mode = actual;
    if (actual !== expect.note_mode) failures.push(`note_mode: esperado ${expect.note_mode}, resuelto ${actual}`);
  }

  // 2. Secciones requeridas con contenido real.
  const required = Array.isArray(expect.required_filled) ? expect.required_filled : [];
  const filled = required.filter((key) => !isPrudentEmpty(byKey.get(key)?.content));
  metrics.required_filled_rate = required.length ? filled.length / required.length : 1;
  for (const key of required) {
    if (!filled.includes(key)) failures.push(`sección requerida vacía: ${key}`);
  }

  // 3. Secciones que deben quedar como frase prudente.
  for (const key of Array.isArray(expect.absent_sections) ? expect.absent_sections : []) {
    const section = byKey.get(key);
    if (!section || !isPrudentEmpty(section.content) || section.grounding !== 'absent') {
      failures.push(`sección ${key} debía quedar ausente (frase prudente + grounding absent)`);
    }
  }

  // 4. Literales que deben sobrevivir (cifras, dosis, nombres, tiempos).
  const literals = Array.isArray(expect.preserved_literals) ? expect.preserved_literals : [];
  const preserved = literals.filter((literal) => comparable.includes(text.normalizeComparable(literal)));
  metrics.preserved_literals_rate = literals.length ? preserved.length / literals.length : 1;
  for (const literal of literals) {
    if (!preserved.includes(literal)) failures.push(`literal perdido: "${literal}"`);
  }

  // 5. Negaciones: toda frase que nombre el término tiene que traer una pista
  //    de negación. "niega fiebre" nunca puede quedar como "fiebre".
  const negations = Array.isArray(expect.negations) ? expect.negations : [];
  let negationHits = 0;
  for (const rule of negations) {
    const term = text.normalizeComparable(rule.term);
    const cues = (rule.cues || []).map((cue) => text.normalizeComparable(cue));
    const offending = sentencesOf(fullText)
      .map((sentence) => text.normalizeComparable(sentence))
      .filter((sentence) => sentence.includes(term) && !cues.some((cue) => sentence.includes(cue.trim())));
    if (offending.length === 0) negationHits += 1;
    else failures.push(`negación perdida para "${rule.term}": ${offending[0].slice(0, 80)}`);
  }
  metrics.negations_preserved_rate = negations.length ? negationHits / negations.length : 1;

  // 6. Términos prohibidos (diagnóstico "confirmado", datos que nadie dijo, marcas del bloque de anotaciones).
  for (const term of Array.isArray(expect.forbidden_terms) ? expect.forbidden_terms : []) {
    if (comparable.includes(text.normalizeComparable(term))) failures.push(`término prohibido presente: "${term}"`);
  }

  // 7. Cobertura literal de las secciones verbatim.
  const verbatimKeys = Array.isArray(expect.verbatim_keys) ? expect.verbatim_keys : [];
  if (verbatimKeys.length && transcript) {
    const coverages = verbatimKeys.map((key) => text.verbatimCoverage(byKey.get(key)?.content || '', transcript));
    metrics.verbatim_coverage_min = Math.min(...coverages);
    const threshold = Number.isFinite(expect.min_verbatim_coverage) ? expect.min_verbatim_coverage : 0.85;
    verbatimKeys.forEach((key, i) => {
      if (coverages[i] < threshold) failures.push(`cobertura literal de ${key}: ${Math.round(coverages[i] * 100)}% < ${Math.round(threshold * 100)}%`);
    });
  }

  // 8. Cuántas secciones quedaron en "inferred" (deberían disparar revisión).
  const inferred = sections.filter((section) => section.grounding === 'inferred').map((section) => section.key);
  metrics.inferred_sections = inferred.length;
  if (Number.isFinite(expect.max_inferred) && inferred.length > expect.max_inferred) {
    failures.push(`secciones inferred (${inferred.join(', ')}) > ${expect.max_inferred}`);
  }

  // 9. Warnings del validador.
  const warnings = Array.isArray(note?.warnings) ? note.warnings : [];
  metrics.warnings = warnings.length;
  if (Number.isFinite(expect.max_warnings) && warnings.length > expect.max_warnings) {
    failures.push(`warnings (${warnings.length}) > ${expect.max_warnings}: ${warnings[0]}`);
  }

  // 10. evidence_spans: cada offset apunta a texto real de la transcripción.
  if (expect.evidence_spans_valid && transcript) {
    let spans = 0;
    let invalid = 0;
    for (const section of sections) {
      for (const span of Array.isArray(section.evidence_spans) ? section.evidence_spans : []) {
        spans += 1;
        const slice = transcript.slice(span.char_start, span.char_end);
        if (!(span.char_start >= 0 && span.char_end <= transcript.length && span.char_end > span.char_start
          && text.normalizeComparable(slice) === text.normalizeComparable(span.quote))) {
          invalid += 1;
        }
      }
    }
    metrics.evidence_spans = spans;
    if (invalid > 0) failures.push(`${invalid} evidence_span(s) no coinciden con la transcripción`);
    if (spans === 0) failures.push('la nota no trae ningún evidence_span verificado');
  }

  return { metrics, failures };
}

module.exports = { evaluateNote, isPrudentEmpty, noteText };
