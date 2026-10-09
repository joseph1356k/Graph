// Revisa guías en borrador SIN tocar guidelines.corpus.json: formato de la
// cabecera, población, tamaño de cada fragmento y que el escudo de privacidad
// no tape nada. Útil mientras se redacta; al terminar, `npm run build:corpus`.
//   node scripts/check-guideline-drafts.js knowledge/guias-clinicas/anafilaxia.md [...]
const fs = require('fs');
const path = require('path');
const corpusLib = require('./lib/guideline-corpus');
const ProtectionMap = require('../src/domain/privacy/ProtectionMap');

function checkFile(file) {
  const problems = [];
  let guideline;
  try {
    guideline = corpusLib.parseGuideline(fs.readFileSync(file, 'utf8'), path.basename(file));
  } catch (error) {
    return { file, problems: [error.message], sections: [] };
  }
  if (!guideline.poblacion.length) problems.push('falta "poblacion" (adultos, adultos_mayores, gestantes, pediatria, neonatos)');
  if (!guideline.nota) problems.push('falta la nota «Resumen orientativo…» (blockquote inicial)');
  if (guideline.palabras_clave.length < 3) problems.push('pon al menos 3 palabras clave');
  const sections = guideline.secciones.map((section) => {
    const map = new ProtectionMap({ seeds: [], excludedNames: [] });
    const text = `${section.titulo}\n${section.texto}`;
    const masked = map.protectText(text);
    const privacy = map.hasTokens() || masked !== text ? JSON.stringify(map.summary().byType) : '';
    if (privacy) problems.push(`«${section.titulo}»: el escudo taparía ${privacy}; reescribe esa cifra o nombre`);
    if (section.texto.length < 120) problems.push(`«${section.titulo}»: fragmento demasiado corto`);
    return { titulo: section.titulo, chars: section.texto.length };
  });
  return { file, problems, sections };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('uso: node scripts/check-guideline-drafts.js <guia.md> [...]');
  process.exit(2);
}
let failed = 0;
for (const file of files) {
  const result = checkFile(file);
  const status = result.problems.length ? 'REVISAR' : 'ok';
  console.log(`${status}  ${path.basename(file)}`);
  for (const section of result.sections) console.log(`      ${String(section.chars).padStart(5)}  ${section.titulo}`);
  for (const problem of result.problems) console.log(`   !  ${problem}`);
  if (result.problems.length) failed += 1;
}
process.exit(failed ? 1 : 0);
