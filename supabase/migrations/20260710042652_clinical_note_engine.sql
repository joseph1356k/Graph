-- Clinical note engine: structured templates + encounters with template snapshots.
-- Applied to the live project miracle-app (ref zyvfamlhlmztliexvmej) via MCP on 2026-07-09.
-- Adapts the existing public.clinical_templates table (personal-only, sections text[])
-- to the structured template model (jsonb sections, institutional scope, lifecycle
-- status) and creates public.clinical_encounters. Idempotent: safe to re-run.

-- 0) updated_at helper (reuse private.set_updated_at if the project already has it).
create schema if not exists private;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'set_updated_at'
  ) then
    create function private.set_updated_at()
    returns trigger
    language plpgsql
    set search_path to ''
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end
$$;

-- 1) clinical_templates: institutional scope, lifecycle status, structured sections.
-- Base table (originally created by the client web app for personal templates).
-- Created here if absent so this backend module is reproducible standalone; on
-- the live project the table already exists and this is a no-op.
create table if not exists public.clinical_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  name text not null,
  description text,
  specialty_code text not null,
  specialty_name text not null,
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clinical_templates enable row level security;

alter table public.clinical_templates alter column owner_id drop not null;

-- Writes go through the backend with service role; institutional seeds have no
-- owner and local dev sessions use derived UUIDs, so the auth.users FK is dropped.
alter table public.clinical_templates drop constraint if exists clinical_templates_owner_id_fkey;

alter table public.clinical_templates add column if not exists scope text not null default 'personal';
alter table public.clinical_templates add column if not exists is_default boolean not null default false;
alter table public.clinical_templates add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinical_templates_scope_check') then
    alter table public.clinical_templates
      add constraint clinical_templates_scope_check check (scope in ('personal', 'institutional'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinical_templates_status_check') then
    alter table public.clinical_templates
      add constraint clinical_templates_status_check check (status in ('active', 'archived'));
  end if;
end
$$;

-- sections: text[] -> jsonb (array of section objects).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_templates'
      and column_name = 'sections' and data_type = 'ARRAY'
  ) then
    alter table public.clinical_templates drop constraint if exists clinical_templates_sections_check;
    alter table public.clinical_templates
      alter column sections type jsonb using coalesce(to_jsonb(sections), '[]'::jsonb);
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinical_templates_sections_jsonb_check') then
    alter table public.clinical_templates
      add constraint clinical_templates_sections_jsonb_check
      check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 2 and 30);
  end if;
end
$$;

create index if not exists idx_clinical_templates_specialty on public.clinical_templates(specialty_code);
create index if not exists idx_clinical_templates_owner_user_id on public.clinical_templates(owner_id);
create index if not exists idx_clinical_templates_status on public.clinical_templates(status);

drop trigger if exists set_clinical_templates_updated_at on public.clinical_templates;
create trigger set_clinical_templates_updated_at
  before update on public.clinical_templates
  for each row execute function private.set_updated_at();

-- Authenticated users can read active institutional templates; the pre-existing
-- owner policies keep covering personal templates.
drop policy if exists "Users can read institutional clinical templates" on public.clinical_templates;
create policy "Users can read institutional clinical templates"
  on public.clinical_templates for select to authenticated
  using (scope = 'institutional' and status = 'active');

revoke all on table public.clinical_templates from anon;
grant all on table public.clinical_templates to service_role;

-- 2) clinical_encounters: one row per consultation, with the template snapshot.
create table if not exists public.clinical_encounters (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid null,
  patient_id text null,
  consultation_type text not null,
  consent boolean not null default false,
  template_id uuid null references public.clinical_templates(id),
  template_snapshot jsonb not null,
  status text not null default 'created',
  transcript text default '',
  note_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_encounters_consultation_type_check
    check (consultation_type in ('presencial', 'telemedicina', 'audio_upload')),
  constraint clinical_encounters_status_check
    check (status in ('created', 'recording', 'transcript_ready', 'note_generating', 'note_generated', 'completed', 'failed')),
  constraint clinical_encounters_snapshot_check
    check (jsonb_typeof(template_snapshot) = 'object')
);

create index if not exists idx_clinical_encounters_doctor_id on public.clinical_encounters(doctor_id);
create index if not exists idx_clinical_encounters_template_id on public.clinical_encounters(template_id);
create index if not exists idx_clinical_encounters_status on public.clinical_encounters(status);
create index if not exists idx_clinical_encounters_created_at on public.clinical_encounters(created_at desc);

drop trigger if exists set_clinical_encounters_updated_at on public.clinical_encounters;
create trigger set_clinical_encounters_updated_at
  before update on public.clinical_encounters
  for each row execute function private.set_updated_at();

alter table public.clinical_encounters enable row level security;

drop policy if exists "Doctors read own clinical encounters" on public.clinical_encounters;
create policy "Doctors read own clinical encounters"
  on public.clinical_encounters for select to authenticated
  using ((select auth.uid()) = doctor_id);

drop policy if exists "Doctors create own clinical encounters" on public.clinical_encounters;
create policy "Doctors create own clinical encounters"
  on public.clinical_encounters for insert to authenticated
  with check ((select auth.uid()) = doctor_id and consent = true);

drop policy if exists "Doctors update own clinical encounters" on public.clinical_encounters;
create policy "Doctors update own clinical encounters"
  on public.clinical_encounters for update to authenticated
  using ((select auth.uid()) = doctor_id)
  with check ((select auth.uid()) = doctor_id);

revoke all on table public.clinical_encounters from anon;
grant select, insert, update on table public.clinical_encounters to authenticated;
grant all on table public.clinical_encounters to service_role;

-- 3) Institutional seeds: 3 Medicina General templates with fixed UUIDs.
-- on conflict do nothing keeps the seed idempotent.
insert into public.clinical_templates
  (id, owner_id, name, description, specialty_code, specialty_name, sections, scope, is_default, status)
values
  (
    'e3b0c442-98fc-4c14-9af4-a11e00000001',
    null,
    'Consulta inicial · Medicina general',
    'Plantilla institucional para primera consulta de medicina general.',
    'medicina_general',
    'Medicina general',
    '[
      {"key":"identificacion","label":"Identificación","order":1,"required":false,"instruction":"Extrae los datos de identificación del paciente mencionados (nombre, documento, edad). Si no fueron mencionados, indica que el paciente no fue identificado en la consulta."},
      {"key":"motivo_consulta","label":"Motivo de consulta","order":2,"required":true,"instruction":"Resume de forma breve el motivo principal por el que consulta el paciente, usando lo dicho en la transcripción."},
      {"key":"antecedentes_relevantes","label":"Antecedentes relevantes","order":3,"required":false,"instruction":"Registra únicamente los antecedentes personales, familiares, farmacológicos o alérgicos mencionados en la consulta. Si no se mencionaron, escribe que no fueron referidos."},
      {"key":"enfermedad_actual_y_tamizajes","label":"Enfermedad actual y tamizajes preventivos","order":4,"required":true,"instruction":"Describe la evolución cronológica de los síntomas actuales tal como fueron relatados, incluyendo factores agravantes o atenuantes y tamizajes preventivos discutidos. No agregues síntomas no mencionados."},
      {"key":"examen_fisico_dirigido","label":"Examen físico dirigido","order":5,"required":false,"instruction":"Registra solo los hallazgos de examen físico explícitamente dictados. Nunca inventes signos vitales ni hallazgos. Si no se dictó examen físico, indica que no fue mencionado en la consulta."},
      {"key":"impresion_diagnostica","label":"Impresión diagnóstica","order":6,"required":true,"instruction":"Formula una impresión diagnóstica prudente basada exclusivamente en lo conversado, en términos de probabilidad y pendiente de criterio médico. No inventes diagnósticos confirmados."},
      {"key":"plan_y_recomendaciones","label":"Plan y recomendaciones","order":7,"required":true,"instruction":"Lista las recomendaciones, indicaciones y signos de alarma mencionados por el médico. No agregues medicamentos ni conductas no mencionadas."}
    ]'::jsonb,
    'institutional',
    true,
    'active'
  ),
  (
    'e3b0c442-98fc-4c14-9af4-a11e00000002',
    null,
    'Control y seguimiento · Medicina general',
    'Plantilla institucional para consultas de control y seguimiento.',
    'medicina_general',
    'Medicina general',
    '[
      {"key":"identificacion","label":"Identificación","order":1,"required":false,"instruction":"Extrae los datos de identificación del paciente mencionados. Si no fueron mencionados, indica que el paciente no fue identificado en la consulta."},
      {"key":"motivo_consulta","label":"Motivo de consulta","order":2,"required":true,"instruction":"Resume de forma breve el motivo del control o seguimiento según lo dicho en la transcripción."},
      {"key":"evolucion_desde_ultima_consulta","label":"Evolución desde la última consulta","order":3,"required":true,"instruction":"Describe los cambios clínicos desde el último control tal como fueron relatados (mejoría, empeoramiento o estabilidad). No inventes evolución no mencionada."},
      {"key":"adherencia_y_respuesta_tratamiento","label":"Adherencia y respuesta al tratamiento","order":4,"required":false,"instruction":"Registra la adherencia al tratamiento y la respuesta reportada. Solo menciona medicamentos que hayan sido nombrados en la consulta."},
      {"key":"hallazgos_relevantes","label":"Hallazgos relevantes","order":5,"required":false,"instruction":"Registra hallazgos clínicos o paraclínicos explícitamente mencionados. No inventes resultados de laboratorio ni de examen físico."},
      {"key":"plan_y_recomendaciones","label":"Plan y recomendaciones","order":6,"required":true,"instruction":"Lista las recomendaciones, ajustes de manejo y signos de alarma mencionados por el médico. No agregues conductas no mencionadas."}
    ]'::jsonb,
    'institutional',
    true,
    'active'
  ),
  (
    'e3b0c442-98fc-4c14-9af4-a11e00000003',
    null,
    'Atención integral y remisión · Medicina general',
    'Plantilla institucional para atención integral con remisión a otros servicios.',
    'medicina_general',
    'Medicina general',
    '[
      {"key":"identificacion","label":"Identificación","order":1,"required":false,"instruction":"Extrae los datos de identificación del paciente mencionados. Si no fueron mencionados, indica que el paciente no fue identificado en la consulta."},
      {"key":"motivo_consulta","label":"Motivo de consulta","order":2,"required":true,"instruction":"Resume de forma breve el motivo principal de consulta según la transcripción."},
      {"key":"enfermedad_actual","label":"Enfermedad actual","order":3,"required":true,"instruction":"Describe la evolución cronológica del cuadro actual tal como fue relatado, sin agregar síntomas no mencionados."},
      {"key":"hallazgos_relevantes","label":"Hallazgos relevantes","order":4,"required":false,"instruction":"Registra hallazgos clínicos o paraclínicos explícitamente mencionados en la consulta. No inventes resultados ni examen físico."},
      {"key":"impresion_diagnostica","label":"Impresión diagnóstica","order":5,"required":true,"instruction":"Formula una impresión diagnóstica prudente basada exclusivamente en lo conversado, pendiente de criterio médico. No inventes diagnósticos confirmados."},
      {"key":"conducta_remision_recomendaciones","label":"Conducta, remisión y recomendaciones","order":6,"required":true,"instruction":"Registra la conducta definida, el servicio o especialidad de remisión si fue mencionada y las recomendaciones dadas. No inventes remisiones ni tratamientos."}
    ]'::jsonb,
    'institutional',
    true,
    'active'
  )
on conflict do nothing;
