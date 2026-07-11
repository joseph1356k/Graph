/**
 * Single source of truth for what goes into the Miracle Chrome extension bundle.
 *
 * The extension is deliberately a thin frontend over the backend core: it ships
 * its own source (chrome-extension-src/graph-trainer) plus a copy of the shared
 * browser runtime that the web app also uses (web/public/*). Keeping the file
 * manifest here means both the CLI build (scripts/build-chrome-extension.js) and
 * the on-the-fly download endpoint assemble byte-identical packages from one list,
 * so the extension stays isolated from — but in sync with — the core services.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(repoRoot, 'chrome-extension-src', 'graph-trainer');
const runtimeRoot = path.join(repoRoot, 'web', 'public');

const EXTENSION_DIR_NAME = 'graph-trainer';

// Shared browser runtime copied from the web app into the extension's assets/.
// [source path under web/public, destination path under the extension root].
const RUNTIME_FILE_ASSETS = [
  ['page-state.js', 'assets/page-state.js'],
  ['recorder.js', 'assets/recorder.js'],
  ['assistant-runtime.js', 'assets/assistant-runtime.js'],
  ['shared/deepgram-dictation.js', 'assets/shared/deepgram-dictation.js'],
  ['trainer-plugin.js', 'assets/trainer-plugin.js']
];

const RUNTIME_DIR_ASSETS = [
  ['plugin', 'assets/plugin']
];

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

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

/**
 * Returns the full manifest of files for the extension bundle as
 * `{ absPath, archivePath }` entries. `archivePath` is always POSIX-style and
 * rooted at the extension directory name (e.g. "graph-trainer/manifest.json").
 */
function collectExtensionFiles() {
  const files = [];

  for (const abs of walkFiles(sourceRoot)) {
    const rel = toPosix(path.relative(sourceRoot, abs));
    files.push({ absPath: abs, archivePath: `${EXTENSION_DIR_NAME}/${rel}` });
  }

  for (const [from, to] of RUNTIME_FILE_ASSETS) {
    files.push({
      absPath: path.join(runtimeRoot, from),
      archivePath: `${EXTENSION_DIR_NAME}/${to}`
    });
  }

  for (const [fromDir, toDir] of RUNTIME_DIR_ASSETS) {
    const absDir = path.join(runtimeRoot, fromDir);
    for (const abs of walkFiles(absDir)) {
      const rel = toPosix(path.relative(absDir, abs));
      files.push({
        absPath: abs,
        archivePath: `${EXTENSION_DIR_NAME}/${toDir}/${rel}`
      });
    }
  }

  return files;
}

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
  collectExtensionFiles,
  buildReadme
};
