const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(repoRoot, 'chrome-extension-src', 'graph-trainer');
const runtimeRoot = path.join(repoRoot, 'web', 'public');
const outputRoot = path.join(repoRoot, 'generated', 'chrome-extension', 'graph-trainer');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function copyDirectoryContents(fromDir, toDir) {
  ensureDir(toDir);
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(from, to);
    } else {
      copyFile(from, to);
    }
  }
}

function build() {
  removeDir(outputRoot);
  ensureDir(outputRoot);

  copyDirectoryContents(sourceRoot, outputRoot);

  copyFile(path.join(runtimeRoot, 'page-state.js'), path.join(outputRoot, 'assets', 'page-state.js'));
  copyFile(path.join(runtimeRoot, 'recorder.js'), path.join(outputRoot, 'assets', 'recorder.js'));
  copyFile(path.join(runtimeRoot, 'assistant-runtime.js'), path.join(outputRoot, 'assets', 'assistant-runtime.js'));
  copyFile(path.join(runtimeRoot, 'trainer-plugin.js'), path.join(outputRoot, 'assets', 'trainer-plugin.js'));
  copyDirectoryContents(path.join(runtimeRoot, 'plugin'), path.join(outputRoot, 'assets', 'plugin'));

  const readme = [
    '# Miracle Chrome Extension',
    '',
    '1. Open `chrome://extensions`.',
    '2. Enable Developer mode.',
    '3. Click "Load unpacked".',
    `4. Select this folder: ${outputRoot}`,
    '5. Open the Miracle popup and confirm the backend URL.',
    '6. Reload the target webpage.'
  ].join('\n');

  fs.writeFileSync(path.join(outputRoot, 'README.txt'), readme);
  console.log(`Chrome extension generated at: ${outputRoot}`);
}

build();
