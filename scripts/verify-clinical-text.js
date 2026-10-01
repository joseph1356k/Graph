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

check('locateFragment ignora la puntuación del STT pero no deja cambiar una cifra', () => {
  const haystack = 'Depende. 60 cigarrillos. ¿Ex tabaquismo pesado? 60. ¿Y 60 cigarrillos al día? Actualmente sigue.';
  const hit = text.locateFragment(haystack, 'Y 60 cigarrillos al día');
  assert.ok(hit, 'la cita sin signos debe ubicarse');
  assert.strictEqual(hit.quote, 'Y 60 cigarrillos al día');
  assert.ok(text.locateFragment(haystack, 'ex tabaquismo pesado, 60'), 'una coma de más no descarta la cita');
  assert.strictEqual(text.locateFragment(haystack, 'Y 70 cigarrillos al día'), null);
  assert.strictEqual(text.locateFragment('TSH 29,75 del 10 de septiembre', 'TSH 29,57'), null);
  assert.strictEqual(text.locateFragment('presión 140/70', 'presión 14070'), null);
  assert.strictEqual(text.locateFragment('lo que sea', '¿?...'), null);
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

check('MEDIDAS DICTADAS no penaliza la cobertura literal: «3 x 4 cm» sale de «tres por cuatro centímetros»', () => {
  assert.strictEqual(text.verbatimCoverage('3 x 4 cm', 'tres por cuatro centímetros'), 1);
  assert.strictEqual(text.verbatimCoverage('Lesión de 0.6 cm.', 'lesión de cero punto seis centímetros'), 1);
  assert.strictEqual(text.verbatimCoverage('Omeprazol 20 mg.', 'omeprazol veinte miligramos'), 1);
  assert.ok(text.verbatimCoverage('Lesión de 0.8 cm.', 'lesión de cero punto seis centímetros') < 0.85, 'una cifra cambiada sigue sin pasar');
});

check('un documento que el STT partió en grupos cuenta como dictado cuando la nota lo escribe corrido', () => {
  assert.strictEqual(text.verbatimCoverage('Documento: 1036457892', 'documento 1036 457 892'), 1);
  assert.strictEqual(text.verbatimCoverage('Documento: 1036457892', 'documento uno cero tres seis cuatro cinco siete ocho nueve dos'), 1);
  assert.ok(text.verbatimCoverage('Documento: 1036457893', 'documento 1036 457 892') < 0.85, 'una cifra cambiada es otro documento');
  assert.strictEqual(text.verbatimCoverage('Documento: 1.036.457.892', 'documento 1036 457 892'), 1, 'los puntos de miles no parten el número');
});

check('un decimal no es un grupo: «2.5 mg» y «25 mg» son dosis distintas, y una fecha no se pega con otra', () => {
  const dictado = 'metotrexato dos punto cinco miligramos semanal';
  assert.strictEqual(text.verbatimCoverage('Metotrexato 2.5 mg semanal.', dictado), 1);
  assert.strictEqual(text.verbatimCoverage('Metotrexato 2,5 mg semanal.', 'metotrexato dos coma cinco miligramos semanal'), 1);
  assert.ok(text.verbatimCoverage('Metotrexato 25 mg semanal.', dictado) < 0.85, 'el decimal corrido es otra dosis');
  assert.ok(text.verbatimCoverage('2 x 12 x 04 cm', 'uno punto dos por cero punto cuatro centímetros') < 0.85, 'ni en una medida');
  assert.strictEqual(text.verbatimCoverage('1.2 x 0.4 cm', 'uno punto dos por cero punto cuatro centímetros'), 1);
  assert.ok(text.verbatimCoverage('Fecha 1/12/2024', 'fecha 11/2/2024') < 0.85, 'el 1 de diciembre no es el 11 de febrero');
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

check('grounding ↔ confidence: la ida y vuelta es estable y los bordes del legado caen donde deben', () => {
  for (const level of grounding.GROUNDING_LEVELS) {
    const number = grounding.confidenceFromGrounding(level);
    assert.strictEqual(grounding.groundingFromConfidence(number), level, `${level} → ${number} → ${level}`);
    assert.strictEqual(grounding.confidenceFromGrounding(grounding.groundingFromConfidence(number)), number);
  }
  // Los cuatro valores que produce el sistema son exactamente estos; ningún
  // productor debe emitir otro (los consumidores cortan sobre ellos).
  assert.deepStrictEqual(
    grounding.GROUNDING_LEVELS.map((level) => grounding.confidenceFromGrounding(level)),
    [1, 0.8, 0.4, 0]
  );
  // Bordes del mapeo legado (notas persistidas antes del cambio):
  assert.strictEqual(grounding.groundingFromConfidence(0.9), 'explicit');
  assert.strictEqual(grounding.groundingFromConfidence(0.89), 'entailed');
  assert.strictEqual(grounding.groundingFromConfidence(0.6), 'entailed');
  assert.strictEqual(grounding.groundingFromConfidence(0.59), 'inferred');
  assert.strictEqual(grounding.groundingFromConfidence(0.01), 'inferred');
  // Umbrales de los consumidores frente a la escala: inferred (0.4) queda bajo
  // el 0.5 del portal; entailed (0.8) pasa el autofill del servidor pero queda
  // bajo el 0.85 del plugin (deliberado: sólo lo explícito se da por confirmado).
  assert.ok(grounding.confidenceFromGrounding('inferred') < 0.5);
  assert.ok(grounding.isGroundedForAutofill('entailed') && grounding.confidenceFromGrounding('entailed') < 0.85);
  assert.ok(grounding.confidenceFromGrounding('explicit') >= 0.85);
});

console.log(`\nverify-clinical-text: ${passed} checks ok`);
