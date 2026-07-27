-- Objetos "upstream" de Miracle Notes de los que depende graph_note_exports.
--
-- Los crea el repo Pagina-web-clientes-final en el MISMO proyecto Supabase.
-- Aquí se reproducen SOLO los necesarios, copiados fielmente de su origen, para
-- que la migración y las pruebas de graph_note_exports corran contra un Postgres
-- limpio sin tener que clonar el otro repo.
--
-- Origen de cada bloque (Pagina-web-clientes-final/supabase/migrations/):
--   · private.current_org / current_app_role, organizations, patients,
--     consultations, audit_events → 20260628000000_multi_tenant_organizations.sql
--   · trigger de inmutabilidad                → 20260721000000_consultation_immutability_and_addenda.sql
--   · consultations.rotulo                    → 20260723030000_consultations_rotulo_column.sql
--
-- OJO: `profiles.role` es TEXT (no el enum app_role), tal como asume
-- 20260628000000 y como está en producción.
--
-- Si el esquema real de consultations cambia (columnas firmadas, estados,
-- trigger de inmutabilidad), este archivo tiene que seguirlo: es lo que hace
-- honestas a las pruebas de exportación.

create schema if not exists private;
grant usage on schema private to authenticated;

create type public.org_kind as enum ('personal', 'institution');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.org_kind not null default 'personal',
  nit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organizations enable row level security;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text,
  avatar_url text,
  role text not null default 'medico',
  organization_id uuid references public.organizations(id),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helpers security definer (evitan recursión de RLS sobre profiles).
create function private.current_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;
revoke all on function private.current_org() from public;
grant execute on function private.current_org() to authenticated;

create function private.current_app_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;
revoke all on function private.current_app_role() from public;
grant execute on function private.current_app_role() to authenticated;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_org() references public.organizations(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  nombre text not null check (char_length(trim(nombre)) >= 1),
  documento text,
  edad int check (edad is null or (edad >= 0 and edad <= 130)),
  sexo text check (sexo is null or sexo in ('F', 'M')),
  eps text, telefono text,
  antecedentes text[] not null default '{}',
  alergias text[] not null default '{}',
  medicamentos text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.patients enable row level security;

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_org() references public.organizations(id) on delete cascade,
  medico_id uuid not null default auth.uid() references auth.users(id),
  patient_id uuid references public.patients(id) on delete set null,
  servicio text, especialidad text,
  tipo text not null default 'presencial',
  estado text not null default 'borrador',
  motivo text,
  fecha timestamptz not null default now(),
  duracion_min int, plantilla text, resumen text,
  note jsonb not null default '[]'::jsonb,
  codigos jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  firma jsonb,
  rotulo text,
  created_at timestamptz not null default now()
);
alter table public.consultations enable row level security;
create index on public.consultations (organization_id);
create index on public.consultations (patient_id);
grant select, insert, update, delete on table public.consultations to authenticated;
create policy "read consultations" on public.consultations for select to authenticated
  using (organization_id = (select private.current_org())
    and ((select private.current_app_role()) in ('admin', 'supervisor') or medico_id = (select auth.uid())));
create policy "insert consultations" on public.consultations for insert to authenticated
  with check (organization_id = (select private.current_org()) and medico_id = (select auth.uid()));
create policy "update consultations" on public.consultations for update to authenticated
  using (organization_id = (select private.current_org())
    and ((select private.current_app_role()) in ('admin', 'supervisor') or medico_id = (select auth.uid())));

-- Auditoría (append-only).
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_org() references public.organizations(id) on delete cascade,
  consultation_id uuid references public.consultations(id) on delete cascade,
  actor_id uuid default auth.uid(),
  actor_name text, accion text not null, detalle text,
  fecha timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create index on public.audit_events (consultation_id);
grant select, insert on table public.audit_events to authenticated;
create policy "org reads audit" on public.audit_events for select to authenticated
  using (organization_id = (select private.current_org()));
create policy "org inserts audit" on public.audit_events for insert to authenticated
  with check (organization_id = (select private.current_org()));

-- Inmutabilidad de la nota firmada. Única transición de estado permitida:
-- 'aprobada' -> 'exportada'. Es el contrato que respeta
-- graph_report_note_export_result al confirmar una exportación.
create or replace function private.enforce_consultation_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado in ('aprobada', 'exportada') then
    if new.estado is distinct from old.estado
       and not (old.estado = 'aprobada' and new.estado = 'exportada') then
      raise exception 'CONSULTATION_IMMUTABLE: transicion de estado no permitida (% -> %)',
        old.estado, new.estado;
    end if;

    if new.note is distinct from old.note
       or new.resumen is distinct from old.resumen
       or new.codigos is distinct from old.codigos
       or new.transcript is distinct from old.transcript
       or new.firma is distinct from old.firma
       or new.patient_id is distinct from old.patient_id
       or new.medico_id is distinct from old.medico_id
       or new.organization_id is distinct from old.organization_id
       or new.fecha is distinct from old.fecha
       or new.motivo is distinct from old.motivo
       or new.servicio is distinct from old.servicio
       or new.especialidad is distinct from old.especialidad
       or new.tipo is distinct from old.tipo
       or new.plantilla is distinct from old.plantilla
       or new.duracion_min is distinct from old.duracion_min then
      raise exception 'CONSULTATION_IMMUTABLE: la nota firmada no admite cambios; usa una adenda';
    end if;
  end if;
  return new;
end;
$$;

create trigger consultations_immutability
  before update on public.consultations
  for each row execute function private.enforce_consultation_immutability();
