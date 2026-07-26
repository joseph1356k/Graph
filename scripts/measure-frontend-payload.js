// @ts-check
// Mide el payload JS que realmente carga cada página del frontend: cuántos
// requests y cuántos KB. Es la instrumentación de la métrica de éxito de la
// Fase 1 (ver docs/PLAN-BUILD-FRONTEND.md) — sirve para capturar el baseline
// ANTES de bundlear y para comprobar la mejora después, sin copiar números a
// mano a ningún documento.
//
//   node scripts/measure-frontend-payload.js
//   node scripts/measure-frontend-payload.js --json
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(repoRoot, 'web', 'public');

/**
 * Extrae los `src` de los <script> de un HTML, en orden de aparición.
 * @param {string} html
 * @returns {string[]}
 */
function extraerScriptSrcs(html) {
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  return [...html.matchAll(re)].map((m) => m[1]);
}

/**
 * Resuelve un `src` de HTML a una ruta en disco bajo web/public.
 * Ignora los absolutos externos y limpia el cache-buster (`?v=8`).
 * @param {string} src
 * @param {string} htmlDir directorio del HTML que lo referencia
 * @returns {string|null}
 */
function resolverSrc(src, htmlDir) {
  if (/^(https?:)?\/\//i.test(src)) return null; // externo
  const limpio = src.split('?')[0].split('#')[0];
  const abs = limpio.startsWith('/')
    ? path.join(publicRoot, limpio.slice(1))
    : path.resolve(htmlDir, limpio);
  return fs.existsSync(abs) ? abs : null;
}

/** @returns {string[]} rutas absolutas de los HTML de web/public (incluye subcarpetas) */
function listarHtml() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function caminar(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'studio-docs') continue;
        caminar(abs);
      } else if (entry.name.endsWith('.html')) {
        out.push(abs);
      }
    }
  }
  caminar(publicRoot);
  return out.sort();
}

function medir() {
  const paginas = [];

  for (const html of listarHtml()) {
    const contenido = fs.readFileSync(html, 'utf8');
    const htmlDir = path.dirname(html);
    let bytes = 0;
    let requests = 0;
    let externos = 0;
    let noResueltos = 0;

    for (const src of extraerScriptSrcs(contenido)) {
      if (/^(https?:)?\/\//i.test(src)) {
        externos += 1;
        continue;
      }
      const abs = resolverSrc(src, htmlDir);
      if (!abs) {
        noResueltos += 1;
        continue;
      }
      bytes += fs.statSync(abs).size;
      requests += 1;
    }

    paginas.push({
      pagina: path.relative(publicRoot, html),
      requests,
      bytes,
      kb: Math.round(bytes / 1024),
      externos,
      noResueltos
    });
  }

  // Las tres listas de carga que hoy hay que sincronizar a mano. Es la métrica
  // secundaria del plan: debe llegar a 1.
  const listas = [];

  const htmlConMuchos = paginas.filter((p) => p.requests > 5).length;
  if (htmlConMuchos > 0) listas.push(`HTML con >5 scripts (${htmlConMuchos} páginas)`);

  const manifestPath = path.join(repoRoot, 'chrome-extension-src', 'graph-trainer', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const n = manifest?.content_scripts?.[0]?.js?.length || 0;
    if (n > 1) listas.push(`manifest.json content_scripts (${n} entradas)`);
  }

  const swPath = path.join(publicRoot, 'service-worker.js');
  if (fs.existsSync(swPath)) {
    const n = (fs.readFileSync(swPath, 'utf8').match(/^\s*'\/[^']*\.js'/gm) || []).length;
    if (n > 1) listas.push(`service-worker.js precache (${n} rutas .js)`);
  }

  return { paginas, listas };
}

function main() {
  const { paginas, listas } = medir();
  const comoJson = process.argv.includes('--json');

  if (comoJson) {
    process.stdout.write(`${JSON.stringify({ paginas, listas }, null, 2)}\n`);
    return 0;
  }

  console.log('\nPayload JS por página (fuente sin minificar)\n');
  console.log('  requests    KB   página');
  console.log('  --------  ----   ------');
  for (const p of paginas.sort((a, b) => b.bytes - a.bytes)) {
    const nota = p.noResueltos > 0 ? `  (${p.noResueltos} sin resolver)` : '';
    console.log(`  ${String(p.requests).padStart(8)}  ${String(p.kb).padStart(4)}   ${p.pagina}${nota}`);
  }

  const totalReq = paginas.reduce((a, p) => a + p.requests, 0);
  console.log(`\n  Total de <script src> locales en el frontend: ${totalReq}`);

  console.log(`\nListas de carga sincronizadas a mano: ${listas.length}`);
  for (const l of listas) console.log(`  - ${l}`);
  console.log('');

  return 0;
}

process.exit(main());
