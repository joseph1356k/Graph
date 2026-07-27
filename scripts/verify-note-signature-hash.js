// GATE del contrato de exportación a historia clínica — lado Graph.
//   node scripts/verify-note-signature-hash.js
//
// Miracle Notes firma la nota calculando un hash del contenido; Graph re-verifica
// ese mismo hash antes de mandar la nota al HIS. Si las dos serializaciones se
// separan (orden de claves, unicode, undefined vs null), o todas las
// exportaciones se rechazan, o —peor— se acepta contenido distinto al firmado.
//
// Este script y su gemelo en Notes (`tests/signature-hash.test.ts`) leen EL
// MISMO vector, byte a byte idéntico en los dos repos:
//   tests/fixtures/signature-hash-vector.json
//
// Si esto falla tras un cambio de serialización: los hashes de las notas ya
// firmadas dejan de verificar. No se "arregla" regenerando el vector — eso
// requiere migración de datos.
const assert = require('assert');
const path = require('path');

const {
  canonicalSignaturePayload,
  computeSignatureHash,
  signatureHashMatches
} = require('../src/application/use-cases/NoteSignatureHash');

const VECTOR_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'signature-hash-vector.json');
const vector = require(VECTOR_PATH);

let checks = 0;
function check(label, fn) {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

console.log('Vector compartido del hash de la firma (Notes ↔ Graph)');

check('el vector trae casos y declara el algoritmo del contrato', () => {
  assert.ok(Array.isArray(vector.cases) && vector.cases.length > 0, 'el vector no tiene casos');
  assert.strictEqual(vector.algorithm, 'sha256');
  assert.strictEqual(vector.serialization, 'JSON.stringify({ note, resumen, codigos })');
});

for (const testCase of vector.cases) {
  check(`reproduce el hash esperado — ${testCase.name}`, () => {
    assert.strictEqual(
      computeSignatureHash(testCase.consultation),
      testCase.expected_hash,
      `hash distinto para el caso "${testCase.name}"`
    );
  });
}

check('todos los hashes del vector son sha256 hex minúsculas y distintos entre sí', () => {
  const hashes = vector.cases.map((c) => c.expected_hash);
  for (const hash of hashes) {
    assert.ok(/^[0-9a-f]{64}$/.test(hash), `hash con formato inesperado: ${hash}`);
  }
  assert.strictEqual(new Set(hashes).size, hashes.length, 'hay hashes repetidos en el vector');
});

console.log('Serialización canónica');

check('fija el orden de claves del contrato: note, resumen, codigos', () => {
  assert.strictEqual(
    canonicalSignaturePayload({ note: 1, resumen: 2, codigos: 3 }),
    '{"note":1,"resumen":2,"codigos":3}'
  );
});

check('es insensible al orden en que llegan las claves del objeto de entrada', () => {
  assert.strictEqual(
    computeSignatureHash({ codigos: [], resumen: 'x', note: [] }),
    computeSignatureHash({ note: [], resumen: 'x', codigos: [] })
  );
});

check('normaliza undefined a null (columna ausente == NULL de Postgres)', () => {
  assert.strictEqual(
    canonicalSignaturePayload({ note: [], codigos: [] }),
    '{"note":[],"resumen":null,"codigos":[]}'
  );
  assert.strictEqual(
    computeSignatureHash({ note: [], codigos: [] }),
    computeSignatureHash({ note: [], resumen: null, codigos: [] })
  );
});

check('distingue resumen null de cadena vacía', () => {
  assert.notStrictEqual(
    computeSignatureHash({ note: [], resumen: null, codigos: [] }),
    computeSignatureHash({ note: [], resumen: '', codigos: [] })
  );
});

check('cambia si cambia cualquiera de los tres campos firmados', () => {
  const base = { note: [{ key: 'plan', content: 'reposo' }], resumen: 'r', codigos: [{ code: 'I10' }] };
  const original = computeSignatureHash(base);
  assert.notStrictEqual(
    computeSignatureHash({ ...base, note: [{ key: 'plan', content: 'reposo ' }] }),
    original
  );
  assert.notStrictEqual(computeSignatureHash({ ...base, resumen: 'r2' }), original);
  assert.notStrictEqual(computeSignatureHash({ ...base, codigos: [{ code: 'I11' }] }), original);
});

console.log('signatureHashMatches');

check('acepta el hash correcto, incluso en mayúsculas o con espacios', () => {
  const content = { note: [], resumen: 'x', codigos: [] };
  const hash = computeSignatureHash(content);
  assert.strictEqual(signatureHashMatches(content, hash), true);
  assert.strictEqual(signatureHashMatches(content, hash.toUpperCase()), true);
  assert.strictEqual(signatureHashMatches(content, `  ${hash}  `), true);
});

check('rechaza contenido alterado', () => {
  const content = { note: [], resumen: 'x', codigos: [] };
  const hash = computeSignatureHash(content);
  assert.strictEqual(signatureHashMatches({ ...content, resumen: 'y' }, hash), false);
});

check('"sin hash" nunca cuenta como verificado', () => {
  const content = { note: [], resumen: 'x', codigos: [] };
  assert.strictEqual(signatureHashMatches(content, ''), false);
  assert.strictEqual(signatureHashMatches(content, null), false);
  assert.strictEqual(signatureHashMatches(content, undefined), false);
  assert.strictEqual(signatureHashMatches(content, 12345), false);
});

console.log(`\n✅ Hash de la firma: ${checks} comprobaciones OK (vector de ${vector.cases.length} casos).`);
