-- Emulación mínima de la plataforma Supabase para probar migraciones en un
-- Postgres normal (CI o local), sin depender del stack completo de Supabase.
--
-- Crea SOLO lo que las migraciones de este proyecto usan de la plataforma:
-- roles, el esquema `auth` con `users`/`identities`/`uid()`, pgcrypto en
-- `extensions` y la publicación de Realtime.
--
-- `auth.uid()` lee `request.jwt.claims` igual que en Supabase, así que los
-- tests pueden "iniciar sesión" con:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- y las policies de RLS se comportan como en producción.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end;
$$;

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Default privileges del proyecto real: Supabase concede ALL sobre cada tabla
-- NUEVA de `public` a anon y authenticated. Se reproduce aquí a propósito.
--
-- Sin esto los tests son más benévolos que producción: una tabla que solo hace
-- `grant select to authenticated` parecería cerrada, cuando en la base real llega
-- con INSERT/UPDATE/DELETE concedidos y RLS como única barrera. Reproducirlo es lo
-- que permite afirmar de verdad quién bloquea qué (ver la migración
-- 20260727033327_graph_note_exports_revoke_client_writes.sql).
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- Subconjunto de auth.users que usan las migraciones (FKs y el trigger de
-- alta de usuario que lee raw_user_meta_data).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Identidad del usuario de la petición, tal como la expone Supabase.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true))
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Publicación de Realtime (la migración de graph_note_exports añade su tabla).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
