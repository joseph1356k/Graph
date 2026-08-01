// Vigilancia del motor clínico: revisa el estado real del sistema y avisa por
// correo cuando algo necesita atención.
//
// Por qué existe: hoy nadie se entera de que el LLM falló, de que hay consultas
// atascadas o de que la cola de exportación al HIS está trabada — se entera el
// médico, que es la peor forma. Este servicio corre en un cron y manda un solo
// correo con lo que importa.
//
// Dos decisiones deliberadas:
//   · Solo avisa cuando HAY algo que avisar. Un correo diario que casi siempre
//     dice "todo bien" se deja de leer, y el día que trae un problema tampoco se
//     lee. Con `force` se puede pedir el reporte aunque esté todo en orden.
//   · Nunca incluye PHI: cuenta consultas y estados, jamás transcripciones,
//     contenido de notas ni datos de pacientes.

const SEVERITY_ORDER = { critico: 0, atencion: 1, info: 2 };

class SystemHealthAlertService {
  constructor({ restClient, fetchImpl = null, now = () => new Date() } = {}) {
    if (!restClient) {
      throw new Error('SystemHealthAlertService requires a SupabaseRestClient');
    }
    this.restClient = restClient;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
    this.now = now;
  }

  static parseRecipients(value = '') {
    return `${value || ''}`
      .split(',')
      .map((email) => email.trim())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  recipients() {
    const explicit = SystemHealthAlertService.parseRecipients(process.env.ALERT_EMAIL_TO);
    if (explicit.length > 0) {
      return explicit;
    }
    // Sin lista propia, se reusa la de administradores clínicos: son quienes ya
    // tienen responsabilidad sobre la plataforma.
    return SystemHealthAlertService.parseRecipients(process.env.CLINICAL_ADMIN_EMAILS);
  }

  isConfigured() {
    return Boolean(`${process.env.RESEND_API_KEY || ''}`.trim()) && this.recipients().length > 0;
  }

  // Cuenta filas sin traérselas: PostgREST devuelve el total en Content-Range
  // cuando se pide `count=exact`, así que una consulta de conteo no mueve datos
  // clínicos por la red.
  async count(table, query) {
    const rows = await this.restClient.select(table, `${query}&select=id&limit=1000`);
    return Array.isArray(rows) ? rows.length : 0;
  }

  // Cuenta notas generadas que no tienen fila en el historial. PostgREST no hace
  // anti-joins, así que se comparan los ids de las notas recientes contra los
  // que sí existen en consultations: dos lecturas de ids, sin contenido clínico.
  async countOrphanNotes() {
    const desde = this.sinceIso(30);
    const conNota = await this.restClient.select(
      'clinical_encounters',
      `status=eq.note_generated&created_at=gte.${desde}&select=id&limit=1000`,
    );
    const ids = (Array.isArray(conNota) ? conNota : []).map((row) => row.id).filter(Boolean);
    if (ids.length === 0) {
      return 0;
    }

    const enHistorial = await this.restClient.select(
      'consultations',
      `id=in.(${ids.join(',')})&select=id&limit=1000`,
    );
    const publicadas = new Set((Array.isArray(enHistorial) ? enHistorial : []).map((row) => row.id));
    return ids.filter((id) => !publicadas.has(id)).length;
  }

  async collectFindings() {
    const findings = [];

    const [fallidas, atascadas, exportacionesFallidas, exportacionesEnCola] = await Promise.all([
      this.count('clinical_encounters', 'status=eq.failed&updated_at=gte.' + this.sinceIso(1)),
      this.count(
        'clinical_encounters',
        'status=in.(transcript_ready,note_generating,recording)&created_at=lt.' + this.sinceIso(1),
      ),
      this.count('graph_note_exports', 'status=eq.failed'),
      this.count('graph_note_exports', 'status=in.(queued,claimed)&created_at=lt.' + this.sinceIso(1)),
    ]);

    if (fallidas > 0) {
      findings.push({
        severity: 'critico',
        title: `${fallidas} nota${fallidas === 1 ? '' : 's'} sin poder generarse`,
        detail:
          'La generación falló en las últimas 24 horas. Suele ser el proveedor de IA: revisa la clave y el saldo en Provider Studio.',
      });
    }

    if (exportacionesFallidas > 0) {
      findings.push({
        severity: 'critico',
        title: `${exportacionesFallidas} exportación(es) a la historia clínica fallidas`,
        detail: 'Hay notas firmadas que no llegaron al HIS. Requieren reintento desde la consola.',
      });
    }

    if (atascadas > 0) {
      findings.push({
        severity: 'atencion',
        title: `${atascadas} consulta(s) llevan más de un día sin terminar`,
        detail:
          'Quedaron con transcripción pero sin nota firmada. Tienen contenido del médico, así que no se borran solas: hay que revisarlas.',
      });
    }

    if (exportacionesEnCola > 0) {
      findings.push({
        severity: 'atencion',
        title: `${exportacionesEnCola} exportación(es) llevan más de un día en cola`,
        detail: 'El ejecutor de Operations no las está tomando. Revisa que esté corriendo.',
      });
    }

    // Huérfanas: nota generada que no llegó al historial del médico. Antes esto
    // pasaba en silencio (24 acumuladas hasta el 2026-08-01) porque el puente
    // vivía en el navegador. Ahora lo publica el servidor, y si aun así falla
    // esta alerta lo dice el mismo día en vez de nunca.
    const huerfanas = await this.countOrphanNotes();
    if (huerfanas > 0) {
      findings.push({
        severity: 'critico',
        title: `${huerfanas} nota(s) generadas que el médico no ve en su historial`,
        detail:
          'La consulta existe con su nota pero no llegó a la tabla de historial. El médico no la encuentra. Revisa el espejo del servidor.',
      });
    }

    if (!`${process.env.GRAPH_LLM_API_KEY || process.env.OPENAI_API_KEY || ''}`.trim()) {
      findings.push({
        severity: 'critico',
        title: 'El proveedor de IA no está configurado',
        detail: 'Sin clave, generar una nota responde error. Configúralo en Provider Studio.',
      });
    }

    return findings.sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    );
  }

  sinceIso(days) {
    return new Date(this.now().getTime() - days * 86400000).toISOString();
  }

  buildEmail(findings) {
    const criticos = findings.filter((f) => f.severity === 'critico').length;
    const subject = findings.length === 0
      ? 'Miracle · todo en orden'
      : criticos > 0
        ? `Miracle · ${criticos} problema${criticos === 1 ? '' : 's'} que necesita${criticos === 1 ? '' : 'n'} atención`
        : `Miracle · ${findings.length} aviso${findings.length === 1 ? '' : 's'}`;

    const filas = findings.length === 0
      ? '<p style="margin:0;color:#13795b">Sin incidencias en las últimas 24 horas.</p>'
      : findings
        .map((f) => {
          const color = f.severity === 'critico' ? '#b33224' : '#a34a06';
          return `<div style="margin:0 0 16px;padding:12px 14px;border-left:3px solid ${color};background:#f6f8fb">
              <div style="font-weight:600;color:#0c1424">${f.title}</div>
              <div style="margin-top:4px;font-size:14px;color:#5d6b80">${f.detail}</div>
            </div>`;
        })
        .join('');

    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h1 style="margin:0 0 4px;font-size:18px;color:#0c1424">Estado de la plataforma</h1>
        <p style="margin:0 0 20px;font-size:13px;color:#5d6b80">Revisión automática · ${this.now().toLocaleDateString('es-CO')}</p>
        ${filas}
        <p style="margin:24px 0 0;font-size:12px;color:#5d6b80">
          Este correo no contiene datos de pacientes: solo conteos y estados del sistema.
        </p>
      </div>`;

    return { subject, html };
  }

  // --- Aviso inmediato -------------------------------------------------------
  // El cron diario sirve para lo que solo se ve por acumulación (consultas que
  // llevan días sin terminar). Pero un fallo de generación o una nota que no
  // llega al historial son eventos con un instante exacto: esperar horas para
  // contarlo es esperar de más. Estos avisan en el momento.

  async lastSentAt(alertKey) {
    const rows = await this.restClient.select(
      'graph_alert_log',
      `alert_key=eq.${encodeURIComponent(alertKey)}&select=last_sent_at&limit=1`,
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.last_sent_at ? new Date(row.last_sent_at) : null;
  }

  async recordSent(alertKey, detail = '') {
    // upsert: la clave es única, así que repetir la alerta actualiza la fila.
    await this.restClient.insert(
      'graph_alert_log',
      {
        alert_key: alertKey,
        last_sent_at: this.now().toISOString(),
        last_detail: `${detail || ''}`.slice(0, 500),
      },
      'on_conflict=alert_key',
    );
  }

  /**
   * Avisa AHORA de un fallo puntual, salvo que ya se haya avisado de lo mismo
   * dentro de la ventana de silencio (por defecto 30 minutos).
   *
   * Nunca lanza: se llama desde caminos donde el trabajo del médico ya está
   * hecho, y un fallo del correo no puede tumbar una consulta.
   */
  async notifyNow(alertKey, finding, { cooldownMinutes = 30 } = {}) {
    try {
      if (!this.isConfigured()) {
        return { sent: false, reason: 'alertas_no_configuradas' };
      }

      const ultimo = await this.lastSentAt(alertKey);
      if (ultimo) {
        const minutos = (this.now().getTime() - ultimo.getTime()) / 60000;
        if (minutos < cooldownMinutes) {
          return { sent: false, reason: 'en_ventana_de_silencio', minutos: Math.round(minutos) };
        }
      }

      const { subject, html } = this.buildEmail([finding]);
      const from = `${process.env.ALERT_EMAIL_FROM || 'Miracle <onboarding@resend.dev>'}`.trim();

      const response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${`${process.env.RESEND_API_KEY || ''}`.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: this.recipients(), subject, html }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[Alerta] Resend ${response.status} para ${alertKey}: ${body.slice(0, 200)}`);
        return { sent: false, reason: 'resend_error' };
      }

      await this.recordSent(alertKey, finding?.title || '');
      return { sent: true };
    } catch (error) {
      console.error(`[Alerta] No se pudo avisar de ${alertKey}: ${error.message}`);
      return { sent: false, reason: 'error' };
    }
  }

  async send({ force = false } = {}) {
    const findings = await this.collectFindings();

    if (findings.length === 0 && !force) {
      return { sent: false, reason: 'sin_novedades', findings };
    }
    if (!this.isConfigured()) {
      return { sent: false, reason: 'alertas_no_configuradas', findings };
    }

    const { subject, html } = this.buildEmail(findings);
    const from = `${process.env.ALERT_EMAIL_FROM || 'Miracle <alertas@itsmiracleai.com.co>'}`.trim();

    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${`${process.env.RESEND_API_KEY || ''}`.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: this.recipients(), subject, html }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Resend respondió ${response.status}: ${body.slice(0, 200)}`);
    }

    return { sent: true, findings, recipients: this.recipients().length };
  }
}

module.exports = SystemHealthAlertService;
