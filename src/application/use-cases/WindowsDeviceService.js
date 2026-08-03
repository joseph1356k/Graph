const crypto = require('crypto');
const { clinicalError } = require('./ClinicalErrors');

// Identidad por instalación del cliente Windows + vínculo médico↔equipo.
//
// Implementa el plan de web/public/studio-docs/autenticacion-interna-plan.md:
// la key embebida en el .exe solo sirve para ENROLAR; la credencial real es un
// token per-install del que aquí solo vive el sha256. Y lo extiende con la
// delegación clínica: un médico canjea en Miracle Notes el código que el equipo
// muestra en pantalla, y desde entonces ese equipo puede actuar en su nombre en
// /api/clinical/* — nunca firmar ni exportar (esas rutas no aceptan aparatos).
//
// Todas las decisiones de autorización viven aquí, en código, porque las tablas
// graph_windows_devices / graph_device_doctor_links se leen con service-role
// (RLS sin políticas): el mismo régimen y la misma responsabilidad que
// NoteExportService documenta para graph_note_exports.

// Alfabeto de agent_links (Notes): sin 0/O/1/I/L para dictarlo sin ambigüedad.
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
// 10 minutos, no 8 horas: el canje es inmediato; cada minuto extra es
// superficie de ataque sin beneficio de UX.
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_LABEL_LENGTH = 80;
const MAX_DEVICE_ID_LENGTH = 128;

function nowIso() {
  return new Date().toISOString();
}

class WindowsDeviceService {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('WindowsDeviceService requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  static hashToken(token) {
    return crypto.createHash('sha256').update(`${token || ''}`, 'utf8').digest('hex');
  }

  // Prefijo identificable (útil en logs del cliente y en escaneo de secretos)
  // + 256 bits de aleatoriedad. El token en claro se devuelve UNA vez.
  static newToken() {
    return `uwd_${crypto.randomBytes(32).toString('base64url')}`;
  }

  static newPairingCode() {
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
      code += PAIRING_ALPHABET[crypto.randomInt(PAIRING_ALPHABET.length)];
    }
    return code;
  }

  static normalizePairingCode(raw) {
    const code = `${raw || ''}`.trim().toUpperCase();
    return new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`).test(code) ? code : '';
  }

  static sanitizeLabel(raw) {
    return `${raw || ''}`.trim().slice(0, MAX_LABEL_LENGTH);
  }

  /**
   * Da de alta (o re-enrola) una instalación. Re-enrolar el mismo device_id
   * ROTA el token: no crea dispositivos fantasma y deja el token viejo muerto.
   * Un dispositivo revocado puede re-enrolarse (quien tenga la key de
   * enrolamiento puede enrolar una "máquina nueva" de todas formas): la
   * revocación mata el TOKEN filtrado y los vínculos clínicos — que no
   * renacen solos: hay que volver a emparejar con el médico.
   */
  async enroll({ deviceId, label } = {}) {
    const cleanDeviceId = `${deviceId || ''}`.trim();
    if (!cleanDeviceId || cleanDeviceId.length > MAX_DEVICE_ID_LENGTH) {
      throw clinicalError('DEVICE_INVALID', 'device_id es obligatorio.');
    }
    const cleanLabel = WindowsDeviceService.sanitizeLabel(label);
    const token = WindowsDeviceService.newToken();
    const tokenHash = WindowsDeviceService.hashToken(token);

    const existing = await this.restClient.select(
      'graph_windows_devices',
      `device_id=eq.${encodeURIComponent(cleanDeviceId)}&select=id,revoked_at&limit=1`
    );
    const existingRow = Array.isArray(existing) ? existing[0] : null;

    let device;
    if (existingRow) {
      const wasRevoked = Boolean(existingRow.revoked_at);
      device = await this.restClient.update(
        'graph_windows_devices',
        `id=eq.${encodeURIComponent(existingRow.id)}`,
        {
          token_hash: tokenHash,
          ...(cleanLabel ? { label: cleanLabel } : {}),
          revoked_at: null,
          last_seen: nowIso()
        }
      );
      if (wasRevoked) {
        // Revivir un dispositivo revocado NO revive su delegación clínica.
        await this.restClient.update(
          'graph_device_doctor_links',
          `device_id=eq.${encodeURIComponent(existingRow.id)}&revoked_at=is.null`,
          { revoked_at: nowIso() }
        );
      }
    } else {
      device = await this.restClient.insert('graph_windows_devices', {
        device_id: cleanDeviceId,
        token_hash: tokenHash,
        label: cleanLabel
      });
    }

    return {
      token,
      device: { id: device.id, deviceId: cleanDeviceId, label: device.label || cleanLabel }
    };
  }

  /** Credencial → dispositivo vivo, o null. Actualiza last_seen best-effort. */
  async deviceByToken(token) {
    if (!token) return null;
    const tokenHash = WindowsDeviceService.hashToken(token);
    const rows = await this.restClient.select(
      'graph_windows_devices',
      `token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&select=id,device_id,label&limit=1`
    );
    const device = Array.isArray(rows) ? rows[0] : null;
    if (device) {
      this.restClient
        .update('graph_windows_devices', `id=eq.${encodeURIComponent(device.id)}`, { last_seen: nowIso() })
        .catch(() => {});
    }
    return device;
  }

  async activeLink(deviceRowId) {
    const rows = await this.restClient.select(
      'graph_device_doctor_links',
      `device_id=eq.${encodeURIComponent(deviceRowId)}&approved_at=not.is.null&revoked_at=is.null` +
        '&select=id,doctor_id,organization_id,approved_at&limit=1'
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  /**
   * Token → actor clínico completo, o las razones por las que no lo es.
   * Devuelve { device: null } (credencial mala), { device, link: null }
   * (enrolado pero sin médico) o { device, link, doctor, organizationId }.
   */
  async resolveClinicalActor(token) {
    const device = await this.deviceByToken(token);
    if (!device) return { device: null, link: null };
    const link = await this.activeLink(device.id);
    if (!link) return { device, link: null };
    const profiles = await this.restClient.select(
      'profiles',
      `id=eq.${encodeURIComponent(link.doctor_id)}&select=id,email,full_name,organization_id&limit=1`
    );
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    return {
      device,
      link,
      doctor: {
        id: link.doctor_id,
        email: `${profile?.email || ''}`,
        fullName: `${profile?.full_name || ''}`
      },
      // La organización del VÍNCULO (congelada al canjear), no la del perfil de
      // hoy: si el médico cambió de organización, el vínculo viejo no lo sigue.
      organizationId: link.organization_id
    };
  }

  /** El equipo pide un código para mostrarlo en pantalla. Un código vivo por equipo. */
  async createPairingCode(device) {
    if (!device?.id) {
      throw clinicalError('DEVICE_INVALID', 'Dispositivo no reconocido.');
    }
    // Regla "un código vivo": los pendientes anteriores mueren.
    await this.restClient.update(
      'graph_device_doctor_links',
      `device_id=eq.${encodeURIComponent(device.id)}&approved_at=is.null&revoked_at=is.null`,
      { revoked_at: nowIso() }
    );
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
    // La colisión de código es casi imposible (31^8) pero el índice unique la
    // convierte en error: reintentar es más honesto que rezar.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = WindowsDeviceService.newPairingCode();
      try {
        await this.restClient.insert('graph_device_doctor_links', {
          device_id: device.id,
          pairing_code: code,
          code_expires_at: expiresAt
        });
        return { code, expiresAt };
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    throw clinicalError('DEVICE_INVALID', 'No se pudo generar el código.');
  }

  /**
   * El médico canjea el código desde Miracle Notes (JWT verificado antes de
   * llegar aquí). Canje atómico de un solo uso; respuesta única 'invalid' sin
   * distinguir inexistente/caducado/usado — misma decisión anti-oráculo que
   * agent_values_for_code en Notes.
   */
  async claimPairing({ code, doctor } = {}) {
    const cleanCode = WindowsDeviceService.normalizePairingCode(code);
    if (!cleanCode) {
      throw clinicalError('PAIRING_CODE_INVALID', 'Código inválido o vencido.');
    }
    const doctorId = `${doctor?.id || ''}`.trim();
    if (!doctorId) {
      throw clinicalError('UNAUTHORIZED', 'Sesión clínica requerida.');
    }

    const profiles = await this.restClient.select(
      'profiles',
      `id=eq.${encodeURIComponent(doctorId)}&select=organization_id,full_name,email&limit=1`
    );
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile?.organization_id) {
      // Sin organización el vínculo nacería roto (patrón del espejo: mejor
      // negarse y decirlo).
      throw clinicalError(
        'DOCTOR_WITHOUT_ORGANIZATION',
        'Tu perfil no tiene organización asignada; no se puede vincular el equipo.'
      );
    }

    const pendingRows = await this.restClient.select(
      'graph_device_doctor_links',
      `pairing_code=eq.${encodeURIComponent(cleanCode)}&approved_at=is.null&revoked_at=is.null` +
        `&code_expires_at=gt.${encodeURIComponent(nowIso())}&select=id,device_id&limit=1`
    );
    const pending = Array.isArray(pendingRows) ? pendingRows[0] : null;
    if (!pending) {
      throw clinicalError('PAIRING_CODE_INVALID', 'Código inválido o vencido.');
    }

    const devices = await this.restClient.select(
      'graph_windows_devices',
      `id=eq.${encodeURIComponent(pending.device_id)}&revoked_at=is.null&select=id,device_id,label&limit=1`
    );
    const device = Array.isArray(devices) ? devices[0] : null;
    if (!device) {
      // Dispositivo revocado: su código pendiente es papel mojado.
      throw clinicalError('PAIRING_CODE_INVALID', 'Código inválido o vencido.');
    }

    // V1: un vínculo activo por equipo. Re-emparejar = reemplazar; el índice
    // parcial de la migración lo fuerza aunque este paso fallara.
    await this.restClient.update(
      'graph_device_doctor_links',
      `device_id=eq.${encodeURIComponent(device.id)}&approved_at=not.is.null&revoked_at=is.null`,
      { revoked_at: nowIso() }
    );

    // CAS de un solo uso: si dos canjes corren, uno encuentra approved_at ya
    // puesto y recibe 0 filas → 'invalid'.
    const approved = await this.restClient.update(
      'graph_device_doctor_links',
      `id=eq.${encodeURIComponent(pending.id)}&approved_at=is.null&revoked_at=is.null` +
        `&code_expires_at=gt.${encodeURIComponent(nowIso())}`,
      {
        doctor_id: doctorId,
        organization_id: profile.organization_id,
        approved_at: nowIso(),
        approved_by: doctorId,
        pairing_code: null
      }
    );
    if (!approved) {
      throw clinicalError('PAIRING_CODE_INVALID', 'Código inválido o vencido.');
    }

    try {
      await this.restClient.insert('audit_events', {
        organization_id: profile.organization_id,
        consultation_id: null,
        actor_id: doctorId,
        actor_name: `${profile.full_name || profile.email || ''}`,
        accion: 'equipo_vinculado',
        detalle: `Equipo «${device.label || device.device_id}» vinculado al médico.`
      });
    } catch (error) {
      console.error(`[Dispositivos] Auditoría de vínculo no registrada: ${error.message}`);
    }

    return {
      linkId: approved.id,
      device: { id: device.id, deviceId: device.device_id, label: device.label || '' }
    };
  }

  /** Vínculos activos del médico, con el dispositivo de cada uno (para el panel). */
  async listLinks(doctorId) {
    const cleanDoctorId = `${doctorId || ''}`.trim();
    if (!cleanDoctorId) return [];
    const links = await this.restClient.select(
      'graph_device_doctor_links',
      `doctor_id=eq.${encodeURIComponent(cleanDoctorId)}&approved_at=not.is.null&revoked_at=is.null` +
        '&select=id,device_id,approved_at&order=approved_at.desc'
    );
    const linkRows = Array.isArray(links) ? links : [];
    if (!linkRows.length) return [];
    const deviceIds = linkRows.map((row) => row.device_id);
    const devices = await this.restClient.select(
      'graph_windows_devices',
      `id=in.(${deviceIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,device_id,label,last_seen`
    );
    const byId = new Map((Array.isArray(devices) ? devices : []).map((row) => [row.id, row]));
    return linkRows.map((row) => {
      const device = byId.get(row.device_id) || {};
      return {
        linkId: row.id,
        approvedAt: row.approved_at,
        deviceId: device.device_id || '',
        label: device.label || '',
        lastSeen: device.last_seen || null
      };
    });
  }

  /** El médico desvincula un equipo suyo. Solo los propios: el filtro es la autorización. */
  async revokeLink(linkId, doctorId) {
    const cleanLinkId = `${linkId || ''}`.trim();
    const cleanDoctorId = `${doctorId || ''}`.trim();
    if (!cleanLinkId || !cleanDoctorId) {
      throw clinicalError('LINK_NOT_FOUND', 'Vínculo no encontrado.');
    }
    const revoked = await this.restClient.update(
      'graph_device_doctor_links',
      `id=eq.${encodeURIComponent(cleanLinkId)}&doctor_id=eq.${encodeURIComponent(cleanDoctorId)}` +
        '&revoked_at=is.null',
      { revoked_at: nowIso() }
    );
    if (!revoked) {
      throw clinicalError('LINK_NOT_FOUND', 'Vínculo no encontrado.');
    }
    if (revoked.organization_id) {
      try {
        await this.restClient.insert('audit_events', {
          organization_id: revoked.organization_id,
          consultation_id: null,
          actor_id: cleanDoctorId,
          accion: 'equipo_desvinculado',
          detalle: 'El médico desvinculó el equipo desde Miracle Notes.'
        });
      } catch (error) {
        console.error(`[Dispositivos] Auditoría de desvinculación no registrada: ${error.message}`);
      }
    }
    return { revoked: true };
  }
}

WindowsDeviceService.PAIRING_ALPHABET = PAIRING_ALPHABET;
WindowsDeviceService.PAIRING_CODE_LENGTH = PAIRING_CODE_LENGTH;
WindowsDeviceService.PAIRING_CODE_TTL_MS = PAIRING_CODE_TTL_MS;

module.exports = WindowsDeviceService;
