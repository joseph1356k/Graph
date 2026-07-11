const fs = require('fs');
const path = require('path');

const { EXTENSION_DIR_NAME, collectExtensionFiles, buildReadme } = require('./lib/chrome-extension-bundle');

const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(repoRoot, 'generated', 'chrome-extension', EXTENSION_DIR_NAME);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function build() {
  removeDir(outputRoot);
  ensureDir(outputRoot);

  // archivePath entries are rooted at EXTENSION_DIR_NAME; strip that prefix so
  // the on-disk layout matches the previous behaviour (files land directly in
  // generated/chrome-extension/graph-trainer/...).
  const prefix = `${EXTENSION_DIR_NAME}/`;
  for (const { absPath, archivePath } of collectExtensionFiles()) {
    const relative = archivePath.startsWith(prefix) ? archivePath.slice(prefix.length) : archivePath;
    const destination = path.join(outputRoot, relative);
    ensureDir(path.dirname(destination));
    fs.copyFileSync(absPath, destination);
  }

  fs.writeFileSync(path.join(outputRoot, 'README.txt'), buildReadme(outputRoot));
  console.log(`Chrome extension generated at: ${outputRoot}`);
}

build();
