// Hash del contenido firmado de una nota clínica — lado Graph.
//
// Graph NO firma notas: las firma Miracle Notes. Este módulo existe para
// RE-VERIFICAR, al exportar a la historia clínica, que la versión que se va a
// enviar al HIS es exactamente la que el médico firmó — leyendo `note`,
// `resumen` y `codigos` de `consultations` y comparando con `firma.hash`.
//
// CONTRATO COMPARTIDO CON MIRACLE NOTES — no cambiar de un lado solamente.
//   sha256(JSON.stringify({ note, resumen, codigos }))
// Ese orden de claves es parte del contrato. La implementación espejo vive en
// `Pagina-web-clientes-final/lib/clinical/signature-hash.ts` y las dos se
// validan contra el mismo vector: `tests/fixtures/signature-hash-vector.json`
// (copia idéntica en los dos repos).
const { createHash } = require('crypto');

// Serialización canónica del contenido firmado.
//
// Una columna ausente se normaliza a `null` porque es lo que PostgREST devuelve
// para un NULL de Postgres. Sin esta normalización un `undefined` desaparecería
// del JSON (`JSON.stringify` omite las claves undefined) y el hash no cuadraría
// con el que calculó la firma en Notes.
function canonicalSignaturePayload(content = {}) {
  return JSON.stringify({
    note: typeof content.note === 'undefined' ? null : content.note,
    resumen: typeof content.resumen === 'undefined' ? null : content.resumen,
    codigos: typeof content.codigos === 'undefined' ? null : content.codigos
  });
}

// SHA-256 en hex minúsculas del contenido firmado.
function computeSignatureHash(content = {}) {
  return createHash('sha256').update(canonicalSignaturePayload(content)).digest('hex');
}

// Compara el hash guardado en `firma.hash` con el recalculado. Devuelve false
// si no hay hash guardado: "sin hash" nunca cuenta como "verificado" (esos
// casos se resuelven con hash_source='computed_at_export', decisión del
// servicio de exportación, no de esta función).
function signatureHashMatches(content, storedHash) {
  const stored = typeof storedHash === 'string' ? storedHash.trim().toLowerCase() : '';
  if (!stored) return false;
  return stored === computeSignatureHash(content);
}

module.exports = {
  canonicalSignaturePayload,
  computeSignatureHash,
  signatureHashMatches
};
