// @ts-check
// Build de despliegue. Antes era solo un `cpSync`; ahora también construye los
// bundles del frontend (ver docs/PLAN-BUILD-FRONTEND.md) para que el HTML que
// se sirve encuentre /dist/*.js ya generado y minificado.
//
//   node scripts/build-vercel.js
const fs = require('fs');
const path = require('path');

const fb = require('./lib/frontend-bundles');
const { construirBundle, escribirBundle } = require('./lib/frontend-bundler');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(projectRoot, 'web', 'public');
const outputDirectory = path.join(projectRoot, 'public');

async function main() {
  // 1. Bundles primero, dentro de web/public/dist, para que el cpSync de abajo
  //    se los lleve junto al resto de los estáticos.
  const distDir = path.join(sourceDirectory, fb.DIST_DIR_NAME);
  fs.rmSync(distDir, { recursive: true, force: true });

  const bundles = fb.todosLosBundles();
  let bytesTotal = 0;

  for (const grupo of bundles) {
    const resultado = await construirBundle(grupo, {
      minify: true,
      sourcemap: true,
      cache: false
    });
    escribirBundle(resultado, distDir);
    bytesTotal += resultado.bytes;
    console.log(
      `[Build] ${grupo.id}.js  ${grupo.archivos.length} archivos -> ${Math.round(resultado.bytes / 1024)} KB`
    );
  }

  console.log(
    `[Build] ${bundles.length} bundles, ${Math.round(bytesTotal / 1024)} KB minificados`
  );

  // 2. Copiar todo el estático (incluido /dist) al outputDirectory de Vercel.
  //    El destino está FUERA del origen, así que no hay recursión.
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.cpSync(sourceDirectory, outputDirectory, { recursive: true });

  console.log(`[Vercel] Copied static assets to ${path.relative(projectRoot, outputDirectory)}`);
}

main().catch((error) => {
  console.error('[Build] falló:', error);
  process.exit(1);
});
