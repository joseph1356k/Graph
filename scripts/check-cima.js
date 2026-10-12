// Prueba en vivo de la conexión con CIMA (AEMPS) desde ESTE entorno: búsqueda,
// elección del producto, sección 4.2 de la ficha y tiempo de respuesta.
// Úsalo al desplegar (o en la máquina donde corre Graph) para confirmar que
// las fichas técnicas del asistente funcionan antes de confiar en ellas.
//   npm run check:cima [medicamento]
const { DrugLabelService } = require('../src/application/knowledge/DrugLabelService');

async function main() {
  const drug = process.argv[2] || 'amoxicilina';
  const service = new DrugLabelService({ snapshot: { labels: [] }, timeoutMs: 15000 });
  const started = Date.now();
  const labels = await service.lookup({ message: `¿Cuál es la dosis de ${drug} en adultos?` });
  const elapsed = Date.now() - started;
  if (!labels.length) {
    console.error(`[check-cima] sin ficha para «${drug}» en ${elapsed} ms: CIMA no respondió, el medicamento no está en el diccionario o la respuesta cambió de forma.`);
    process.exit(1);
  }
  const [label] = labels;
  console.log(`[check-cima] OK en ${elapsed} ms`);
  console.log(`  ${label.title} · ${label.section} · ${label.year || 's. f.'}`);
  console.log(`  ${label.url}`);
  console.log(`  ${label.text.slice(0, 400).replace(/\n/g, ' ⏎ ')}…`);
}

main().catch((error) => {
  console.error(`[check-cima] FALLÓ: ${error.message}`);
  process.exit(1);
});
