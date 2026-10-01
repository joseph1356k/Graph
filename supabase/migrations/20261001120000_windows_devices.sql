-- ============================================================================
-- Una credencial por instalación de Ü para Windows (spec 076 de apps/windows)
--
-- POR QUÉ EXISTE. Hasta el 2026-09-30 todas las instalaciones compartían UNA
-- API key embebida en el instalador, y el repo es público: el instalador se
-- descarga sin credenciales. Con esa key se podía pedir /api/v1/agent/claves
-- —las claves crudas de OpenAI y TypeSafe— y entrar a todo /api/v1. No había
-- forma de cortar a una instalación sin cortarlas a todas.
--
-- graph_windows_devices: una fila por instalación que se presentó
-- (POST /api/v1/agent/enroll). La key embebida pasa a servir SOLO para eso.
--
--   token_hash  SHA-256 de la credencial que se le dio. La credencial en claro
--               se entrega una vez y no se guarda: quien lea esta tabla no puede
--               hacerse pasar por ninguna instalación.
--   status      pendiente | aprobada | revocada. Nace pendiente SIEMPRE: el
--               correo lo teclea la persona sin verificar, así que aprobar por
--               correo sería dejar la puerta abierta. La aprueba un admin desde
--               Provider Studio (WindowsDeviceService.setStatus, service-role).
--   api_label   la etiqueta de la API key con la que se presentó. La pone el
--               servidor, no el cuerpo de la petición. La compuerta se enciende
--               POR etiqueta, y con esto el panel la ofrece ya escrita en vez de
--               pedirle a alguien que se la sepa (spec 004 de Graph, promesa 411).
--
-- RLS activado SIN políticas, igual que graph_windows_users: ningún cliente la
-- toca directo; el backend (service-role) la salta. Y además se REVOCA el
-- privilegio de tabla a anon/authenticated: es la lección de
-- 20260917120000_android_realtime_allowed, no fiarse solo de la RLS para la
-- columna que decide quién entra.
-- ============================================================================

create table if not exists public.graph_windows_devices (
  device_id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aprobada', 'revocada')),
  api_label text not null default '',
  email text not null default '',
  display_name text not null default '',
  install_id text not null default '',
  machine_name text not null default '',
  os_version text not null default '',
  app_version text not null default '',
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz,
  decided_at timestamptz,
  decided_by text not null default ''
);

alter table public.graph_windows_devices enable row level security;
revoke all on table public.graph_windows_devices from anon, authenticated;

-- La lista del panel: las más recientes primero.
create index if not exists graph_windows_devices_enrolled_idx
  on public.graph_windows_devices (enrolled_at desc);
