// @ts-check
// Verifica que el bundling del frontend no cambió la semántica (Fase 1,
// ver docs/PLAN-BUILD-FRONTEND.md).
//
//   node scripts/verify-frontend-bundles.js
//
// Qué comprueba:
//   1. Cada bundle es JS sintácticamente válido, minificado y sin minificar.
//      Esto atrapa la falla clásica de concatenar: un archivo que termina sin
//      punto y coma seguido de otro que empieza con `(` o `[`.
//   2. Todo `window.X = ` que exista en los fuentes sigue existiendo en el
//      bundle minificado. Los minificadores no pueden renombrar propiedades,
//      así que la ausencia de uno sería una pérdida real de API pública.
//   3. Cada archivo fuente aparece exactamente una vez en su bundle, y en el
//      mismo orden que tenía.
//   4. Los grupos derivados de un HTML cubren todos los <script src> locales de
//      ese HTML: si uno se queda afuera, la página perdería código al reescribirse.
//
// Lo que NO comprueba (sé honesto sobre esto): que la app funcione en un
// navegador real. Eso requiere cargar la página y la extensión a mano. Esta
// verificación es la red de seguridad automatizada, no el reemplazo de esa prueba.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fb = require('./lib/frontend-bundles');
const { construirBundle } = require('./lib/frontend-bundler');

let ok = 0;
/** @type {string[]} */
const fallos = [];

/**
 * @param {string} nombre
 * @param {() => void} fn
 */
function check(nombre, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  ok ${ok}. ${nombre}`);
  } catch (error) {
    fallos.push(`${nombre}: ${error instanceof Error ? error.message : error}`);
    console.log(`  FALLO ${nombre}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Extrae los `window.X` que un código ASIGNA (no los que solo lee).
 *
 * Se le pasa SIEMPRE código ya minificado, en los dos lados de la comparación.
 * Razón: los comentarios mencionan globals que nadie asigna — `windows-live.js`
 * documenta "define window.__WINDOWS_LIVE_MOCK__ = ..." en una cabecera y solo
 * LO LEE en el código. Comparar fuente-con-comentarios contra bundle-minificado
 * daba un falso positivo.
 * @param {string} codigoMinificado
 * @returns {Set<string>}
 */
function globalsAsignados(codigoMinificado) {
  const out = new Set();
  // window.Foo = ...   |   window["Foo"] = ...
  for (const m of codigoMinificado.matchAll(/window\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out.add(m[1]);
  for (const m of codigoMinificado.matchAll(/window\s*\[\s*["']([^"']+)["']\s*\]\s*=(?!=)/g)) out.add(m[1]);
  return out;
}

/**
 * Minifica un fuente por sí solo, para poder comparar sus globals contra los
 * del bundle sin que los comentarios ensucien la comparación.
 * @param {string} codigo
 * @returns {Promise<string>}
 */
async function minificarSuelto(codigo) {
  const esbuild = require('esbuild');
  const r = await esbuild.transform(codigo, { minify: true, target: 'es2020', legalComments: 'none' });
  return r.code;
}

async function main() {
  const grupos = fb.todosLosBundles();
  assert.ok(grupos.length > 0, 'no se descubrió ningún bundle');

  console.log(`\n[verify-frontend-bundles] ${grupos.length} bundles a verificar\n`);

  for (const grupo of grupos) {
    const fuente = grupo.archivos.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

    // Sin minificar y minificado se construyen aparte: los dos tienen que ser válidos.
    const plano = await construirBundle(grupo, { minify: false, cache: false });
    const min = await construirBundle(grupo, { minify: true, cache: false });

    check(`${grupo.id}: sintaxis válida sin minificar`, () => {
      new vm.Script(plano.codigo, { filename: `${grupo.id}.js` });
    });

    check(`${grupo.id}: sintaxis válida minificado`, () => {
      new vm.Script(min.codigo, { filename: `${grupo.id}.min.js` });
    });

    // Los módulos ES se reescriben al bundlear (los `export` desaparecen, los
    // nombres internos se renombran), así que la comparación de globals solo
    // tiene sentido en los grupos concatenados.
    if (grupo.semantica !== 'module') {
      const esperados = globalsAsignados(await minificarSuelto(fuente));
      check(`${grupo.id}: conserva los window.X de los fuentes`, () => {
        const presentes = globalsAsignados(min.codigo);
        const perdidos = [...esperados].filter((g) => !presentes.has(g));
        assert.deepStrictEqual(
          perdidos,
          [],
          `faltan en el bundle minificado: ${perdidos.join(', ')}`
        );
      });

      check(`${grupo.id}: cada fuente aparece una vez y en orden`, () => {
        let cursor = -1;
        for (const archivo of grupo.archivos) {
          const rel = path.relative(fb.publicRoot, archivo).split(path.sep).join('/');
          const marca = `// ==== ${rel} ====`;
          const primera = plano.codigo.indexOf(marca);
          assert.ok(primera !== -1, `no se encontró la marca de ${rel} en el bundle`);
          assert.strictEqual(
            plano.codigo.indexOf(marca, primera + 1),
            -1,
            `${rel} aparece más de una vez en ${grupo.id}`
          );
          assert.ok(
            primera > cursor,
            `${rel} está fuera de orden en ${grupo.id}`
          );
          cursor = primera;
        }
      });
    }
  }

  // Ningún <script src> local puede quedarse fuera de un grupo: si pasa, al
  // reescribir el HTML la página perdería ese código.
  for (const pagina of fb.descubrirPaginas()) {
    check(`${pagina.relHtml}: todos los <script src> locales están cubiertos`, () => {
      const html = fs.readFileSync(pagina.html, 'utf8');
      const etiquetas = fb.escanearScripts(html, path.dirname(pagina.html));
      const locales = etiquetas.filter((e) => e.absPath).map((e) => e.absPath);
      const cubiertos = new Set(pagina.grupos.flatMap((g) => g.archivos));

      // Un archivo puede quedar deliberadamente fuera si era un grupo de uno
      // solo (no se gana nada bundleándolo). Eso es válido: sigue en el HTML.
      const soloUno = locales.filter((f) => !cubiertos.has(f));
      const conteo = new Map();
      for (const f of locales) conteo.set(f, (conteo.get(f) || 0) + 1);

      for (const f of soloUno) {
        const rel = path.relative(fb.publicRoot, /** @type {string} */(f));
        assert.ok(
          conteo.get(f) === 1,
          `${rel} aparece ${conteo.get(f)} veces pero no está en ningún bundle`
        );
      }
    });
  }

  console.log('');
  if (fallos.length > 0) {
    console.error(`[verify-frontend-bundles] ${fallos.length} FALLOS:`);
    for (const f of fallos) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`[verify-frontend-bundles] ${ok} verificaciones OK`);
  return 0;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error('[verify-frontend-bundles] error inesperado:', error);
    process.exit(1);
  });
