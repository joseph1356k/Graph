-- Institutional clinical templates seed: 147 templates (49 specialties x 3 types).
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
      'instruction', 'Documenta "' || lbl || '" usando solo lo mencionado explícitamente en la transcripción; si no se mencionó, indícalo de forma prudente. No inventes datos clínicos.'
    ) order by ord
  )
  from unnest(labels) with ordinality as t(lbl, ord)
$fn$;

-- Reconcile: drop the 3 hand-authored Medicina General seeds from
-- clinical_note_engine (superseded by the frontend-derived versions below).
-- Guarded to institutional scope; safe because no clinical_encounters reference them.
delete from public.clinical_templates
where id in ('e3b0c442-98fc-4c14-9af4-a11e00000001', 'e3b0c442-98fc-4c14-9af4-a11e00000002', 'e3b0c442-98fc-4c14-9af4-a11e00000003')
  and scope = 'institutional'
  and not exists (
    select 1 from public.clinical_encounters e
    where e.template_id = public.clinical_templates.id
  );

with spec(code, name, focus, follow_up, procedure) as (
  values
    ('medicina-general', 'Medicina general', 'enfermedad actual y tamizajes preventivos', 'respuesta al tratamiento y factores de riesgo', 'atención integral y remisión'),
    ('medicina-familiar', 'Medicina familiar', 'contexto familiar, curso de vida y riesgo biopsicosocial', 'plan familiar y continuidad del cuidado', 'abordaje familiar y coordinación de red'),
    ('medicina-interna', 'Medicina interna', 'problemas clínicos complejos y comorbilidades', 'metas clínicas, paraclínicos y adherencia', 'valoración integral de adulto'),
    ('pediatria', 'Pediatría', 'crecimiento, desarrollo y antecedentes perinatales', 'curvas de crecimiento y esquema de vacunación', 'valoración pediátrica integral'),
    ('neonatologia', 'Neonatología', 'antecedentes maternos, perinatales y adaptación neonatal', 'ganancia ponderal y evolución neonatal', 'valoración del recién nacido'),
    ('ginecologia-obstetricia', 'Ginecología y obstetricia', 'antecedentes ginecoobstétricos y salud sexual', 'evolución materna, fetal y signos de alarma', 'valoración ginecológica u obstétrica'),
    ('urgencias', 'Medicina de urgencias', 'triaje, cronología del evento y signos de alarma', 'respuesta a intervenciones y disposición', 'atención inicial de urgencias'),
    ('cardiologia', 'Cardiología', 'síntomas cardiovasculares, riesgo y estudios previos', 'síntomas, presión arterial y metas cardiovasculares', 'valoración cardiovascular especializada'),
    ('dermatologia', 'Dermatología', 'morfología, distribución y evolución de lesiones', 'respuesta cutánea y tolerancia al tratamiento', 'valoración dermatológica y dermatoscopia'),
    ('endocrinologia', 'Endocrinología', 'síntomas metabólicos, hormonales y resultados de laboratorio', 'metas metabólicas y ajuste terapéutico', 'valoración endocrinológica'),
    ('gastroenterologia', 'Gastroenterología', 'síntomas digestivos, dieta y estudios endoscópicos', 'síntomas, nutrición y resultados de estudios', 'valoración digestiva especializada'),
    ('geriatria', 'Geriatría', 'funcionalidad, fragilidad, cognición y red de apoyo', 'capacidad funcional, caídas y polifarmacia', 'valoración geriátrica integral'),
    ('hematologia', 'Hematología', 'síntomas hematológicos, sangrado y hemogramas', 'hemograma, eventos adversos y respuesta', 'valoración hematológica'),
    ('infectologia', 'Infectología', 'exposición, foco infeccioso y antimicrobianos previos', 'fiebre, cultivos y respuesta antimicrobiana', 'valoración de enfermedad infecciosa'),
    ('nefrologia', 'Nefrología', 'función renal, líquidos, presión arterial y uroanálisis', 'función renal, electrolitos y nefroprotección', 'valoración renal especializada'),
    ('neumologia', 'Neumología', 'síntomas respiratorios, exposición y pruebas funcionales', 'disnea, saturación y control inhalatorio', 'valoración respiratoria especializada'),
    ('neurologia', 'Neurología', 'semiología neurológica, cronología y neuroimágenes', 'déficit neurológico, crisis y funcionalidad', 'valoración neurológica'),
    ('oncologia', 'Oncología clínica', 'diagnóstico oncológico, estadificación y tratamiento previo', 'toxicidad, respuesta y soporte', 'valoración oncológica'),
    ('psiquiatria', 'Psiquiatría', 'síntomas afectivos, pensamiento, riesgo y funcionamiento', 'estado mental, adherencia y riesgo suicida', 'valoración psiquiátrica'),
    ('psicologia', 'Psicología clínica', 'motivo de consulta, contexto y recursos de afrontamiento', 'objetivos terapéuticos y evolución emocional', 'valoración psicológica'),
    ('reumatologia', 'Reumatología', 'dolor inflamatorio, rigidez y compromiso sistémico', 'actividad de enfermedad y tolerancia terapéutica', 'valoración reumatológica'),
    ('alergologia', 'Alergología e inmunología', 'desencadenantes, reacciones y antecedentes atópicos', 'control de síntomas y exposición a alérgenos', 'valoración alérgica e inmunológica'),
    ('dolor-paliativos', 'Dolor y cuidados paliativos', 'intensidad de síntomas, funcionalidad y objetivos de cuidado', 'alivio sintomático, efectos adversos y red de apoyo', 'valoración de dolor y cuidado paliativo'),
    ('rehabilitacion', 'Medicina física y rehabilitación', 'funcionalidad, limitaciones y objetivos de rehabilitación', 'metas funcionales y respuesta al plan', 'valoración de rehabilitación'),
    ('medicina-laboral', 'Medicina laboral', 'exposición ocupacional, cargo y restricciones', 'evolución laboral y capacidad funcional', 'valoración ocupacional'),
    ('medicina-legal', 'Medicina legal', 'relato, cronología, hallazgos y cadena de custodia', 'evolución de lesiones y requerimientos periciales', 'valoración médico-legal'),
    ('anestesiologia', 'Anestesiología', 'riesgo anestésico, vía aérea y antecedentes perioperatorios', 'estado posanestésico y control del dolor', 'valoración preanestésica'),
    ('cirugia-general', 'Cirugía general', 'síntomas quirúrgicos, abdomen y estudios de apoyo', 'herida, dolor y recuperación posoperatoria', 'valoración quirúrgica'),
    ('cirugia-cardiovascular', 'Cirugía cardiovascular', 'indicación quirúrgica cardiovascular y riesgo perioperatorio', 'recuperación cardiovascular y complicaciones', 'valoración de cirugía cardiovascular'),
    ('cirugia-torax', 'Cirugía de tórax', 'síntomas torácicos, función pulmonar e imágenes', 'drenajes, dolor y función respiratoria', 'valoración de cirugía torácica'),
    ('cirugia-vascular', 'Cirugía vascular', 'síntomas vasculares, pulsos y estudios Doppler', 'perfusión, herida y factores de riesgo', 'valoración vascular periférica'),
    ('neurocirugia', 'Neurocirugía', 'déficit neurológico, dolor y estudios neuroquirúrgicos', 'evolución neurológica y control de herida', 'valoración neuroquirúrgica'),
    ('cirugia-plastica', 'Cirugía plástica', 'defecto funcional o estético, piel y tejidos blandos', 'cicatrización, simetría y cuidados', 'valoración de cirugía plástica'),
    ('cirugia-pediatrica', 'Cirugía pediátrica', 'antecedentes pediátricos, síntomas y evaluación familiar', 'dolor, alimentación y recuperación infantil', 'valoración de cirugía pediátrica'),
    ('coloproctologia', 'Coloproctología', 'hábito intestinal, síntomas anorrectales y estudios', 'síntomas, continencia y cicatrización', 'valoración coloproctológica'),
    ('ortopedia', 'Ortopedia y traumatología', 'mecanismo de lesión, dolor, movilidad e imágenes', 'dolor, consolidación y rehabilitación', 'valoración ortopédica'),
    ('oftalmologia', 'Oftalmología', 'agudeza visual, síntomas oculares y antecedentes', 'visión, presión ocular y adherencia', 'valoración oftalmológica'),
    ('otorrinolaringologia', 'Otorrinolaringología', 'síntomas de oído, nariz, garganta y audición', 'síntomas, audición y respuesta terapéutica', 'valoración otorrinolaringológica'),
    ('urologia', 'Urología', 'síntomas urinarios, sexuales y estudios urológicos', 'síntomas, uroflujometría y función renal', 'valoración urológica'),
    ('cirugia-maxilofacial', 'Cirugía oral y maxilofacial', 'dolor facial, oclusión, trauma e imágenes', 'cicatrización, apertura oral y dolor', 'valoración maxilofacial'),
    ('radiologia', 'Radiología e imágenes diagnósticas', 'indicación, antecedentes relevantes y estudio solicitado', 'hallazgos, correlación clínica y recomendación', 'informe de estudio de imagen'),
    ('patologia', 'Patología', 'muestra, contexto clínico y diagnóstico presuntivo', 'correlación histopatológica y estudios complementarios', 'informe anatomopatológico'),
    ('medicina-nuclear', 'Medicina nuclear', 'indicación, antecedentes y radiofármacos', 'hallazgos funcionales y correlación', 'valoración de medicina nuclear'),
    ('genetica', 'Genética médica', 'árbol familiar, fenotipo y antecedentes genéticos', 'resultados, consejería y plan familiar', 'valoración genética'),
    ('odontologia-general', 'Odontología general', 'dolor dental, higiene y antecedentes odontológicos', 'síntomas, control de placa y respuesta', 'valoración odontológica'),
    ('endodoncia', 'Endodoncia', 'dolor pulpar, pruebas de vitalidad y radiografías', 'dolor, sellado y restauración definitiva', 'valoración endodóntica'),
    ('periodoncia', 'Periodoncia', 'sangrado gingival, movilidad y periodontograma', 'higiene, inflamación y profundidad de sondaje', 'valoración periodontal'),
    ('ortodoncia', 'Ortodoncia', 'oclusión, hábitos y análisis facial', 'movimiento dentario, higiene y adherencia', 'valoración ortodóncica'),
    ('rehabilitacion-oral', 'Rehabilitación oral', 'función masticatoria, oclusión y piezas ausentes', 'adaptación protésica, función y confort', 'valoración de rehabilitación oral')
),
tpl as (
  select s.code, s.name, s.focus, s.follow_up, s.procedure,
         t.suffix, t.tpl_name, t.labels, t.required
  from spec s
  cross join lateral (values
    (
      'inicial',
      'Consulta inicial · ' || s.name,
      array['Identificación', 'Motivo de consulta', 'Antecedentes relevantes'] || array[s.focus] || array['Examen físico dirigido','Impresión diagnóstica','Plan y recomendaciones'],
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
  pg_temp.uuid_v5('1b671a64-40d5-491e-99b0-da01ff1f3341', code || '-' || suffix),
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
