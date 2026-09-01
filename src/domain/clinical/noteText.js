// Render de note_json a texto plano/Markdown.
//
// La nota canónica es note_json. Cuando un consumidor necesita texto (la etapa
// de autofill del pipeline público, un cliente que sólo sabe pegar Markdown),
// se deriva de aquí en vez de pedirle al modelo dos formatos.

function renderNoteMarkdown(noteJson = {}) {
  const lines = [];
  const summary = `${noteJson?.summary || ''}`.trim();
  if (summary) {
    lines.push('# Resumen', summary, '');
  }
  const sections = Array.isArray(noteJson?.sections) ? noteJson.sections : [];
  for (const section of sections) {
    const label = `${section?.label || section?.key || ''}`.trim();
    const content = `${section?.content || ''}`.trim();
    if (!label) continue;
    lines.push(`## ${label}`, content, '');
  }
  return lines.join('\n').trim();
}

module.exports = { renderNoteMarkdown };
