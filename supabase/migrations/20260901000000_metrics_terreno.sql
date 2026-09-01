-- ============================================================================
-- metrics_* — el instrumento de medición de impacto de Miracle.
--
-- Mide el trabajo operativo de los médicos (tiempo en PC/HIS, escritura, clics,
-- navegación SAP, esperas, post-atención) en tres fases con el MISMO esquema:
-- baseline (sin Miracle) → Notes → Notes+Operations. Lo escribe UMedidor.exe, un
-- cliente Windows SEPARADO de U.exe, por el mismo carril que el resto: /api/v1 con
-- X-API-Key, y es Graph (service-role) quien escribe aquí. Por eso, igual que
-- graph_windows_*, estas tablas tienen RLS activado SIN políticas: ningún cliente
-- las toca directo; el backend las salta con service-role.
--
-- DECISIÓN DE PRIVACIDAD, y es la razón de que estas tablas existan en vez de
-- reusar graph_windows_events: aquí NO hay un `detail jsonb` libre que el panel
-- admin muestre. Los campos son TIPADOS y hay una lista blanca. El contenido
-- clínico no tiene forma de entrar: la identidad del paciente ya llegó hasheada
-- (encounter_key), las superficies vienen normalizadas sin el sufijo vista: ni
-- títulos, y del tecleo solo llegan cantidades. Ver el riesgo R4 del análisis de
-- Operations (PHI a un feed visible a administradores).
--
-- Molde: 20260804000000_ai_usage_telemetry.sql (idempotencia por clave única,
-- snapshots inmutables, org como dimensión, RPCs de agregación server-side).
-- ============================================================================

-- ── El secreto HMAC de la organización ──────────────────────────────────────
-- Con él se podría re-derivar una huella de paciente, así que es la tabla más
-- sensible del sistema: RLS activado y NI UNA política, ni de lectura. Solo
-- service-role la toca, y solo para el enrolamiento y la rotación. El portal
-- jamás la ve. (Esto hace la huella PSEUDÓNIMA, no anónima; es una decisión
-- consciente para poder correlacionar el mismo paciente entre los PCs de un
-- hospital dentro del día operativo — ver la spec 003, punto abierto nº2.)
create table if not exists public.metrics_org_secrets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key_version int not null,
  secret text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (organization_id, key_version)
);
alter table public.metrics_org_secrets enable row level security;

-- ── Dispositivos (instalaciones del medidor) ────────────────────────────────
create table if not exists public.metrics_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_name text not null default '',
  os_version text not null default '',
  app_version text not null default '',
  enrolled_at timestamptz not null default now(),
  enrolled_with_code text not null default '',
  last_seen_at timestamptz not null default now(),
  last_sample_at timestamptz,
  hmac_version int not null default 1,
  config_version int not null default 0,
  status text not null default 'active' check (status in ('active','paused','retired')),
  environment text not null default 'production'
);
alter table public.metrics_devices enable row level security;
create index if not exists metrics_devices_org_idx on public.metrics_devices (organization_id, last_seen_at desc);

-- ── Turnos: la unidad de trabajo, y la fuente de verdad del médico ──────────
-- shift_id lo genera el cliente (uuid) → upsert idempotente. doctor_id puede ser
-- NULL (turno anónimo: el baseline no se pierde por un selector ignorado) y solo
-- transiciona desde NULL o al mismo valor (reasignar un turno abierto), nunca de
-- un médico a otro (eso son dos turnos). phase es un snapshot del calendario;
-- la fase autoritativa se re-deriva de metrics_study_phases por fecha.
create table if not exists public.metrics_shifts (
  shift_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.metrics_devices(id) on delete cascade,
  doctor_id uuid,                          -- fk lógica a metrics_roster (en el portal); sin FK cruzada de repos
  doctor_display_snapshot text not null default '',
  sap_user_seen text,
  phase text not null default 'baseline',
  phase_source text not null default 'calendar',
  started_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual','timeout_inactividad','lock_prolongado','turno_nuevo','apagado','desconocido')),
  dia_operativo date,
  hmac_version int not null default 1,
  app_version text not null default '',
  -- calidad cruda del turno (la derivada, con % de cobertura, vive en el summary)
  huecos_ms bigint not null default 0,
  clock_jumps int not null default 0,
  spool_dropped int not null default 0,
  hooks_degradados boolean not null default false,
  ticks_sap_saltados_busy int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.metrics_shifts enable row level security;
create index if not exists metrics_shifts_org_idx on public.metrics_shifts (organization_id, started_at desc);
create index if not exists metrics_shifts_doctor_idx on public.metrics_shifts (doctor_id, started_at desc);
create index if not exists metrics_shifts_device_idx on public.metrics_shifts (device_id, started_at desc);

-- ── Muestras: la serie temporal (la tabla de volumen) ───────────────────────
-- Una fila por cubeta de 15 s por segmento de contexto (app · superficie ·
-- encounter). La clave natural (shift_id, bucket_start, seq) da idempotencia:
-- un lote reenviado tras un timeout de red hace ON CONFLICT DO NOTHING. bigint
-- identity, no uuid: es la tabla que crece (~4k filas/turno).
create table if not exists public.metrics_samples (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.metrics_devices(id) on delete cascade,
  shift_id uuid not null references public.metrics_shifts(shift_id) on delete cascade,
  doctor_id uuid,
  bucket_start timestamptz not null,
  bucket_ms int not null default 0,
  seq smallint not null default 0,
  app text not null default 'otro',
  surface text,                            -- sapgui://SID/TCODE/DYNPRO | web://dominio | uia://slug — NUNCA título ni vista:
  encounter_key text,                      -- HMAC hex de 32; NULL si la pantalla no dio paciente
  foreground_ms int not null default 0,
  active_ms int not null default 0,
  typing_ms int not null default 0,
  keystrokes int not null default 0,
  clicks int not null default 0,
  scroll_ticks int not null default 0,
  context_switches int not null default 0,
  sap_roundtrips int not null default 0,
  sap_wait_ms int not null default 0,
  created_at timestamptz not null default now(),
  unique (shift_id, bucket_start, seq)
);
alter table public.metrics_samples enable row level security;
create index if not exists metrics_samples_org_time_idx on public.metrics_samples (organization_id, bucket_start desc);
create index if not exists metrics_samples_shift_enc_idx on public.metrics_samples (shift_id, encounter_key);

-- ── Eventos discretos tipados ───────────────────────────────────────────────
-- event_uid = {device}:{coleccion}:{seq} → unique → idempotencia. detail jsonb
-- pero SANEADO en el servidor con lista blanca de claves antes de insertar
-- (doble valla con el cliente): jamás texto libre con PHI.
create table if not exists public.metrics_events (
  id bigint generated always as identity primary key,
  event_uid text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.metrics_devices(id) on delete cascade,
  shift_id uuid references public.metrics_shifts(shift_id) on delete cascade,
  doctor_id uuid,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  encounter_key text,
  kind text not null check (kind in (
    'shift_start','shift_end','doctor_prompted','encounter_enter','encounter_exit','encounter_unknown',
    'lock','unlock','suspend','resume','medidor_start','medidor_stop','pausa_usuario','reanudar_usuario',
    'sap_attach','sap_detach','sap_user_seen','clock_jump','spool_drop','hooks_degradados','config_applied',
    'ops_run','calidad')),
  detail jsonb not null default '{}'::jsonb
);
alter table public.metrics_events enable row level security;
create index if not exists metrics_events_org_idx on public.metrics_events (organization_id, occurred_at desc);
create index if not exists metrics_events_shift_idx on public.metrics_events (shift_id, occurred_at);
create index if not exists metrics_events_kind_idx on public.metrics_events (kind, occurred_at desc);

-- ── Visitas SAP: el journey del HIS, como segmentos ─────────────────────────
create table if not exists public.metrics_sap_visits (
  id bigint generated always as identity primary key,
  visit_uid text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.metrics_devices(id) on delete cascade,
  shift_id uuid not null references public.metrics_shifts(shift_id) on delete cascade,
  doctor_id uuid,
  encounter_key text,
  sid text not null default '',
  tcode text not null default '',
  dynpro text not null default '',
  surface text not null default '',
  entered_at timestamptz not null,
  left_at timestamptz,
  dwell_ms bigint not null default 0,
  ready_ms bigint,                         -- NULL, no 0, si la pantalla nunca dio un EndRequest sin Busy
  sap_wait_ms bigint not null default 0,
  roundtrips int not null default 0,
  exit_to text
);
alter table public.metrics_sap_visits enable row level security;
create index if not exists metrics_visits_shift_idx on public.metrics_sap_visits (shift_id, entered_at);
create index if not exists metrics_visits_tcode_idx on public.metrics_sap_visits (organization_id, tcode, entered_at desc);

-- ── Rollups: el artefacto durable de largo plazo ────────────────────────────
-- Una fila por turno, RECOMPUTABLE (algo_version) por el cron diario. calidad_ok
-- es el filtro por defecto de toda comparación: las sesiones malas se excluyen
-- por construcción, no a mano.
create table if not exists public.metrics_shift_summary (
  shift_id uuid primary key references public.metrics_shifts(shift_id) on delete cascade,
  organization_id uuid not null,
  doctor_id uuid,
  device_id uuid not null,
  phase text not null default 'baseline',
  fecha_operativa date,
  duracion_ms bigint not null default 0,
  active_ms_total bigint not null default 0,
  active_ms_por_app jsonb not null default '{}'::jsonb,
  his_ms bigint not null default 0,
  typing_ms bigint not null default 0,
  keystrokes bigint not null default 0,
  clicks bigint not null default 0,
  scroll_ticks bigint not null default 0,
  context_switches bigint not null default 0,
  encounters int not null default 0,
  encounters_sin_id int not null default 0,
  post_atencion_ms bigint not null default 0,
  cola_post_turno_ms bigint not null default 0,
  sap_wait_ms_total bigint not null default 0,
  ready_ms_p50 bigint,
  ready_ms_p95 bigint,
  pantallas_distintas int not null default 0,
  visitas int not null default 0,
  cobertura_pct numeric,
  calidad jsonb not null default '{}'::jsonb,
  calidad_ok boolean not null default true,
  algo_version int not null default 1,
  computed_at timestamptz not null default now()
);
alter table public.metrics_shift_summary enable row level security;
create index if not exists metrics_summary_org_idx on public.metrics_shift_summary (organization_id, fecha_operativa desc);
create index if not exists metrics_summary_phase_idx on public.metrics_shift_summary (organization_id, phase, doctor_id);

-- ── Rollup diario (para series largas cuando el crudo ya se podó) ────────────
-- doctor_id/device_id son NOT NULL con un centinela «sin dato» (uuid de ceros)
-- en vez de NULL: una PRIMARY KEY no admite expresiones (coalesce), y un NULL en
-- la clave rompería el upsert del rollup. El centinela es explícito y consultable.
create table if not exists public.metrics_daily_rollup (
  organization_id uuid not null,
  fecha_operativa date not null,
  phase text not null,
  doctor_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  device_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  app text not null default 'otro',
  foreground_ms bigint not null default 0,
  active_ms bigint not null default 0,
  typing_ms bigint not null default 0,
  keystrokes bigint not null default 0,
  clicks bigint not null default 0,
  sap_wait_ms bigint not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, fecha_operativa, phase, doctor_id, device_id, app)
);
alter table public.metrics_daily_rollup enable row level security;

-- ============================================================================
-- RPCs de ingesta atómica. Todas SECURITY DEFINER, llamadas SOLO por el backend
-- con service-role; el org_id sale del device registrado, NUNCA del payload.
-- ============================================================================

-- Reclama/crea el secreto v1 de una org en su primer enrolamiento, y lo devuelve.
-- Atómico: dos dispositivos enrolando a la vez no crean dos secretos distintos.
-- Los nombres de las columnas de retorno llevan prefijo out_ para que no colisionen
-- con las columnas reales dentro del cuerpo (un TABLE(...) declara variables PL/pgSQL
-- con esos nombres, y `on conflict (key_version)` sería ambiguo si se llamaran igual).
create or replace function public.metrics_ensure_org_secret(p_org uuid, p_secret text)
returns table(out_key_version int, out_secret text)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.metrics_org_secrets(organization_id, key_version, secret)
  values (p_org, 1, p_secret)
  on conflict (organization_id, key_version) do nothing;

  return query
  select s.key_version, s.secret
  from public.metrics_org_secrets s
  where s.organization_id = p_org and s.retired_at is null
  order by s.key_version desc
  limit 1;
end;
$$;

-- Upsert de un turno (idempotente por shift_id). Protege la regla del médico:
-- doctor_id solo cambia desde NULL, o al mismo valor; y solo mientras el turno
-- está abierto (ended_at nulo). Un cierre no se pisa con otro.
create or replace function public.metrics_upsert_shift(
  p_shift uuid, p_org uuid, p_device uuid, p_doctor uuid, p_doctor_display text,
  p_sap_user text, p_phase text, p_started timestamptz, p_ended timestamptz,
  p_end_reason text, p_dia date, p_hmac_version int, p_app_version text,
  p_huecos_ms bigint, p_clock_jumps int, p_spool_dropped int,
  p_hooks_degradados boolean, p_ticks_sap int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.metrics_shifts(
    shift_id, organization_id, device_id, doctor_id, doctor_display_snapshot, sap_user_seen,
    phase, started_at, ended_at, end_reason, dia_operativo, hmac_version, app_version,
    huecos_ms, clock_jumps, spool_dropped, hooks_degradados, ticks_sap_saltados_busy)
  values (
    p_shift, p_org, p_device, p_doctor, coalesce(p_doctor_display,''), p_sap_user,
    coalesce(p_phase,'baseline'), p_started, p_ended, p_end_reason, p_dia, coalesce(p_hmac_version,1), coalesce(p_app_version,''),
    coalesce(p_huecos_ms,0), coalesce(p_clock_jumps,0), coalesce(p_spool_dropped,0),
    coalesce(p_hooks_degradados,false), coalesce(p_ticks_sap,0))
  on conflict (shift_id) do update set
    doctor_id = case
      when public.metrics_shifts.ended_at is not null then public.metrics_shifts.doctor_id  -- cerrado: no se reasigna
      when public.metrics_shifts.doctor_id is null then excluded.doctor_id                   -- anónimo → médico: se acepta
      else public.metrics_shifts.doctor_id end,                                              -- ya tenía médico: se conserva
    doctor_display_snapshot = case
      when public.metrics_shifts.ended_at is not null then public.metrics_shifts.doctor_display_snapshot
      when public.metrics_shifts.doctor_id is null then excluded.doctor_display_snapshot
      else public.metrics_shifts.doctor_display_snapshot end,
    sap_user_seen = coalesce(excluded.sap_user_seen, public.metrics_shifts.sap_user_seen),
    ended_at = coalesce(public.metrics_shifts.ended_at, excluded.ended_at),  -- el primer cierre manda
    end_reason = coalesce(public.metrics_shifts.end_reason, excluded.end_reason),
    huecos_ms = greatest(public.metrics_shifts.huecos_ms, excluded.huecos_ms),
    clock_jumps = greatest(public.metrics_shifts.clock_jumps, excluded.clock_jumps),
    spool_dropped = greatest(public.metrics_shifts.spool_dropped, excluded.spool_dropped),
    hooks_degradados = public.metrics_shifts.hooks_degradados or excluded.hooks_degradados,
    ticks_sap_saltados_busy = greatest(public.metrics_shifts.ticks_sap_saltados_busy, excluded.ticks_sap_saltados_busy),
    updated_at = now();
end;
$$;

comment on table public.metrics_samples is
  'Serie temporal del medidor: una fila por cubeta de 15s por contexto. Idempotente por (shift_id,bucket_start,seq). Sin PHI: campos tipados, encounter ya hasheado, surface normalizada.';
comment on table public.metrics_org_secrets is
  'Secreto HMAC por organización. RLS sin políticas: SOLO service-role. Con él se re-derivaría una huella de paciente — nunca sale del backend.';
