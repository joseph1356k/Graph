#!/usr/bin/env node
// Normalización de texto clínico, grounding y localización de fragmentos.
const assert = require('assert');
const text = require('../src/domain/clinical/textNormalize');
const grounding = require('../src/domain/clinical/grounding');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

check('normalizeComparable quita tildes, colapsa espacios y baja a minúsculas', () => {
  assert.strictEqual(text.normalizeComparable('  Dolor   Abdominal  Agudo.  '), 'dolor abdominal agudo.');
  assert.strictEqual(text.normalizeComparable('Niña con FIEBRE'), 'nina con fiebre');
});

check('locateFragment devuelve offsets en el original aunque haya tildes y espacios', () => {
  const haystack = 'La   paciente refiere   Cefalea intensa, sin náuseas.';
  const hit = text.locateFragment(haystack, 'cefalea intensa, sin nauseas');
  assert.ok(hit, 'debe localizar');
  assert.strictEqual(haystack.slice(hit.char_start, hit.char_end), 'Cefalea intensa, sin náuseas');
  assert.strictEqual(hit.quote, 'Cefalea intensa, sin náuseas');
});

check('locateFragment devuelve null cuando la cita no existe', () => {
  assert.strictEqual(text.locateFragment('sin fiebre', 'con fiebre'), null);
  assert.strictEqual(text.locateFragment('lo que sea', ''), null);
});

check('un índice precalculado sirve para varios fragmentos', () => {
  const haystack = 'Primero esto. Luego aquello.';
  const index = text.buildNormalizedIndex(haystack);
  assert.strictEqual(text.locateFragment(haystack, 'Primero esto', index).char_start, 0);
  assert.strictEqual(text.locateFragment(haystack, 'aquello', index).char_start, haystack.indexOf('aquello'));
});

check('normalizeForVerbatim iguala puntuación dictada, «por»→«x» y números en palabra', () => {
  const dictated = 'masa de tres por cuatro centímetros coma bordes irregulares punto y aparte';
  const written = 'Masa de 3 x 4 centímetros, bordes irregulares.';
  assert.strictEqual(text.normalizeForVerbatim(dictated), text.normalizeForVerbatim(written));
});

check('verbatimCoverage es 1 cuando la sección sale del dictado y baja cuando no', () => {
  const transcript = 'se recibe fragmento de piel de dos por uno coma con lesión central punto';
  assert.strictEqual(text.verbatimCoverage('Se recibe fragmento de piel de 2 x 1, con lesión central.', transcript), 1);
  const invented = text.verbatimCoverage('Se recibe fragmento de piel con lesión central y bordes necróticos extensos.', transcript);
  assert.ok(invented < 0.85, `cobertura inventada ${invented}`);
  assert.strictEqual(text.verbatimCoverage('', transcript), 1);
});

check('grounding: normaliza, calcula confidence y acepta sólo explicit/entailed para autofill', () => {
  assert.strictEqual(grounding.normalizeGrounding(' Explicit '), 'explicit');
  assert.strictEqual(grounding.normalizeGrounding('maybe'), null);
  assert.strictEqual(grounding.confidenceFromGrounding('inferred'), 0.4);
  assert.strictEqual(grounding.confidenceFromGrounding('edited'), 1);
  assert.strictEqual(grounding.confidenceFromGrounding(null), 0);
  assert.strictEqual(grounding.groundingFromConfidence(0.95), 'explicit');
  assert.strictEqual(grounding.groundingFromConfidence(0.7), 'entailed');
  assert.strictEqual(grounding.groundingFromConfidence(0.2), 'inferred');
  assert.strictEqual(grounding.groundingFromConfidence(0), 'absent');
  assert.strictEqual(grounding.groundingFromConfidence('x'), null);
  assert.ok(grounding.isGroundedForAutofill('entailed'));
  assert.ok(!grounding.isGroundedForAutofill('inferred'));
});

console.log(`\nverify-clinical-text: ${passed} checks ok`);
