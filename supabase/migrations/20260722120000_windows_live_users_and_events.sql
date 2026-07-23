-- ============================================================================
-- "Windows Live" — el core de visualización/telemetría por usuario del cliente
-- Windows (Ü / U.WindowsClient). A diferencia de Android (que escribe directo a
-- Supabase con la anon key + RLS), el cliente Windows habla SOLO con el backend
-- Graph (/api/v1, X-API-Key), y es Graph quien escribe aquí con service-role.
-- Por eso estas tablas tienen RLS activado SIN políticas para anon/authenticated:
-- ningún cliente las toca directo; el backend (service-role) las salta.
--
-- Identidad canónica = EMAIL (el usuario da nombre+correo al instalar). Si el
-- correo se repite (reinstalación u otra máquina) es el MISMO usuario: register
-- hace upsert por email. Sin contraseña por ahora.
--
-- graph_windows_users: una fila por usuario (email). owner_id espeja el email y
--   es la clave con la que se scopea su subconsciente (workflows en Neo4j).
-- graph_windows_events: feed genérico y extensible (kind + detail jsonb) que
--   alimenta tanto los pulsos de la visualización (consciente/subconsciente)
--   como el panel de logs. Pensado para colgar cualquier métrica futura sin
--   cambiar el esquema: basta un `kind` nuevo y payload en `detail`.
-- ============================================================================

create table if not exists public.graph_windows_users (
  email text primary key,
  display_name text not null default '',
  owner_id text not null default '',
  last_install_id text not null default '',
  app_id text not null default '',
  app_version text not null default '',
  machine_name text not null default '',
  os_version text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.graph_windows_users enable row level security;
create index if not exists graph_windows_users_last_seen_idx
  on public.graph_windows_users (last_seen_at desc);

create table if not exists public.graph_windows_events (
  id bigint generated always as identity primary key,
  email text not null,
  install_id text not null default '',
  -- Familia del evento. Consciente: conscious_run_start | analyze | action |
  -- conscious_run_end. Subconsciente: workflow_start | workflow_step |
  -- workflow_end. Genéricos: mcp | log. (Abierto: nuevos kinds no requieren
  -- migración.)
  kind text not null,
  -- Matiz del evento: start | end | ok | error | skipped | '' ...
  phase text not null default '',
  app_id text not null default '',
  surface_url text not null default '',
  workflow_id text not null default '',
  -- Correlaciona todos los eventos de una misma corrida (consciente o workflow).
  run_id text not null default '',
  label text not null default '',
  -- Payload libre para cualquier dato extra (coordenadas, selector, narración,
  -- conteos, tokens…). Es lo que hace este feed extensible sin tocar el esquema.
  detail jsonb not null default '{}'::jsonb,
  -- Marca de tiempo del cliente (cuando ocurrió en la máquina del usuario).
  client_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.graph_windows_events enable row level security;
-- Eventos recientes por usuario (feed de pulsos + logs): orden por id desc.
create index if not exists graph_windows_events_email_idx
  on public.graph_windows_events (email, id desc);
-- Filtro por corrida (drill-down de una ejecución concreta).
create index if not exists graph_windows_events_run_idx
  on public.graph_windows_events (run_id, id);
-- Filtro por app/superficie (agregados del subconsciente).
create index if not exists graph_windows_events_app_idx
  on public.graph_windows_events (email, app_id, id desc);
