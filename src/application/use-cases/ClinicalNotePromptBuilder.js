// Builds the strict clinical prompt used to turn a transcript + template
// snapshot into a structured note. The template is the mold, the transcript is
// the raw material; the model must never invent clinical data.
class ClinicalNotePromptBuilder {
  static expectedSchema(sections = []) {
    return {
      summary: 'string — resumen breve y fiel de la consulta',
      sections: sections.map((section) => ({
        key: section.key,
        label: section.label,
        content: 'string — contenido clínico de la sección',
        confidence: 'number entre 0 y 1',
        evidence: 'string — cita breve de la transcripción que soporta el contenido (puede ser vacía)'
      })),
      warnings: ['string — problemas detectados (transcripción insuficiente, datos contradictorios, etc.)'],
      missing_required_sections: ['string — keys de secciones obligatorias sin información']
    };
  }

  build({ transcript = '', templateSnapshot = {} } = {}) {
    const sections = Array.isArray(templateSnapshot.sections) ? templateSnapshot.sections : [];
    const sectionRules = sections
      .map((section) => `${section.order}. key="${section.key}" · label="${section.label}"${section.required ? ' · OBLIGATORIA' : ''}\n   Instrucción: ${section.instruction}`)
      .join('\n');

    const system = [
      'Eres Miracle Clinical Note Generator, un motor que convierte transcripciones de consultas médicas en notas clínicas estructuradas en español.',
      'La plantilla NO es la nota: la plantilla es el molde y la transcripción es la única materia prima.',
      '',
      'REGLAS ESTRICTAS DE NO INVENCIÓN:',
      '- Usa únicamente información mencionada de forma explícita en la transcripción.',
      '- No inventes signos vitales, examen físico, antecedentes, medicamentos, dosis, resultados de laboratorio ni diagnósticos confirmados.',
      '- La impresión diagnóstica debe ser prudente, en términos de probabilidad y pendiente de criterio médico.',
      '- Si algo no fue mencionado, usa una frase prudente como "No referido.", "No mencionado en la consulta." o "No documentado en la transcripción."',
      '- Si la evidencia es débil, baja el valor de confidence.',
      '',
      'REGLAS DE PUNTUACIÓN DICTADA:',
      '- El médico puede dictar signos de puntuación como palabras (ej: "coma", "punto", "punto y seguido", "punto y aparte", "punto final", "dos puntos", "punto y coma", "abre paréntesis" / "entre paréntesis" ... "cierra paréntesis", "abre comillas" ... "cierra comillas", "guion", "signo de interrogación", "signo de pregunta").',
      '- Cuando identifiques estas palabras usadas como comando de puntuación (no como término clínico), NO las transcribas literalmente: aplica el signo correspondiente en el texto de la sección ((), coma, punto, saltos de párrafo para "punto y aparte", etc.).',
      '- "punto y aparte" implica cierre de oración y salto de párrafo dentro del contenido de la sección; "punto y seguido" o "punto" solo cierra la oración.',
      '- Usa el contexto clínico para diferenciar un comando de puntuación de una palabra con significado médico real (ej. "coma" como estado de conciencia, "punto" en "punto de sutura"); en ese caso consérvala como texto normal.',
      '- Si tras aplicar la puntuación una frase queda ambigua o dudas si era comando o contenido clínico, prioriza la interpretación clínica y agrega un warning.',
      '',
      'REGLAS DE ESTRUCTURA:',
      '- Devuelve ÚNICAMENTE un objeto JSON válido, sin markdown ni texto fuera del JSON.',
      '- "sections" debe contener EXACTAMENTE las secciones de la plantilla: mismas keys, mismos labels, mismo orden.',
      '- No agregues secciones extra ni omitas ninguna.',
      '- Cada sección: {"key","label","content","confidence","evidence"}.',
      '- "evidence" es una cita breve y textual de la transcripción; usa "" cuando la sección quede en "No mencionado".',
      '- "warnings": lista problemas reales (transcripción insuficiente, datos contradictorios, secciones obligatorias sin información).',
      '- "missing_required_sections": keys de secciones OBLIGATORIAS que quedaron sin información.',
      '',
      'SECCIONES DE LA PLANTILLA (en orden):',
      sectionRules
    ].join('\n');

    const user = JSON.stringify({
      task: 'Genera la nota clínica estructurada de esta consulta.',
      template: {
        name: templateSnapshot.name || '',
        specialty: templateSnapshot.specialty || '',
        sections: sections.map((section) => ({
          key: section.key,
          label: section.label,
          order: section.order,
          required: Boolean(section.required),
          instruction: section.instruction
        }))
      },
      transcript: `${transcript || ''}`,
      expected_schema: ClinicalNotePromptBuilder.expectedSchema(sections)
    });

    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }
}

module.exports = ClinicalNotePromptBuilder;
