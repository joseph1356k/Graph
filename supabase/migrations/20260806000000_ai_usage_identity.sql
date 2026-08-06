-- Identidad legible en el panel de consumo.
--
-- EL PROBLEMA. El ledger guarda `user_id` y `organization_id` como UUID, que es
-- lo correcto para un libro de contabilidad: sobrevive al borrado de la cuenta y
-- no duplica datos personales. Pero el panel enseñaba «f30d6246…», con lo que la
-- pregunta que justifica el panel entero — «¿quién gastó esto?» — quedaba sin
-- responder, y filtrar por persona exigía pegar un UUID a mano.
--
-- LA DECISIÓN: RESOLVER EN LECTURA, NO GUARDAR EL NOMBRE.
-- El nombre se busca en `profiles` en el momento de consultar, no se copia al
-- evento. Tres consecuencias, todas buscadas:
--   · El ledger sigue sin contener datos personales: solo referencias internas.
--   · Si alguien cambia de nombre, el histórico se lee con el nombre de hoy, sin
--     reescribir nada.
--   · Si se borra el perfil, el consumo NO desaparece: queda con su UUID y se
--     muestra como «Usuario a1b2c3d4». Perder la contabilidad por borrar una
--     cuenta sería peor que no saber el nombre.
--
-- POR QUÉ ESTO NO AMPLÍA LO QUE NADIE PUEDE VER. El join ocurre DESPUÉS del
-- filtro de alcance, sobre las filas que quien consulta ya tenía derecho a ver.
-- Un admin de la organización A no puede hacer aparecer el nombre de nadie de la
-- B, porque para empezar no tiene ni una fila de la B sobre la que unir. El
-- alcance sigue siendo el de `private.ai_usage_scope()`, sin excepciones.
--
-- Se recrean dos funciones en vez de alterarlas: cambiar el tipo devuelto exige
-- `drop`, y con él hay que rehacer los permisos — incluido el `revoke` a `anon`,
-- que si se olvida vuelve a abrir lo que ya se cerró una vez.

-- ---------------------------------------------------------------------------
-- 1 · Desgloses con nombre.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
);

create function public.ai_usage_breakdown(
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
  avg_latency_ms numeric,
  display_name text,
  display_detail text
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
  with agregado as (
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
      end as k,
      case v_dimension
        when 'user' then e.user_id
        when 'organization' then e.organization_id
        else null::uuid
      end as k_id,
      count(*)::bigint as n_events,
      coalesce(sum(e.input_tokens), 0)::bigint as n_input,
      coalesce(sum(e.output_tokens), 0)::bigint as n_output,
      coalesce(sum(e.total_tokens), 0)::bigint as n_total,
      coalesce(sum(e.cost_usd), 0)::numeric as n_cost,
      count(*) filter (where e.status = 'error')::bigint as n_errors,
      round(coalesce(avg(e.latency_ms), 0)::numeric, 1) as n_latency,
      -- La app dominante de esa fila. Contesta «¿desde dónde gasta esta
      -- persona?» sin obligar a cruzar dos paneles a ojo.
      (array_agg(e.app order by e.total_tokens desc))[1] as k_top_app
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
  )
  select
    a.k,
    a.k_id,
    a.n_events,
    a.n_input,
    a.n_output,
    a.n_total,
    a.n_cost,
    a.n_errors,
    a.n_latency,
    case
      when v_dimension = 'user' and a.k_id is null then 'Sin usuario atribuido'
      when v_dimension = 'user' then coalesce(
        nullif(btrim(p.full_name), ''),
        nullif(btrim(p.email), ''),
        'Usuario ' || left(a.k_id::text, 8))
      when v_dimension = 'organization' and a.k_id is null then 'Sin organización'
      when v_dimension = 'organization' then coalesce(
        nullif(btrim(o.name), ''),
        'Organización ' || left(a.k_id::text, 8))
      else a.k
    end::text as display_name,
    case
      when v_dimension = 'user' then
        btrim(coalesce(nullif(btrim(p.email), '') || ' · ', '') || coalesce(a.k_top_app, ''))
      -- `kind` es un enum: hay que llevarlo a texto ANTES del coalesce, o el
      -- respaldo de cadena vacía se intenta convertir en un valor del enum.
      when v_dimension = 'organization' then coalesce(o.kind::text, '')
      else coalesce(a.k_top_app, '')
    end::text as display_detail
  from agregado a
  left join public.profiles p
    on v_dimension = 'user' and p.id = a.k_id
  left join public.organizations o
    on v_dimension = 'organization' and o.id = a.k_id
  order by a.n_total desc, a.n_cost desc
  limit v_limit;
end;
$$;

revoke all on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
) from public;
revoke execute on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
) from anon;
grant execute on function public.ai_usage_breakdown(
  text, timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Tabla de detalle con nombre.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
);

create function public.ai_usage_events_page(
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
  user_name text,
  user_email text,
  organization_name text,
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
    coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(btrim(p.email), ''),
      case when f.user_id is null then '' else 'Usuario ' || left(f.user_id::text, 8) end
    )::text as user_name,
    coalesce(nullif(btrim(p.email), ''), '')::text as user_email,
    coalesce(nullif(btrim(o.name), ''), '')::text as organization_name,
    (select count(*) from filtrados)::bigint
  from filtrados f
  left join public.profiles p on p.id = f.user_id
  left join public.organizations o on o.id = f.organization_id
  order by f.occurred_at desc, f.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
) from public;
revoke execute on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
) from anon;
grant execute on function public.ai_usage_events_page(
  timestamptz, timestamptz, uuid, uuid, text[], text[], text[], text[], text[], text[], integer, integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Facetas: qué personas y organizaciones se pueden elegir en los filtros.
-- ---------------------------------------------------------------------------
-- Se derivan del consumo que quien consulta YA puede ver, no del directorio de
-- usuarios. Es lo que hace que el desplegable no sea un canal para enumerar la
-- plantilla de otra institución: si no hay consumo visible de esa persona, no
-- aparece. Y como el alcance es el mismo del resto, tampoco sirve para adivinar
-- identidades cambiando el rango de fechas.
create or replace function public.ai_usage_facets(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  kind text,
  id uuid,
  label text,
  detail text,
  events bigint,
  total_tokens bigint,
  cost_usd numeric
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
  with visibles as (
    select e.*
    from public.ai_usage_events e
    where (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at <= p_to)
      and (v_scope <> 'org' or e.organization_id = v_org)
      and (v_scope <> 'self' or e.user_id = v_actor)
  ),
  personas as (
    select
      'user'::text as kind,
      v.user_id as id,
      count(*)::bigint as events,
      coalesce(sum(v.total_tokens), 0)::bigint as total_tokens,
      coalesce(sum(v.cost_usd), 0)::numeric as cost_usd
    from visibles v
    where v.user_id is not null
    group by v.user_id
  ),
  instituciones as (
    select
      'organization'::text as kind,
      v.organization_id as id,
      count(*)::bigint as events,
      coalesce(sum(v.total_tokens), 0)::bigint as total_tokens,
      coalesce(sum(v.cost_usd), 0)::numeric as cost_usd
    from visibles v
    where v.organization_id is not null
    group by v.organization_id
  )
  select
    x.kind,
    x.id,
    case x.kind
      when 'user' then coalesce(
        nullif(btrim(p.full_name), ''),
        nullif(btrim(p.email), ''),
        'Usuario ' || left(x.id::text, 8))
      else coalesce(nullif(btrim(o.name), ''), 'Organización ' || left(x.id::text, 8))
    end::text as label,
    case x.kind
      when 'user' then coalesce(nullif(btrim(p.email), ''), '')
      else coalesce(o.kind::text, '')
    end::text as detail,
    x.events,
    x.total_tokens,
    x.cost_usd
  from (select * from personas union all select * from instituciones) x
  left join public.profiles p on x.kind = 'user' and p.id = x.id
  left join public.organizations o on x.kind = 'organization' and o.id = x.id
  order by x.kind, x.total_tokens desc
  limit 500;
end;
$$;

revoke all on function public.ai_usage_facets(timestamptz, timestamptz) from public;
revoke execute on function public.ai_usage_facets(timestamptz, timestamptz) from anon;
grant execute on function public.ai_usage_facets(timestamptz, timestamptz)
  to authenticated, service_role;
