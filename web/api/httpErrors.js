function isDependencyUnavailable(error) {
  const code = `${error?.code || ''}`.trim();
  const message = `${error?.message || ''}`.toLowerCase();
  return code === 'WORKFLOW_STORAGE_UNAVAILABLE'
    || code === 'ServiceUnavailable'
    || message.includes('workflow storage is unavailable')
    || message.includes('failed to connect to server')
    || message.includes('no routing servers available');
}

function statusForError(error) {
  if (/not found/i.test(`${error?.message || ''}`)) {
    return 404;
  }
  if (isDependencyUnavailable(error)) {
    return 503;
  }
  return 500;
}

function publicErrorMessage(error) {
  if (isDependencyUnavailable(error)) {
    return 'El almacenamiento de workflows no está disponible. Verifica la conexión con Neo4j.';
  }
  return `${error?.message || 'Error interno del servidor.'}`;
}

module.exports = {
  isDependencyUnavailable,
  statusForError,
  publicErrorMessage
};
