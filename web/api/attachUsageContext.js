// Middleware que abre el contexto de atribución para toda la petición.
//
// Se monta DESPUÉS de la autenticación, porque necesita `req.clinicalUser`,
// `req.apiClient` o `req.user` ya resueltos, y ANTES de las rutas, para que
// cualquier llamada a un modelo que ocurra dentro herede la identidad sin que
// nadie tenga que acordarse de pasarla.
//
// El `next()` va DENTRO de `runWithContext`: ese es el detalle que hace que
// funcione. Si se llamara fuera, el resto de la cadena correría en otro ámbito
// asíncrono y el contexto estaría vacío justo donde se necesita.

const { runWithContext } = require('../../src/infrastructure/usage/UsageContext');

function createUsageContextMiddleware(resolver, options = {}) {
  const defaultFeature = options.feature || 'unknown';

  return function attachUsageContext(req, res, next) {
    resolver
      .resolveFromRequest(req, { feature: defaultFeature })
      .then((context) => {
        req.usageContext = context;
        runWithContext(context, () => next());
      })
      .catch((error) => {
        // Si la resolución falla (Supabase caído, por ejemplo), la petición
        // sigue: se pierde la atribución, no el servicio. El evento quedará
        // marcado `unattributed`, que es la verdad de lo ocurrido.
        console.warn(`[Usage] No se pudo resolver la atribución: ${error.message}`);
        runWithContext({ feature: defaultFeature }, () => next());
      });
  };
}

module.exports = createUsageContextMiddleware;
