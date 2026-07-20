-- ============================================================================
-- Telemetría de la app Android (Ü) + configuración distribuida a los clientes
-- (aplicada al proyecto zyvfamlhlmztliexvmej el 2026-07-19 vía MCP; esta copia
--  es el registro versionado)
--
-- graph_client_config: una sola fila con las API keys y defaults que la app
--   Android descarga al arrancar (el usuario final ya no digita keys a mano).
--   Lectura pública (anon); escritura solo service-role (Provider Studio).
--
-- graph_app_users / graph_prompts / graph_exec_logs: cada instalación se
--   registra con el nombre del usuario (popup obligatorio), y cada prompt y
--   línea de log de ejecución se sube para el panel Android del Provider
--   Studio. Los clientes solo pueden INSERTAR/ACTUALIZAR (con la key
--   publishable); nadie puede LEER telemetría ajena: la lectura es exclusiva
--   del backend Graph con service-role.
-- ============================================================================

create table public.graph_client_config (
  id int primary key default 1 check (id = 1),
  openai_key text not null default '',
  gemini_key text not null default '',
  deepgram_key text not null default '',
  default_provider text not null default 'OPENAI' check (default_provider in ('OPENAI','GEMINI')),
  default_openai_model text not null default 'gpt-5.6-terra',
  default_gemini_model text not null default 'gemini-3.5-flash',
  updated_at timestamptz not null default now()
);
alter table public.graph_client_config enable row level security;
create policy "config legible por clientes" on public.graph_client_config
  for select to anon, authenticated using (true);
insert into public.graph_client_config (id) values (1);

create table public.graph_app_users (
  device_id text primary key,
  display_name text not null,
  auth_user_id uuid,
  device_model text not null default '',
  app_version text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.graph_app_users enable row level security;
create policy "clientes registran su instalacion" on public.graph_app_users
  for insert to anon, authenticated with check (true);
create policy "clientes actualizan su instalacion" on public.graph_app_users
  for update to anon, authenticated using (true) with check (true);

create table public.graph_prompts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.graph_app_users(device_id) on delete cascade,
  user_name text not null default '',
  prompt text not null,
  source text not null default 'text',
  status text not null default 'running' check (status in ('running','ok','error','cancelled')),
  summary text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.graph_prompts enable row level security;
create policy "clientes crean prompts" on public.graph_prompts
  for insert to anon, authenticated with check (true);
create policy "clientes cierran prompts" on public.graph_prompts
  for update to anon, authenticated using (true) with check (true);
create index graph_prompts_device_idx on public.graph_prompts (device_id, started_at desc);

create table public.graph_exec_logs (
  id bigint generated always as identity primary key,
  device_id text not null,
  prompt_id uuid,
  tag text not null default '',
  message text not null,
  at timestamptz not null default now()
);
alter table public.graph_exec_logs enable row level security;
create policy "clientes suben logs" on public.graph_exec_logs
  for insert to anon, authenticated with check (true);
create index graph_exec_logs_prompt_idx on public.graph_exec_logs (prompt_id, id);
create index graph_exec_logs_device_idx on public.graph_exec_logs (device_id, at desc);

-- ----------------------------------------------------------------------------
-- Upserts de telemetría vía RPC SECURITY DEFINER: los clientes (anon) no tienen
-- política SELECT (no pueden leer telemetría ajena) y sin ella el ON CONFLICT
-- DO UPDATE de PostgREST viola RLS. Estas funciones hacen el upsert server-side
-- sin abrir lectura. (Aplicado como migración android_telemetry_rpcs.)
-- ----------------------------------------------------------------------------

create or replace function public.graph_upsert_app_user(
  p_device_id text, p_display_name text, p_device_model text default '', p_app_version text default ''
) returns void
language sql security definer set search_path = public as $$
  insert into graph_app_users (device_id, display_name, device_model, app_version, last_seen_at)
  values (p_device_id, p_display_name, p_device_model, p_app_version, now())
  on conflict (device_id) do update set
    display_name = excluded.display_name,
    device_model = excluded.device_model,
    app_version = excluded.app_version,
    last_seen_at = now();
$$;

create or replace function public.graph_upsert_prompt(
  p_id uuid, p_device_id text, p_user_name text, p_prompt text, p_source text,
  p_status text, p_summary text default '', p_finished boolean default false
) returns void
language sql security definer set search_path = public as $$
  insert into graph_prompts (id, device_id, user_name, prompt, source, status, summary, finished_at)
  values (p_id, p_device_id, p_user_name, p_prompt, p_source, p_status, p_summary,
          case when p_finished then now() else null end)
  on conflict (id) do update set
    status = excluded.status,
    summary = excluded.summary,
    finished_at = excluded.finished_at;
$$;

revoke all on function public.graph_upsert_app_user(text, text, text, text) from public;
revoke all on function public.graph_upsert_prompt(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.graph_upsert_app_user(text, text, text, text) to anon, authenticated;
grant execute on function public.graph_upsert_prompt(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;
