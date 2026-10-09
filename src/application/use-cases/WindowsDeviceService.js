// Una credencial por instalación de Ü para Windows (spec 076 de apps/windows).
//
// QUÉ PROBLEMA RESUELVE. Todas las instalaciones compartían UNA API key embebida
// en el instalador, y el instalador es público (el repo lo es). Esa key abría
// todo /api/v1, incluida la entrega de las claves crudas de OpenAI y TypeSafe.
// Aquí cada instalación se presenta una vez (enroll), recibe una credencial
// propia y queda PENDIENTE hasta que un admin la aprueba en Provider Studio. La
// compuerta que lo exige vive en web/api/registerWindowsDeviceRoutes.js.
//
// LA CREDENCIAL NO SE GUARDA. Se entrega una vez y en la base queda su SHA-256:
// quien lea la tabla no puede hacerse pasar por ninguna instalación. SHA-256 sin
// sal basta porque la credencial son 32 bytes al azar, no una contraseña que se
// pueda adivinar por diccionario.
//
// NADIE SE APRUEBA SOLO. El estado de una fila nueva es siempre «pendiente» y lo
// pone este servicio, no el cuerpo de la petición. El correo lo teclea la persona
// sin verificar y el install_id lo dice el cliente: ninguno de los dos autoriza.
//
// LA MEMORIA DE CADA INSTANCIA. La compuerta corre en cada petición a /api/v1 y un
// viaje a Supabase por petición sería pagar ~50 ms en un camino donde Windows
// pelea por cada 100. Una aprobada se recuerda 60 s; lo demás, 10 s, para que
// aprobar en el panel se note enseguida. El coste, dicho: revocar tarda hasta un
// minuto en llegar a las OTRAS instancias de Vercel. En la que revoca es inmediato.
//
// QUÉ SE LOGUEA: el id de la instalación (los 8 primeros caracteres) y nombres de
// estado. Nunca la credencial ni su huella.

const crypto = require('crypto');

const TABLA = 'graph_windows_devices';
const ESTADOS = Object.freeze(['pendiente', 'aprobada', 'revocada']);
const PREFIJO = 'udev_';
const BYTES_DE_LA_CREDENCIAL = 32;
const LARGO_MAXIMO_DE_CREDENCIAL = 200;
const LARGO_MAXIMO_DE_TEXTO = 200;
const TTL_APROBADA_MS = 60_000;
const TTL_OTRAS_MS = 10_000;
const MEMORIA_MAXIMA = 5000;
const LISTA_MAXIMA = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Las columnas que salen hacia el panel: token_hash NO está, y es deliberado.
const COLUMNAS_DEL_PANEL = 'device_id,status,api_label,email,display_name,install_id,machine_name,os_version,app_version,enrolled_at,last_seen_at,decided_at,decided_by';

function fallo(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function texto(valor) {
  return `${valor == null ? '' : valor}`.trim().slice(0, LARGO_MAXIMO_DE_TEXTO);
}

function huellaDe(credencial) {
  return crypto.createHash('sha256').update(credencial).digest('hex');
}

// El código que la persona le dicta al administrador: los 8 primeros caracteres
// del id, en mayúsculas y partidos en dos. Sale de aquí y de ningún otro sitio,
// para que la instalación y el panel enseñen SIEMPRE el mismo.
function codigoDe(deviceId) {
  const hex = `${deviceId || ''}`.replace(/-/g, '').slice(0, 8).toUpperCase();
  return hex.length === 8 ? `${hex.slice(0, 4)}-${hex.slice(4)}` : '';
}

function formaDeCredencial(valor) {
  const credencial = `${valor == null ? '' : valor}`.trim();
  if (!credencial || credencial.length > LARGO_MAXIMO_DE_CREDENCIAL) return '';
  return credencial;
}

class WindowsDeviceService {
  constructor(supabaseRestClient, options = {}) {
    if (!supabaseRestClient) {
      throw new Error('WindowsDeviceService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
    this.now = options.now || (() => Date.now());
    this.randomBytes = options.randomBytes || ((n) => crypto.randomBytes(n));
    this.randomUUID = options.randomUUID || (() => crypto.randomUUID());
    this.logger = options.logger || console;
    this.memoria = new Map();
  }

  // Alta de una instalación. Devuelve la credencial EN CLARO: es la única vez.
  //
  // `etiqueta` es la de la API key con la que llegó la petición, y la pone la ruta:
  // lo que diga el cuerpo no cuenta. Se guarda porque la compuerta se enciende POR
  // etiqueta, y quien la enciende tiene que saber con cuál se están presentando las
  // instalaciones sin ir a comparar claves a mano.
  async enroll(payload = {}, { etiqueta = '' } = {}) {
    const cuerpo = payload && typeof payload === 'object' ? payload : {};
    const email = texto(cuerpo.email).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw fallo(400, 'cuerpo_invalido', 'Para presentarse hace falta un correo.');
    }

    const deviceId = this.randomUUID();
    const token = `${PREFIJO}${this.randomBytes(BYTES_DE_LA_CREDENCIAL).toString('base64url')}`;
    const ahora = new Date(this.now()).toISOString();
    await this.supabase.insert(TABLA, {
      device_id: deviceId,
      token_hash: huellaDe(token),
      // SIEMPRE pendiente, y escrito aquí: lo que diga el cuerpo no cuenta.
      status: 'pendiente',
      api_label: texto(etiqueta),
      email,
      display_name: texto(cuerpo.display_name ?? cuerpo.displayName),
      install_id: texto(cuerpo.install_id ?? cuerpo.installId),
      machine_name: texto(cuerpo.machine_name ?? cuerpo.machineName),
      os_version: texto(cuerpo.os_version ?? cuerpo.osVersion),
      app_version: texto(cuerpo.app_version ?? cuerpo.appVersion),
      enrolled_at: ahora,
      last_seen_at: ahora
    });

    return { device_id: deviceId, token, estado: 'pendiente', codigo: codigoDe(deviceId) };
  }

  // Quién es el dueño de esta credencial: { deviceId, status, codigo } o null si
  // nadie la emitió. LANZA si no se pudo preguntar: quien llama decide cerrar.
  async authorize(credencial) {
    const limpia = formaDeCredencial(credencial);
    if (!limpia) return null;
    const huella = huellaDe(limpia);

    const recordada = this.memoria.get(huella);
    if (recordada && recordada.caduca > this.now()) return recordada.device;

    const filas = await this.supabase.select(
      TABLA,
      `select=device_id,status&token_hash=eq.${huella}&limit=1`
    );
    const fila = Array.isArray(filas) && filas[0] ? filas[0] : null;
    const device = fila
      ? { deviceId: fila.device_id, status: fila.status, codigo: codigoDe(fila.device_id) }
      : null;
    this.#recordar(huella, device);
    if (device) this.#anotarQueSeVio(device.deviceId);
    return device;
  }

  async list(limit = 200) {
    const tope = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), LISTA_MAXIMA);
    const filas = await this.supabase.select(
      TABLA,
      `select=${COLUMNAS_DEL_PANEL}&order=enrolled_at.desc&limit=${tope}`
    );
    return (Array.isArray(filas) ? filas : []).map((fila) => {
      // Aunque la base devolviera la columna, de aquí no sale.
      const { token_hash: _huella, ...resto } = fila;
      return { ...resto, codigo: codigoDe(fila.device_id) };
    });
  }

  // ¿Hay alguna instalación APROBADA que se presentó con esta etiqueta? Es lo que
  // se mira antes de encender la compuerta: sin ninguna, encenderla deja fuera a
  // todas. LANZA si no se pudo preguntar: quien llama decide no encender a ciegas.
  async hayAprobadas(etiqueta) {
    const limpia = texto(etiqueta);
    if (!limpia) return false;
    const filas = await this.supabase.select(
      TABLA,
      `select=device_id&status=eq.aprobada&api_label=eq.${encodeURIComponent(limpia)}&limit=1`
    );
    return Array.isArray(filas) && filas.length > 0;
  }

  // Aprobar, revocar o devolver a pendiente. Solo lo llama el panel (admin).
  async setStatus(deviceId, status, decididoPor = '') {
    const id = `${deviceId == null ? '' : deviceId}`.trim();
    if (!UUID_RE.test(id)) {
      throw fallo(400, 'cuerpo_invalido', 'El id de la instalación no tiene forma de id.');
    }
    if (!ESTADOS.includes(status)) {
      throw fallo(400, 'cuerpo_invalido', `El estado tiene que ser uno de: ${ESTADOS.join(', ')}.`);
    }
    const fila = await this.supabase.update(TABLA, `device_id=eq.${id}`, {
      status,
      decided_at: new Date(this.now()).toISOString(),
      decided_by: texto(decididoPor)
    });
    if (!fila) {
      throw fallo(404, 'instalacion_desconocida', 'Instalación no encontrada.');
    }
    // En ESTA instancia el cambio se nota ya; en las demás, cuando caduque su memoria.
    for (const [huella, recordada] of this.memoria) {
      if (recordada.device && recordada.device.deviceId === id) this.memoria.delete(huella);
    }
    const { token_hash: _huella, ...resto } = fila;
    return { ...resto, codigo: codigoDe(id) };
  }

  #recordar(huella, device) {
    // Un tope, para que una lluvia de credenciales inventadas no se quede a vivir en memoria.
    if (this.memoria.size >= MEMORIA_MAXIMA) this.memoria.clear();
    const ttl = device && device.status === 'aprobada' ? TTL_APROBADA_MS : TTL_OTRAS_MS;
    this.memoria.set(huella, { device, caduca: this.now() + ttl });
  }

  // «Última vez vista», para el panel. No espera ni decide nada: si falla, la
  // petición sigue. Como mucho una vez por caducidad de la memoria, no por petición.
  #anotarQueSeVio(deviceId) {
    Promise.resolve()
      .then(() => this.supabase.update(TABLA, `device_id=eq.${deviceId}`, {
        last_seen_at: new Date(this.now()).toISOString()
      }))
      .catch((error) => {
        this.logger.warn(`[agent/gate] no pude anotar la última vez de ${deviceId.slice(0, 8)}…: ${error.statusCode || 'sin estado'}`);
      });
  }
}

module.exports = WindowsDeviceService;
module.exports.ESTADOS = ESTADOS;
module.exports.codigoDe = codigoDe;
module.exports.huellaDe = huellaDe;
