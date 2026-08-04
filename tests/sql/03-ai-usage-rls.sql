-- Aislamiento entre organizaciones del ledger de consumo de IA.
--
-- Esto NO se puede probar en Node: lo aplica Postgres con RLS y con la función
-- de alcance. Probarlo desde el backend solo demostraría que el backend hace lo
-- que dice, no que la base impida lo demás — que es justo la garantía que
-- importa cuando alguien manipula un filtro o llama a la RPC por su cuenta.
--
-- Cómo correrlo (contra una base con las migraciones aplicadas):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/03-ai-usage-rls.sql
--
-- Sale con error en la primera afirmación que falle.

begin;

-- ---------------------------------------------------------------------------
-- Datos de prueba: dos organizaciones, tres personas.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, kind)
values
  ('0a000000-0000-4000-8000-00000000000a', 'Hospital A (test)', 'institution'),
  ('0b000000-0000-4000-8000-00000000000b', 'Hospital B (test)', 'institution');

-- Los perfiles cuelgan de auth.users; se insertan directo para no depender del
-- flujo de registro. El trigger de creación no aplica a inserts manuales.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('0a000001-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-a@test.local', '', now(), now(), now()),
  ('0a000002-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'medico-a@test.local', '', now(), now(), now()),
  ('0b000001-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-b@test.local', '', now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, organization_id)
values
  ('0a000001-0000-4000-8000-00000000000a', 'admin-a@test.local',  'Admin A',  'admin',  '0a000000-0000-4000-8000-00000000000a'),
  ('0a000002-0000-4000-8000-00000000000a', 'medico-a@test.local', 'Medico A', 'medico', '0a000000-0000-4000-8000-00000000000a'),
  ('0b000001-0000-4000-8000-00000000000b', 'admin-b@test.local',  'Admin B',  'admin',  '0b000000-0000-4000-8000-00000000000b');

-- Consumo: dos eventos de A (uno por persona), uno de B, uno del sistema.
insert into public.ai_usage_events
  (idempotency_key, occurred_at, organization_id, user_id, actor_type, attribution_source,
   app, feature, provider, requested_model, input_tokens, output_tokens, total_tokens,
   cost_usd, cost_status, status, environment)
values
  ('test-a-admin',  now(), '0a000000-0000-4000-8000-00000000000a', '0a000001-0000-4000-8000-00000000000a',
   'user', 'session', 'web_app', 'hoja_en_blanco', 'openai', 'gpt-4.1', 1000, 200, 1200, 0.0036, 'priced', 'ok', 'test'),
  ('test-a-medico', now(), '0a000000-0000-4000-8000-00000000000a', '0a000002-0000-4000-8000-00000000000a',
   'user', 'api_key', 'windows_app', 'biopsia', 'openai', 'gpt-4o', 800, 150, 950, 0.0035, 'priced', 'ok', 'test'),
  ('test-b-admin',  now(), '0b000000-0000-4000-8000-00000000000b', '0b000001-0000-4000-8000-00000000000b',
   'user', 'session', 'web_app', 'asistente', 'openai', 'gpt-4o-mini', 500, 100, 600, 0.0001, 'priced', 'ok', 'test'),
  ('test-system',   now(), null, null,
   'system', 'internal', 'system', 'note_rescue', 'openai', 'gpt-4o-mini', 400, 90, 490, 0.0001, 'priced', 'ok', 'test');

-- ---------------------------------------------------------------------------
-- Helper de afirmación.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert_eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FALLO — %: esperado %, obtenido %', label, expected, actual;
  end if;
  raise notice '  ok  %', label;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1 · Admin institucional de A: ve SU organización y nada más.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"0a000001-0000-4000-8000-00000000000a","role":"authenticated"}';

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events where environment = 'test'),
  2, 'admin de A ve los 2 eventos de su organización (RLS directa)');

select pg_temp.assert_eq(
  (select total_events from public.ai_usage_summary(null, null) limit 1),
  2, 'la RPC de resumen devuelve solo la organización de A');

-- El intento explícito de mirar la organización B: el filtro se aplica DENTRO
-- del alcance, así que no amplía nada. Esta es la prueba que pide el enunciado.
select pg_temp.assert_eq(
  coalesce((select total_events from public.ai_usage_summary(
    null, null, '0b000000-0000-4000-8000-00000000000b') limit 1), 0),
  0, 'el admin de A NO puede consultar la organización B manipulando el filtro');

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events_page(null, null, null, null,
     null, null, null, null, null, null, 100, 0)),
  2, 'la tabla de detalle también queda acotada a la organización de A');

-- ---------------------------------------------------------------------------
-- 2 · Médico de A: solo sus propios eventos.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"0a000002-0000-4000-8000-00000000000a","role":"authenticated"}';

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events where environment = 'test'),
  1, 'un médico ve solo su propio consumo, no el de toda la organización');

select pg_temp.assert_eq(
  coalesce((select total_events from public.ai_usage_summary(
    null, null, null, '0a000001-0000-4000-8000-00000000000a') limit 1), 0),
  0, 'un médico no puede consultar el consumo de otro compañero');

-- ---------------------------------------------------------------------------
-- 3 · Admin de B: ve lo suyo y nunca lo de A.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"0b000001-0000-4000-8000-00000000000b","role":"authenticated"}';

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events where environment = 'test'),
  1, 'admin de B ve solo su organización');

select pg_temp.assert_eq(
  coalesce((select total_events from public.ai_usage_summary(
    null, null, '0a000000-0000-4000-8000-00000000000a') limit 1), 0),
  0, 'la organización B NO puede consultar ninguno de los eventos de A');

-- ---------------------------------------------------------------------------
-- 4 · Nadie autenticado puede escribir el ledger.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.ai_usage_events (idempotency_key, provider, requested_model)
    values ('intento-cliente', 'openai', 'gpt-4o');
    raise exception 'FALLO — un usuario autenticado pudo inyectar consumo falso';
  exception
    when insufficient_privilege or check_violation then
      raise notice '  ok  un cliente autenticado NO puede escribir en el ledger';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5 · Anónimo: nada.
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events),
  0, 'un anónimo no ve ningún evento');

-- ---------------------------------------------------------------------------
-- 6 · El backend (service-role) sí ve todo: es el operador interno.
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims = '{"role":"service_role"}';

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_events where environment = 'test'),
  4, 'el backend ve los 4 eventos, incluido el del sistema sin usuario');

-- ---------------------------------------------------------------------------
-- 7 · Idempotencia: la clave única impide duplicar el mismo evento.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.ai_usage_events (idempotency_key, provider, requested_model)
    values ('test-a-admin', 'openai', 'gpt-4.1');
    raise exception 'FALLO — se pudo duplicar un evento con la misma clave';
  exception
    when unique_violation then
      raise notice '  ok  reescribir el mismo evento choca contra la clave de idempotencia';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8 · Los desgloses separan aplicación de funcionalidad.
-- ---------------------------------------------------------------------------
select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_breakdown('app') where dimension_key in ('web_app','windows_app','system')),
  3, 'el desglose por aplicación distingue web / windows / system');

select pg_temp.assert_eq(
  (select count(*) from public.ai_usage_breakdown('feature')
     where dimension_key in ('hoja_en_blanco','biopsia','asistente','note_rescue')),
  4, 'el desglose por funcionalidad es independiente del de aplicación');

\echo ''
\echo '✅ Aislamiento y contabilidad del ledger: todas las comprobaciones OK.'

-- Nada de esto se persiste: es una prueba, no una carga de datos.
rollback;
