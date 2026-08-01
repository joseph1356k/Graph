// Rescata las consultas que se quedaron con la transcripción guardada pero sin
// nota, porque la cadena se rompió entre un paso y el siguiente.
//
// POR QUÉ EXISTE
// El navegador del médico era quien empujaba "guardar transcripción → generar
// nota". Cerrar la pestaña, perder el internet o un timeout del proveedor de IA
// bastaba para dejar la consulta a medias, y nadie la retomaba: sin reintento,
// sin cola, sin nadie revisando. El 2026-08-02 había 15 así, la más vieja del
// 21 de julio, todas invisibles para su médico.
//
// CÓMO FUNCIONA
// La cola es la propia tabla de consultas filtrada por estado, y el claim usa
// `for update skip locked` con lease —el mismo patrón probado de
// graph_note_exports—. Si el proceso muere a mitad, el lease vence y otra
// ejecución la retoma en vez de dejarla bloqueada para siempre.
//
// LO QUE NO HACE
// No compite con el flujo normal (solo mira consultas de más de 5 minutos) y no
// toca las viejas (ventana de 24 horas). Reusa ClinicalNoteGeneratorService tal
// cual, así que hereda el modo literal de patología, la versión IA de la nota y
// la publicación al historial sin duplicar una línea.

const DEFAULT_MAX_JOBS = 5;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_MAX_ATTEMPTS = 3;

class NoteGenerationRescueService {
  constructor({ restClient, noteGeneratorService, healthAlertService = null, options = {} } = {}) {
    if (!restClient || !noteGeneratorService) {
      throw new Error('NoteGenerationRescueService requires restClient and noteGeneratorService');
    }
    this.restClient = restClient;
    this.noteGeneratorService = noteGeneratorService;
    this.healthAlertService = healthAlertService;
    this.maxJobs = Number(options.maxJobs || process.env.NOTE_RESCUE_MAX_JOBS || DEFAULT_MAX_JOBS);
    this.leaseSeconds = Number(options.leaseSeconds || DEFAULT_LEASE_SECONDS);
    this.maxAttempts = Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  }

  async claimNext() {
    const rows = await this.restClient.rpc('claim_next_note_generation', {
      p_lease_seconds: this.leaseSeconds,
      p_max_attempts: this.maxAttempts
    });
    // La RPC devuelve un conjunto: vacío = no hay nada que rescatar.
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  async release(encounterId, errorCode) {
    return this.restClient.rpc('release_note_generation', {
      p_encounter_id: encounterId,
      p_error_code: `${errorCode || 'UNKNOWN'}`,
      p_max_attempts: this.maxAttempts
    });
  }

  /**
   * Procesa hasta `maxJobs` consultas. Devuelve el detalle de cada una para que
   * el cron lo registre; nunca lanza, porque un fallo del rescate no puede
   * tumbar el resto del mantenimiento.
   */
  async run() {
    const result = { claimed: 0, rescued: 0, failed: 0, exhausted: 0, errors: [] };

    for (let i = 0; i < this.maxJobs; i += 1) {
      let encounter = null;
      try {
        encounter = await this.claimNext();
      } catch (error) {
        result.errors.push(`claim: ${error.message}`);
        break;
      }

      if (!encounter) {
        break; // Cola vacía: lo normal.
      }
      result.claimed += 1;

      try {
        // El doctor dueño de la consulta: el rescate actúa en su nombre, no
        // salta la verificación de propiedad del generador.
        await this.noteGeneratorService.generate(encounter.id, { doctorId: encounter.doctor_id });
        result.rescued += 1;
        console.log(`[Rescate] Consulta ${encounter.id}: nota generada tras quedar a medias.`);
      } catch (error) {
        const code = error?.code || 'NOTE_GENERATION_FAILED';
        let estadoFinal = null;
        try {
          estadoFinal = await this.release(encounter.id, code);
        } catch (releaseError) {
          result.errors.push(`release ${encounter.id}: ${releaseError.message}`);
        }

        if (estadoFinal === 'failed') {
          result.exhausted += 1;
          console.error(`[Rescate] Consulta ${encounter.id}: agotados los intentos (${code}).`);
          await this.notifyExhausted(encounter, code);
        } else {
          result.failed += 1;
          console.warn(`[Rescate] Consulta ${encounter.id}: intento fallido (${code}), se reintentará.`);
        }
      }
    }

    return result;
  }

  // Solo se avisa cuando se agotaron los intentos: un fallo aislado que el
  // siguiente ciclo resuelve no merece despertar a nadie.
  async notifyExhausted(encounter, code) {
    if (!this.healthAlertService) {
      return;
    }
    try {
      await this.healthAlertService.notifyNow('note_generation_exhausted', {
        severity: 'critico',
        title: 'Una consulta no pudo convertirse en nota tras varios intentos',
        detail: `El médico dictó la consulta y la transcripción está guardada, pero la nota no se pudo generar (${code}). La transcripción NO se ha perdido: hay que revisarla a mano.`
      });
    } catch (error) {
      console.error(`[Rescate] Aviso no enviado: ${error.message}`);
    }
  }
}

NoteGenerationRescueService.DEFAULT_MAX_JOBS = DEFAULT_MAX_JOBS;

module.exports = NoteGenerationRescueService;
