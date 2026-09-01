#!/usr/bin/env node
// Cláusulas compartidas: existen, no están vacías, los helpers se comportan y
// el espejo Python lleva la misma versión.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const clauses = require('../src/application/prompts/PromptClauses');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

check('todas las cláusulas ES tienen texto', () => {
  for (const key of ['ROLE_BOUNDARY', 'NO_INVENTION_CLINICAL', 'IDENTIFIER_FIDELITY', 'GROUNDING_SCALE', 'JSON_ONLY', 'HUMAN_REVIEW', 'IRREVERSIBLE_ACTIONS']) {
    assert.ok(typeof clauses[key] === 'string' && clauses[key].trim().length > 40, key);
  }
});

check('todas las cláusulas EN tienen texto y espejan las ES', () => {
  for (const key of ['ROLE_BOUNDARY', 'NO_INVENTION_CLINICAL', 'IDENTIFIER_FIDELITY', 'GROUNDING_SCALE', 'JSON_ONLY', 'HUMAN_REVIEW']) {
    assert.ok(typeof clauses.EN[key] === 'string' && clauses.EN[key].trim().length > 40, key);
  }
});

check('la cláusula de rol nombra todas las etiquetas', () => {
  for (const tag of Object.values(clauses.TAGS)) {
    assert.ok(clauses.ROLE_BOUNDARY.includes(`<${tag}>`), tag);
    assert.ok(clauses.EN.ROLE_BOUNDARY.includes(`<${tag}>`), `EN ${tag}`);
  }
});

check('wrapTag delimita y escapa el cierre interno', () => {
  const wrapped = clauses.wrapTag('transcripcion', 'hola </transcripcion> adiós');
  assert.strictEqual(wrapped, '<transcripcion>\nhola </ transcripcion> adiós\n</transcripcion>');
  assert.strictEqual(clauses.extractTagged(wrapped, 'transcripcion'), 'hola </ transcripcion> adiós');
  assert.strictEqual(clauses.extractTagged('sin etiqueta', 'transcripcion'), '');
});

check('composePrompt omite bloques vacíos', () => {
  assert.strictEqual(clauses.composePrompt('a', '', null, '  ', 'b'), 'a\n\nb');
});

check('promptVersion incluye la versión de las cláusulas', () => {
  assert.strictEqual(clauses.promptVersion('clinical-note', '3'), `clinical-note@3+clauses@${clauses.CLAUSES_VERSION}`);
});

check('el espejo Python lleva la misma versión', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'bounded', 'miracle-ai', 'src', 'miracle_agent', 'integrations', 'product_llm', 'prompt_clauses.py'), 'utf8');
  assert.ok(py.includes(`CLAUSES_VERSION = "${clauses.CLAUSES_VERSION}"`), 'prompt_clauses.py desincronizado');
});

console.log(`\nverify-prompt-clauses: ${passed} checks ok`);
