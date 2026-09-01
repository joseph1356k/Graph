// Ingesta del MEDIDOR de impacto (UMedidor.exe) — el lado escritura de metrics_*.
// Igual topología que WindowsTelemetryService: el cliente habla SOLO con /api/v1
// (X-API-Key) y este servicio persiste con service-role. Pero con una diferencia
// que no se puede relajar: aquí NO es best-effort. La telemetría de U.exe puede
// perderse sin drama; una transición de estado de un ESTUDIO no. Por eso:
//   - el org_id sale del DEVICE registrado, jamás del payload;
//   - las claves naturales dan idempotencia (ON CONFLICT DO NOTHING) → nunca 409;
//   - una fila envenenada va en `rejected[]` (para que el cliente la saque del
//     spool) SIN tumbar el resto del lote;
//   - el `detail` se saneia otra vez aquí (segunda valla de PHI, vocabulario.js).

const crypto = require('crypto');
const { KINDS, saneaDetalle, esEncounterKey, surfaceValida } = require('../../domain/metrics/vocabulario');

const LIMITES = { samples: 1000, events: 500, sap_visits: 300, shifts: 20 };

function badRequest(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

function str(v, fallback = '') {
  const out = `${v == null ? '' : v}`.trim();
  return out || fallback;
}
function toIso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function uuidOrNull(v) {
  const s = str(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

class MetricsIngestService {
  constructor(supabaseRestClient) {
    this.db = supabaseRestClient;
  }

  // ── Enrolamiento ──────────────────────────────────────────────────────────
  // Canjea un código corto por una identidad de dispositivo + el secreto HMAC de
  // la org. El secreto viaja SOLO aquí (y en una rotación). Todo transaccional en
  // una RPC del lado Postgres para que dos PCs enrolando a la vez no descuadren.
  async enroll(body = {}) {
    const codigo = str(body.enrollment_code).toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(codigo)) throw badRequest('Código de enrolamiento inválido.');

    const machine = str(body.machine_name);
    const os = str(body.os_version);
    const appv = str(body.app_version, '0.0.0');

    // La RPC valida el código (vigente, con usos), crea el device, asegura el
    // secreto v1 de la org, y devuelve todo en una fila.
    const rows = await this.db.rpc('metrics_enroll_device', {
      p_code: codigo, p_machine: machine, p_os: os, p_app_version: appv,
    });
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || !r.device_id) {
      const e = new Error('El código no fue aceptado.');
      e.statusCode = 410;
      throw e;
    }
    return {
      ok: true,
      device_id: r.device_id,
      organization_id: r.organization_id,
      org_name: r.org_name || '',
      hmac: { version: r.hmac_version || 1, secret: r.secret },
      config_version: r.config_version || 0,
      config: r.config || {},
      roster: r.roster || [],
      phases: r.phases || [],
    };
  }

  // ── Config / heartbeat ────────────────────────────────────────────────────
  async config(query = {}) {
    const deviceId = uuidOrNull(query.device_id);
    if (!deviceId) throw badRequest('device_id inválido.');
    const configVersion = num(query.config_version, -1);
    const hmacVersion = num(query.hmac_version, -1);

    const rows = await this.db.rpc('metrics_device_config', {
      p_device: deviceId, p_config_version: configVersion, p_hmac_version: hmacVersion,
    });
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r) { const e = new Error('Dispositivo no encontrado.'); e.statusCode = 403; throw e; }
    if (r.status && r.status !== 'active') { const e = new Error('Dispositivo pausado o retirado.'); e.statusCode = 403; throw e; }
    return r.payload || { unchanged: true };
  }

  // ── El lote ───────────────────────────────────────────────────────────────
  async ingestBatch(body = {}) {
    const deviceId = uuidOrNull(body.device_id);
    if (!deviceId) throw badRequest('device_id inválido.');

    // El device manda la identidad: org, estado, versiones. NUNCA se cree al payload.
    const dev = await this.resolverDevice(deviceId);
    if (!dev) { const e = new Error('Dispositivo no encontrado.'); e.statusCode = 403; throw e; }
    if (dev.status !== 'active') { const e = new Error('Dispositivo pausado o retirado.'); e.statusCode = 403; throw e; }

    const org = dev.organization_id;
    const rejected = [];
    const accepted = { shifts: 0, samples: 0, events: 0, sap_visits: 0 };
    const clientNow = toIso(body.client_now);
    const skewMs = clientNow ? Date.now() - Date.parse(clientNow) : null;

    // Turnos primero: las muestras/visitas los referencian por FK.
    for (const raw of cap(body.shifts, LIMITES.shifts)) {
      try { await this.upsertShift(org, deviceId, raw); accepted.shifts++; }
      catch (err) { rejected.push({ col: 'shifts', seq: num(raw.seq, -1), reason: motivo(err) }); }
    }
    // Las filas se construyen EN un try por fila: una fila envenenada (surface con
    // forma de título, encounter mal formado) va a rejected[] sin tumbar el resto
    // del lote. Construir con .map() dejaría escapar el throw antes del catch.
    accepted.samples = await this.insertColeccion('metrics_samples', 'samples',
      cap(body.samples, LIMITES.samples), (r) => this.filaMuestra(org, deviceId, r), rejected);
    accepted.events = await this.insertEventos(org, deviceId, cap(body.events, LIMITES.events), rejected);
    accepted.sap_visits = await this.insertColeccion('metrics_sap_visits', 'sap_visits',
      cap(body.sap_visits, LIMITES.sap_visits), (r) => this.filaVisita(org, deviceId, r), rejected);

    await this.tocarDevice(deviceId, accepted.samples > 0);

    return {
      ok: true,
      accepted,
      rejected,
      clock_skew_ms: skewMs,
      config_version: dev.config_version,
      hmac_version: dev.hmac_version,
    };
  }

  // ── por dentro ─────────────────────────────────────────────────────────────

  async resolverDevice(deviceId) {
    const rows = await this.db.select('metrics_devices',
      `id=eq.${deviceId}&select=id,organization_id,status,config_version,hmac_version&limit=1`);
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async upsertShift(org, deviceId, r) {
    await this.db.rpc('metrics_upsert_shift', {
      p_shift: mustUuid(r.shift_id, 'shift_id'),
      p_org: org, p_device: deviceId,
      p_doctor: uuidOrNull(r.doctor_id),
      p_doctor_display: str(r.doctor_display),
      p_sap_user: r.sap_user_seen ? str(r.sap_user_seen) : null,
      p_phase: str(r.phase, 'baseline'),
      p_started: mustIso(r.started_at, 'started_at'),
      p_ended: toIso(r.ended_at),
      p_end_reason: r.end_reason ? str(r.end_reason) : null,
      p_dia: str(r.dia_operativo) || null,
      p_hmac_version: num(r.hmac_version, 1),
      p_app_version: str(r.app_version),
      p_huecos_ms: num(r.huecos_ms), p_clock_jumps: num(r.clock_jumps),
      p_spool_dropped: num(r.spool_dropped), p_hooks_degradados: !!r.hooks_degradados,
      p_ticks_sap: num(r.ticks_sap_saltados_busy),
    });
  }

  filaMuestra(org, deviceId, r) {
    const surface = r.surface == null ? null : str(r.surface) || null;
    if (!surfaceValida(surface)) throw badRequest(`surface con forma inesperada`);
    if (!esEncounterKey(r.encounter_key)) throw badRequest('encounter_key con forma inesperada');
    return {
      organization_id: org, device_id: deviceId,
      shift_id: mustUuid(r.shift_id, 'shift_id'),
      doctor_id: uuidOrNull(r.doctor_id),
      bucket_start: mustIso(r.bucket_start, 'bucket_start'),
      bucket_ms: num(r.bucket_ms), seq: num(r.seq),
      app: str(r.app, 'otro'), surface, encounter_key: r.encounter_key || null,
      foreground_ms: num(r.foreground_ms), active_ms: num(r.active_ms),
      typing_ms: num(r.typing_ms), keystrokes: num(r.keystrokes),
      clicks: num(r.clicks), scroll_ticks: num(r.scroll_ticks),
      context_switches: num(r.context_switches),
      sap_roundtrips: num(r.sap_roundtrips), sap_wait_ms: num(r.sap_wait_ms),
    };
  }

  filaVisita(org, deviceId, r) {
    if (!esEncounterKey(r.encounter_key)) throw badRequest('encounter_key con forma inesperada');
    return {
      visit_uid: this.uid(deviceId, 'visitas', r.seq),
      organization_id: org, device_id: deviceId,
      shift_id: mustUuid(r.shift_id, 'shift_id'),
      encounter_key: r.encounter_key || null,
      sid: str(r.sid), tcode: str(r.tcode), dynpro: str(r.dynpro), surface: str(r.surface),
      entered_at: mustIso(r.entered_at, 'entered_at'), left_at: toIso(r.left_at),
      dwell_ms: num(r.dwell_ms), ready_ms: r.ready_ms == null ? null : num(r.ready_ms),
      sap_wait_ms: num(r.sap_wait_ms), roundtrips: num(r.roundtrips),
      exit_to: r.exit_to ? str(r.exit_to) : null,
    };
  }

  async insertEventos(org, deviceId, filas, rejected) {
    const rows = [];
    for (const r of filas) {
      try {
        const kind = str(r.kind);
        if (!KINDS.has(kind)) throw badRequest(`kind desconocido: ${kind}`);
        if (!esEncounterKey(r.encounter_key)) throw badRequest('encounter_key con forma inesperada');
        rows.push({
          event_uid: this.uid(deviceId, 'eventos', r.seq),
          organization_id: org, device_id: deviceId,
          shift_id: uuidOrNull(r.shift_id),
          occurred_at: mustIso(r.occurred_at, 'occurred_at'),
          encounter_key: r.encounter_key || null,
          kind, detail: saneaDetalle(r.detail),
        });
      } catch (err) { rejected.push({ col: 'events', seq: num(r.seq, -1), reason: motivo(err) }); }
    }
    return this.insertConIgnorar('metrics_events', rows);
  }

  // Construye cada fila con `construir` dentro de su propio try: la que lance
  // (una promesa de privacidad rota, un campo inválido) se separa a rejected[] y
  // el resto del lote sigue. Después inserta las buenas ignorando duplicados.
  async insertColeccion(tabla, col, filas, construir, rejected) {
    const rows = [];
    for (const raw of filas) {
      try { rows.push(construir(raw)); }
      catch (err) { rejected.push({ col, seq: num(raw?.seq, -1), reason: motivo(err) }); }
    }
    return this.insertConIgnorar(tabla, rows);
  }

  async insertConIgnorar(tabla, rows) {
    if (!rows.length) return 0;
    // PostgREST: resolution=ignore-duplicates hace el ON CONFLICT DO NOTHING con
    // la restricción única de la tabla → idempotencia sin 409.
    await this.db.request(`/${tabla}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    return rows.length;
  }

  async tocarDevice(deviceId, huboMuestra) {
    const patch = { last_seen_at: new Date().toISOString() };
    if (huboMuestra) patch.last_sample_at = patch.last_seen_at;
    try { await this.db.update('metrics_devices', `id=eq.${deviceId}`, patch); }
    catch { /* el heartbeat es best-effort; no tumba el lote ya persistido */ }
  }

  // uid determinista por (device, colección, seq): el mismo evento reenviado da
  // el mismo uid → el índice único lo desecha. Si no viene seq (no debería), un
  // aleatorio evita colisión pero pierde idempotencia — se registra como -1.
  uid(deviceId, coleccion, seq) {
    const s = Number.isFinite(Number(seq)) ? Number(seq) : `r${crypto.randomUUID()}`;
    return `${deviceId}:${coleccion}:${s}`;
  }
}

function cap(arr, n) { return Array.isArray(arr) ? arr.slice(0, n) : []; }
function motivo(err) { return `${err && err.message ? err.message : err}`.slice(0, 160); }
function mustUuid(v, campo) {
  const u = uuidOrNull(v);
  if (!u) throw badRequest(`${campo} inválido`);
  return u;
}
function mustIso(v, campo) {
  const iso = toIso(v);
  if (!iso) throw badRequest(`${campo} inválido`);
  return iso;
}

module.exports = MetricsIngestService;
