const { specialtyDisplayName } = require('../../domain/clinical/specialtyNames');

// Publica en el historial clínico (public.consultations) la consulta que el
// asistente acaba de terminar.
//
// POR QUÉ EXISTE
// El puente encounter → consultation vivía SOLO en el navegador del médico
// (providers.tsx). Si cerraba la pestaña, se le caía el internet o el proceso se
// interrumpía antes de la copia, la nota quedaba huérfana: existía en
// clinical_encounters pero no aparecía en su historial, sin error ni aviso. El
// 2026-08-01 había 24 así. Ahora el servidor que genera la nota es también quien
// la publica, y eso ya no depende de ningún navegador.
//
// CONTRATO DE PROPIEDAD DE DATOS (etapa 2)
// El servidor es dueño de lo que produce el asistente:
//     note, resumen, transcript, plantilla, especialidad, tipo, fecha, motivo
// La web sigue siendo dueña de lo suyo, y el servidor NUNCA lo toca:
//     estado, firma, codigos, patient_id, duracion_min, auditoría posterior
//
// Por eso solo se CREA la fila cuando no existe. Si ya existe —porque la web la
// creó o porque el médico ya la editó, firmó o exportó— el servidor no escribe
// nada: una nota firmada jamás se degrada desde aquí.

const SERVICIO_POR_DEFECTO = 'Consulta externa';
const MAX_MOTIVO = 140;

function toStoreConsultationType(type = '') {
  if (type === 'telemedicina') return 'telemedicina';
  if (type === 'audio_upload') return 'audio';
  return 'presencial';
}

// note_json.sections → el formato de secciones que lee la web (todas de texto).
function noteJsonToSections(noteJson = {}) {
  const sections = Array.isArray(noteJson.sections) ? noteJson.sections : [];
  return sections.map((section) => ({
    id: `${section?.key || ''}`,
    titulo: `${section?.label || ''}`,
    kind: 'texto',
    texto: `${section?.content || ''}`
  }));
}

// La transcripción se espeja como un único turno sin hablante: se guarda tal
// como se dictó. Vacía → [] (no se fabrica una transcripción que no existe).
function transcriptTextToTurns(text = '') {
  const clean = `${text || ''}`.trim();
  return clean ? [{ t: '', texto: clean }] : [];
}

function deriveMotivo(noteJson = {}) {
  const sections = Array.isArray(noteJson.sections) ? noteJson.sections : [];
  const motivo = sections.find(
    (section) => /motivo/i.test(`${section?.key || ''}`) || /motivo/i.test(`${section?.label || ''}`)
  );
  const text = `${motivo?.content || noteJson.summary || ''}`.trim();
  return text.length > MAX_MOTIVO ? `${text.slice(0, MAX_MOTIVO - 1)}…` : text;
}

class ConsultationMirrorService {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('ConsultationMirrorService requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  static buildRow(encounter = {}, noteJson = {}, { organizationId = null } = {}) {
    const snapshot = encounter.template_snapshot || {};
    return {
      id: encounter.id,
      organization_id: organizationId,
      medico_id: encounter.doctor_id || null,
      // patient_id es uuid con FK en consultations y texto libre en el encounter:
      // se deja null y lo asocia la web, que es la dueña del paciente.
      patient_id: null,
      servicio: SERVICIO_POR_DEFECTO,
      especialidad: specialtyDisplayName(snapshot.specialty),
      tipo: toStoreConsultationType(encounter.consultation_type),
      estado: 'borrador',
      motivo: deriveMotivo(noteJson),
      fecha: encounter.created_at || new Date().toISOString(),
      duracion_min: 0,
      plantilla: `${snapshot.name || ''}`,
      resumen: `${noteJson.summary || ''}`,
      note: noteJsonToSections(noteJson),
      codigos: [],
      transcript: transcriptTextToTurns(encounter.transcript)
    };
  }

  async findOrganizationId(doctorId) {
    if (!doctorId) {
      return null;
    }
    const rows = await this.restClient.select(
      'profiles',
      `id=eq.${encodeURIComponent(doctorId)}&select=organization_id&limit=1`
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.organization_id || null;
  }

  async exists(consultationId) {
    const rows = await this.restClient.select(
      'consultations',
      `id=eq.${encodeURIComponent(consultationId)}&select=id&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Crea la fila del historial si todavía no existe. Devuelve el motivo cuando
   * no escribe, para que el llamador pueda registrarlo sin adivinar.
   */
  async publish(encounter = {}, noteJson = {}) {
    if (!encounter.id) {
      return { published: false, reason: 'sin_encounter' };
    }

    if (await this.exists(encounter.id)) {
      return { published: false, reason: 'ya_existe' };
    }

    const organizationId = await this.findOrganizationId(encounter.doctor_id);
    if (!organizationId) {
      // Sin organización la fila violaría la política de lectura y quedaría
      // invisible igual: mejor no escribir y decirlo que crear un registro roto.
      return { published: false, reason: 'medico_sin_organizacion' };
    }

    const row = ConsultationMirrorService.buildRow(encounter, noteJson, { organizationId });

    // Idempotente: si otro proceso ganó la carrera, la fila ya está y se respeta.
    await this.restClient.insert('consultations', row, 'on_conflict=id');

    try {
      await this.restClient.insert('audit_events', {
        consultation_id: encounter.id,
        organization_id: organizationId,
        actor_id: encounter.doctor_id || null,
        accion: 'Nota generada con Miracle',
        detalle: 'Publicada por el servidor al terminar la consulta.'
      });
    } catch (error) {
      // La auditoría no puede tumbar la publicación: la nota en el historial vale
      // más que su registro de auditoría, y el fallo queda en el log.
      console.error(`[Espejo] Auditoría no registrada para ${encounter.id}: ${error.message}`);
    }

    return { published: true, organizationId };
  }
}

ConsultationMirrorService.noteJsonToSections = noteJsonToSections;
ConsultationMirrorService.transcriptTextToTurns = transcriptTextToTurns;
ConsultationMirrorService.deriveMotivo = deriveMotivo;
ConsultationMirrorService.toStoreConsultationType = toStoreConsultationType;

module.exports = ConsultationMirrorService;
