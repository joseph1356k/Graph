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

// Igualdad de contenido independiente del orden de claves: jsonb de Postgres NO
// conserva el orden de los objetos, así que comparar con JSON.stringify directo
// declararía «la web editó» en cada refresh aunque nadie haya tocado nada.
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameContent(left, right) {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
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

  /**
   * Refresca en el historial lo que el taller acaba de editar — SOLO campos del
   * servidor (note, resumen, motivo) y SOLO cuando quien edita es un aparato
   * (carril Operations). El carril del navegador conserva su propiedad actual:
   * la web escribe `consultations` directo bajo RLS y aquí no se interfiere.
   *
   * Tres candados, porque el médico edita el historial PRECISAMENTE en borrador:
   *   1. estado=eq.borrador en el propio UPDATE (con el trigger de inmutabilidad
   *      de Notes como último candado del lado de la base);
   *   2. CAS de contenido: si `consultations.note` ya no es lo que el servidor
   *      escribió la última vez (previousNoteJson), la web divergió y NO se
   *      escribe — razón 'web_edito', el último que manda es el médico;
   *   3. sin referencia previa no hay CAS posible → no se escribe.
   *
   * Devuelve { refreshed, reason } para que el llamador lo registre sin adivinar.
   */
  async refresh(encounter = {}, noteJson = {}, { previousNoteJson = null, deviceLabel = '' } = {}) {
    if (!encounter.id) {
      return { refreshed: false, reason: 'sin_encounter' };
    }

    const rows = await this.restClient.select(
      'consultations',
      `id=eq.${encodeURIComponent(encounter.id)}&select=id,estado,note,organization_id&limit=1`
    );
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      // Nunca se publicó (p. ej. el médico no tenía organización entonces):
      // publicar es mejor que refrescar la nada.
      const published = await this.publish(encounter, noteJson);
      return { refreshed: published.published, reason: published.published ? 'publicada' : published.reason };
    }

    if (`${row.estado}` !== 'borrador') {
      return { refreshed: false, reason: 'estado_no_borrador' };
    }

    if (!previousNoteJson) {
      return { refreshed: false, reason: 'sin_referencia' };
    }
    if (!sameContent(row.note, noteJsonToSections(previousNoteJson))) {
      return { refreshed: false, reason: 'web_edito' };
    }

    const updated = await this.restClient.update(
      'consultations',
      `id=eq.${encodeURIComponent(encounter.id)}&estado=eq.borrador`,
      {
        note: noteJsonToSections(noteJson),
        resumen: `${noteJson.summary || ''}`,
        motivo: deriveMotivo(noteJson)
      }
    );
    if (!updated) {
      // Perdió la carrera contra una firma entre la lectura y la escritura.
      return { refreshed: false, reason: 'estado_no_borrador' };
    }

    try {
      await this.restClient.insert('audit_events', {
        consultation_id: encounter.id,
        organization_id: row.organization_id,
        actor_id: encounter.doctor_id || null,
        accion: 'Nota actualizada con Miracle',
        detalle: deviceLabel
          ? `Actualizada desde el taller por el equipo «${deviceLabel}».`
          : 'Actualizada desde el taller.'
      });
    } catch (error) {
      console.error(`[Espejo] Auditoría de refresh no registrada para ${encounter.id}: ${error.message}`);
    }

    return { refreshed: true };
  }
}

ConsultationMirrorService.noteJsonToSections = noteJsonToSections;
ConsultationMirrorService.transcriptTextToTurns = transcriptTextToTurns;
ConsultationMirrorService.stableStringify = stableStringify;
ConsultationMirrorService.sameContent = sameContent;
ConsultationMirrorService.deriveMotivo = deriveMotivo;
ConsultationMirrorService.toStoreConsultationType = toStoreConsultationType;

module.exports = ConsultationMirrorService;
