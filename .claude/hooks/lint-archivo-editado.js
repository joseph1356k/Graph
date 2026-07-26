#!/usr/bin/env node
// Hook PostToolUse: tras cada Edit/Write sobre un .js del repo, corre ESLint
// solo en ese archivo. Los errores vuelven al agente en el momento, no tres
// pasos después. Los avisos (deuda conocida) no bloquean.
//
// Salida: exit 2 = feedback bloqueante para el agente. Exit 0 = todo bien.
// Cualquier fallo del propio hook sale con 0: un hook roto no debe frenar el trabajo.
//
// Cross-platform a propósito: invocamos `bin/eslint.js` con el mismo binario
// de Node que corre este hook (`process.execPath`), NO `npx`/`eslint` por
// PATH. Así evitamos la resolución de `npx` (lenta) y el problema de que en
// Windows el ejecutable real es `npx.cmd`/`eslint.cmd`, no `npx`/`eslint` —
// invocar el `.js` con Node no depende de esa extensión en absoluto.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function leerStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function resolverBinEslint(raizProyecto) {
  try {
    const pkgPath = require.resolve('eslint/package.json', { paths: [raizProyecto] });
    const pkg = require(pkgPath);
    const binRelativo = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.eslint;
    if (!binRelativo) return null;
    return path.join(path.dirname(pkgPath), binRelativo);
  } catch {
    return null;
  }
}

function main() {
  const raw = leerStdin();
  if (!raw.trim()) return 0;

  let evento;
  try {
    evento = JSON.parse(raw);
  } catch {
    return 0;
  }

  const archivo = evento?.tool_input?.file_path;
  if (typeof archivo !== 'string' || !archivo.endsWith('.js')) return 0;

  const raizProyecto = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const absoluto = path.resolve(archivo);

  // Solo archivos dentro del repo, y nunca build output ni skills instaladas.
  if (!absoluto.startsWith(path.resolve(raizProyecto) + path.sep)) return 0;
  const relativo = path.relative(raizProyecto, absoluto);
  if (/^(node_modules|generated|public|dist|build|\.agents|\.vercel)[\\/]/.test(relativo)) return 0;
  if (!fs.existsSync(absoluto)) return 0;

  const binEslint = resolverBinEslint(raizProyecto);
  if (!binEslint || !fs.existsSync(binEslint)) return 0; // ESLint no instalado: no bloquear.

  try {
    // --quiet: solo errores. Los warnings son deuda conocida del repo.
    execFileSync(process.execPath, [binEslint, '--quiet', '--format', 'stylish', absoluto], {
      cwd: raizProyecto,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60000
    });
    return 0;
  } catch (error) {
    if (error.code === 'ETIMEDOUT') return 0;

    const salida = `${error.stdout || ''}${error.stderr || ''}`.trim();
    if (!salida) return 0;

    process.stderr.write(
      `ESLint encontró errores en ${relativo}. Corrígelos antes de seguir:\n\n${salida}\n`
    );
    return 2;
  }
}

process.exit(main());
