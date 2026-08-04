-- ============================================================================
-- Telemetría de consumo de IA (tokens y costos) — Miracle
--
-- POR QUÉ ESTA TABLA EXISTE
-- Hasta hoy el consumo se escribía en un JSONL (`generated/usage/ai-usage-events.jsonl`).
-- En Vercel ese archivo vive en /tmp, que es efímero y por invocación: el
-- dashboard leía casi siempre un archivo vacío. De ahí el «0» de la captura.
-- Aquí el evento se persiste en Postgres, que es el único almacenamiento
-- compartido entre las lambdas.
--
-- QUÉ NO SE GUARDA (no negociable)
-- Ni prompts, ni respuestas, ni transcripciones, ni notas, ni nombres de
-- paciente, ni documentos de identidad, ni llaves. `metadata` es jsonb pero se
-- sanea en el servidor (allowlist de claves técnicas) antes de llegar aquí.
-- El identificador clínico nunca entra: se referencia al usuario por su uuid de
-- auth.users y a la organización por su uuid.
--
-- QUIÉN ESCRIBE
-- Solo el backend Graph con service-role. RLS queda activo y SIN políticas de
-- escritura: ningún cliente (anon/authenticated) puede insertar ni alterar el
-- ledger. Es el mismo patrón que graph_windows_events.
--
-- QUIÉN LEE
--   · superadmin           → todas las organizaciones
--   · admin (institucional)→ su organización
--   · medico / secretaria  → solo sus propios eventos
--   · service-role (Graph) → todo, porque es quien sirve el dashboard interno
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vocabulario canónico. Se usan dominios de texto con CHECK en vez de enums:
-- agregar una app o un módulo nuevo no debe requerir ALTER TYPE ni bloquear la
-- tabla. La lista viva está en src/domain/usage/vocabulary.js.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),

  -- Idempotencia: si el mismo evento se reintenta por un fallo de red o de
  -- persistencia, el segundo insert choca aquí en vez de duplicar consumo.
  -- OJO: un REINTENTO DE LA LLAMADA AL PROVEEDOR es consumo real y trae su
  -- propia clave (lleva el número de intento). Esto solo deduplica el mismo
  -- evento escrito dos veces.
  idempotency_key text not null unique,

  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  -- Atribución -------------------------------------------------------------
  organization_id uuid references public.organizations(id) on delete set null,
  -- Sin FK a auth.users a propósito: el ledger es un registro contable y debe
  -- sobrevivir al borrado de una cuenta. Se conserva el uuid como referencia.
  user_id uuid,
  actor_type text not null default 'unattributed'
    check (actor_type in ('user', 'system', 'background_job', 'unattributed')),
  -- De dónde salió la atribución. Sirve para auditar que no venga del cliente
  -- sin validar: 'session' = derivada del JWT verificado; 'api_key' = cliente
  -- con X-API-Key mapeado en servidor; 'device' = instalación registrada;
  -- 'internal' = proceso propio; 'none' = no hubo forma de atribuir.
  attribution_source text not null default 'none'
    check (attribution_source in ('session', 'api_key', 'device', 'internal', 'none')),

  -- Aplicación y funcionalidad son campos SEPARADOS a propósito -------------
  app text not null default 'unknown',      -- web_app | windows_app | android_app | backend | system | ...
  feature text not null default 'unknown',  -- hoja_en_blanco | asistente | biopsia | field_matching | ...

  -- Proveedor y modelo -----------------------------------------------------
  provider text not null default 'unknown',
  api_family text not null default 'unknown', -- chat_completions | responses | transcription | video | computer_use
  requested_model text not null default '',
  served_model text not null default '',      -- el que el proveedor dice haber usado

  -- Consumo ----------------------------------------------------------------
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  -- Audio (Deepgram, transcripción). En segundos para no perder precisión.
  audio_seconds numeric(12, 3) not null default 0 check (audio_seconds >= 0),
  -- Imágenes/vídeo, cuando el proveedor cobre por unidad y no por token.
  request_units integer not null default 0 check (request_units >= 0),

  -- Costo ------------------------------------------------------------------
  -- NULL = no se pudo calcular. Nunca 0 por defecto: un cero silencioso es
  -- indistinguible de «gratis» y esconde tarifas sin configurar.
  cost_usd numeric(14, 8),
  cost_status text not null default 'unpriced_no_rate'
    check (cost_status in ('priced', 'unpriced_no_rate', 'unpriced_no_usage', 'free')),
  currency text not null default 'USD',
  -- Tarifa aplicada en el momento del evento, congelada. Permite reconstruir
  -- el cálculo aunque el catálogo cambie después.
  pricing_version text not null default '',
  pricing_snapshot jsonb not null default '{}'::jsonb,

  -- Resultado --------------------------------------------------------------
  status text not null default 'ok'
    check (status in ('ok', 'error', 'partial', 'cancelled')),
  error_code text not null default '',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  streamed boolean not null default false,
  -- Reintentos y fallback: el intento 1 es el original; los siguientes apuntan
  -- al primero por root_event_id. Todos cuentan como consumo real.
  attempt smallint not null default 1 check (attempt >= 1),
  root_event_id uuid,
  fallback_from_model text not null default '',

  provider_request_id text not null default '',
  environment text not null default 'development'
    check (environment in ('production', 'preview', 'development', 'test')),

  -- Correlación técnica (nunca contenido clínico)
  session_id text not null default '',
  workflow_id text not null default '',
  request_id text not null default '',

  metadata jsonb not null default '{}'::jsonb
);

alter table public.ai_usage_events enable row level security;

comment on table public.ai_usage_events is
  'Ledger de consumo de modelos de IA. Solo el backend (service-role) escribe. No contiene prompts, respuestas ni datos clínicos.';
comment on column public.ai_usage_events.idempotency_key is
  'Impide duplicar el MISMO evento. Un reintento real al proveedor trae su propia clave (incluye attempt).';
comment on column public.ai_usage_events.cost_usd is
  'NULL cuando no hay tarifa configurada o el proveedor no reportó uso. Nunca 0 por omisión.';
comment on column public.ai_usage_events.app is
  'Aplicación de origen (web_app, windows_app, android_app, backend, system). NO mezclar con feature.';
comment on column public.ai_usage_events.feature is
  'Módulo o funcionalidad (hoja_en_blanco, asistente, biopsia, field_matching...). NO mezclar con app.';

-- Índices: el dashboard siempre filtra por rango de tiempo y casi siempre
-- agrupa por una dimensión. El índice por (occurred_at desc) cubre el rango;
-- los parciales por organización y usuario cubren el aislamiento.
create index if not exists ai_usage_events_occurred_idx
  on public.ai_usage_events (occurred_at desc);
create index if not exists ai_usage_events_org_occurred_idx
  on public.ai_usage_events (organization_id, occurred_at desc);
create index if not exists ai_usage_events_user_occurred_idx
  on public.ai_usage_events (user_id, occurred_at desc)
  where user_id is not null;
create index if not exists ai_usage_events_app_occurred_idx
  on public.ai_usage_events (app, occurred_at desc);
create index if not exists ai_usage_events_feature_occurred_idx
  on public.ai_usage_events (feature, occurred_at desc);
create index if not exists ai_usage_events_provider_model_idx
  on public.ai_usage_events (provider, requested_model, occurred_at desc);
create index if not exists ai_usage_events_unpriced_idx
  on public.ai_usage_events (provider, requested_model)
  where cost_status = 'unpriced_no_rate';

-- ---------------------------------------------------------------------------
-- Catálogo de tarifas, versionado por fecha de vigencia.
--
-- El cálculo en caliente lo hace el recorder de Node con el catálogo de código
-- (src/domain/usage/pricing.js) para no depender de la red en el camino
-- crítico. Esta tabla es el espejo consultable por SQL: sirve para auditar,
-- para reconstruir costos históricos y para responder «qué tarifa falta».
-- Un test (verify-ai-usage-pricing.js) exige que ambas coincidan.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  api_family text not null default 'chat_completions',
  version text not null,
  currency text not null default 'USD',

  input_per_mtok numeric(12, 6),
  cached_input_per_mtok numeric(12, 6),
  output_per_mtok numeric(12, 6),
  reasoning_per_mtok numeric(12, 6),
  per_minute_usd numeric(12, 6),
  per_request_usd numeric(12, 6),

  effective_from timestamptz not null default '1970-01-01T00:00:00Z',
  effective_to timestamptz,
  source_url text not null default '',
  source_captured_at date,
  created_at timestamptz not null default now(),

  unique (provider, model, api_family, version)
);

alter table public.ai_model_prices enable row level security;

comment on table public.ai_model_prices is
  'Tarifas por proveedor/modelo con vigencia. Espejo auditable del catálogo de código; el runtime calcula con el módulo de Node.';

create index if not exists ai_model_prices_lookup_idx
  on public.ai_model_prices (provider, model, api_family, effective_from desc);

-- ---------------------------------------------------------------------------
-- Alcance de lectura. Una sola función decide qué ve cada quien; las políticas
-- RLS y las RPC la comparten, así no hay dos jueces que puedan discrepar.
--
--   'all'  → sin filtro de organización (superadmin, o el backend con
--            service-role sirviendo el dashboard interno)
--   'org'  → solo su organización (admin institucional)
--   'self' → solo sus propios eventos (medico, secretaria)
--   'none' → nada
-- ---------------------------------------------------------------------------
create or replace function private.ai_usage_scope()
returns table (scope text, org_id uuid, actor_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if v_uid is null then
    -- Sin identidad de usuario final. El EXECUTE está revocado a anon y a
    -- public, así que este camino solo lo alcanza service_role: el backend
    -- Graph, que es el rol interno autorizado a ver varias organizaciones.
    if v_jwt_role = 'anon' then
      return query select 'none'::text, null::uuid, null::uuid;
    else
      return query select 'all'::text, null::uuid, null::uuid;
    end if;
  elsif private.is_superadmin() then
    return query select 'all'::text, null::uuid, v_uid;
  elsif private.current_app_role() = 'admin' then
    return query select 'org'::text, private.current_org(), v_uid;
  else
    return query select 'self'::text, private.current_org(), v_uid;
  end if;
end;
$$;

revoke all on function private.ai_usage_scope() from public;
grant execute on function private.ai_usage_scope() to authenticated, service_role;

-- Políticas de lectura. Escritura: ninguna política ⇒ solo service-role.
create policy "ai usage lectura por alcance" on public.ai_usage_events
  for select to authenticated
  using (
    exists (
      select 1
      from private.ai_usage_scope() s
      where s.scope = 'all'
         or (s.scope = 'org' and public.ai_usage_events.organization_id = s.org_id)
         or (s.scope = 'self' and public.ai_usage_events.user_id = s.actor_id)
    )
  );

grant select on table public.ai_usage_events to authenticated;

-- Las tarifas no son secretas: cualquiera autenticado puede leerlas para
-- entender su factura. Escribirlas sigue siendo service-role.
create policy "tarifas legibles por autenticados" on public.ai_model_prices
  for select to authenticated using (true);
grant select on table public.ai_model_prices to authenticated;

-- ---------------------------------------------------------------------------
-- Predicado de filtros compartido por todas las RPC.
-- Se resuelve el alcance UNA vez y se aplican los filtros como condiciones
-- planas, para que los índices sirvan. Los arrays vacíos o NULL no filtran.
-- ---------------------------------------------------------------------------

create or replace function public.ai_usage_summary(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organization_id uuid default null,
  p_user_id uuid default null,
  p_apps text[] default null,
  p_features text[] default null,
  p_providers text[] default null,
  p_models text[] default null,
  p_statuses text[] default null,
  p_environments text[] default null
)
returns table (
  total_events bigint,
  ok_events bigint,
  error_events bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  reasoning_tokens bigint,
  total_tokens bigint,
  audio_seconds numeric,
  cost_usd numeric,
  priced_events bigint,
  unpriced_events bigint,
  active_users bigint,
  active_organizations bigint,
  avg_tokens_per_event numeric,
  avg_latency_ms numeric,
  error_rate numeric,
  first_event_at timestamptz,
  last_event_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_org uuid;
  v_actor uuid;
begin
  select s.scope, s.org_id, s.actor_id into v_scope, v_org, v_actor
  from private.ai_usage_scope() s;

  if v_scope = 'none' then
    return;
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where e.status = 'ok')::bigint,
    count(*) filter (where e.status = 'error')::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cached_input_tokens), 0)::bigint,
    coalesce(sum(e.reasoning_tokens), 0)::bigint,
    coalesce(sum(e.total_tokens), 0)::bigint,
    coalesce(sum(e.audio_seconds), 0)::numeric,
    coalesce(sum(e.cost_usd), 0)::numeric,
    count(*) filter (where e.cost_status = 'priced')::bigint,
    count(*) filter (where e.cost_status = 'unpriced_no_rate')::bigint,
    count(distinct e.user_id)::bigint,
    count(distinct e.organization_id)::bigint,
    case when count(*) = 0 then 0
         else round(coalesce(sum(e.total_tokens), 0)::numeric / count(*), 2) end,
    round(coalesce(avg(e.latency_ms), 0)::numeric, 1),
    case when count(*) = 0 then 0
         else round((count(*) filter (where e.status = 'error'))::numeric * 100 / count(*), 2) end,
    min(e.occurred_at),
    max(e.occurred_at)
  from public.ai_usage_events e
  where (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to)
    and (v_scope <> 'org' or e.organization_id = v_org)
    and (v_scope <> 'self' or e.user_id = v_actor)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_user_id is null or e.user_id = p_user_id)
    and (p_apps is null or cardinality(p_apps) = 0 or e.app = any(p_apps))
    and (p_features is null or cardinality(p_features) = 0 or e.feature = any(p_features))
    and (p_providers is null or cardinality(p_providers) = 0 or e.provider = any(p_providers))
    and (p_models is null or cardinality(p_models) = 0 or e.requested_model = any(p_models))
    and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any(p_statuses))
    and (p_environments is null or cardinality(p_environments) = 0 or e.environment = any(p_environments));
end;
$$;

revoke all on function public.ai_usage_summary(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]
) from public;
grant execute on function public.ai_usage_summary(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]
) to authenticated, service_role;

-- Serie temporal. p_bucket acepta 'minute' | 'hour' | 'day'; cualquier otro
-- valor cae a 'hour' en vez de abrir un hueco de inyección en date_trunc.
create or replace function public.ai_usage_series(
  p_bucket text default 'hour',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organization_id uuid default null,
  p_user_id uuid default null,
  p_apps text[] default null,
  p_features text[] default null,
  p_providers text[] default null,
  p_models text[] default null,
  p_statuses text[] default null,
  p_environments text[] default null
)
returns table (
  bucket_at timestamptz,
  events bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  cost_usd numeric,
  error_events bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_org uuid;
  v_actor uuid;
  v_bucket text := case lower(coalesce(p_bucket, 'hour'))
                     when 'minute' then 'minute'
                     when 'day' then 'day'
                     else 'hour'
                   end;
begin
  select s.scope, s.org_id, s.actor_id into v_scope, v_org, v_actor
  from private.ai_usage_scope() s;

  if v_scope = 'none' then
    return;
  end if;

  return query
  select
    date_trunc(v_bucket, e.occurred_at) as bucket_at,
    count(*)::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.total_tokens), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric,
    count(*) filter (where e.status = 'error')::bigint
  from public.ai_usage_events e
  where (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to)
    and (v_scope <> 'org' or e.organization_id = v_org)
    and (v_scope <> 'self' or e.user_id = v_actor)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_user_id is null or e.user_id = p_user_id)
    and (p_apps is null or cardinality(p_apps) = 0 or e.app = any(p_apps))
    and (p_features is null or cardinality(p_features) = 0 or e.feature = any(p_features))
    and (p_providers is null or cardinality(p_providers) = 0 or e.provider = any(p_providers))
    and (p_models is null or cardinality(p_models) = 0 or e.requested_model = any(p_models))
    and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any(p_statuses))
    and (p_environments is null or cardinality(p_environments) = 0 or e.environment = any(p_environments))
  group by 1
  order by 1;
end;
$$;

revoke all on function public.ai_usage_series(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]
) from public;
grant execute on function public.ai_usage_series(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]
) to authenticated, service_role;

-- Desglose por dimensión. p_dimension se valida contra una lista blanca; el
-- CASE evita SQL dinámico.
create or replace function public.ai_usage_breakdown(
  p_dimension text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organization_id uuid default null,
  p_user_id uuid default null,
  p_apps text[] default null,
  p_features text[] default null,
  p_providers text[] default null,
  p_models text[] default null,
  p_statuses text[] default null,
  p_environments text[] default null,
  p_limit integer default 50
)
returns table (
  dimension_key text,
  dimension_id uuid,
  events bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  cost_usd numeric,
  error_events bigint,
  avg_latency_ms numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_org uuid;
  v_actor uuid;
  v_dimension text := lower(coalesce(p_dimension, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
begin
  if v_dimension not in ('app', 'feature', 'provider', 'model', 'user', 'organization', 'status', 'environment', 'actor_type') then
    raise exception 'dimension no soportada: %', p_dimension
      using errcode = '22023';
  end if;

  select s.scope, s.org_id, s.actor_id into v_scope, v_org, v_actor
  from private.ai_usage_scope() s;

  if v_scope = 'none' then
    return;
  end if;

  return query
  select
    case v_dimension
      when 'app' then e.app
      when 'feature' then e.feature
      when 'provider' then e.provider
      when 'model' then coalesce(nullif(e.served_model, ''), e.requested_model)
      when 'user' then coalesce(e.user_id::text, '(sin atribucion)')
      when 'organization' then coalesce(e.organization_id::text, '(sin organizacion)')
      when 'status' then e.status
      when 'environment' then e.environment
      else e.actor_type
    end as dimension_key,
    case v_dimension
      when 'user' then e.user_id
      when 'organization' then e.organization_id
      else null::uuid
    end as dimension_id,
    count(*)::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.total_tokens), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric,
    count(*) filter (where e.status = 'error')::bigint,
    round(coalesce(avg(e.latency_ms), 0)::numeric, 1)
  from public.ai_usage_events e
  where (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to)
    and (v_scope <> 'org' or e.organization_id = v_org)
    and (v_scope <> 'self' or e.user_id = v_actor)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_user_id is null or e.user_id = p_user_id)
    and (p_apps is null or cardinality(p_apps) = 0 or e.app = any(p_apps))
    and (p_features is null or cardinality(p_features) = 0 or e.feature = any(p_features))
    and (p_providers is null or cardinality(p_providers) = 0 or e.provider = any(p_providers))
    and (p_models is null or cardinality(p_models) = 0 or e.requested_model = any(p_models))
    and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any(p_statuses))
    and (p_environments is null or cardinality(p_environments) = 0 or e.environment = any(p_environments))
  group by 1, 2
  order by 6 desc, 4 desc
  limit v_limit;
end;
$$;

revoke all on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
) from public;
grant execute on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
) to authenticated, service_role;

-- Tabla de detalle paginada. Devuelve el total para poder paginar sin
-- descargar todo. Nunca expone metadata cruda con contenido: `metadata` ya
-- viene saneada desde el servidor.
create or replace function public.ai_usage_events_page(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_organization_id uuid default null,
  p_user_id uuid default null,
  p_apps text[] default null,
  p_features text[] default null,
  p_providers text[] default null,
  p_models text[] default null,
  p_statuses text[] default null,
  p_environments text[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  occurred_at timestamptz,
  organization_id uuid,
  user_id uuid,
  actor_type text,
  attribution_source text,
  app text,
  feature text,
  provider text,
  requested_model text,
  served_model text,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  total_tokens bigint,
  audio_seconds numeric,
  cost_usd numeric,
  cost_status text,
  status text,
  error_code text,
  latency_ms integer,
  streamed boolean,
  attempt smallint,
  environment text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_org uuid;
  v_actor uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  select s.scope, s.org_id, s.actor_id into v_scope, v_org, v_actor
  from private.ai_usage_scope() s;

  if v_scope = 'none' then
    return;
  end if;

  return query
  with filtrados as (
    select e.*
    from public.ai_usage_events e
    where (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at <= p_to)
      and (v_scope <> 'org' or e.organization_id = v_org)
      and (v_scope <> 'self' or e.user_id = v_actor)
      and (p_organization_id is null or e.organization_id = p_organization_id)
      and (p_user_id is null or e.user_id = p_user_id)
      and (p_apps is null or cardinality(p_apps) = 0 or e.app = any(p_apps))
      and (p_features is null or cardinality(p_features) = 0 or e.feature = any(p_features))
      and (p_providers is null or cardinality(p_providers) = 0 or e.provider = any(p_providers))
      and (p_models is null or cardinality(p_models) = 0 or e.requested_model = any(p_models))
      and (p_statuses is null or cardinality(p_statuses) = 0 or e.status = any(p_statuses))
      and (p_environments is null or cardinality(p_environments) = 0 or e.environment = any(p_environments))
  )
  select
    f.id, f.occurred_at, f.organization_id, f.user_id, f.actor_type, f.attribution_source,
    f.app, f.feature, f.provider, f.requested_model, f.served_model,
    f.input_tokens, f.output_tokens, f.cached_input_tokens, f.total_tokens, f.audio_seconds,
    f.cost_usd, f.cost_status, f.status, f.error_code, f.latency_ms, f.streamed, f.attempt,
    f.environment,
    (select count(*) from filtrados)::bigint
  from filtrados f
  order by f.occurred_at desc, f.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
) from public;
grant execute on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
) to authenticated, service_role;

-- Qué combinaciones proveedor/modelo están facturando sin tarifa configurada.
-- Es lo que el dashboard muestra en el estado «tarifa no configurada».
create or replace function public.ai_usage_missing_rates(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  provider text,
  api_family text,
  requested_model text,
  events bigint,
  total_tokens bigint,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_org uuid;
  v_actor uuid;
begin
  select s.scope, s.org_id, s.actor_id into v_scope, v_org, v_actor
  from private.ai_usage_scope() s;

  if v_scope = 'none' then
    return;
  end if;

  return query
  select e.provider, e.api_family, e.requested_model,
         count(*)::bigint,
         coalesce(sum(e.total_tokens), 0)::bigint,
         max(e.occurred_at)
  from public.ai_usage_events e
  where e.cost_status = 'unpriced_no_rate'
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at <= p_to)
    and (v_scope <> 'org' or e.organization_id = v_org)
    and (v_scope <> 'self' or e.user_id = v_actor)
  group by 1, 2, 3
  order by 4 desc;
end;
$$;

revoke all on function public.ai_usage_missing_rates(timestamptz, timestamptz) from public;
grant execute on function public.ai_usage_missing_rates(timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Semilla de tarifas. Debe coincidir con src/domain/usage/pricing.js
-- (lo verifica scripts/verify-ai-usage-pricing.js).
-- ---------------------------------------------------------------------------
insert into public.ai_model_prices
  (provider, model, api_family, version, input_per_mtok, cached_input_per_mtok,
   output_per_mtok, per_minute_usd, source_url, source_captured_at)
values
  ('openai', 'gpt-4.1',            'chat_completions', '2026-08-04', 2.00, 0.50, 8.00,  null, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4.1-mini',       'chat_completions', '2026-08-04', 0.40, 0.10, 1.60,  null, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4.1-nano',       'chat_completions', '2026-08-04', 0.10, 0.025, 0.40, null, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4o',             'chat_completions', '2026-08-04', 2.50, 1.25, 10.00, null, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4o-mini',        'chat_completions', '2026-08-04', 0.15, 0.075, 0.60, null, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4o-transcribe',      'transcription', '2026-08-04', 2.50, null, 10.00, 0.006, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('openai', 'gpt-4o-mini-transcribe', 'transcription', '2026-08-04', 1.25, null, 5.00,  0.003, 'https://developers.openai.com/api/docs/pricing', '2026-08-04'),
  ('anthropic', 'claude-opus-5',    'messages', '2026-08-04', 5.00, null, 25.00, null, 'https://platform.claude.com/docs/en/pricing', '2026-08-04'),
  ('anthropic', 'claude-sonnet-5',  'messages', '2026-08-04', 3.00, null, 15.00, null, 'https://platform.claude.com/docs/en/pricing', '2026-08-04'),
  ('anthropic', 'claude-sonnet-4-6','messages', '2026-08-04', 3.00, null, 15.00, null, 'https://platform.claude.com/docs/en/pricing', '2026-08-04'),
  ('anthropic', 'claude-haiku-4-5', 'messages', '2026-08-04', 1.00, null,  5.00, null, 'https://platform.claude.com/docs/en/pricing', '2026-08-04'),
  ('google', 'gemini-2.5-flash',    'chat_completions', '2026-08-04', 0.30, 0.075, 2.50, null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-04'),
  ('google', 'gemini-2.5-pro',      'chat_completions', '2026-08-04', 1.25, 0.3125, 10.00, null, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-04'),
  ('deepgram', 'nova-3', 'transcription', '2026-08-04', null, null, null, 0.0043, 'https://deepgram.com/pricing', '2026-08-04'),
  ('deepgram', 'nova-2', 'transcription', '2026-08-04', null, null, null, 0.0043, 'https://deepgram.com/pricing', '2026-08-04')
on conflict (provider, model, api_family, version) do nothing;

-- ---------------------------------------------------------------------------
-- Defensa en profundidad: revocar los permisos de tabla que Supabase concede
-- por defecto a anon/authenticated en `public`.
--
-- RLS ya bloquea las filas (no hay política de escritura, y el alcance devuelve
-- 'none' para anónimos), pero dejar el GRANT puesto significaría que un fallo
-- futuro en una política bastaría para escribir o leer. Dos cerraduras, no una.
-- Se vuelve a conceder solo el SELECT que la política necesita.
-- ---------------------------------------------------------------------------
revoke all on table public.ai_usage_events from anon, authenticated;
revoke all on table public.ai_model_prices from anon, authenticated;

grant select on table public.ai_usage_events to authenticated;
grant select on table public.ai_model_prices to authenticated;

-- `revoke all ... from public` NO revoca de `anon`: Supabase le concede EXECUTE
-- por separado con default privileges. Sin esto, cualquiera con la anon key
-- podría invocar las RPC vía /rest/v1/rpc/... No devolverían datos —el alcance
-- responde 'none' a los anónimos— pero eso dejaría la seguridad colgando de UNA
-- sola comprobación dentro de la función. Se cierra también la puerta.
revoke execute on function private.ai_usage_scope() from anon;
revoke execute on function public.ai_usage_summary(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]) from anon;
revoke execute on function public.ai_usage_series(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[]) from anon;
revoke execute on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer) from anon;
revoke execute on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer) from anon;
revoke execute on function public.ai_usage_missing_rates(timestamptz, timestamptz) from anon;
