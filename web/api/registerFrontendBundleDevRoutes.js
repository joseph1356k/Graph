// @ts-check
// Middleware de desarrollo para los bundles del frontend (Fase 1, ver
// docs/PLAN-BUILD-FRONTEND.md).
//
// En dev sirve /dist/*.js construyéndolos al vuelo, para que el flujo siga
// siendo "guardar y refrescar" con un solo proceso (`npm start`), sin un watch
// aparte que haya que recordar tener corriendo.
//
// En producción NO se registra: ahí /dist ya existe en disco porque lo generó
// `npm run build:vercel`, y lo sirve express.static (o el CDN de Vercel).
//
// IMPORTANTE: hay que registrarlo ANTES de `express.static('web/public')`, o un
// /dist rancio en disco le gana al bundle recién construido.
const path = require('path');

/**
 * ¿Estamos en desarrollo local? En Vercel o con NODE_ENV=production, no.
 * @returns {boolean}
 */
function esDesarrollo() {
  return !process.env.VERCEL
    && `${process.env.NODE_ENV || ''}`.trim().toLowerCase() !== 'production';
}

/**
 * @param {import('express').Express} app
 * @param {{ forzar?: boolean }} [opciones] `forzar` solo para tests
 */
function registerFrontendBundleDevRoutes(app, opciones = {}) {
  if (!opciones.forzar && !esDesarrollo()) return;

  // Se cargan acá, no arriba, para que requerir este módulo en producción no
  // arrastre esbuild ni lea el manifiesto si el middleware no se va a usar.
  const fb = require('../../scripts/lib/frontend-bundles');
  const { construirBundle } = require('../../scripts/lib/frontend-bundler');

  /** @param {string} id */
  function buscarBundle(id) {
    return fb.todosLosBundles().find((/** @type {any} */ b) => b.id === id) || null;
  }

  app.get(`/${fb.DIST_DIR_NAME}/:archivo`, async (req, res, next) => {
    const archivo = `${req.params.archivo || ''}`;
    const esMapa = archivo.endsWith('.js.map');
    const esJs = archivo.endsWith('.js');
    if (!esJs && !esMapa) return next();

    // Nada de path traversal: el id es un nombre plano.
    if (archivo.includes('/') || archivo.includes('\\') || archivo.includes('..')) {
      return res.status(400).type('text/plain').send('Nombre de bundle inválido.');
    }

    const id = archivo.replace(/\.js(\.map)?$/, '');
    const grupo = buscarBundle(id);
    if (!grupo) return next();

    try {
      // Sin minificar en dev: el código es legible en devtools y el build es
      // más rápido. La caché por mtime vive en el bundler.
      const resultado = await construirBundle(grupo, { minify: false, sourcemap: true });

      res.set('Cache-Control', 'no-store');
      if (esMapa) {
        if (!resultado.mapa) return res.status(404).type('text/plain').send('Sin sourcemap.');
        return res.type('application/json').send(resultado.mapa);
      }
      const cuerpo = resultado.mapa
        ? `${resultado.codigo}\n//# sourceMappingURL=${id}.js.map\n`
        : resultado.codigo;
      return res.type('text/javascript').send(cuerpo);
    } catch (error) {
      // Un error de build tiene que ser VISIBLE, no un 500 mudo: se devuelve JS
      // válido que lo grita en la consola del navegador.
      const mensaje = error instanceof Error ? error.message : `${error}`;
      console.error(`[Bundles] falló ${id}:`, mensaje);
      const escapado = JSON.stringify(`[Bundles] falló ${id}: ${mensaje}`);
      return res
        .status(200)
        .type('text/javascript')
        .send(`console.error(${escapado});`);
    }
  });

  const rutaManifiesto = path.relative(process.cwd(), fb.MANIFIESTO_PATH);
  const fuente = require('fs').existsSync(fb.MANIFIESTO_PATH) ? rutaManifiesto : 'derivado de los HTML';
  console.log(`[Bundles] middleware de dev activo (fuente: ${fuente})`);
}

module.exports = registerFrontendBundleDevRoutes;
