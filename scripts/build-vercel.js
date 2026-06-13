const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(projectRoot, 'web', 'public');
const outputDirectory = path.join(projectRoot, 'public');

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.cpSync(sourceDirectory, outputDirectory, { recursive: true });

console.log(`[Vercel] Copied static assets to ${path.relative(projectRoot, outputDirectory)}`);
