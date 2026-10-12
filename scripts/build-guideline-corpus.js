// Compila knowledge/guias-clinicas/*.md → knowledge/guias-clinicas/guidelines.corpus.json.
//
// El JSON se COMMITEA: en runtime el índice lo carga con `require`, que es lo
// único que el empaquetado de Vercel traza sin tocar `includeFiles` ni leer
// disco. `verify-guideline-corpus.js` falla si el JSON se quedó viejo respecto
// a los Markdown (hash de las fuentes).
//   node scripts/build-guideline-corpus.js
const fs = require('fs');
const corpus = require('./lib/guideline-corpus');

function main() {
  const built = corpus.buildCorpus();
  const chunks = built.guidelines.reduce((sum, guideline) => sum + guideline.secciones.length, 0);
  fs.writeFileSync(corpus.CORPUS_FILE, `${JSON.stringify(built, null, 2)}\n`);
  console.log(`[build-guideline-corpus] ${built.guidelines.length} guías, ${chunks} fragmentos → ${corpus.CORPUS_FILE}`);
}

try {
  main();
} catch (error) {
  console.error(`[build-guideline-corpus] FALLÓ: ${error.message}`);
  process.exit(1);
}
