// Catalog integrity check for the institutional template seed: asserts the
// generator produces exactly 147 templates across 49 specialties (3 each),
// with unique deterministic ids, valid section counts and no duplicate section
// keys. Mirrors what the SQL migration derives.
//   node scripts/verify-institutional-catalog.js
const assert = require('assert');
const { clinicalSpecialties, buildTemplates } = require('./generate-institutional-templates-seed');

function main() {
  const rows = buildTemplates();
  let checks = 0;
  const check = (name, fn) => { fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  check('49 especialidades en el catálogo', () => {
    assert.strictEqual(clinicalSpecialties.length, 49);
  });

  check('147 plantillas generadas', () => {
    assert.strictEqual(rows.length, 147);
  });

  check('ids deterministas y únicos', () => {
    const ids = new Set(rows.map((r) => r.id));
    assert.strictEqual(ids.size, 147);
    rows.forEach((r) => assert.match(r.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  });

  check('cada especialidad tiene exactamente 3 plantillas', () => {
    const bySpecialty = new Map();
    rows.forEach((r) => bySpecialty.set(r.specialty_code, (bySpecialty.get(r.specialty_code) || 0) + 1));
    assert.strictEqual(bySpecialty.size, 49);
    for (const [code, count] of bySpecialty) {
      assert.strictEqual(count, 3, `${code} tiene ${count} plantillas`);
    }
  });

  check('specialty_code normalizado con guion_bajo', () => {
    rows.forEach((r) => assert.match(r.specialty_code, /^[a-z0-9_]+$/, `specialty_code inválido: ${r.specialty_code}`));
  });

  check('exactamente 1 plantilla is_default (Consulta inicial · Medicina general)', () => {
    const defaults = rows.filter((r) => r.is_default);
    assert.strictEqual(defaults.length, 1);
    assert.strictEqual(defaults[0].slug, 'medicina-general-inicial');
    assert.strictEqual(defaults[0].name, 'Consulta inicial · Medicina general');
  });

  check('Medicina General tiene las 3 plantillas del catálogo frontend', () => {
    const mg = rows.filter((r) => r.specialty_code === 'medicina_general').map((r) => r.name).sort();
    assert.deepStrictEqual(mg, [
      'Atención integral y remisión · Medicina general',
      'Consulta inicial · Medicina general',
      'Control y seguimiento · Medicina general'
    ]);
  });

  check('secciones válidas: 2..30, sin keys duplicadas, campos completos', () => {
    rows.forEach((r) => {
      assert.ok(r.sections.length >= 2 && r.sections.length <= 30, `${r.slug}: ${r.sections.length} secciones`);
      const keys = new Set();
      r.sections.forEach((s, index) => {
        assert.ok(s.key && s.label && s.instruction, `${r.slug} sección ${index} incompleta`);
        assert.strictEqual(s.order, index + 1, `${r.slug} orden desalineado`);
        assert.ok(!keys.has(s.key), `${r.slug} key duplicada ${s.key}`);
        keys.add(s.key);
      });
    });
  });

  console.log(`\n[verify-institutional-catalog] ${checks} verificaciones OK · 147 plantillas / 49 especialidades`);
}

try {
  main();
} catch (error) {
  console.error(`\n[verify-institutional-catalog] FALLÓ: ${error.message}`);
  process.exit(1);
}
