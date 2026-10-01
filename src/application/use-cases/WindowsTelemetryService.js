// Ingesta de telemetría del cliente Windows (Ü / U.WindowsClient) — el lado
// escritura del core "Windows Live". El cliente habla SOLO con el backend Graph
// (/api/v1, X-API-Key); este servicio persiste en Supabase con service-role
// (SupabaseRestClient), igual patrón que AndroidPanelService pero al revés:
// aquí el backend ESCRIBE lo que el cliente reporta.
//
// Identidad canónica = EMAIL (nombre+correo capturados al instalar). register()
// hace upsert por email: mismo correo => mismo usuario (reinstalación / otra
// máquina no crean uno nuevo). Sin contraseña por ahora.
//
// El feed de eventos es genérico (kind + detail jsonb): alimenta los pulsos de
// la visualización y el panel de logs, y admite cualquier métrica futura sin
// cambiar el esquema.
//
// LOS LOGS SE JUNTAN AL ENTRAR (spec 001). El cliente refleja cada línea de su
// log, y el 2026-10-01 eso eran 407.979 filas y 246 MB en una base de 500 MB:
// unas pocas líneas («ubicación cada N ms…», «delante no es SAP («…»)…») llegaban
// decenas de miles de veces. Ahora la primera aparición de cada línea en la hora
// se guarda, las repeticiones se cuentan en memoria, y al cerrarse la hora se
// guarda una fila con la cuenta. Lo que se recuerda vive en la memoria de la
// instancia: si se pierde (arranque en frío), se guarda de más, nunca de menos.
// El log completo sigue en el equipo: %LOCALAPPDATA%\U\logs.

const { plantillaDeLog } = require('../../domain/plantillaDeLog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EVENTS_PER_BATCH = 200;
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
// El latido de verdad es register(), que el cliente llama cada 60 s. El de aquí
// se escribía en CADA lote: 7.061 PATCH al día para decir lo mismo.
const LATIDO_MS = 60 * 1000;
// Por usuario. Medido el 2026-10-01: en una hora, un usuario manda 129 líneas
// distintas de media y 1.130 como mucho.
const TOPE_DE_PLANTILLAS = 2000;
const TOPE_DE_USUARIOS = 500;
const DIAS_DE_LOGS = 7;

// Kinds que el backend acepta hoy. Es una lista blanca laxa: si llega uno
// desconocido lo guardamos igual (el feed es extensible), pero normalizamos los
// conocidos para que el dashboard pueda razonar sobre ellos.
const KNOWN_KINDS = new Set([
  'conscious_run_start',
  'analyze',
  'action',
  'conscious_run_end',
  'workflow_start',
  'workflow_step',
  'workflow_end',
  'mcp',
  'log'
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normEmail(value) {
  const email = `${value == null ? '' : value}`.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    throw badRequest('Correo invalido.');
  }
  return email;
}

function str(value, fallback = '') {
  const out = `${value == null ? '' : value}`.trim();
  return out || fallback;
}

function toIso(value) {
  if (!value) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return null;
  return new Date(stamp).toISOString();
}

function toDetail(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  // Cualquier escalar se envuelve para no perderlo.
  return { value };
}

function entero(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

// El espejo del log manda el texto dos veces: en `label` y en `detail.text`. Se
// queda el de `label`, que es el que pinta el panel; `detail.text` solo sobrevive
// cuando dice algo más (el backend recorta `label` a 500). `detail.tag` no se
// toca: de ahí saca el panel el motor (domain/windowsEngines.js).
function sinTextoRepetido(fila) {
  if (fila.label && str(fila.detail.text) === fila.label) {
    const { text, ...resto } = fila.detail;
    return { ...fila, detail: resto };
  }
  return fila;
}

class WindowsTelemetryService {
  // options.now: el reloj (ms), para que el juez pueda moverlo.
  constructor(supabaseRestClient, options = {}) {
    if (!supabaseRestClient) {
      throw new Error('WindowsTelemetryService requires a SupabaseRestClient');
    }
    this.supabase = supabaseRestClient;
    this.ahora = typeof options.now === 'function' ? options.now : () => Date.now();
    this.ventanaMs = entero(options.ventanaMs, HORA_MS);
    this.latidoMs = entero(options.latidoMs, LATIDO_MS);
    this.tope = entero(options.tope, TOPE_DE_PLANTILLAS);
    this.topeDeUsuarios = entero(options.topeDeUsuarios, TOPE_DE_USUARIOS);
    // email -> { latidoEn, enVivoHasta, ventana, plantillas: clave -> { veces, fila, hasta } }
    this.memoria = new Map();
  }

  recordar(email) {
    let memoria = this.memoria.get(email);
    if (!memoria) {
      // Map conserva el orden de llegada: el primero es el que lleva más sin estrenarse.
      if (this.memoria.size >= this.topeDeUsuarios) this.memoria.delete(this.memoria.keys().next().value);
      memoria = { latidoEn: -Infinity, enVivoHasta: 0, ventana: null, plantillas: new Map() };
      this.memoria.set(email, memoria);
    }
    return memoria;
  }

  plantillasRecordadas(email) {
    const memoria = this.memoria.get(`${email || ''}`.trim().toLowerCase());
    return memoria ? memoria.plantillas.size : 0;
  }

  // Como mucho una vez por minuto y por usuario. La misma petición trae de vuelta
  // la fila del usuario, y con ella hasta cuándo hay alguien mirándolo en vivo
  // (WindowsPanelService.marcarMirando): por eso el modo en vivo tarda hasta un
  // minuto en empezar.
  async latir(email, memoria, ahora) {
    if (ahora - memoria.latidoEn < this.latidoMs) return;
    memoria.latidoEn = ahora; // antes del await: dos lotes a la vez no laten dos veces
    try {
      const usuario = await this.supabase.update(
        'graph_windows_users',
        `email=eq.${encodeURIComponent(email)}`,
        { last_seen_at: new Date(ahora).toISOString() }
      );
      // Sin fila (el usuario aún no se registró) o sin columna (la migración
      // `detalle_hasta` todavía no está aplicada): nadie mira, y los eventos se guardan igual.
      const hasta = Date.parse((usuario && usuario.detalle_hasta) || '');
      memoria.enVivoHasta = Number.isFinite(hasta) ? hasta : 0;
    } catch (error) {
      console.warn(`[Windows Live] no se pudo escribir el latido: ${error.message}`);
    }
  }

  // La fila que dice cuántas veces llegó una línea en la hora que acaba de cerrarse.
  filaDeCuenta(vista) {
    return {
      ...vista.fila,
      label: `×${vista.veces} en una hora · ${vista.fila.label}`.slice(0, 500),
      detail: { ...vista.fila.detail, veces: vista.veces, desde: vista.fila.client_at, hasta: vista.hasta },
      client_at: vista.hasta || vista.fila.client_at
    };
  }

  // Devuelve lo que hay que guardar de un lote: todo lo que no es log, la primera
  // aparición de cada línea de log en la hora, y las cuentas de la hora que se cerró.
  // `estrenadas` son las claves que este lote recordó por primera vez: si después
  // no se pueden guardar, hay que olvidarlas.
  juntar(memoria, filas, ahora) {
    const aGuardar = [];
    const estrenadas = [];
    let juntadas = 0;
    const ventana = Math.floor(ahora / this.ventanaMs);
    if (memoria.ventana !== ventana) {
      for (const vista of memoria.plantillas.values()) {
        if (vista.veces > 1) aGuardar.push(this.filaDeCuenta(vista));
      }
      memoria.plantillas.clear();
      memoria.ventana = ventana;
    }

    const enVivo = memoria.enVivoHasta > ahora;
    for (const cruda of filas) {
      if (cruda.kind !== 'log') { aGuardar.push(cruda); continue; }
      const fila = sinTextoRepetido(cruda);
      if (enVivo) { aGuardar.push(fila); continue; }

      const clave = `${fila.phase}\n${plantillaDeLog(fila.label || fila.detail.text)}`;
      const vista = memoria.plantillas.get(clave);
      if (vista) {
        vista.veces += 1;
        vista.hasta = fila.client_at || vista.hasta;
        juntadas += 1;
        continue;
      }
      if (memoria.plantillas.size >= this.tope) {
        // Sin sitio: se olvida la más vieja, y su cuenta se guarda antes de olvidarla.
        const [vieja, olvidada] = memoria.plantillas.entries().next().value;
        memoria.plantillas.delete(vieja);
        if (olvidada.veces > 1) aGuardar.push(this.filaDeCuenta(olvidada));
      }
      memoria.plantillas.set(clave, { veces: 1, fila, hasta: fila.client_at });
      estrenadas.push(clave);
      aGuardar.push(fila);
    }
    return { aGuardar, juntadas, estrenadas };
  }

  // Lo llama el mantenimiento diario (web/api/registerMaintenanceRoutes.js). Solo
  // los logs: las corridas, los pasos y las acciones son 2.656 filas en total y son
  // la historia de lo que el agente hizo. Devuelve cuántas filas borró.
  async purgarLogsViejos({ dias } = {}) {
    // Menos de un día no es una retención, es un error de configuración: con «0»
    // esto borraría el log entero.
    const corte = new Date(this.ahora() - entero(dias, DIAS_DE_LOGS) * DIA_MS).toISOString();
    const borradas = await this.supabase.delete(
      'graph_windows_events',
      `kind=eq.log&created_at=lt.${encodeURIComponent(corte)}&select=id`
    );
    return Array.isArray(borradas) ? borradas.length : 0;
  }

  // Upsert por email, en UNA petición (spec 003). El cliente lo llama cada 60 s
  // como latido; antes eran dos (un select y luego update o insert), y cada
  // petición a la API de Supabase es una línea en su cuota de logs. Solo viajan
  // las columnas de `patch`: en un usuario que ya existe, `first_seen_at` y
  // `created_at` no se tocan, y en uno nuevo los pone la tabla (default now()).
  // Devuelve un resumen mínimo para el cliente.
  async register(payload = {}) {
    const email = normEmail(payload.email);
    const now = new Date(this.ahora()).toISOString();

    const patch = {
      email,
      display_name: str(payload.displayName || payload.display_name),
      owner_id: email, // el subconsciente (Neo4j) se scopea por este owner
      last_install_id: str(payload.installId || payload.install_id),
      app_id: str(payload.appId || payload.app_id, 'windows-u'),
      app_version: str(payload.appVersion || payload.app_version),
      machine_name: str(payload.machineName || payload.machine_name),
      os_version: str(payload.osVersion || payload.os_version),
      last_seen_at: now
    };

    await this.supabase.upsert('graph_windows_users', patch, 'email');

    return { ok: true, email };
  }

  // Inserta un lote de eventos. Tolerante: filtra los que no tengan kind, capa
  // el tamaño del lote y normaliza campos. El email del usuario manda; cada
  // evento puede traer su propio install_id. Las líneas de log repetidas se
  // juntan (ver arriba); `inserted` son las filas que de verdad se guardaron.
  async ingestEvents(payload = {}) {
    const email = normEmail(payload.email);
    const installId = str(payload.installId || payload.install_id);
    const rawEvents = Array.isArray(payload.events) ? payload.events : [];
    if (!rawEvents.length) {
      return { ok: true, inserted: 0 };
    }

    const rows = rawEvents
      .slice(0, MAX_EVENTS_PER_BATCH)
      .map((event) => {
        const kind = str(event && event.kind);
        if (!kind) return null;
        return {
          email,
          install_id: str(event.installId || event.install_id || installId),
          kind: KNOWN_KINDS.has(kind) ? kind : kind.slice(0, 64),
          phase: str(event.phase),
          app_id: str(event.appId || event.app_id),
          surface_url: str(event.surfaceUrl || event.surface_url),
          workflow_id: str(event.workflowId || event.workflow_id),
          run_id: str(event.runId || event.run_id),
          label: str(event.label).slice(0, 500),
          detail: toDetail(event.detail),
          client_at: toIso(event.at || event.clientAt || event.client_at)
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      return { ok: true, inserted: 0 };
    }

    const ahora = this.ahora();
    const memoria = this.recordar(email);
    await this.latir(email, memoria, ahora);

    const { aGuardar, juntadas, estrenadas } = this.juntar(memoria, rows, ahora);
    // Un lote en el que todo son repeticiones no le cuesta nada a la base.
    if (aGuardar.length) {
      try {
        await this.supabase.insert('graph_windows_events', aGuardar);
      } catch (error) {
        // Lo que no se guardó no se da por visto: si se recordara, sus repeticiones
        // se contarían contra una fila que no existe y la línea no saldría en toda la hora.
        for (const clave of estrenadas) memoria.plantillas.delete(clave);
        throw error;
      }
    }
    return { ok: true, inserted: aGuardar.length, juntadas };
  }
}

module.exports = WindowsTelemetryService;
