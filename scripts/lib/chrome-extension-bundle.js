// @ts-check
/**
 * Fuente única de lo que va dentro del paquete de la extensión de Chrome.
 *
 * La extensión es deliberadamente un frontend delgado sobre el backend: trae su
 * propio código (chrome-extension-src/graph-trainer) más el runtime de
 * navegador compartido que también usa la web (web/public/*). Tener el
 * manifiesto de archivos acá hace que el build por CLI
 * (scripts/build-chrome-extension.js) y el endpoint de descarga al vuelo armen
 * paquetes idénticos desde una sola lista.
 *
 * Desde la Fase 1 del build (docs/PLAN-BUILD-FRONTEND.md), el runtime NO se
 * copia archivo por archivo: va en UN bundle, `assets/extension-content.js`,
 * construido en memoria. Dos razones:
 *
 *  1. `manifest.json` pasó de 17 entradas en `content_scripts` a una. Era la
 *     tercera lista de carga que había que sincronizar a mano.
 *  2. El endpoint de descarga corre en el serverless de Vercel, donde no está
 *     garantizado que exista `web/public/dist` en el filesystem (el destino
 *     natural del build está en .gitignore, y no está confirmado que el
 *     `includeFiles` de vercel.json capture archivos creados por el build).
 *     Bundlear en memoria elimina esa dependencia por completo.
 *
 * Por eso `collectExtensionFiles()` es async y devuelve `getContent()` en vez de
 * una ruta en disco.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(repoRoot, 'chrome-extension-src', 'graph-trainer');

const EXTENSION_DIR_NAME = 'graph-trainer';

// El bundle del runtime dentro del paquete. Su contenido lo define el manifiesto
// de bundles (scripts/lib/frontend-bundles.manifest.json), no esta lista.
const RUNTIME_BUNDLE_ID = 'extension-content';
const RUNTIME_BUNDLE_ARCHIVE_PATH = `assets/${RUNTIME_BUNDLE_ID}.js`;

// Código propio de la extensión que NO se copia tal cual porque ya viaja dentro
// del bundle del runtime (es su último archivo, ver el manifiesto de bundles).
const YA_EN_EL_BUNDLE = new Set(['content.js']);

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs));
    } else {
      out.push(abs);
    }
  }
  return out;
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

/**
 * @typedef {object} ArchivoExtension
 * @property {string} archivePath  ruta POSIX dentro del ZIP, con la carpeta raíz incluida
 * @property {() => Promise<Buffer|string>} getContent
 */

/**
 * Manifiesto completo de archivos del paquete de la extensión.
 * @returns {Promise<ArchivoExtension[]>}
 */
async function collectExtensionFiles() {
  /** @type {ArchivoExtension[]} */
  const files = [];

  // 1. Código propio de la extensión, tal cual (menos lo que ya va en el bundle).
  for (const abs of walkFiles(sourceRoot)) {
    const rel = toPosix(path.relative(sourceRoot, abs));
    if (YA_EN_EL_BUNDLE.has(rel)) continue;
    files.push({
      archivePath: `${EXTENSION_DIR_NAME}/${rel}`,
      getContent: async () => fs.readFileSync(abs)
    });
  }

  // 2. El runtime compartido, en un solo bundle construido en memoria.
  const { todosLosBundles } = require('./frontend-bundles');
  const { construirBundle } = require('./frontend-bundler');

  const grupo = todosLosBundles().find((b) => b.id === RUNTIME_BUNDLE_ID);
  if (!grupo) {
    throw new Error(
      `chrome-extension-bundle: no se encontró el bundle "${RUNTIME_BUNDLE_ID}" en el manifiesto de bundles (scripts/lib/frontend-bundles.manifest.json).`
    );
  }

  files.push({
    archivePath: `${EXTENSION_DIR_NAME}/${RUNTIME_BUNDLE_ARCHIVE_PATH}`,
    getContent: async () => {
      const resultado = await construirBundle(grupo, { minify: true });
      return resultado.codigo;
    }
  });

  return files;
}

/**
 * @param {string} [loadInstructionsTarget]
 * @returns {string}
 */
function buildReadme(loadInstructionsTarget) {
  return [
    '# Miracle Chrome Extension',
    '',
    '1. Unzip this package.',
    '2. Open `chrome://extensions`.',
    '3. Enable Developer mode.',
    '4. Click "Load unpacked".',
    `5. Select this folder: ${loadInstructionsTarget || EXTENSION_DIR_NAME}`,
    '6. Open the Miracle popup and confirm the backend URL.',
    '7. Reload the target webpage.'
  ].join('\n');
}

module.exports = {
  EXTENSION_DIR_NAME,
  RUNTIME_BUNDLE_ID,
  RUNTIME_BUNDLE_ARCHIVE_PATH,
  collectExtensionFiles,
  buildReadme
};
