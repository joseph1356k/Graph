// Nombre legible de una especialidad a partir de su código normalizado.
//
// El template_snapshot guarda la especialidad en snake_case ("medicina_nuclear")
// porque así se normaliza al crear la plantilla. El historial clínico que ve el
// médico necesita el nombre con tildes y mayúsculas ("Medicina nuclear"), así
// que la traducción vive aquí, en el dominio, y no duplicada en cada consumidor.

const SPECIALTY_NAMES = {
  medicina_general: 'Medicina general',
  medicina_familiar: 'Medicina familiar',
  medicina_interna: 'Medicina interna',
  pediatria: 'Pediatría',
  neonatologia: 'Neonatología',
  ginecologia_obstetricia: 'Ginecología y obstetricia',
  urgencias: 'Medicina de urgencias',
  cardiologia: 'Cardiología',
  dermatologia: 'Dermatología',
  endocrinologia: 'Endocrinología',
  gastroenterologia: 'Gastroenterología',
  geriatria: 'Geriatría',
  hematologia: 'Hematología',
  infectologia: 'Infectología',
  nefrologia: 'Nefrología',
  neumologia: 'Neumología',
  neurologia: 'Neurología',
  oncologia: 'Oncología clínica',
  psiquiatria: 'Psiquiatría',
  psicologia: 'Psicología clínica',
  reumatologia: 'Reumatología',
  alergologia: 'Alergología e inmunología',
  dolor_paliativos: 'Dolor y cuidados paliativos',
  rehabilitacion: 'Medicina física y rehabilitación',
  medicina_laboral: 'Medicina laboral',
  medicina_legal: 'Medicina legal',
  anestesiologia: 'Anestesiología',
  cirugia_general: 'Cirugía general',
  cirugia_cardiovascular: 'Cirugía cardiovascular',
  cirugia_torax: 'Cirugía de tórax',
  cirugia_vascular: 'Cirugía vascular',
  neurocirugia: 'Neurocirugía',
  cirugia_plastica: 'Cirugía plástica',
  cirugia_pediatrica: 'Cirugía pediátrica',
  coloproctologia: 'Coloproctología',
  ortopedia: 'Ortopedia y traumatología',
  oftalmologia: 'Oftalmología',
  otorrinolaringologia: 'Otorrinolaringología',
  urologia: 'Urología',
  cirugia_maxilofacial: 'Cirugía oral y maxilofacial',
  radiologia: 'Radiología e imágenes diagnósticas',
  patologia: 'Patología',
  medicina_nuclear: 'Medicina nuclear',
  genetica: 'Genética médica',
  odontologia_general: 'Odontología general',
  endodoncia: 'Endodoncia',
  periodoncia: 'Periodoncia',
  ortodoncia: 'Ortodoncia',
  rehabilitacion_oral: 'Rehabilitación oral'
};

function normalizeSpecialtyCode(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Una especialidad fuera del catálogo (plantilla personal con nombre propio) no
// es un error: se devuelve legible en vez de vacío o del código crudo.
function specialtyDisplayName(value = '') {
  const code = normalizeSpecialtyCode(value);
  if (!code) {
    return '';
  }
  if (SPECIALTY_NAMES[code]) {
    return SPECIALTY_NAMES[code];
  }
  const words = code.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

module.exports = { SPECIALTY_NAMES, specialtyDisplayName, normalizeSpecialtyCode };
