// @ts-check
// Motor de bundling del frontend (ver docs/PLAN-BUILD-FRONTEND.md).
//
// Dos modos, según la semántica del grupo:
//
//   concat  — para los scripts clásicos, que ya vienen envueltos en su propio
//             IIFE y se comunican por `window.X`. Se CONCATENAN en orden de
//             ejecución y se minifican. Es semánticamente idéntico a que el
//             navegador los cargue como N <script> en ese orden: mismo scope
//             global, mismo orden, y cada archivo ya aísla lo suyo.
//
//   module  — para web/public/miracle/**, que son módulos ES reales. Se bundlean
//             resolviendo los `import` y se emiten como IIFE (obligatorio: los
//             content scripts de MV3 no aceptan `type="module"`).
//
// Que ambos modos convivan es lo que permite que la Fase 2 migre entry points
// de `concat` a `module` de a uno, sin un big bang.
const fs = require('fs');
const path = require('path');

const { publicRoot, DIST_DIR_NAME } = require('./frontend-bundles');

/** @typedef {import('./frontend-bundles').GrupoBundle} GrupoBundle */

/**
 * @typedef {object} ResultadoBundle
 * @property {string} id
 * @property {string} codigo    JS final
 * @property {string|null} mapa sourcemap, si se pidió
 * @property {number} bytes
 */

// Caché de builds en vuelo Y terminados, por id de bundle. Evita que dos
// requests concurrentes al mismo bundle disparen dos builds (lo pidió la
// revisión senior del plan: "caché de promesas, no solo por mtime").
/** @type {Map<string, {mtime: number, promesa: Promise<ResultadoBundle>}>} */
const cache = new Map();

/**
 * mtime más reciente entre los archivos de un grupo. Es la clave de
 * invalidación en dev: si ninguno cambió, se reusa el bundle ya construido.
 * @param {GrupoBundle} grupo
 * @returns {number}
 */
function mtimeMasReciente(grupo) {
  let max = 0;
  for (const archivo of grupo.archivos) {
    try {
      const m = fs.statSync(archivo).mtimeMs;
      if (m > max) max = m;
    } catch {
      // Archivo borrado entre el descubrimiento y el build: fuerza rebuild.
      return Date.now();
    }
  }
  return max;
}

/**
 * Construye un grupo concatenando sus archivos (modo `concat`).
 * @param {GrupoBundle} grupo
 * @param {{minify: boolean, sourcemap: boolean}} opciones
 * @returns {Promise<ResultadoBundle>}
 */
async function construirConcat(grupo, opciones) {
  const esbuild = require('esbuild');

  // Cada archivo se separa con un salto de línea y un comentario con su origen.
  // El comentario sobrevive solo sin minificar (dev), donde es útil para ubicarse.
  const partes = grupo.archivos.map((archivo) => {
    const rel = path.relative(publicRoot, archivo).split(path.sep).join('/');
    const codigo = fs.readFileSync(archivo, 'utf8');
    // El `;` protege contra un archivo que termine sin punto y coma seguido de
    // uno que empiece con `(` — el caso clásico de romper una concatenación.
    return `// ==== ${rel} ====\n${codigo}\n;`;
  });

  const fuente = partes.join('\n');

  if (!opciones.minify && !opciones.sourcemap) {
    return { id: grupo.id, codigo: fuente, mapa: null, bytes: Buffer.byteLength(fuente) };
  }

  const resultado = await esbuild.transform(fuente, {
    minify: opciones.minify,
    sourcemap: opciones.sourcemap ? 'external' : false,
    sourcefile: `${grupo.id}.js`,
    legalComments: 'none',
    target: 'es2020'
  });

  return {
    id: grupo.id,
    codigo: resultado.code,
    mapa: resultado.map || null,
    bytes: Buffer.byteLength(resultado.code)
  };
}

/**
 * Construye un grupo resolviendo sus imports (modo `module`).
 * @param {GrupoBundle} grupo
 * @param {{minify: boolean, sourcemap: boolean}} opciones
 * @returns {Promise<ResultadoBundle>}
 */
async function construirModule(grupo, opciones) {
  const esbuild = require('esbuild');

  const resultado = await esbuild.build({
    entryPoints: grupo.archivos,
    bundle: true,
    write: false,
    // Sin `outfile`, esbuild nombra la salida `<stdout>` y no se puede
    // distinguir el JS del sourcemap por extensión.
    outfile: path.join(publicRoot, DIST_DIR_NAME, `${grupo.id}.js`),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: opciones.minify,
    sourcemap: opciones.sourcemap ? 'external' : false,
    legalComments: 'none',
    // Los imports del código usan rutas absolutas de servidor ("/miracle/assets/...").
    // Sin esto, esbuild las buscaría en la raíz del filesystem.
    absWorkingDir: publicRoot,
    plugins: [
      {
        name: 'rutas-absolutas-de-servidor',
        setup(build) {
          build.onResolve({ filter: /^\// }, (args) => {
            if (args.kind === 'entry-point') return null;
            const abs = path.join(publicRoot, args.path.slice(1));
            return fs.existsSync(abs) ? { path: abs } : null;
          });
        }
      }
    ]
  });

  const js = resultado.outputFiles.find((f) => f.path.endsWith('.js'));
  const map = resultado.outputFiles.find((f) => f.path.endsWith('.map'));
  if (!js) throw new Error(`frontend-bundler: esbuild no emitió JS para ${grupo.id}`);

  return {
    id: grupo.id,
    codigo: js.text,
    mapa: map ? map.text : null,
    bytes: Buffer.byteLength(js.text)
  };
}

/**
 * Construye un bundle, con caché por mtime y deduplicación de builds concurrentes.
 * @param {GrupoBundle} grupo
 * @param {{minify?: boolean, sourcemap?: boolean, cache?: boolean}} [opciones]
 * @returns {Promise<ResultadoBundle>}
 */
function construirBundle(grupo, opciones = {}) {
  const opts = {
    minify: opciones.minify !== false,
    sourcemap: opciones.sourcemap === true
  };
  const usarCache = opciones.cache !== false;

  if (usarCache) {
    const mtime = mtimeMasReciente(grupo);
    const previo = cache.get(grupo.id);
    if (previo && previo.mtime === mtime) return previo.promesa;

    const promesa = grupo.semantica === 'module'
      ? construirModule(grupo, opts)
      : construirConcat(grupo, opts);

    // Si el build falla, no dejamos la promesa rechazada en caché: el próximo
    // request debe volver a intentarlo (y ver el error actualizado).
    promesa.catch(() => {
      if (cache.get(grupo.id)?.promesa === promesa) cache.delete(grupo.id);
    });

    cache.set(grupo.id, { mtime, promesa });
    return promesa;
  }

  return grupo.semantica === 'module'
    ? construirModule(grupo, opts)
    : construirConcat(grupo, opts);
}

/**
 * Escribe un bundle a disco bajo web/public/dist/.
 * @param {ResultadoBundle} resultado
 * @param {string} [dirDestino]
 * @returns {string} ruta escrita
 */
function escribirBundle(resultado, dirDestino) {
  const dir = dirDestino || path.join(publicRoot, DIST_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `${resultado.id}.js`);
  const conRef = resultado.mapa
    ? `${resultado.codigo}\n//# sourceMappingURL=${resultado.id}.js.map\n`
    : resultado.codigo;
  fs.writeFileSync(destino, conRef);
  if (resultado.mapa) {
    fs.writeFileSync(path.join(dir, `${resultado.id}.js.map`), resultado.mapa);
  }
  return destino;
}

function limpiarCache() {
  cache.clear();
}

module.exports = {
  construirBundle,
  escribirBundle,
  limpiarCache
};
