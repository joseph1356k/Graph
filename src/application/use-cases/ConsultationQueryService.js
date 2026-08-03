const { clinicalError } = require('./ClinicalErrors');

// Listado MAGRO del historial clínico para «qué llevo hoy»: id, fecha, estado y
// rótulos — nunca el cuerpo de la nota. Menos PHI en tránsito, y menos tokens si
// la respuesta acaba en el contexto del modelo que pilota Operations.
//
// Graph lee `consultations` con service-role (salta el RLS de Notes), así que
// la autorización se comprueba aquí, explícita, como en NoteExportService:
//   · siempre medico_id = el actor resuelto (médico del JWT o del vínculo);
//   · cuando el actor es un aparato, ADEMÁS organization_id = la organización
//     congelada en el vínculo — un vínculo viejo de otra organización no lee la
//     nueva.
// El rango de fechas lo manda el cliente (desde/hasta ISO): es quien sabe su
// zona horaria; el servidor no adivina qué significa «hoy» en Medellín.

const ESTADOS = new Set(['borrador', 'revisada', 'aprobada', 'exportada']);
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function assertIsoDate(value, name) {
  if (!value) return '';
  const clean = `${value}`.trim();
  if (Number.isNaN(Date.parse(clean))) {
    throw clinicalError('CONSULTATION_QUERY_INVALID', `${name} no es una fecha ISO válida.`);
  }
  return clean;
}

class ConsultationQueryService {
  constructor(restClient) {
    if (!restClient) {
      throw new Error('ConsultationQueryService requires a SupabaseRestClient');
    }
    this.restClient = restClient;
  }

  async listForDoctor({ doctorId, organizationId = null, estado = '', desde = '', hasta = '', limit = DEFAULT_LIMIT } = {}) {
    const cleanDoctorId = `${doctorId || ''}`.trim();
    if (!cleanDoctorId) {
      throw clinicalError('UNAUTHORIZED', 'Actor clínico no resuelto.');
    }
    const cleanEstado = `${estado || ''}`.trim();
    if (cleanEstado && !ESTADOS.has(cleanEstado)) {
      throw clinicalError('CONSULTATION_QUERY_INVALID', `estado debe ser uno de: ${[...ESTADOS].join(', ')}.`);
    }
    const cleanDesde = assertIsoDate(desde, 'desde');
    const cleanHasta = assertIsoDate(hasta, 'hasta');
    const cleanLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const parts = [
      `medico_id=eq.${encodeURIComponent(cleanDoctorId)}`,
      'deleted_at=is.null',
      'select=id,fecha,estado,servicio,especialidad,plantilla,motivo',
      'order=fecha.desc',
      `limit=${cleanLimit}`
    ];
    if (organizationId) {
      parts.push(`organization_id=eq.${encodeURIComponent(organizationId)}`);
    }
    if (cleanEstado) parts.push(`estado=eq.${encodeURIComponent(cleanEstado)}`);
    if (cleanDesde) parts.push(`fecha=gte.${encodeURIComponent(cleanDesde)}`);
    if (cleanHasta) parts.push(`fecha=lt.${encodeURIComponent(cleanHasta)}`);

    const rows = await this.restClient.select('consultations', parts.join('&'));
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      fecha: row.fecha,
      estado: row.estado,
      servicio: row.servicio || '',
      especialidad: row.especialidad || '',
      plantilla: row.plantilla || '',
      motivo: row.motivo || ''
    }));
  }
}

module.exports = ConsultationQueryService;
