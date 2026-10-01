// Spec 070 — quién dijo qué. Las promesas 600-603, del lado de Graph.
//
// La transcripción llega con una línea «[Hablante N] …» cada vez que Soniox
// oye otra voz (la ponen los clientes; ver apps/web/lib/stt/speaker-turns.ts y
// apps/windows/.../Verbatim.cs). Aquí se juzga lo que el modelo recibe:
// etiquetas explicadas cuando hay conversación, lo del médico por encima, y
// cero cambio cuando habla uno solo.
//   node scripts/verify-diarizacion.js
const assert = require('assert');

const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
const ProtectionMap = require('../src/domain/privacy/ProtectionMap');
const { TAGS } = require('../src/application/prompts/PromptClauses');

const SECTIONS = [
  { key: 'motivo_consulta', label: 'Motivo de consulta', required: true },
  { key: 'enfermedad_actual', label: 'Enfermedad actual', required: true },
  { key: 'analisis', label: 'Análisis', required: false },
  { key: 'plan', label: 'Plan', required: false }
];

function snapshot(specialty = 'medicina_general') {
  return {
    template_id: 'tpl-diarizacion',
    name: 'Plantilla de prueba',
    specialty,
    sections: SECTIONS.map((section, index) => ({ ...section, order: index + 1, instruction: `Instrucción de ${section.label}` }))
  };
}

const CONVERSACION = [
  '[Hablante 1] Buenos días, ¿qué lo trae por aquí?',
  '[Hablante 2] Doctor, tengo una alergia en la piel desde hace tres días.',
  '[Hablante 1] Eso no es alergia: es una celulitis en la pierna derecha. Vamos a darle cefalexina 500 mg cada seis horas por siete días.',
  '[Hablante 3] Es que él no se quiere tomar las pastillas.'
].join('\n');

function plan(transcript, specialty) {
  return new ClinicalNotePromptBuilder().plan({ transcript, templateSnapshot: snapshot(specialty) });
}
const systemOf = (p) => p.messages.find((m) => m.role === 'system').content;
const transcriptOf = (p) => ClinicalNotePromptBuilder.extractTagged(p.messages.find((m) => m.role === 'user').content, TAGS.TRANSCRIPT);

function main() {
  let checks = 0;
  const check = (name, fn) => { fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  check('600. con varias voces, el prompt explica las etiquetas y pide deducir médico y paciente por contexto', () => {
    const system = systemOf(plan(CONVERSACION));
    assert.ok(system.includes('[Hablante N]'), 'el system prompt nombra la forma de la etiqueta');
    assert.ok(/qui[eé]n es el m[eé]dico/i.test(system), 'pide deducir quién es el médico');
    assert.ok(/acompañante/i.test(system), 'y contempla al acompañante, no solo a dos voces');
    assert.ok(/no copies las etiquetas/i.test(system), 'y que las etiquetas no se cuelen en la nota');
    // La etiqueta sigue en el texto: es lo que el modelo necesita para separar las voces.
    assert.ok(transcriptOf(plan(CONVERSACION)).includes('[Hablante 2] Doctor, tengo una alergia'));
  });

  check('601. lo que dice el médico manda, con etiquetas y sin ellas', () => {
    for (const transcript of [CONVERSACION, 'Paciente refiere dolor abdominal de dos días.']) {
      const system = systemOf(plan(transcript));
      assert.ok(system.includes('PRIORIDAD DEL MÉDICO'), 'la prioridad del médico es política del modo interpretativo');
      assert.ok(/prevalece lo (que dice|dicho por) el m[eé]dico/i.test(system), 'ante una corrección, prevalece el médico');
      assert.ok(/referido por el paciente/i.test(system), 'lo que solo dice el paciente queda como referido');
    }
  });

  // Medido el 2026-09-30 contra gpt-4.1-mini, con el prompt @6 ya desplegado: el
  // paciente dice «yo tengo gastritis», la acompañante «él es diabético», el médico
  // no confirma ninguna, y la nota salía «paciente con diagnóstico conocido de
  // gastritis y diabetes» en 3 corridas de 3. La 601 decía que el médico manda,
  // pero no decía qué hacer con un diagnóstico que el médico NO tocó.
  check('610. un diagnóstico que solo dicen el paciente o su acompañante no es un diagnóstico conocido', () => {
    for (const transcript of [CONVERSACION, 'Paciente refiere dolor abdominal de dos días.']) {
      const system = systemOf(plan(transcript));
      assert.ok(/no es un diagn[oó]stico conocido/i.test(system), 'lo dice con esas palabras');
      assert.ok(/Refiere antecedente de/.test(system), 'y da la forma de escribirlo, con su fuente');
      assert.ok(/tampoco (se usa como|es) (el )?motivo/i.test(system), 'y prohíbe usarlo para justificar una conducta');
      assert.ok(!/ya ven[ií]a establecido en la historia\./.test(system),
        '«ya venía establecido en la historia», a secas, era la puerta por la que entraba lo que dice el paciente');
    }
  });

  check('602. con una sola voz, el modelo recibe la transcripción sin etiquetas, como antes', () => {
    const dictado = 'Paciente masculino de 45 años con dolor abdominal. Se solicita ecografía.';
    const sinEtiqueta = plan(dictado);
    const conEtiqueta = plan(`[Hablante 1] ${dictado}`);
    assert.strictEqual(transcriptOf(conEtiqueta), dictado, 'la etiqueta única se quita');
    assert.strictEqual(transcriptOf(sinEtiqueta), dictado, 'y un texto sin etiquetas no se toca');
    assert.strictEqual(systemOf(conEtiqueta), systemOf(sinEtiqueta), 'ni el system prompt cambia');
    assert.ok(!systemOf(sinEtiqueta).includes('[Hablante N]'), 'sin conversación no se habla de etiquetas');
    // Patología dicta una sola voz: el modo literal no puede recibir una etiqueta que copiar.
    assert.strictEqual(transcriptOf(plan(`[Hablante 1] ${dictado}`, 'patologia')), dictado);
  });

  check('603. el escudo de privacidad deja las etiquetas intactas', () => {
    // Mismo caso que el corpus dorado (n01), partido en dos voces.
    const map = new ProtectionMap({ seeds: [] });
    const protegido = map.protectText('[Hablante 1] ¿Cómo se llama?\n[Hablante 2] El paciente se llama Juan David Pérez Gómez y consulta por cefalea.');
    assert.ok(protegido.includes('[Hablante 1]') && protegido.includes('\n[Hablante 2]'), protegido);
    assert.ok(!protegido.includes('Juan David Pérez Gómez'), 'y el nombre sí se protege: la prueba no pasa por un escudo apagado');
  });

  console.log(`\nverify-diarizacion: ${checks} verificaciones OK`);
}

try {
  main();
} catch (error) {
  // La cadena entera: un require que falla dice por qué, no solo que falló.
  for (let e = error; e; e = e.cause) console.error(`   ✘ ${e.name}: ${e.message}`);
  process.exit(1);
}
