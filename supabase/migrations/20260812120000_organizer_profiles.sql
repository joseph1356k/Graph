-- ============================================================================
-- "Hoja en blanco" para NO médicos: perfiles de organización por usuario.
--
-- El sistema médico organiza una transcripción con un system prompt fijo. Un
-- vendedor, un supervisor de planta o un abogado necesitan lo mismo con OTRA
-- estructura, así que el system prompt deja de ser una constante del backend y
-- pasa a ser un dato: se GENERA una vez por usuario a partir de (a) lo que él
-- cuenta en voz alta sobre su trabajo y (b) screenshots de cómo organiza hoy
-- esa información.
--
-- graph_organizer_profiles: un perfil por instalación (device_id). Guarda el
--   texto que dictó el usuario, el system prompt generado y el resumen de los
--   ejemplos visuales. Sin RLS para clientes: la app Android NUNCA toca esta
--   tabla directo — pasa por /api/v1/organizer/* del backend Graph, que es el
--   único con service-role. Así el prompt de un usuario no es legible por otro
--   aunque alguien extraiga la key publishable del APK.
--
-- graph_client_config: dos columnas nuevas para que la app Android pueda
--   consumir /api/v1 (X-API-Key) sin hornear la key al compilar, igual que ya
--   hace con las keys de OpenAI/Gemini/Deepgram.
-- ============================================================================

create table if not exists public.graph_organizer_profiles (
  id uuid primary key default gen_random_uuid(),
  -- Instalación dueña del perfil (graph_app_users.device_id). Es la identidad
  -- que la app Android ya tiene siempre, con o sin sesión Supabase.
  device_id text not null,
  -- Sesión Supabase, cuando el usuario inició sesión: permite recuperar el
  -- perfil tras cambiar de teléfono. Nullable a propósito.
  auth_user_id uuid,
  -- 'medico' | 'otra' — la bifurcación que la app pregunta al arrancar.
  profession text not null default 'otra',
  -- Nombre corto del oficio, deducido por la IA ("supervisor de planta").
  occupation text not null default '',
  -- Lo que el usuario dictó, tal cual se transcribió. Es la fuente de verdad:
  -- si mañana mejora el generador, se puede regenerar el prompt desde aquí.
  description text not null default '',
  -- El system prompt generado: lo que organiza cada transcripción de aquí en
  -- adelante. Es EL producto de la configuración inicial.
  system_prompt text not null default '',
  -- Estructura propuesta [{key,label,instruction}] para pintar el reporte.
  sections jsonb not null default '[]'::jsonb,
  -- Lo que la IA leyó de los screenshots de ejemplo (nunca las imágenes: no se
  -- persiste ningún binario, solo la descripción del formato observado).
  sample_notes jsonb not null default '[]'::jsonb,
  sample_count int not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un perfil activo por instalación: el upsert de /api/v1/organizer/profiles se
-- apoya en este índice para reemplazar la configuración cuando el usuario la
-- rehace, en vez de acumular perfiles huérfanos.
create unique index if not exists graph_organizer_profiles_device_active_idx
  on public.graph_organizer_profiles (device_id)
  where status = 'active';

create index if not exists graph_organizer_profiles_auth_user_idx
  on public.graph_organizer_profiles (auth_user_id)
  where auth_user_id is not null;

alter table public.graph_organizer_profiles enable row level security;
-- Sin políticas: nadie con la key publishable (anon/authenticated) lee ni
-- escribe. Solo el backend Graph, que usa service-role y salta RLS.

-- ----------------------------------------------------------------------------
-- Acceso de la app Android al API público (/api/v1)
-- ----------------------------------------------------------------------------
alter table public.graph_client_config
  add column if not exists miracle_api_base text not null default '';
alter table public.graph_client_config
  add column if not exists miracle_api_key text not null default '';
