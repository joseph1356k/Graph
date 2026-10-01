// Una credencial por instalación de Ü para Windows (spec 076 de apps/windows).
//
//   POST /api/v1/agent/enroll                   -> la instalación se presenta (X-API-Key embebida)
//   GET  /api/v1/agent/enroll                   -> «¿ya me aprobaron?» (X-Device-Token)
//   GET  /api/windows/devices                   -> la lista del panel (admin)
//   POST /api/windows/devices/:deviceId/status  -> aprobar / revocar (admin)
//   POST /api/windows/devices/gate              -> encender / apagar la compuerta (admin)
//
// Y LA COMPUERTA (createDeviceGate), que se monta sobre /api/v1 justo detrás de
// requireApiKey. WINDOWS_DEVICE_GATE_LABELS nombra las API keys que SOLO sirven
// para presentarse: la embebida en el instalador, que es pública porque el
// instalador lo es. Con una de esas claves, todo lo demás de /api/v1 exige además
// la credencial de una instalación APROBADA.
//
// NACE APAGADA. Con la variable vacía no se toca nada ni se consulta la base: así
// se puede desplegar antes de que las instalaciones sepan presentarse, y
// encenderla es cambiar una variable. El orden está en la spec 076.
//
// SE ENCIENDE DESDE EL PANEL (spec 004, promesas 411-413). Encenderla a mano era
// entrar a Vercel y acertar la ETIQUETA de la clave embebida, que nadie se sabe:
// un paso así se deja para luego, y mientras tanto el instalador público sigue
// abriéndolo todo. El panel ya escribe variables de su propio proyecto (las API
// keys, VercelProjectEnvService), cada instalación guarda con qué clave se
// presentó, y con eso encender es un botón que ya trae la etiqueta puesta.
//
// SE CIERRA SI NO PUEDE COMPROBAR. Con la base caída contesta 503, no deja pasar:
// una compuerta que abre cuando no ve es una compuerta que se salta tumbando la base.
//
// LOG. Una línea por alta y una por rechazo, con el id de la instalación recortado
// y el nombre de la causa. Nunca la credencial, ni su huella, ni el correo.

const rateLimit = require('express-rate-limit');

const RUTA_ENROLL = '/api/v1/agent/enroll';
const ENROLL_DENTRO_DE_V1 = '/agent/enroll';
const CABECERA = 'x-device-token';
const LIMITE_POR_IP = 10;
const VENTANA_MS = 60 * 60 * 1000;

const MENSAJES = Object.freeze({
  instalacion_sin_credencial: 'Esta instalación todavía no se ha presentado.',
  instalacion_desconocida: 'No conozco esta instalación.',
  instalacion_pendiente: 'Esta instalación espera la aprobación de un administrador.',
  instalacion_revocada: 'El acceso de esta instalación fue revocado.',
  autorizacion_no_disponible: 'No se pudo comprobar la instalación.',
  limite_de_uso: 'Demasiadas altas desde esta red; espera un rato.',
  cuerpo_invalido: 'La petición no tiene la forma esperada.',
  etiqueta_desconocida: 'Esa etiqueta no es la de ninguna API key: no protegería nada.',
  sin_instalaciones_aprobadas: 'Ninguna instalación aprobada se presentó con esa clave: encender la compuerta ahora las dejaría fuera a todas.',
  compuerta_no_se_puede_cambiar: 'La compuerta no se puede cambiar desde aquí: este Graph no puede escribir sus variables en Vercel.'
});

const VARIABLE_DE_LA_COMPUERTA = 'WINDOWS_DEVICE_GATE_LABELS';
// LO QUE SE ESCRIBE AL APAGAR. Vercel no guarda una variable vacía, así que apagar
// escribe esto. Lleva «:» a propósito: la etiqueta de una API key es lo que va
// ANTES del primer «:» de MIRACLE_API_KEYS, así que ninguna puede llevarlo, y un
// valor con «:» no es una etiqueta ni hoy ni mañana.
const APAGADA = 'apagada:';

function etiquetasDeLaCompuerta(env) {
  return `${(env && env[VARIABLE_DE_LA_COMPUERTA]) || ''}`
    .split(',')
    .map((valor) => valor.trim())
    .filter((valor) => valor && !valor.includes(':'));
}

// Los 8 primeros caracteres: bastan para seguir una instalación entre dos líneas.
function recortar(deviceId) {
  const id = `${deviceId || ''}`.replace(/[^0-9a-fA-F-]/g, '');
  return id ? `${id.slice(0, 8)}…` : '(sin id)';
}

function rutaSinBarraFinal(ruta) {
  const limpia = `${ruta || ''}`;
  return limpia.length > 1 && limpia.endsWith('/') ? limpia.slice(0, -1) : limpia;
}

function requireProviderAdmin(req, res, next) {
  if (!req.workflowAccess?.canManageGlobalWorkflows) {
    return res.status(403).json({ error: 'No autorizado para administrar las instalaciones de Windows.' });
  }
  return next();
}

// Middleware para app.use('/api/v1', ...), DESPUÉS de requireApiKey.
function createDeviceGate(deps = {}) {
  const windowsDeviceService = deps.windowsDeviceService;
  if (!windowsDeviceService) {
    throw new Error('createDeviceGate requiere windowsDeviceService');
  }
  const env = deps.env || process.env;
  const logger = deps.logger || console;

  return async function deviceGate(req, res, next) {
    const etiqueta = (req.apiClient && req.apiClient.label) || '';
    // Se lee en cada petición: encender la compuerta es cambiar la variable, no reiniciar nada.
    if (!etiqueta || !etiquetasDeLaCompuerta(env).includes(etiqueta)) return next();
    // Lo ÚNICO que la clave sola puede hacer: presentarse y preguntar su estado.
    // La ruta exacta, no un prefijo: «/agent/enroll-lo-que-sea» no se cuela.
    if (rutaSinBarraFinal(req.path) === ENROLL_DENTRO_DE_V1) return next();

    const rechaza = (status, code, device) => {
      logger.log(`[agent/gate] etiqueta=${etiqueta} code=${code} device=${recortar(device && device.deviceId)}`);
      const cuerpo = { error: MENSAJES[code], code };
      if (device && device.codigo) cuerpo.codigo = device.codigo;
      return res.status(status).json(cuerpo);
    };

    const credencial = `${req.get(CABECERA) || ''}`.trim();
    if (!credencial) return rechaza(403, 'instalacion_sin_credencial');

    let device;
    try {
      device = await windowsDeviceService.authorize(credencial);
    } catch (error) {
      // El mensaje de la base no sale: puede traer detalle interno.
      logger.error(`[agent/gate] etiqueta=${etiqueta} code=autorizacion_no_disponible estado=${error.statusCode || 'sin estado'}`);
      return res.status(503).json({ error: MENSAJES.autorizacion_no_disponible, code: 'autorizacion_no_disponible' });
    }
    if (!device) return rechaza(403, 'instalacion_desconocida');
    if (device.status === 'revocada') return rechaza(403, 'instalacion_revocada', device);
    // Todo lo que no sea «aprobada» se trata como pendiente: un estado nuevo en la
    // base no puede convertirse en un pase por no estar en esta lista.
    if (device.status !== 'aprobada') return rechaza(403, 'instalacion_pendiente', device);

    req.windowsDevice = device;
    return next();
  };
}

function registerWindowsDeviceRoutes(app, deps = {}) {
  const windowsDeviceService = deps.windowsDeviceService;
  if (!app || !windowsDeviceService) {
    throw new Error('registerWindowsDeviceRoutes requiere app y windowsDeviceService');
  }
  const logger = deps.logger || console;
  // El MISMO objeto que lee la compuerta: encenderla aquí la enciende ya en esta instancia.
  const env = deps.env || process.env;
  const vercelEnvService = deps.vercelEnvService || null;
  const etiquetasConocidas = typeof deps.etiquetasConocidas === 'function' ? deps.etiquetasConocidas : () => [];

  const sePuedeCambiar = () => {
    try {
      return Boolean(vercelEnvService && vercelEnvService.status().write_enabled);
    } catch (_) {
      return false;
    }
  };

  // Lo que el panel necesita para ofrecer el botón sin que nadie tenga que saberse
  // una etiqueta: si está puesta, para cuáles, y con cuáles se presentan las instalaciones.
  const describirLaCompuerta = (devices) => {
    const etiquetas = etiquetasDeLaCompuerta(env);
    const deLasInstalaciones = [...new Set((devices || []).map((d) => `${d.api_label || ''}`.trim()).filter(Boolean))].sort();
    return {
      encendida: etiquetas.length > 0,
      etiquetas,
      etiquetas_de_las_instalaciones: deLasInstalaciones,
      se_puede_cambiar: sePuedeCambiar()
    };
  };

  // Solo los fallos PROPIOS del servicio (los que traen un código de la lista) salen
  // con su estado y su mensaje. Lo que venga de la base se queda en un «no
  // disponible», sin su texto: puede traer detalle interno.
  const esPropio = (error) => Boolean(error && error.code && MENSAJES[error.code]);

  // Presentarse no gasta dinero, pero deja una fila: sin tope, cualquiera con el
  // instalador podría llenar la lista del panel de pendientes.
  const limiteDeAltas = rateLimit({
    windowMs: VENTANA_MS,
    limit: deps.limitePorIp || LIMITE_POR_IP,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      logger.log('[agent/enroll] code=limite_de_uso');
      return res.status(429).json({ error: MENSAJES.limite_de_uso, code: 'limite_de_uso' });
    }
  });

  app.post(RUTA_ENROLL, limiteDeAltas, async (req, res) => {
    try {
      const etiqueta = (req.apiClient && req.apiClient.label) || '';
      const alta = await windowsDeviceService.enroll(req.body || {}, { etiqueta });
      logger.log(`[agent/enroll] alta device=${recortar(alta.device_id)} estado=${alta.estado} etiqueta=${etiqueta || '(sin etiqueta)'}`);
      // Que la credencial no se quede en ninguna cache intermedia.
      res.set('Cache-Control', 'no-store, private');
      return res.json(alta);
    } catch (error) {
      if (esPropio(error)) {
        logger.log(`[agent/enroll] code=${error.code}`);
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      }
      logger.error(`[agent/enroll] code=autorizacion_no_disponible estado=${error.statusCode || 'sin estado'}`);
      return res.status(503).json({ error: MENSAJES.autorizacion_no_disponible, code: 'autorizacion_no_disponible' });
    }
  });

  app.get(RUTA_ENROLL, async (req, res) => {
    const credencial = `${req.get(CABECERA) || ''}`.trim();
    if (!credencial) {
      return res.status(403).json({ error: MENSAJES.instalacion_sin_credencial, code: 'instalacion_sin_credencial' });
    }
    try {
      const device = await windowsDeviceService.authorize(credencial);
      if (!device) {
        // 404 y no 403: le dice al cliente que su credencial ya no existe y toca presentarse otra vez.
        return res.status(404).json({ error: MENSAJES.instalacion_desconocida, code: 'instalacion_desconocida' });
      }
      res.set('Cache-Control', 'no-store, private');
      return res.json({ device_id: device.deviceId, estado: device.status, codigo: device.codigo });
    } catch (error) {
      logger.error(`[agent/enroll] estado code=autorizacion_no_disponible estado=${error.statusCode || 'sin estado'}`);
      return res.status(503).json({ error: MENSAJES.autorizacion_no_disponible, code: 'autorizacion_no_disponible' });
    }
  });

  app.get('/api/windows/devices', requireProviderAdmin, async (req, res) => {
    try {
      const devices = await windowsDeviceService.list(req.query && req.query.limit);
      return res.json({ devices, compuerta: describirLaCompuerta(devices) });
    } catch (error) {
      logger.error(`[Windows devices] list: ${error.statusCode || 'sin estado'}`);
      return res.status(503).json({ error: 'No fue posible cargar las instalaciones.' });
    }
  });

  app.post('/api/windows/devices/:deviceId/status', requireProviderAdmin, async (req, res) => {
    try {
      const quien = `${(req.user && (req.user.email || req.user.username)) || ''}`.trim();
      const device = await windowsDeviceService.setStatus(req.params.deviceId, req.body && req.body.status, quien);
      logger.log(`[Windows devices] device=${recortar(device.device_id)} pasa a ${device.status}`);
      return res.json({ device });
    } catch (error) {
      if (esPropio(error)) {
        return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
      }
      logger.error(`[Windows devices] setStatus: ${error.statusCode || 'sin estado'}`);
      return res.status(503).json({ error: 'No fue posible cambiar el estado de la instalación.' });
    }
  });

  // Encender o apagar la compuerta. { etiquetas: ['x'] } la pone para esas claves;
  // { etiquetas: [] } la apaga. Se escribe en Vercel —para que sobreviva al
  // siguiente despliegue y la lean todas las instancias— y en ESTA instancia ya.
  app.post('/api/windows/devices/gate', requireProviderAdmin, async (req, res) => {
    const rechaza = (status, code, extra) => res.status(status).json({ error: MENSAJES[code], code, ...extra });

    const cuerpo = req.body || {};
    if (!Array.isArray(cuerpo.etiquetas)) return rechaza(400, 'cuerpo_invalido');
    const pedidas = [...new Set(cuerpo.etiquetas.map((valor) => `${valor == null ? '' : valor}`.trim()).filter(Boolean))];

    // UNA ETIQUETA QUE NO ES DE NINGUNA CLAVE deja la compuerta «puesta» sin proteger
    // nada: es el guardia que se cree puesto. Se dice, no se escribe.
    const conocidas = etiquetasConocidas();
    const desconocida = pedidas.find((etiqueta) => etiqueta.includes(':') || !conocidas.includes(etiqueta));
    if (desconocida !== undefined) return rechaza(400, 'etiqueta_desconocida', { etiqueta: desconocida });

    // ENCENDERLA SIN NINGUNA APROBADA deja fuera a todas las instalaciones a la vez.
    // Puede ser justo lo que se quiere —cerrar ya, aprobar después—, y por eso se
    // puede pedir a sabiendas (forzar); lo que no puede es pasar por descuido.
    if (pedidas.length > 0 && cuerpo.forzar !== true) {
      try {
        for (const etiqueta of pedidas) {
          if (!(await windowsDeviceService.hayAprobadas(etiqueta))) {
            return rechaza(409, 'sin_instalaciones_aprobadas', { etiqueta });
          }
        }
      } catch (error) {
        logger.error(`[Windows devices] compuerta: no pude contar las aprobadas (${error.statusCode || 'sin estado'})`);
        return rechaza(503, 'autorizacion_no_disponible');
      }
    }

    const valor = pedidas.length > 0 ? pedidas.join(',') : APAGADA;
    try {
      if (!vercelEnvService) throw Object.assign(new Error('sin VercelProjectEnvService'), { statusCode: 503 });
      vercelEnvService.assertWritable();
      // No es un secreto: es el nombre de una etiqueta, y así se puede leer en Vercel.
      await vercelEnvService.upsertProjectEnv(VARIABLE_DE_LA_COMPUERTA, valor, { secret: false });
    } catch (error) {
      // El mensaje de dentro no sale: el de Vercel puede traer detalle del proyecto.
      logger.error(`[Windows devices] compuerta: no se pudo guardar (${error.statusCode || 'sin estado'})`);
      return rechaza(503, 'compuerta_no_se_puede_cambiar');
    }

    // SOLO DESPUÉS de guardada: si no se pudo escribir, esta instancia no se queda
    // con una compuerta que el siguiente despliegue olvidaría.
    env[VARIABLE_DE_LA_COMPUERTA] = valor;

    let deployment;
    try {
      deployment = await vercelEnvService.triggerRedeploy();
    } catch (error) {
      deployment = { triggered: false, strategy: 'manual', message: 'La variable quedó guardada, pero no se pudo redesplegar: las demás instancias la leerán en el siguiente despliegue.' };
      logger.error(`[Windows devices] compuerta: guardada, sin redesplegar (${error.statusCode || 'sin estado'})`);
    }

    const quien = `${(req.user && (req.user.email || req.user.username)) || ''}`.trim() || '(sin nombre)';
    logger.log(`[Windows devices] compuerta ${pedidas.length > 0 ? `puesta para ${pedidas.join(',')}` : 'apagada'} por ${quien}`);

    let devices = [];
    try {
      devices = await windowsDeviceService.list();
    } catch (_) {
      // La compuerta ya cambió; la lista se relee desde el panel.
    }
    return res.json({ ok: true, compuerta: describirLaCompuerta(devices), deployment });
  });
}

module.exports = registerWindowsDeviceRoutes;
module.exports.createDeviceGate = createDeviceGate;
module.exports.etiquetasDeLaCompuerta = etiquetasDeLaCompuerta;
module.exports.RUTA_ENROLL = RUTA_ENROLL;
module.exports.CABECERA = CABECERA;
