// Snapshot de la nota firmada que se congela dentro del trabajo de exportación.
//
// Por qué un snapshot y no leer `consultations` en el momento de ejecutar: el
// trabajo queda autocontenido y auditable. Lo que el ejecutor escribe en el HIS
// es exactamente lo que se validó y se hasheó al crear la exportación, aunque
// alguien purgue, migre o (en el futuro) adende la consulta después.
//
// PHI: el snapshot lleva el contenido clínico porque es lo que hay que escribir
// en el HIS, pero NUNCA nombre ni documento del paciente — solo `patient_ref`
// (el uuid). El nombre no hace falta: el ejecutor ya está dentro del contexto
// del paciente en el HIS cuando llena el formulario.

// Secciones de `consultations.note` (jsonb):
//   { id, titulo, kind: 'texto', texto }
//   { id, titulo, kind: 'lista', items: [] }
function normalizeSections(note) {
  if (!Array.isArray(note)) return [];
  return note
    .filter((section) => section && typeof section === 'object')
    .map((section) => ({
      id: `${section.id || ''}`,
      titulo: `${section.titulo || ''}`,
      kind: section.kind === 'lista' ? 'lista' : 'texto',
      texto: typeof section.texto === 'string' ? section.texto : '',
      items: Array.isArray(section.items) ? section.items.map((item) => `${item}`) : []
    }));
}

// Códigos aceptados: los sugeridos/rechazados no van a la historia clínica.
function acceptedCodes(codigos) {
  if (!Array.isArray(codigos)) return [];
  return codigos
    .filter((code) => code && typeof code === 'object' && `${code.estado || ''}` === 'aceptado')
    .map((code) => ({
      sistema: `${code.sistema || ''}`,
      codigo: `${code.codigo || ''}`,
      descripcion: `${code.descripcion || ''}`
    }));
}

// Texto plano listo para volcar en el HIS: títulos en mayúsculas con dos puntos,
// secciones separadas por línea en blanco. Es también el `context` que consume
// el resolver de variables de los workflows de automatización.
function renderNoteText(consultation) {
  const blocks = [];

  for (const section of normalizeSections(consultation.note)) {
    const titulo = (section.titulo || section.id || 'SECCIÓN').toLocaleUpperCase('es-CO');
    const cuerpo = section.kind === 'lista'
      ? section.items.filter((item) => `${item}`.trim()).map((item) => `- ${item}`).join('\n')
      : `${section.texto || ''}`.trim();
    if (!cuerpo) continue;
    blocks.push(`${titulo}:\n${cuerpo}`);
  }

  const resumen = `${consultation.resumen || ''}`.trim();
  if (resumen) blocks.push(`RESUMEN:\n${resumen}`);

  const codes = acceptedCodes(consultation.codigos);
  if (codes.length) {
    const lineas = codes
      .map((code) => [code.sistema, code.codigo].filter(Boolean).join(' ') + (code.descripcion ? ` — ${code.descripcion}` : ''))
      .map((linea) => linea.trim())
      .filter(Boolean);
    if (lineas.length) blocks.push(`CODIFICACIÓN:\n${lineas.join('\n')}`);
  }

  return blocks.join('\n\n');
}

/**
 * Construye el payload que viaja al ejecutor. `firma` se copia tal cual (quién
 * firmó, cuándo y con qué hash) para que el trabajo sea auditable por sí solo.
 */
function buildNoteExportPayload(consultation) {
  const renderedText = renderNoteText(consultation);
  const firma = consultation.firma && typeof consultation.firma === 'object' ? consultation.firma : {};

  return {
    note: normalizeSections(consultation.note),
    resumen: `${consultation.resumen || ''}`,
    codigos: acceptedCodes(consultation.codigos),
    firma: {
      por: `${firma.por || ''}`,
      fecha: `${firma.fecha || ''}`,
      hash: `${firma.hash || ''}`
    },
    // Solo la referencia: nunca nombre ni documento.
    patient_ref: `${consultation.patient_id || ''}`,
    especialidad: `${consultation.especialidad || ''}`,
    servicio: `${consultation.servicio || ''}`,
    fecha: `${consultation.fecha || ''}`,
    rendered_text: renderedText,
    // Mismo texto, con el nombre que espera el resolver de variables de los
    // workflows. Duplicado a propósito: el contrato del ejecutor no debería
    // tener que saber que `context` y `rendered_text` son lo mismo hoy.
    context: renderedText
  };
}

module.exports = {
  buildNoteExportPayload,
  renderNoteText,
  normalizeSections,
  acceptedCodes
};
