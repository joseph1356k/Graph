// Tipos de apoyo para `npm run typecheck`. No son código de producción.

// En este repo los errores de dominio viajan con el status HTTP adjunto
// (ver src/application/use-cases/ClinicalErrors.js y ~18 sitios más), y las
// rutas de web/api/ lo leen para responder. Declararlo aquí documenta el
// idiom y evita falsos positivos en el chequeo.
interface Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}
