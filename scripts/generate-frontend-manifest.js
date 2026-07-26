// @ts-check
// Migración de Fase 1 (ver docs/PLAN-BUILD-FRONTEND.md): deriva los bundles de
// los <script> de cada HTML, escribe el manifiesto versionado y reescribe los
// HTML para que apunten a los bundles.
//
//   node scripts/generate-frontend-manifest.js --dry-run   (por defecto: solo muestra)
//   node scripts/generate-frontend-manifest.js --write      (aplica)
//
// Es IDEMPOTENTE: si los HTML ya apuntan a /dist, no hay nada que derivar y
// avisa en vez de destruir el manifiesto existente. Correrlo dos veces es
// seguro.
//
// Se corre UNA VEZ para migrar. Después, el manifiesto es la fuente de verdad y
// este script no vuelve a hacer falta salvo que se agregue una página nueva con
// scripts sueltos.
const fs = require('fs');
const path = require('path');

const fb = require('./lib/frontend-bundles');

const escribir = process.argv.includes('--write');

/**
 * Construye el tag <script> del bundle, conservando la semántica del grupo.
 * @param {import('./lib/frontend-bundles').GrupoBundle} grupo
 * @param {string} relHtml ruta del HTML relativa a web/public (para la profundidad)
 * @returns {string}
 */
function tagBundle(grupo, relHtml) {
  const attrs = [];
  if (grupo.semantica === 'defer') attrs.push('defer');
  if (grupo.semantica === 'async') attrs.push('async');
  // Siempre ruta absoluta de servidor: así funciona igual desde /page1.html que
  // desde /miracle/index.html, sin calcular ../ según la profundidad.
  void relHtml;
  const extra = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  return `<script src="/${fb.DIST_DIR_NAME}/${grupo.id}.js"${extra}></script>`;
}

/**
 * Reescribe un HTML: reemplaza el primer <script> de cada grupo por el tag del
 * bundle y borra los demás. Preserva los inline en su posición.
 * @param {import('./lib/frontend-bundles').PaginaBundle} pagina
 * @returns {{original: string, nuevo: string, reemplazos: number}}
 */
function reescribirHtml(pagina) {
  const original = fs.readFileSync(pagina.html, 'utf8');

  /** @type {{start: number, end: number, texto: string}[]} */
  const ediciones = [];

  for (const grupo of pagina.grupos) {
    grupo.posiciones.forEach((pos, indice) => {
      ediciones.push({
        start: pos.start,
        end: pos.end,
        // El primero se convierte en el bundle; el resto desaparecen.
        texto: indice === 0 ? tagBundle(grupo, pagina.relHtml) : ''
      });
    });
  }

  // De atrás hacia adelante, así los índices de las ediciones pendientes no se
  // corren al aplicar las anteriores.
  ediciones.sort((a, b) => b.start - a.start);

  let nuevo = original;
  for (const ed of ediciones) {
    let texto = ed.texto;
    if (texto === '') {
      // Al borrar un tag, comerse también la indentación y el salto de línea
      // que quedaban solo para él, para no dejar líneas en blanco sueltas.
      let inicio = ed.start;
      while (inicio > 0 && (nuevo[inicio - 1] === ' ' || nuevo[inicio - 1] === '\t')) inicio -= 1;
      let fin = ed.end;
      if (nuevo[fin] === '\r') fin += 1;
      if (nuevo[fin] === '\n') fin += 1;
      nuevo = nuevo.slice(0, inicio) + nuevo.slice(fin);
      continue;
    }
    nuevo = nuevo.slice(0, ed.start) + texto + nuevo.slice(ed.end);
  }

  return { original, nuevo, reemplazos: ediciones.length };
}

function main() {
  // Si ya hay manifiesto Y los HTML no tienen grupos que derivar, la migración
  // ya ocurrió: no tocar nada.
  const paginas = fb.descubrirPaginas();
  const yaMigrado = fs.existsSync(fb.MANIFIESTO_PATH) && paginas.length === 0;

  if (yaMigrado) {
    console.log('\nLa migración ya está aplicada: los HTML apuntan a /dist y el manifiesto existe.');
    console.log(`Para cambiar qué entra a cada bundle, editá ${path.relative(fb.repoRoot, fb.MANIFIESTO_PATH)} directamente.\n`);
    return 0;
  }

  if (paginas.length === 0) {
    console.error('\nNo se derivó ningún bundle de los HTML y no hay manifiesto. Nada que hacer.\n');
    return 1;
  }

  const bundles = [...paginas.flatMap((p) => p.grupos), fb.bundleExtension()];

  console.log(`\n${escribir ? 'APLICANDO' : 'DRY-RUN (usá --write para aplicar)'}\n`);
  console.log(`Manifiesto: ${bundles.length} bundles`);
  for (const b of bundles) {
    console.log(`  [${b.semantica.padEnd(7)}] ${(b.id + '.js').padEnd(32)} ${b.archivos.length} archivos`);
  }

  console.log('\nHTML a reescribir:');
  const cambios = [];
  for (const pagina of paginas) {
    const { original, nuevo, reemplazos } = reescribirHtml(pagina);
    const antes = (original.match(/<script\b[^>]*\bsrc\s*=/gi) || []).length;
    const despues = (nuevo.match(/<script\b[^>]*\bsrc\s*=/gi) || []).length;
    console.log(`  ${pagina.relHtml.padEnd(26)} ${String(antes).padStart(2)} -> ${String(despues).padStart(2)} tags con src  (${reemplazos} ediciones)`);
    cambios.push({ pagina, nuevo });
  }

  if (!escribir) {
    console.log('\nNada escrito. Volvé a correr con --write para aplicar.\n');
    return 0;
  }

  fs.writeFileSync(
    fb.MANIFIESTO_PATH,
    `${JSON.stringify(fb.serializarManifiesto(bundles), null, 2)}\n`
  );
  console.log(`\nEscrito ${path.relative(fb.repoRoot, fb.MANIFIESTO_PATH)}`);

  for (const { pagina, nuevo } of cambios) {
    fs.writeFileSync(pagina.html, nuevo);
  }
  console.log(`Reescritos ${cambios.length} HTML.\n`);

  return 0;
}

process.exit(main());
