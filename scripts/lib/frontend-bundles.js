// @ts-check
// Fuente única de verdad del bundling del frontend (ver docs/PLAN-BUILD-FRONTEND.md).
//
// El punto clave: los entry points NO se declaran en una lista a mano — se
// DERIVAN de los propios HTML. Así no puede existir una segunda lista que se
// desincronice, que es exactamente el problema que esta fase viene a matar.
//
// Consumidores: scripts/build-vercel.js, el middleware de dev en web/server.js,
// scripts/lib/chrome-extension-bundle.js y la generación del precache del
// service worker.
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const publicRoot = path.join(repoRoot, 'web', 'public');
const extensionSrcRoot = path.join(repoRoot, 'chrome-extension-src', 'graph-trainer');

const DIST_DIR_NAME = 'dist';

// HTML que no participan del bundling.
const HTML_EXCLUIDOS = new Set(['api-docs.html', 'autofill-api-docs.html']);

/**
 * Semántica de carga de un <script>. Determina en qué bundle puede entrar:
 * scripts con semántica distinta NUNCA se mezclan, porque el navegador los
 * ejecuta en momentos distintos.
 * @typedef {'classic'|'defer'|'async'|'module'|'inline'} SemanticaCarga
 */

/**
 * @typedef {object} EtiquetaScript
 * @property {SemanticaCarga} semantica
 * @property {string|null} src        `src` tal cual aparece en el HTML
 * @property {string|null} absPath    ruta en disco, si se pudo resolver
 * @property {string} raw             la etiqueta completa <script ...>...</script>
 * @property {number} start           índice de inicio en el HTML
 * @property {number} end             índice de fin en el HTML
 */

/**
 * @typedef {object} GrupoBundle
 * @property {string} id              identificador del bundle (nombre de archivo sin .js)
 * @property {SemanticaCarga} semantica
 * @property {string[]} archivos      rutas absolutas, en orden de ejecución
 * @property {{start: number, end: number}[]} posiciones
 *   Rango en el HTML de CADA <script> del grupo, en orden de documento. Se
 *   guardan por separado (y no un rango único) porque los grupos intercalados
 *   se solapan: en windows-lab.html el grupo `defer` abarca de la línea 11 a la
 *   64 y cruza por encima del grupo `classic` de las líneas 61-63. El
 *   reescribado de HTML reemplaza la primera posición por el tag del bundle y
 *   borra las demás.
 * @property {number} start           inicio del primer <script> del grupo
 * @property {number} end             fin del último <script> del grupo
 */

/**
 * Clasifica una etiqueta <script> por su semántica de carga.
 * Nota: `type="module"` implica defer, pero se trata como grupo aparte porque
 * necesita bundling de módulos (resolución de imports), no concatenación.
 * @param {string} attrs
 * @param {string|null} src
 * @returns {SemanticaCarga}
 */
function clasificar(attrs, src) {
  if (!src) return 'inline';
  if (/\btype\s*=\s*["']module["']/i.test(attrs)) return 'module';
  if (/\basync\b/i.test(attrs)) return 'async';
  if (/\bdefer\b/i.test(attrs)) return 'defer';
  return 'classic';
}

/**
 * Resuelve el `src` de un <script> a una ruta en disco bajo web/public.
 * Devuelve null si es externo (http, //) o no existe. Limpia el cache-buster.
 * @param {string} src
 * @param {string} htmlDir
 * @returns {string|null}
 */
function resolverSrc(src, htmlDir) {
  if (/^(https?:)?\/\//i.test(src)) return null;
  if (src.startsWith('data:')) return null;
  const limpio = src.split('?')[0].split('#')[0];
  const abs = limpio.startsWith('/')
    ? path.join(publicRoot, limpio.slice(1))
    : path.resolve(htmlDir, limpio);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Extrae todas las etiquetas <script> de un HTML, en orden de documento.
 * @param {string} html
 * @param {string} htmlDir
 * @returns {EtiquetaScript[]}
 */
function escanearScripts(html, htmlDir) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  return [...html.matchAll(re)].map((m) => {
    const attrs = m[1] || '';
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = srcMatch ? srcMatch[1] : null;
    const start = /** @type {number} */ (m.index);
    return {
      semantica: clasificar(attrs, src),
      src,
      absPath: src ? resolverSrc(src, htmlDir) : null,
      raw: m[0],
      start,
      end: start + m[0].length
    };
  });
}

/**
 * Qué etiquetas actúan como BARRERA DE ORDEN para una semántica dada, es decir
 * cuáles pueden ejecutarse *entre* dos scripts de esa semántica y por lo tanto
 * impiden agruparlos.
 *
 * Derivado de cómo el navegador ordena la ejecución:
 *  - `classic` y los inline se ejecutan durante el parseo, intercalados en orden
 *    de documento → un inline SÍ separa dos clásicos.
 *  - `defer` y `module` se ejecutan después del parseo, así que ningún inline ni
 *    ningún clásico se ejecuta entre dos de ellos → no los separan.
 *  - `defer` y `module` sí se intercalan ENTRE SÍ por orden de documento → cada
 *    uno es barrera del otro.
 *  - `async` no tiene orden garantizado: nunca se agrupa (ver más abajo).
 * @type {Record<string, Set<SemanticaCarga>>}
 */
const BARRERAS = {
  classic: new Set(['inline']),
  defer: new Set(['module']),
  module: new Set(['defer'])
};

/**
 * Agrupa las etiquetas de un HTML en bundles.
 *
 * Solo se agrupan scripts con la MISMA semántica de carga, y un grupo se corta
 * cuando aparece una barrera de orden (ver `BARRERAS`). Los scripts de otra
 * semántica que no son barrera se SALTAN sin cortar el grupo, porque el
 * navegador no los ejecuta en medio.
 *
 * Esto es lo que permite bundlear `windows-lab.html`, donde los `defer` están
 * separados textualmente por clásicos pero se ejecutan los tres seguidos.
 *
 * @param {string} slug identificador de la página (p.ej. "emr-workspace")
 * @param {EtiquetaScript[]} etiquetas
 * @returns {GrupoBundle[]}
 */
function agrupar(slug, etiquetas) {
  /** @type {GrupoBundle[]} */
  const grupos = [];

  // Una pasada por semántica: así se pueden saltar las etiquetas que no son
  // barrera sin perder el orden de documento dentro del grupo.
  for (const semantica of /** @type {SemanticaCarga[]} */ (['classic', 'defer', 'module'])) {
    const barreras = BARRERAS[semantica];
    /** @type {GrupoBundle|null} */
    let actual = null;

    const cerrar = () => {
      // Un grupo de un solo archivo no gana nada por bundlearse... salvo que sea
      // `module`, donde el bundling resuelve imports y elimina requests en cascada.
      if (actual && (actual.archivos.length > 1 || actual.semantica === 'module')) {
        grupos.push(actual);
      }
      actual = null;
    };

    for (const et of etiquetas) {
      if (et.semantica === semantica) {
        // Un externo que no se pudo resolver (CDN, archivo inexistente) sigue
        // ocupando su lugar en el orden: corta el grupo.
        if (!et.absPath) {
          cerrar();
          continue;
        }
        if (actual) {
          actual.archivos.push(et.absPath);
          actual.posiciones.push({ start: et.start, end: et.end });
          actual.end = et.end;
        } else {
          actual = {
            id: '', // se asigna abajo, cuando sabemos cuántos grupos hay
            semantica,
            archivos: [et.absPath],
            posiciones: [{ start: et.start, end: et.end }],
            start: et.start,
            end: et.end
          };
        }
        continue;
      }

      if (barreras.has(et.semantica)) cerrar();
    }
    cerrar();
  }

  grupos.sort((a, b) => a.start - b.start);

  // Nombres estables y legibles: <slug>.<semantica>[.<n>].js
  const porSemantica = new Map();
  for (const g of grupos) {
    const n = (porSemantica.get(g.semantica) || 0) + 1;
    porSemantica.set(g.semantica, n);
    const total = grupos.filter((o) => o.semantica === g.semantica).length;
    g.id = total > 1 ? `${slug}.${g.semantica}.${n}` : `${slug}.${g.semantica}`;
  }

  return grupos;
}

/** @returns {string[]} rutas absolutas de los HTML que participan del bundling */
function listarHtml() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function caminar(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === DIST_DIR_NAME || entry.name === 'studio-docs') continue;
        caminar(abs);
      } else if (entry.name.endsWith('.html') && !HTML_EXCLUIDOS.has(entry.name)) {
        out.push(abs);
      }
    }
  }
  caminar(publicRoot);
  return out.sort();
}

/**
 * @typedef {object} PaginaBundle
 * @property {string} html      ruta absoluta del HTML
 * @property {string} relHtml   ruta relativa a web/public
 * @property {string} slug
 * @property {GrupoBundle[]} grupos
 */

/**
 * Descubre todos los entry points del frontend derivándolos de los HTML.
 * @returns {PaginaBundle[]}
 */
function descubrirPaginas() {
  const paginas = [];
  for (const html of listarHtml()) {
    const contenido = fs.readFileSync(html, 'utf8');
    const relHtml = path.relative(publicRoot, html).split(path.sep).join('/');
    // "miracle/index.html" -> "miracle-index"
    const slug = relHtml.replace(/\.html$/, '').replace(/\//g, '-');
    const grupos = agrupar(slug, escanearScripts(contenido, path.dirname(html)));
    if (grupos.length > 0) paginas.push({ html, relHtml, slug, grupos });
  }
  return paginas;
}

/**
 * Todos los bundles del frontend, incluido el de la extensión de Chrome.
 * @returns {GrupoBundle[]}
 */
function todosLosBundles() {
  const bundles = descubrirPaginas().flatMap((p) => p.grupos);
  bundles.push(bundleExtension());
  return bundles;
}

/**
 * El bundle del content script de la extensión.
 *
 * Cruza dos árboles: el runtime compartido vive en web/public/ y `content.js`
 * en chrome-extension-src/. El orden sale del manifest.json, que es la fuente
 * de verdad de lo que Chrome ejecuta.
 * @returns {GrupoBundle}
 */
function bundleExtension() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionSrcRoot, 'manifest.json'), 'utf8')
  );
  const entradas = manifest?.content_scripts?.[0]?.js || [];

  const archivos = entradas.map((/** @type {string} */ entrada) => {
    // "assets/plugin/plugin-api.js" -> web/public/plugin/plugin-api.js
    if (entrada.startsWith('assets/')) {
      return path.join(publicRoot, entrada.slice('assets/'.length));
    }
    // "content.js" -> chrome-extension-src/graph-trainer/content.js
    return path.join(extensionSrcRoot, entrada);
  });

  const faltantes = archivos.filter((/** @type {string} */ f) => !fs.existsSync(f));
  if (faltantes.length > 0) {
    throw new Error(
      `frontend-bundles: el manifest de la extensión apunta a archivos que no existen:\n  ${faltantes.join('\n  ')}`
    );
  }

  return {
    id: 'extension-content',
    semantica: 'classic',
    archivos,
    posiciones: [], // no viene de un HTML: el orden lo manda el manifest
    start: -1,
    end: -1
  };
}

module.exports = {
  DIST_DIR_NAME,
  publicRoot,
  extensionSrcRoot,
  repoRoot,
  escanearScripts,
  agrupar,
  descubrirPaginas,
  todosLosBundles,
  bundleExtension
};
