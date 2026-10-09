// CLAVES DE TERCEROS PARA EL ASISTENTE DE ESCRITORIO (Windows). Ver spec 041 de windows-app.
//
//   GET /api/v1/agent/claves  -> { openai, typesafe }
//
// POR QUE EXISTE. El Setup.exe que se distribuye lleva embebidas la credencial de Graph y el token
// de actualizaciones, y nada mas. La voz (OpenAI) y el decisor (TypeSafe) salian de variables de
// entorno del equipo de quien desarrolla, asi que una copia instalada en otra maquina llegaba SIN
// VOZ Y SIN JEV. Embeberlas en el binario era la salida rapida y se descarto: un .exe que lleva
// claves de pago se las entrega a quien lo reciba, y rotarlas obligaria a sacar instalador nuevo.
// Aqui ya viven como variables de entorno, y rotarlas es cambiarlas y volver a desplegar.
//
// QUIEN PUEDE PEDIRLAS (spec 004, promesa 414). Hasta el 2026-10-01, CUALQUIER API key valida:
// todo /api/v1 pasa por requireApiKey y esta ruta no miraba mas. En produccion hay 19 claves
// —Android, Mac, la extension, cada dev—, y varias viajan dentro de algo que se reparte. Cerrar la
// del instalador de Windows con la compuerta dejaba las otras dieciocho puertas abiertas a las
// mismas claves de pago. Ahora:
//   · compuerta APAGADA (como se despliega): igual que antes. Sin lista, cualquier clave valida;
//     con AGENT_KEYS_ALLOWED_LABELS, solo las etiquetas de la lista.
//   · compuerta PUESTA: solo una instalacion APROBADA (la deja en req.windowsDevice la compuerta,
//     web/api/registerWindowsDeviceRoutes.js) o una etiqueta nombrada en AGENT_KEYS_ALLOWED_LABELS.
// Esta en su propio archivo para que el juez monte LA RUTA DE VERDAD y no una de mentira que
// contesta siempre: asi fue como el hueco de arriba paso por diez promesas verdes.
//
// QUE NO SE REGISTRA: ni un valor. Solo QUE etiqueta pidio y QUE nombres se sirvieron. Un secreto
// en un log es un secreto repartido.

const { etiquetasDeLaCompuerta } = require('./registerWindowsDeviceRoutes');

// Que clave de tercero se sirve bajo que nombre. El nombre de la variable es el mismo que usa el
// cliente de escritorio en su entorno, para que poner una a mano y recibirla del backend sean lo mismo.
const AGENT_KEYS = [
  ['openai', 'OPENAI_API_KEY'],
  ['typesafe', 'TYPESAFE_API_KEY'],
];

function agentKeyNames(env = process.env) {
  return AGENT_KEYS.filter(([, variable]) => `${env[variable] || ''}`.trim()).map(([campo]) => campo);
}

function etiquetasPermitidas(env) {
  return `${(env && env.AGENT_KEYS_ALLOWED_LABELS) || ''}`
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Devuelve '' si se le sirven, o el motivo —para el log— si no.
function porQueNo({ etiqueta, windowsDevice, env }) {
  const permitidas = etiquetasPermitidas(env);
  if (permitidas.includes(etiqueta)) return '';
  if (etiquetasDeLaCompuerta(env).length > 0) {
    // Solo «aprobada»: un estado nuevo en la base no puede leerse aqui como un pase.
    return windowsDevice && windowsDevice.status === 'aprobada'
      ? ''
      : 'la compuerta esta puesta y no es una instalacion aprobada ni esta en AGENT_KEYS_ALLOWED_LABELS';
  }
  return permitidas.length ? 'no esta en AGENT_KEYS_ALLOWED_LABELS' : '';
}

function registerAgentKeysRoute(app, deps = {}) {
  const env = deps.env || process.env;
  const logger = deps.logger || console;

  app.get('/api/v1/agent/claves', (req, res) => {
    const etiqueta = (req.apiClient && req.apiClient.label) || 'desconocida';
    const motivo = porQueNo({ etiqueta, windowsDevice: req.windowsDevice, env });
    if (motivo) {
      logger.warn(`[agent/claves] ${etiqueta}: ${motivo}; no se le sirven claves`);
      return res.status(403).json({ error: 'Esta API key no puede pedir claves de terceros.', code: 'claves_no_permitidas' });
    }

    const claves = {};
    for (const [campo, variable] of AGENT_KEYS) {
      const valor = `${env[variable] || ''}`.trim();
      if (valor) claves[campo] = valor;
    }

    // Que no se quede en ninguna cache intermedia, ni de proxy ni de navegador.
    res.set('Cache-Control', 'no-store, private');
    logger.log(`[agent/claves] ${etiqueta} pidio claves; se sirven: ${Object.keys(claves).join(', ') || 'ninguna'}`);
    return res.json(claves);
  });
}

module.exports = registerAgentKeysRoute;
module.exports.agentKeyNames = agentKeyNames;
module.exports.porQueNo = porQueNo;
