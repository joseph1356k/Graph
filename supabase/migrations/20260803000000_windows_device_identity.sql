-- ============================================================================
-- Identidad por instalación para el cliente Windows + vínculo médico↔equipo.
--
-- Implementa el plan decidido en web/public/studio-docs/autenticacion-interna-plan.md:
-- la key embebida en el .exe deja de ser la credencial de acceso y pasa a ser una
-- key de enrolamiento de bajo privilegio. Al enrolar, Graph emite un token
-- per-install (aquí solo vive su sha256) que es la credencial real de /api/v1 y
-- se revoca por dispositivo sin tocar al resto de la flota.
--
-- Este esquema además EXTIENDE ese plan con lo que no cubría: la delegación
-- clínica. Un médico vincula su consultorio a un equipo canjeando en Miracle
-- Notes un código que el equipo muestra en pantalla; desde entonces el equipo
-- puede actuar EN NOMBRE de ese médico en /api/clinical/* (crear consultas,
-- guardar dictado, generar notas). Firmar y exportar quedan fuera por
-- construcción: esas rutas solo aceptan el JWT del médico.
--
-- DOS TABLAS, no una, porque los ciclos de vida difieren:
--   · revocar el VÍNCULO (el médico deja el consultorio) no mata la credencial
--     del equipo — sigue automatizando SAP y ejecutando exportaciones;
--   · revocar el EQUIPO mata todo.
-- Y porque el multi-médico futuro (PC compartido) es solo cambiar el índice
-- parcial de "un vínculo activo por equipo" — sin migrar datos ni columnas.
--
-- Patrón de acceso (el de graph_note_exports): el cliente habla SOLO con Graph
-- y es Graph quien escribe aquí con service-role. RLS activado SIN políticas:
-- ningún cliente de Supabase lee ni escribe estas tablas. Y como este proyecto
-- tiene un default privilege que concede ALL a anon/authenticated en cada tabla
-- nueva de public (lección de 20260727033327), la revocación va aquí mismo, en
-- la misma migración que crea las tablas.
-- ============================================================================

create table if not exists public.graph_windows_devices (
  id uuid primary key default gen_random_uuid(),
  -- Identificador estable de la máquina, generado por el cliente (hash de
  -- características del equipo, persistido en su config). Sirve para que
  -- re-enrolar la misma máquina no cree un dispositivo fantasma.
  device_id text not null unique,
  -- sha256 hex del token per-install. El token en claro se devuelve UNA vez,
  -- en la respuesta del enroll, y no se vuelve a poder leer.
  token_hash text not null unique,
  -- Nombre visible para humanos ("Consultorio 3", "Admisiones HGM").
  label text not null default '',
  enrolled_at timestamptz not null default now(),
  -- Best-effort: lo actualiza la validación del token. Sirve para detectar
  -- equipos muertos o tokens usándose desde donde no deberían.
  last_seen timestamptz,
  -- Revocación a nivel dispositivo (Studio): mata credencial Y vínculos.
  revoked_at timestamptz
);

create table if not exists public.graph_device_doctor_links (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.graph_windows_devices(id) on delete cascade,
  -- null mientras la fila es un código pendiente de canje. Al canjear, esta
  -- MISMA fila se convierte en el vínculo: toda la historia (quién generó el
  -- código, cuándo se canjeó, quién aprobó, cuándo se revocó) queda junta.
  doctor_id uuid,
  -- Copiada del perfil del médico al canjear (patrón ConsultationMirrorService:
  -- sin organización no se vincula — mejor negarse que crear un vínculo roto).
  organization_id uuid,
  -- Código de emparejamiento que el equipo muestra en pantalla. Alfabeto de
  -- agent_links (sin 0/O/1/I/L). Se anula (null) al canjear: un solo uso.
  pairing_code text unique,
  -- 10 minutos, no 8 horas: el canje es inmediato y cada minuto extra es
  -- superficie de ataque sin beneficio de UX.
  code_expires_at timestamptz,
  approved_at timestamptz,
  -- El médico que canjeó (auth.uid() de su JWT, verificado por Graph).
  approved_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists graph_device_doctor_links_device_idx
  on public.graph_device_doctor_links (device_id);

-- V1: UN vínculo activo por equipo. Re-emparejar revoca el anterior (lo hace el
-- servicio; este índice lo FUERZA aunque el servicio tenga un bug). El soporte
-- multi-médico del futuro es reemplazar este índice por
--   unique (device_id, doctor_id) where revoked_at is null and approved_at is not null
-- y nada más.
create unique index if not exists graph_device_doctor_links_one_active
  on public.graph_device_doctor_links (device_id)
  where revoked_at is null and approved_at is not null;

-- Solo service-role. Sin políticas: RLS niega todo a anon/authenticated…
alter table public.graph_windows_devices enable row level security;
alter table public.graph_device_doctor_links enable row level security;

-- …y sin privilegios, para no depender de RLS como única barrera sobre la
-- tabla que decide quién puede actuar en nombre de un médico.
revoke all on table public.graph_windows_devices from anon, authenticated;
revoke all on table public.graph_device_doctor_links from anon, authenticated;

-- ----------------------------------------------------------------------------
-- VERIFICACIÓN MANUAL (contra la base real, después de aplicar):
--   select has_table_privilege('authenticated', 'public.graph_windows_devices', 'select');
--   select has_table_privilege('authenticated', 'public.graph_device_doctor_links', 'insert');
-- Ambas deben devolver false.
-- ----------------------------------------------------------------------------
