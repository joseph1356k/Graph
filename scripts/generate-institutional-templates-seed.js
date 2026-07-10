// Generates the idempotent SQL seed for the 147 institutional clinical templates
// (49 specialties x 3 template types) that were previously hardcoded in the
// frontend catalog (Pagina-web-clientes-final: lib/clinical/specialties.ts +
// lib/clinical/template-catalog.ts). The catalog is embedded here so the backend
// is the self-contained source of truth going forward.
//
//   node scripts/generate-institutional-templates-seed.js [output.sql]
//
// Re-run whenever the catalog changes; the emitted SQL is idempotent
// (ON CONFLICT (id) DO NOTHING with deterministic slug-derived UUIDs).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');

// --- Catálogo de especialidades (copia fiel del frontend) --------------------
const clinicalSpecialties = [
  { code: 'medicina-general', name: 'Medicina general', focus: 'enfermedad actual y tamizajes preventivos', followUp: 'respuesta al tratamiento y factores de riesgo', procedure: 'atención integral y remisión' },
  { code: 'medicina-familiar', name: 'Medicina familiar', focus: 'contexto familiar, curso de vida y riesgo biopsicosocial', followUp: 'plan familiar y continuidad del cuidado', procedure: 'abordaje familiar y coordinación de red' },
  { code: 'medicina-interna', name: 'Medicina interna', focus: 'problemas clínicos complejos y comorbilidades', followUp: 'metas clínicas, paraclínicos y adherencia', procedure: 'valoración integral de adulto' },
  { code: 'pediatria', name: 'Pediatría', focus: 'crecimiento, desarrollo y antecedentes perinatales', followUp: 'curvas de crecimiento y esquema de vacunación', procedure: 'valoración pediátrica integral' },
  { code: 'neonatologia', name: 'Neonatología', focus: 'antecedentes maternos, perinatales y adaptación neonatal', followUp: 'ganancia ponderal y evolución neonatal', procedure: 'valoración del recién nacido' },
  { code: 'ginecologia-obstetricia', name: 'Ginecología y obstetricia', focus: 'antecedentes ginecoobstétricos y salud sexual', followUp: 'evolución materna, fetal y signos de alarma', procedure: 'valoración ginecológica u obstétrica' },
  { code: 'urgencias', name: 'Medicina de urgencias', focus: 'triaje, cronología del evento y signos de alarma', followUp: 'respuesta a intervenciones y disposición', procedure: 'atención inicial de urgencias' },
  { code: 'cardiologia', name: 'Cardiología', focus: 'síntomas cardiovasculares, riesgo y estudios previos', followUp: 'síntomas, presión arterial y metas cardiovasculares', procedure: 'valoración cardiovascular especializada' },
  { code: 'dermatologia', name: 'Dermatología', focus: 'morfología, distribución y evolución de lesiones', followUp: 'respuesta cutánea y tolerancia al tratamiento', procedure: 'valoración dermatológica y dermatoscopia' },
  { code: 'endocrinologia', name: 'Endocrinología', focus: 'síntomas metabólicos, hormonales y resultados de laboratorio', followUp: 'metas metabólicas y ajuste terapéutico', procedure: 'valoración endocrinológica' },
  { code: 'gastroenterologia', name: 'Gastroenterología', focus: 'síntomas digestivos, dieta y estudios endoscópicos', followUp: 'síntomas, nutrición y resultados de estudios', procedure: 'valoración digestiva especializada' },
  { code: 'geriatria', name: 'Geriatría', focus: 'funcionalidad, fragilidad, cognición y red de apoyo', followUp: 'capacidad funcional, caídas y polifarmacia', procedure: 'valoración geriátrica integral' },
  { code: 'hematologia', name: 'Hematología', focus: 'síntomas hematológicos, sangrado y hemogramas', followUp: 'hemograma, eventos adversos y respuesta', procedure: 'valoración hematológica' },
  { code: 'infectologia', name: 'Infectología', focus: 'exposición, foco infeccioso y antimicrobianos previos', followUp: 'fiebre, cultivos y respuesta antimicrobiana', procedure: 'valoración de enfermedad infecciosa' },
  { code: 'nefrologia', name: 'Nefrología', focus: 'función renal, líquidos, presión arterial y uroanálisis', followUp: 'función renal, electrolitos y nefroprotección', procedure: 'valoración renal especializada' },
  { code: 'neumologia', name: 'Neumología', focus: 'síntomas respiratorios, exposición y pruebas funcionales', followUp: 'disnea, saturación y control inhalatorio', procedure: 'valoración respiratoria especializada' },
  { code: 'neurologia', name: 'Neurología', focus: 'semiología neurológica, cronología y neuroimágenes', followUp: 'déficit neurológico, crisis y funcionalidad', procedure: 'valoración neurológica' },
  { code: 'oncologia', name: 'Oncología clínica', focus: 'diagnóstico oncológico, estadificación y tratamiento previo', followUp: 'toxicidad, respuesta y soporte', procedure: 'valoración oncológica' },
  { code: 'psiquiatria', name: 'Psiquiatría', focus: 'síntomas afectivos, pensamiento, riesgo y funcionamiento', followUp: 'estado mental, adherencia y riesgo suicida', procedure: 'valoración psiquiátrica' },
  { code: 'psicologia', name: 'Psicología clínica', focus: 'motivo de consulta, contexto y recursos de afrontamiento', followUp: 'objetivos terapéuticos y evolución emocional', procedure: 'valoración psicológica' },
  { code: 'reumatologia', name: 'Reumatología', focus: 'dolor inflamatorio, rigidez y compromiso sistémico', followUp: 'actividad de enfermedad y tolerancia terapéutica', procedure: 'valoración reumatológica' },
  { code: 'alergologia', name: 'Alergología e inmunología', focus: 'desencadenantes, reacciones y antecedentes atópicos', followUp: 'control de síntomas y exposición a alérgenos', procedure: 'valoración alérgica e inmunológica' },
  { code: 'dolor-paliativos', name: 'Dolor y cuidados paliativos', focus: 'intensidad de síntomas, funcionalidad y objetivos de cuidado', followUp: 'alivio sintomático, efectos adversos y red de apoyo', procedure: 'valoración de dolor y cuidado paliativo' },
  { code: 'rehabilitacion', name: 'Medicina física y rehabilitación', focus: 'funcionalidad, limitaciones y objetivos de rehabilitación', followUp: 'metas funcionales y respuesta al plan', procedure: 'valoración de rehabilitación' },
  { code: 'medicina-laboral', name: 'Medicina laboral', focus: 'exposición ocupacional, cargo y restricciones', followUp: 'evolución laboral y capacidad funcional', procedure: 'valoración ocupacional' },
  { code: 'medicina-legal', name: 'Medicina legal', focus: 'relato, cronología, hallazgos y cadena de custodia', followUp: 'evolución de lesiones y requerimientos periciales', procedure: 'valoración médico-legal' },
  { code: 'anestesiologia', name: 'Anestesiología', focus: 'riesgo anestésico, vía aérea y antecedentes perioperatorios', followUp: 'estado posanestésico y control del dolor', procedure: 'valoración preanestésica' },
  { code: 'cirugia-general', name: 'Cirugía general', focus: 'síntomas quirúrgicos, abdomen y estudios de apoyo', followUp: 'herida, dolor y recuperación posoperatoria', procedure: 'valoración quirúrgica' },
  { code: 'cirugia-cardiovascular', name: 'Cirugía cardiovascular', focus: 'indicación quirúrgica cardiovascular y riesgo perioperatorio', followUp: 'recuperación cardiovascular y complicaciones', procedure: 'valoración de cirugía cardiovascular' },
  { code: 'cirugia-torax', name: 'Cirugía de tórax', focus: 'síntomas torácicos, función pulmonar e imágenes', followUp: 'drenajes, dolor y función respiratoria', procedure: 'valoración de cirugía torácica' },
  { code: 'cirugia-vascular', name: 'Cirugía vascular', focus: 'síntomas vasculares, pulsos y estudios Doppler', followUp: 'perfusión, herida y factores de riesgo', procedure: 'valoración vascular periférica' },
  { code: 'neurocirugia', name: 'Neurocirugía', focus: 'déficit neurológico, dolor y estudios neuroquirúrgicos', followUp: 'evolución neurológica y control de herida', procedure: 'valoración neuroquirúrgica' },
  { code: 'cirugia-plastica', name: 'Cirugía plástica', focus: 'defecto funcional o estético, piel y tejidos blandos', followUp: 'cicatrización, simetría y cuidados', procedure: 'valoración de cirugía plástica' },
  { code: 'cirugia-pediatrica', name: 'Cirugía pediátrica', focus: 'antecedentes pediátricos, síntomas y evaluación familiar', followUp: 'dolor, alimentación y recuperación infantil', procedure: 'valoración de cirugía pediátrica' },
  { code: 'coloproctologia', name: 'Coloproctología', focus: 'hábito intestinal, síntomas anorrectales y estudios', followUp: 'síntomas, continencia y cicatrización', procedure: 'valoración coloproctológica' },
  { code: 'ortopedia', name: 'Ortopedia y traumatología', focus: 'mecanismo de lesión, dolor, movilidad e imágenes', followUp: 'dolor, consolidación y rehabilitación', procedure: 'valoración ortopédica' },
  { code: 'oftalmologia', name: 'Oftalmología', focus: 'agudeza visual, síntomas oculares y antecedentes', followUp: 'visión, presión ocular y adherencia', procedure: 'valoración oftalmológica' },
  { code: 'otorrinolaringologia', name: 'Otorrinolaringología', focus: 'síntomas de oído, nariz, garganta y audición', followUp: 'síntomas, audición y respuesta terapéutica', procedure: 'valoración otorrinolaringológica' },
  { code: 'urologia', name: 'Urología', focus: 'síntomas urinarios, sexuales y estudios urológicos', followUp: 'síntomas, uroflujometría y función renal', procedure: 'valoración urológica' },
  { code: 'cirugia-maxilofacial', name: 'Cirugía oral y maxilofacial', focus: 'dolor facial, oclusión, trauma e imágenes', followUp: 'cicatrización, apertura oral y dolor', procedure: 'valoración maxilofacial' },
  { code: 'radiologia', name: 'Radiología e imágenes diagnósticas', focus: 'indicación, antecedentes relevantes y estudio solicitado', followUp: 'hallazgos, correlación clínica y recomendación', procedure: 'informe de estudio de imagen' },
  { code: 'patologia', name: 'Patología', focus: 'muestra, contexto clínico y diagnóstico presuntivo', followUp: 'correlación histopatológica y estudios complementarios', procedure: 'informe anatomopatológico' },
  { code: 'medicina-nuclear', name: 'Medicina nuclear', focus: 'indicación, antecedentes y radiofármacos', followUp: 'hallazgos funcionales y correlación', procedure: 'valoración de medicina nuclear' },
  { code: 'genetica', name: 'Genética médica', focus: 'árbol familiar, fenotipo y antecedentes genéticos', followUp: 'resultados, consejería y plan familiar', procedure: 'valoración genética' },
  { code: 'odontologia-general', name: 'Odontología general', focus: 'dolor dental, higiene y antecedentes odontológicos', followUp: 'síntomas, control de placa y respuesta', procedure: 'valoración odontológica' },
  { code: 'endodoncia', name: 'Endodoncia', focus: 'dolor pulpar, pruebas de vitalidad y radiografías', followUp: 'dolor, sellado y restauración definitiva', procedure: 'valoración endodóntica' },
  { code: 'periodoncia', name: 'Periodoncia', focus: 'sangrado gingival, movilidad y periodontograma', followUp: 'higiene, inflamación y profundidad de sondaje', procedure: 'valoración periodontal' },
  { code: 'ortodoncia', name: 'Ortodoncia', focus: 'oclusión, hábitos y análisis facial', followUp: 'movimiento dentario, higiene y adherencia', procedure: 'valoración ortodóncica' },
  { code: 'rehabilitacion-oral', name: 'Rehabilitación oral', focus: 'función masticatoria, oclusión y piezas ausentes', followUp: 'adaptación protésica, función y confort', procedure: 'valoración de rehabilitación oral' }
];

// Legacy hand-authored Medicina General seeds (clinical_note_engine migration).
// Superseded by the frontend-derived catalog; removed to avoid duplicate names.
const LEGACY_SEED_IDS = [
  'e3b0c442-98fc-4c14-9af4-a11e00000001',
  'e3b0c442-98fc-4c14-9af4-a11e00000002',
  'e3b0c442-98fc-4c14-9af4-a11e00000003'
];

// Fixed namespace so slug -> UUIDv5 is stable across runs (idempotency).
const TEMPLATE_UUID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

function uuidV5(name, namespace) {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Required-section heuristic per template type (the frontend catalog has no
// required flags; these are the clinically core sections of each type).
const REQUIRED_LABELS = {
  inicial: ['Motivo de consulta', 'Impresión diagnóstica', 'Plan y recomendaciones'],
  seguimiento: ['Diagnósticos activos', 'Ajuste del plan'],
  valoracion: ['Indicación y contexto clínico', 'Conducta / procedimiento realizado']
};

// Concise, uniform instruction. The frontend catalog carries only section
// labels (no instructions), so these are our own addition; a short prudent
// instruction keeps the seed compact and the note-prompt focused.
function conciseInstruction(label) {
  return `Documenta "${`${label}`.trim()}" usando solo lo mencionado explícitamente en la transcripción; si no se mencionó, indícalo de forma prudente. No inventes datos clínicos.`;
}

function buildSectionInputs(labels, type) {
  const required = new Set(REQUIRED_LABELS[type].map((label) => ClinicalTemplateService.toSnakeKey(label)));
  return labels.map((label, index) => ({
    label,
    order: index + 1,
    required: required.has(ClinicalTemplateService.toSnakeKey(label)),
    instruction: conciseInstruction(label)
  }));
}

// Mirrors createTemplatesForSpecialty from the frontend template-catalog.ts.
function templatesForSpecialty(specialty) {
  const shared = ['Identificación', 'Motivo de consulta', 'Antecedentes relevantes'];
  return [
    {
      slug: `${specialty.code}-inicial`,
      type: 'inicial',
      name: `Consulta inicial · ${specialty.name}`,
      isDefault: specialty.code === 'medicina-general',
      labels: [...shared, specialty.focus, 'Examen físico dirigido', 'Impresión diagnóstica', 'Plan y recomendaciones']
    },
    {
      slug: `${specialty.code}-seguimiento`,
      type: 'seguimiento',
      name: `Control y seguimiento · ${specialty.name}`,
      isDefault: false,
      labels: ['Diagnósticos activos', specialty.followUp, 'Examen de control', 'Resultados relevantes', 'Ajuste del plan', 'Próximo control y signos de alarma']
    },
    {
      slug: `${specialty.code}-valoracion`,
      type: 'valoracion',
      name: `${capitalize(specialty.procedure)} · ${specialty.name}`,
      isDefault: false,
      labels: ['Indicación y contexto clínico', 'Verificación de seguridad y consentimiento', 'Hallazgos', 'Conducta / procedimiento realizado', 'Indicaciones posteriores', 'Plan de seguimiento']
    }
  ];
}

function capitalize(value = '') {
  const text = `${value || ''}`.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function humanizeSpecialty(code = '') {
  const cleaned = `${code || ''}`.trim().replace(/[_-]+/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase() : '';
}

function sqlString(value) {
  return `'${`${value}`.replace(/'/g, "''")}'`;
}

function buildTemplates() {
  const rows = [];
  for (const specialty of clinicalSpecialties) {
    const specialtyCode = ClinicalTemplateService.normalizeSpecialty(specialty.code); // guion_bajo
    for (const template of templatesForSpecialty(specialty)) {
      const sections = ClinicalTemplateService.normalizeSections(
        buildSectionInputs(template.labels, template.type)
      );
      rows.push({
        id: uuidV5(template.slug, TEMPLATE_UUID_NAMESPACE),
        slug: template.slug,
        name: template.name,
        specialty_code: specialtyCode,
        specialty_name: specialty.name,
        description: `Plantilla institucional · ${specialty.name} · ${template.type}.`,
        is_default: template.isDefault,
        sections
      });
    }
  }
  return rows;
}

const INSTRUCTION_SQL_TEMPLATE =
  `'Documenta "' || lbl || '" usando solo lo mencionado explícitamente en la transcripción; si no se mencionó, indícalo de forma prudente. No inventes datos clínicos.'`;

function sqlArray(labels) {
  return `array[${labels.map(sqlString).join(', ')}]`;
}

// Emits a compact, self-contained migration that DERIVES the 147 templates in
// SQL from the 49-specialty catalog (cross joined with the 3 template types),
// instead of spelling out every row. uuid_v5 + slug are computed in SQL and are
// byte-for-byte identical to the JS generator (verified). Idempotent.
function buildSql() {
  const specValues = clinicalSpecialties.map((s) =>
    `    (${sqlString(s.code)}, ${sqlString(s.name)}, ${sqlString(s.focus)}, ${sqlString(s.followUp)}, ${sqlString(s.procedure)})`
  ).join(',\n');

  const sharedInicial = ['Identificación', 'Motivo de consulta', 'Antecedentes relevantes'];

  return `-- Institutional clinical templates seed: 147 templates (49 specialties x 3 types).
-- Source of truth: frontend catalog Pagina-web-clientes-final
--   (lib/clinical/specialties.ts + lib/clinical/template-catalog.ts), embedded in
--   scripts/generate-institutional-templates-seed.js. Regenerate with that script.
-- The 147 rows are derived in SQL from the 49-specialty catalog; ids are
-- deterministic UUIDv5(slug) so the seed is idempotent (ON CONFLICT (id) DO NOTHING).

create extension if not exists pgcrypto with schema extensions;

-- Deterministic UUIDv5 (matches the JS generator's crypto.sha1 implementation).
create or replace function pg_temp.uuid_v5(ns uuid, name text)
returns uuid language plpgsql immutable as $fn$
declare h bytea;
begin
  h := substring(extensions.digest(decode(replace(ns::text,'-',''),'hex') || convert_to(name,'UTF8'), 'sha1') from 1 for 16);
  h := set_byte(h, 6, (get_byte(h,6) & 15) | 80);
  h := set_byte(h, 8, (get_byte(h,8) & 63) | 128);
  return encode(h,'hex')::uuid;
end;
$fn$;

-- snake_case slug matching ClinicalTemplateService.toSnakeKey (accent-stripped).
create or replace function pg_temp.slug(label text)
returns text language sql immutable as $fn$
  select left(trim(both '_' from regexp_replace(
    regexp_replace(lower(translate(label,
      'áàäâãéèëêíìïîóòöôõúùüûñç·', 'aaaaaeeeeiiiiooooouuuunc_')),
      '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g')), 80)
$fn$;

-- Builds the normalized sections jsonb ({key,label,order,required,instruction})
-- from an ordered label array + the set of required labels.
create or replace function pg_temp.build_sections(labels text[], required_labels text[])
returns jsonb language sql immutable as $fn$
  select jsonb_agg(
    jsonb_build_object(
      'key', pg_temp.slug(lbl),
      'label', lbl,
      'order', ord,
      'required', lbl = any(required_labels),
      'instruction', ${INSTRUCTION_SQL_TEMPLATE}
    ) order by ord
  )
  from unnest(labels) with ordinality as t(lbl, ord)
$fn$;

-- Reconcile: drop the 3 hand-authored Medicina General seeds from
-- clinical_note_engine (superseded by the frontend-derived versions below).
-- Guarded to institutional scope; safe because no clinical_encounters reference them.
delete from public.clinical_templates
where id in (${LEGACY_SEED_IDS.map(sqlString).join(', ')})
  and scope = 'institutional'
  and not exists (
    select 1 from public.clinical_encounters e
    where e.template_id = public.clinical_templates.id
  );

with spec(code, name, focus, follow_up, procedure) as (
  values
${specValues}
),
tpl as (
  select s.code, s.name, s.focus, s.follow_up, s.procedure,
         t.suffix, t.tpl_name, t.labels, t.required
  from spec s
  cross join lateral (values
    (
      'inicial',
      'Consulta inicial · ' || s.name,
      ${sqlArray(sharedInicial)} || array[s.focus] || array['Examen físico dirigido','Impresión diagnóstica','Plan y recomendaciones'],
      array['Motivo de consulta','Impresión diagnóstica','Plan y recomendaciones']
    ),
    (
      'seguimiento',
      'Control y seguimiento · ' || s.name,
      array['Diagnósticos activos'] || array[s.follow_up] || array['Examen de control','Resultados relevantes','Ajuste del plan','Próximo control y signos de alarma'],
      array['Diagnósticos activos','Ajuste del plan']
    ),
    (
      'valoracion',
      (upper(left(s.procedure,1)) || substring(s.procedure from 2)) || ' · ' || s.name,
      array['Indicación y contexto clínico','Verificación de seguridad y consentimiento','Hallazgos','Conducta / procedimiento realizado','Indicaciones posteriores','Plan de seguimiento'],
      array['Indicación y contexto clínico','Conducta / procedimiento realizado']
    )
  ) as t(suffix, tpl_name, labels, required)
)
insert into public.clinical_templates
  (id, owner_id, name, description, specialty_code, specialty_name, sections, scope, is_default, status)
select
  pg_temp.uuid_v5('${TEMPLATE_UUID_NAMESPACE}', code || '-' || suffix),
  null,
  tpl_name,
  'Plantilla institucional · ' || name || ' · ' || suffix || '.',
  pg_temp.slug(code),
  name,
  pg_temp.build_sections(labels, required),
  'institutional',
  (code = 'medicina-general' and suffix = 'inicial'),
  'active'
from tpl
on conflict (id) do nothing;
`;
}

function main() {
  const rows = buildTemplates();
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length) {
    throw new Error(`UUID collision: ${rows.length} templates but ${ids.size} unique ids`);
  }
  const specialties = new Set(rows.map((row) => row.specialty_code));
  const sql = buildSql();

  const outPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'supabase', 'migrations', '20260710060000_seed_institutional_templates.sql');
  fs.writeFileSync(outPath, sql);

  console.log(`Especialidades: ${specialties.size}`);
  console.log(`Plantillas (esperadas en DB): ${rows.length}`);
  console.log(`Default (is_default=true): ${rows.filter((r) => r.is_default).map((r) => r.slug).join(', ')}`);
  console.log(`SQL (derivación en BD) escrito en: ${outPath} (${sql.length} bytes)`);
}

if (require.main === module) {
  main();
}

module.exports = { clinicalSpecialties, buildTemplates, templatesForSpecialty, uuidV5, TEMPLATE_UUID_NAMESPACE, LEGACY_SEED_IDS };
