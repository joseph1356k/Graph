// POST /api/v1/agent/decidir — el decisor Jev (TypeSafe) para la app Android.
//
// Va bajo /api/v1, que ya está detrás de X-API-Key (requireApiKey en server.js) y
// del contexto de atribución del consumo. La lógica —kill switch, whitelist,
// llamada a TypeSafe, mapeo de errores— vive en DecisorService; aquí solo hay
// dos limitadores y una línea de log por llamada.
//
// LIMITADORES. Por device_id (no por IP: los móviles comparten NAT) 30/min, y un
// tope global de Android de 300/min para que Android no pueda comerse el cupo de
// 1.200/min que TypeSafe da a la misma key que usa Windows. En Vercel el
// limitador vive por instancia (aproximado): sirve contra abuso, no como
// presupuesto; el presupuesto real es el precio (~$0,00004 por decisión). Con el
// decisor apagado los limitadores no cuentan: apagado es 503, no 429.
//
// LOG. Estilo `[agent/claves]`: una línea por llamada, con el device_id
// ENMASCARADO (los primeros 8 caracteres + «…») y solo cifras y nombres de causa.
// Nunca el objetivo, las etiquetas, la elección, la key ni el detalle de TypeSafe.

const rateLimit = require('express-rate-limit');
const { normalizarDeviceId, LIMITES, CODIGOS, MOTIVOS } = require('../../src/domain/decisor/peticionSystemOne');

const RUTA = '/api/v1/agent/decidir';
const LIMITE_POR_DISPOSITIVO = 30;
const LIMITE_GLOBAL = 300;
const VENTANA_MS = 60 * 1000;

const MASK_PREFIX_LEN = 8;
const ETIQUETA_DEVICE_VACIO = '(vacío)';

// Sólo los primeros MASK_PREFIX_LEN caracteres + «…»: suficiente para correlacionar
// dos líneas del mismo dispositivo, no para repetirlo. Un id de 16 o menos se
// recorta a la mitad para no mostrarse entero. Lo que no sea de la forma de un id
// (saltos de línea, etc.) se reemplaza por «?» para que el log no se pueda partir.
function enmascararDeviceId(deviceId) {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) return ETIQUETA_DEVICE_VACIO;
  const visible = id.slice(0, Math.min(MASK_PREFIX_LEN, Math.floor(id.length / 2)));
  return `${visible.replace(/[^A-Za-z0-9_.:\-]/g, '?')}…`;
}

// LISTA BLANCA: la línea solo escribe nombres de causa conocidos y números. Todo lo demás, sea lo
// que sea el valor, se escribe como «otro»: la traza viene de otro código y no se le cree.
const OTRO = 'otro';
const nombreConocido = (valor, permitidos) => (permitidos.includes(valor) ? valor : OTRO);
const estadoHttp = (valor) => (Number.isInteger(valor) && valor >= 100 && valor <= 599 ? valor : OTRO);

function lineaDeLog(deviceId, traza) {
  const partes = [
    '[agent/decidir]',
    `device=${enmascararDeviceId(deviceId)}`,
    `puertas=${Number.isFinite(traza.puertas) ? traza.puertas : 0}`,
    `estado=${estadoHttp(traza.estado)}`,
    `code=${nombreConocido(traza.code === undefined ? 'ok' : traza.code, CODIGOS)}`,
    `ms=${Number.isFinite(traza.ms) ? Math.round(traza.ms) : 0}`
  ];
  if (traza.upstream) partes.push(`upstream=${estadoHttp(traza.upstream)}`);
  if (traza.motivo) partes.push(`motivo=${nombreConocido(traza.motivo, MOTIVOS)}`);
  for (const cifra of ['confianza', 'cumplido', 'peligro']) {
    if (Number.isFinite(traza[cifra])) partes.push(`${cifra}=${traza[cifra]}`);
  }
  return partes.join(' ');
}

function registerAgentDecisorRoutes(app, deps = {}) {
  const decisorService = deps.decisorService || null;
  if (!app || !decisorService) {
    throw new Error('registerAgentDecisorRoutes requiere app y decisorService');
  }
  const logger = deps.logger || console;
  const deviceDe = (req) => (req.body && typeof req.body === 'object' ? req.body.device_id : undefined);
  // La cuenta de cada dispositivo va por su id NORMALIZADO, el mismo que valida y autoriza el servicio.
  const claveDeDispositivo = (req) => normalizarDeviceId(deviceDe(req)).slice(0, LIMITES.DEVICE_ID);

  const alExceder = (req, res) => {
    logger.log(lineaDeLog(deviceDe(req), { estado: 429, code: 'limite_de_uso', ms: 0 }));
    return res.status(429).json({ error: 'Demasiadas consultas al decisor; espera un momento.', code: 'limite_de_uso' });
  };
  const opcionesComunes = {
    windowMs: VENTANA_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: alExceder
  };
  // Apagado no gasta ni cuenta: el servicio contesta 503 por su cuenta.
  const apagado = () => decisorService.modo() === 'apagado';

  const limiteGlobal = rateLimit({
    ...opcionesComunes,
    limit: deps.limiteGlobal || LIMITE_GLOBAL,
    keyGenerator: () => 'android-decisor',
    skip: apagado
  });
  const limitePorDispositivo = rateLimit({
    ...opcionesComunes,
    limit: deps.limitePorDispositivo || LIMITE_POR_DISPOSITIVO,
    keyGenerator: (req) => claveDeDispositivo(req),
    // Sin un device_id de texto no hay a quién limitar: lo frena el tope global y el 400.
    skip: (req) => apagado() || !claveDeDispositivo(req)
  });

  app.post(RUTA, limiteGlobal, limitePorDispositivo, async (req, res) => {
    const cuerpo = req.body;
    let resultado;
    try {
      resultado = await decisorService.decidir(cuerpo);
    } catch (error) {
      // Nada de lo que lance el servicio sale tal cual: puede repetir datos del teléfono.
      resultado = {
        status: 500,
        json: { error: 'Error interno del decisor.', code: 'error_interno' },
        traza: { estado: 500, code: 'error_interno', ms: 0 }
      };
    }
    logger.log(lineaDeLog(deviceDe(req), resultado.traza || { estado: resultado.status }));
    if (resultado.headers) {
      for (const [nombre, valor] of Object.entries(resultado.headers)) res.set(nombre, valor);
    }
    return res.status(resultado.status).json(resultado.json);
  });
}

module.exports = registerAgentDecisorRoutes;
module.exports.enmascararDeviceId = enmascararDeviceId;
module.exports.lineaDeLog = lineaDeLog;
module.exports.LIMITE_POR_DISPOSITIVO = LIMITE_POR_DISPOSITIVO;
module.exports.LIMITE_GLOBAL = LIMITE_GLOBAL;
module.exports.RUTA = RUTA;
