// Fidelity check for the note prompt: report-style specialties (pathology,
// radiology, nuclear medicine, lab, genetics, forensics) must be dictated
// verbatim — the prompt has to forbid rewording, reordering and trimming, and
// the verbatim flag must survive template -> snapshot -> prompt.
//   node scripts/verify-note-fidelity.js
const assert = require('assert');

const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');
const ClinicalEncounterService = require('../src/application/use-cases/ClinicalEncounterService');

function snapshot({ specialty, sections, verbatim }) {
  return {
    template_id: 'tpl-test',
    name: `Plantilla ${specialty}`,
    specialty,
    ...(typeof verbatim === 'boolean' ? { verbatim } : {}),
    sections: sections.map((section, index) => ({
      key: section.key,
      label: section.label,
      order: index + 1,
      required: section.required === true,
      verbatim: section.verbatim === true,
      instruction: section.instruction || `Instrucción de ${section.label}`
    }))
  };
}

const PATHOLOGY_SECTIONS = [
  { key: 'datos_muestra', label: 'Datos de la muestra', required: true },
  { key: 'descripcion_macroscopica', label: 'Descripción macroscópica', required: true },
  { key: 'descripcion_microscopica', label: 'Descripción microscópica', required: true },
  { key: 'diagnostico', label: 'Diagnóstico', required: true }
];

const GENERAL_SECTIONS = [
  { key: 'motivo_consulta', label: 'Motivo de consulta', required: true },
  { key: 'enfermedad_actual', label: 'Enfermedad actual', required: true },
  { key: 'plan', label: 'Plan', required: false }
];

function systemOf(messages) {
  return messages.find((message) => message.role === 'system').content;
}

function userOf(messages) {
  return JSON.parse(messages.find((message) => message.role === 'user').content);
}

function main() {
  let checks = 0;
  const check = (name, fn) => { fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  const builder = new ClinicalNotePromptBuilder();

  check('patología entra en modo literal con todas las secciones', () => {
    const snap = snapshot({ specialty: 'patologia', sections: PATHOLOGY_SECTIONS });
    const fidelity = builder.resolveFidelity(snap, snap.sections);
    assert.strictEqual(fidelity.mode, 'verbatim');
    assert.strictEqual(fidelity.wholeTemplate, true);
    assert.deepStrictEqual(fidelity.verbatimKeys, PATHOLOGY_SECTIONS.map((s) => s.key));
  });

  check('el system prompt de patología prohíbe reescribir, reordenar y recortar', () => {
    const snap = snapshot({ specialty: 'patologia', sections: PATHOLOGY_SECTIONS });
    const system = systemOf(builder.build({ transcript: 'dictado', templateSnapshot: snap }));
    assert.ok(system.includes('MODO LITERAL'), 'falta el bloque MODO LITERAL');
    assert.ok(system.includes('TODAS las secciones de esta plantilla son LITERALES.'));
    assert.ok(system.includes('palabra por palabra'), 'falta la regla palabra por palabra');
    assert.ok(system.includes('No reordenes enumeraciones'), 'falta la regla de no reordenar');
    assert.ok(system.includes('No resumas, no recortes'), 'falta la regla de no recortar');
    assert.ok(system.includes('No normalices formatos ya dictados'), 'falta la regla de no normalizar formatos');
    assert.ok(system.includes('LITERAL (copiar el dictado tal cual)'), 'las secciones no quedaron marcadas como LITERAL');
  });

  check('el modo literal conserva las reglas de puntuación dictada y de no invención', () => {
    const snap = snapshot({ specialty: 'patologia', sections: PATHOLOGY_SECTIONS });
    const system = systemOf(builder.build({ transcript: 'dictado', templateSnapshot: snap }));
    assert.ok(system.includes('REGLAS DE PUNTUACIÓN DICTADA:'));
    assert.ok(system.includes('REGLAS ESTRICTAS DE NO INVENCIÓN:'));
    assert.ok(system.includes('3 x 4 cm'), 'se perdió la regla del signo x entre medidas');
    assert.ok(
      system.indexOf('REGLAS DE PUNTUACIÓN DICTADA:') < system.indexOf('MODO LITERAL'),
      'el bloque literal debe ir después de las reglas de puntuación que referencia'
    );
  });

  check('radiología, medicina nuclear, genética y medicina legal también son literales', () => {
    ['radiologia', 'medicina_nuclear', 'genetica', 'medicina_legal', 'laboratorio_clinico'].forEach((specialty) => {
      assert.strictEqual(builder.isVerbatimSpecialty(specialty), true, `${specialty} debería ser literal`);
    });
  });

  check('la especialidad se normaliza (tildes, mayúsculas, guiones)', () => {
    ['Patología', 'PATOLOGIA', 'anatomía-patológica', 'Medicina Nuclear'].forEach((specialty) => {
      assert.strictEqual(builder.isVerbatimSpecialty(specialty), true, `${specialty} debería ser literal`);
    });
  });

  check('medicina general sigue en modo estándar, sin bloque literal', () => {
    const snap = snapshot({ specialty: 'medicina_general', sections: GENERAL_SECTIONS });
    const messages = builder.build({ transcript: 'dictado', templateSnapshot: snap });
    const system = systemOf(messages);
    assert.strictEqual(builder.resolveFidelity(snap, snap.sections).mode, 'standard');
    assert.ok(!system.includes('MODO LITERAL'), 'no debería activarse el modo literal');
    assert.strictEqual(userOf(messages).fidelity.mode, 'standard');
  });

  check('las reglas generales de fidelidad aplican a todas las especialidades', () => {
    const snap = snapshot({ specialty: 'medicina_general', sections: GENERAL_SECTIONS });
    const system = systemOf(builder.build({ transcript: 'dictado', templateSnapshot: snap }));
    assert.ok(system.includes('REGLAS DE FIDELIDAD AL DICTADO (aplican siempre):'));
    assert.ok(system.includes('Conserva el orden en que el médico enunció los datos'));
    assert.ok(system.includes('No resumas ni recortes datos clínicos dictados'));
  });

  check('una casilla marcada verbatim activa el modo literal parcial', () => {
    const snap = snapshot({
      specialty: 'medicina_general',
      sections: [
        GENERAL_SECTIONS[0],
        { ...GENERAL_SECTIONS[1], verbatim: true },
        GENERAL_SECTIONS[2]
      ]
    });
    const messages = builder.build({ transcript: 'dictado', templateSnapshot: snap });
    const system = systemOf(messages);
    const fidelity = userOf(messages).fidelity;
    assert.strictEqual(fidelity.mode, 'verbatim');
    assert.deepStrictEqual(fidelity.verbatim_sections, ['enfermedad_actual']);
    assert.ok(system.includes('Son LITERALES únicamente estas secciones:'));
    assert.ok(system.includes('"Enfermedad actual" (key="enfermedad_actual")'));
    assert.ok(system.includes('El resto sigue las reglas generales.'));
  });

  check('una plantilla marcada verbatim: true es literal completa', () => {
    const snap = snapshot({ specialty: 'medicina_general', sections: GENERAL_SECTIONS, verbatim: true });
    const fidelity = builder.resolveFidelity(snap, snap.sections);
    assert.strictEqual(fidelity.mode, 'verbatim');
    assert.strictEqual(fidelity.wholeTemplate, true);
    assert.strictEqual(fidelity.reason, 'plantilla marcada como literal');
  });

  check('CLINICAL_VERBATIM_SPECIALTIES agrega especialidades sin tocar código', () => {
    const previous = process.env.CLINICAL_VERBATIM_SPECIALTIES;
    process.env.CLINICAL_VERBATIM_SPECIALTIES = 'dermatologia, Oncología';
    try {
      const custom = new ClinicalNotePromptBuilder();
      assert.strictEqual(custom.isVerbatimSpecialty('dermatologia'), true);
      assert.strictEqual(custom.isVerbatimSpecialty('oncologia'), true);
      assert.strictEqual(custom.isVerbatimSpecialty('patologia'), true, 'las de la lista base se conservan');
      assert.strictEqual(custom.isVerbatimSpecialty('cardiologia'), false);
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.CLINICAL_VERBATIM_SPECIALTIES;
      } else {
        process.env.CLINICAL_VERBATIM_SPECIALTIES = previous;
      }
    }
  });

  check('el payload user marca verbatim por sección', () => {
    const snap = snapshot({ specialty: 'patologia', sections: PATHOLOGY_SECTIONS });
    const payload = userOf(builder.build({ transcript: 'dictado', templateSnapshot: snap }));
    assert.strictEqual(payload.fidelity.mode, 'verbatim');
    payload.template.sections.forEach((section) => assert.strictEqual(section.verbatim, true));
    assert.ok(payload.task.includes('palabra por palabra'));
  });

  check('el flag verbatim sobrevive normalización de plantilla y snapshot', () => {
    const normalized = ClinicalTemplateService.validatePayload({
      name: 'Informe de biopsia',
      specialty: 'Patología',
      sections: [
        { label: 'Datos de la muestra', verbatim: true, required: true },
        { label: 'Diagnóstico', verbatim: true, required: true },
        { label: 'Comentario' }
      ]
    });
    assert.deepStrictEqual(normalized.sections.map((s) => s.verbatim), [true, true, false]);

    const snap = ClinicalEncounterService.buildTemplateSnapshot({
      id: 'tpl-1',
      name: normalized.name,
      specialty: normalized.specialty,
      description: '',
      scope: 'personal',
      is_default: false,
      sections: normalized.sections
    });
    assert.deepStrictEqual(snap.sections.map((s) => s.verbatim), [true, true, false]);
  });

  check('la instrucción por defecto de una casilla verbatim manda copiar el dictado', () => {
    const literal = ClinicalTemplateService.defaultInstruction('Descripción macroscópica', { verbatim: true });
    assert.ok(literal.includes('palabra por palabra'));
    assert.ok(literal.includes('sin reformular, resumir ni reordenar'));
    const standard = ClinicalTemplateService.defaultInstruction('Plan');
    assert.ok(standard.startsWith('Redacta la sección'));
  });

  console.log(`\nverify-note-fidelity: ${checks} verificaciones OK`);
}

main();
