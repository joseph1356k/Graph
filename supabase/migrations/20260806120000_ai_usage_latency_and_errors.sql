-- Percentiles de latencia y desglose por código de error.
--
-- POR QUÉ NO BASTA LA MEDIA. El panel mostraba `avg_latency_ms` y una tasa de
-- error global. Una media esconde exactamente lo que se quiere ver: si de cien
-- llamadas noventa tardan 800 ms y diez tardan doce segundos, la media dice
-- 1,9 s y nadie se entera de que hay un modelo dejando colgado al médico. El
-- p95 sí lo dice. Se añaden p50 y p95 por fila de desglose, de modo que se
-- pueda comparar proveedor contra proveedor y modelo contra modelo.
--
-- POR QUÉ `error_code` ES UNA DIMENSIÓN APARTE. El resto de dimensiones agrupa
-- TODOS los eventos; agrupar por código de error haría lo mismo y el 97 % caería
-- en un cajón vacío que no significa nada. Aquí la dimensión se acota por
-- dentro a `status = 'error'`: la pregunta que responde no es «cómo se reparte
-- el consumo» sino «de qué se está muriendo», y son preguntas distintas.
--
-- `percentile_cont` es una función de agregado ordenado y no admite `filter`
-- con la misma sintaxis que `count`; se le pasa el valor ya filtrado con un
-- `case`, que descarta los nulos por sí solo.

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
  cached_input_tokens bigint,
  cost_usd numeric,
  error_events bigint,
  avg_latency_ms numeric,
  display_name text,
  display_detail text,
  p50_latency_ms numeric,
  p95_latency_ms numeric
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
  if v_dimension not in ('app', 'feature', 'provider', 'model', 'user', 'organization',
                         'status', 'environment', 'actor_type', 'error_code') then
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
        when 'error_code' then coalesce(nullif(e.error_code, ''), '(sin codigo)')
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
      coalesce(sum(e.cached_input_tokens), 0)::bigint as n_cached,
      coalesce(sum(e.cost_usd), 0)::numeric as n_cost,
      count(*) filter (where e.status = 'error')::bigint as n_errors,
      round(coalesce(avg(e.latency_ms), 0)::numeric, 1) as n_latency,
      (array_agg(e.app order by e.total_tokens desc))[1] as k_top_app,
      round(coalesce(percentile_cont(0.5) within group (
        order by (case when e.latency_ms > 0 then e.latency_ms end)), 0)::numeric, 0) as n_p50,
      round(coalesce(percentile_cont(0.95) within group (
        order by (case when e.latency_ms > 0 then e.latency_ms end)), 0)::numeric, 0) as n_p95
    from public.ai_usage_events e
    where (p_from is null or e.occurred_at >= p_from)
      and (p_to is null or e.occurred_at <= p_to)
      and (v_scope <> 'org' or e.organization_id = v_org)
      and (v_scope <> 'self' or e.user_id = v_actor)
      -- La dimensión de códigos de error solo mira lo que falló.
      and (v_dimension <> 'error_code' or e.status = 'error')
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
    a.n_cached,
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
    end::text as display_detail,
    a.n_p50,
    a.n_p95
  from agregado a
  left join public.profiles p
    on v_dimension = 'user' and p.id = a.k_id
  left join public.organizations o
    on v_dimension = 'organization' and o.id = a.k_id
  -- Los códigos de error se ordenan por frecuencia; el resto por consumo. Un
  -- error caro pero raro importa menos que uno barato que pasa todo el rato.
  order by
    case when v_dimension = 'error_code' then a.n_events else a.n_total end desc,
    a.n_cost desc
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
