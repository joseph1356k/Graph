-- Pruebas de integración de graph_note_exports contra Postgres REAL.
--
-- Cubren lo que un fake en memoria no puede demostrar: FOR UPDATE SKIP LOCKED,
-- la restricción UNIQUE que da la idempotencia, el trigger de inmutabilidad de
-- Notes, las políticas de RLS y la transacción que mueve la consulta a
-- 'exportada'. Cada bloque falla con excepción; el runner corre con
-- ON_ERROR_STOP=1.
--
-- Lanzar con: node scripts/verify-note-exports-db.js

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Datos base: un médico con su organización, un paciente y una nota firmada.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'medico@itsmiracleai.com'),
  ('22222222-2222-4222-8222-222222222222', 'otro.medico@itsmiracleai.com');

insert into public.organizations (id, name, kind) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Clínica Miracle', 'institution');

insert into public.profiles (id, email, full_name, role, organization_id) values
  ('11111111-1111-4111-8111-111111111111', 'medico@itsmiracleai.com', 'Dra. Ruiz', 'medico', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'otro.medico@itsmiracleai.com', 'Dr. Otro', 'medico', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.patients (id, organization_id, created_by, nombre) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Paciente Prueba');

-- Cuatro consultas firmadas: una principal + tres para FIFO/concurrencia.
insert into public.consultations (id, organization_id, medico_id, patient_id, estado, resumen, note, codigos, firma)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aprobada', 'Lumbalgia mecánica.',
   '[{"key":"motivo","content":"Dolor lumbar"}]'::jsonb, '[{"code":"M54.5"}]'::jsonb,
   '{"por":"Dra. Ruiz","fecha":"2026-07-27T10:00:00.000Z","hash":"deadbeef"}'::jsonb),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   null, 'aprobada', 'Segunda', '[]'::jsonb, '[]'::jsonb, '{"hash":"h2"}'::jsonb),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd03', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   null, 'aprobada', 'Tercera', '[]'::jsonb, '[]'::jsonb, '{"hash":"h3"}'::jsonb),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd04', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   null, 'borrador', 'Borrador sin firmar', '[]'::jsonb, '[]'::jsonb, null);

-- Helper: crea un trabajo de exportación (lo que hace Graph con service-role).
create or replace function pg_temp.new_export(p_consultation uuid, p_status text default 'pending')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.graph_note_exports
    (consultation_id, organization_id, doctor_id, requested_by, workflow_id, status, payload, payload_hash)
  values
    (p_consultation, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
     'wf-sap-hc', p_status, '{"rendered_text":"MOTIVO:\nDolor lumbar"}'::jsonb, 'deadbeef')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count from public.graph_claim_next_note_export('exec-1');
  assert v_count = 0, 'cola vacía debe devolver 0 filas, devolvió ' || v_count;
  raise notice 'ok  claim sobre cola vacía no devuelve trabajo (204 en el API)';
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_job public.graph_note_exports;
  v_count int;
begin
  v_id := pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd01');

  select * into v_job from public.graph_claim_next_note_export('exec-1');
  assert v_job.id = v_id, 'el claim debe devolver el trabajo pendiente';
  assert v_job.status = 'claimed', 'status esperado claimed, fue ' || v_job.status;
  assert v_job.attempts = 1, 'attempts esperado 1, fue ' || v_job.attempts;
  assert v_job.claimed_by = 'exec-1', 'claimed_by no se guardó';
  assert v_job.claimed_at is not null, 'claimed_at debe quedar sellado';
  assert v_job.lease_expires_at > now(), 'el lease debe quedar en el futuro';
  assert v_job.attempt_history @> '[{"event":"claimed","attempt":1}]'::jsonb,
    'el historial debe registrar el claim: ' || v_job.attempt_history::text;
  raise notice 'ok  claim toma el trabajo, sella lease, sube attempts y deja historial';

  -- Un trabajo con lease vigente NO es re-reclamable.
  select count(*) into v_count from public.graph_claim_next_note_export('exec-2');
  assert v_count = 0, 'un trabajo claimed con lease vigente no debe re-reclamarse';
  raise notice 'ok  un trabajo con lease vigente no lo roba otro ejecutor';
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare v_job public.graph_note_exports;
begin
  -- Simula un ejecutor que se apagó: lease vencido.
  update public.graph_note_exports set lease_expires_at = now() - interval '1 minute'
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

  select * into v_job from public.graph_claim_next_note_export('exec-2');
  assert v_job.id is not null, 'un lease vencido debe volver a ser reclamable';
  assert v_job.claimed_by = 'exec-2', 'el nuevo ejecutor debe quedar como dueño';
  assert v_job.attempts = 2, 'attempts esperado 2, fue ' || v_job.attempts;
  raise notice 'ok  lease vencido = trabajo re-reclamable (no queda colgado para siempre)';
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare v_res jsonb;
begin
  -- El ejecutor que ya no es dueño no puede cerrar el trabajo.
  v_res := public.graph_report_note_export_result(
    (select id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'),
    'exec-1', 'ok', '{"folio":"HC-1"}'::jsonb);
  assert (v_res->>'ok')::boolean = false, 'un ejecutor ajeno no debe poder reportar';
  assert v_res->>'code' = 'EXPORT_NOT_OWNED', 'code esperado EXPORT_NOT_OWNED, fue ' || (v_res->>'code');
  raise notice 'ok  solo el ejecutor dueño del lease puede reportar el resultado';

  assert (select estado from public.consultations where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01') = 'aprobada',
    'un reporte rechazado NO puede tocar la consulta';
  raise notice 'ok  un reporte rechazado deja la consulta en aprobada';
end;
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

  -- Lease vencido: un resultado tardío no puede pisar una ejecución en curso.
  update public.graph_note_exports set lease_expires_at = now() - interval '1 second' where id = v_id;
  v_res := public.graph_report_note_export_result(v_id, 'exec-2', 'ok', '{"folio":"HC-TARDE"}'::jsonb);
  assert v_res->>'code' = 'EXPORT_LEASE_EXPIRED', 'code esperado EXPORT_LEASE_EXPIRED, fue ' || (v_res->>'code');
  assert (select estado from public.consultations where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01') = 'aprobada',
    'un resultado con lease vencido no puede exportar la consulta';
  raise notice 'ok  resultado con lease vencido se rechaza y no exporta';

  -- Devolvemos un lease válido para el caso feliz.
  update public.graph_note_exports set lease_expires_at = now() + interval '10 minutes' where id = v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- EL caso que importa: 'ok' confirmado ⇒ aprobada -> exportada, en una
-- transacción, con auditoría.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
  v_job public.graph_note_exports;
  v_audit int;
  v_detalle text;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

  v_res := public.graph_report_note_export_result(v_id, 'exec-2', 'ok', '{"outcome":"ok","folio":"HC-2026-001"}'::jsonb);
  assert (v_res->>'ok')::boolean = true, 'el resultado ok debe aplicarse';
  assert v_res->>'code' = 'RESULT_APPLIED', 'code esperado RESULT_APPLIED, fue ' || (v_res->>'code');
  assert (v_res->>'consultation_exported')::boolean = true, 'la consulta debió pasar a exportada';

  select * into v_job from public.graph_note_exports where id = v_id;
  assert v_job.status = 'completed', 'status esperado completed, fue ' || v_job.status;
  assert v_job.finished_at is not null, 'finished_at debe quedar sellado';
  assert v_job.lease_expires_at is null, 'el lease debe liberarse al terminar';
  assert v_job.error_code is null, 'un ok no deja error_code';

  assert (select estado from public.consultations where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01') = 'exportada',
    'la consulta debe quedar exportada SOLO aquí';
  raise notice 'ok  outcome ok mueve la consulta aprobada -> exportada';

  select count(*), max(detalle) into v_audit, v_detalle from public.audit_events
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
     and accion = 'Nota exportada a HC (automática)';
  assert v_audit = 1, 'debe haber exactamente 1 evento de auditoría, hubo ' || v_audit;
  assert v_detalle like '%folio HC-2026-001%', 'el folio debe quedar en auditoría: ' || v_detalle;
  raise notice 'ok  la exportación queda auditada con su folio';
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotencia del result: el cliente DEBE reintentar hasta recibir ack, así
-- que los reenvíos son normales y no pueden duplicar nada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
  v_audit int;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

  v_res := public.graph_report_note_export_result(v_id, 'exec-2', 'ok', '{"folio":"HC-2026-001"}'::jsonb);
  assert (v_res->>'ok')::boolean = true, 'un reenvío debe recibir ack';
  assert (v_res->>'idempotent')::boolean = true, 'el reenvío debe marcarse idempotente';
  assert v_res->>'code' = 'ALREADY_TERMINAL', 'code esperado ALREADY_TERMINAL, fue ' || (v_res->>'code');

  select count(*) into v_audit from public.audit_events
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
     and accion = 'Nota exportada a HC (automática)';
  assert v_audit = 1, 'el reenvío no puede duplicar auditoría, hubo ' || v_audit;
  raise notice 'ok  reenviar el mismo resultado devuelve ack sin re-transicionar ni duplicar auditoría';
end;
$$;

-- ---------------------------------------------------------------------------
-- Un trabajo ya terminal no se puede reclamar de nuevo.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count from public.graph_claim_next_note_export('exec-3');
  assert v_count = 0, 'un trabajo completed no vuelve a la cola';
  raise notice 'ok  un trabajo completado no vuelve a la cola';
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotencia de la CREACIÓN: una consulta = un trabajo.
-- ---------------------------------------------------------------------------
do $$
declare v_sqlstate text;
begin
  begin
    perform pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd01');
    assert false, 'una segunda exportación de la misma consulta debe fallar';
  exception when unique_violation then
    v_sqlstate := sqlstate;
  end;
  assert v_sqlstate = '23505', 'se esperaba unique_violation (23505), fue ' || coalesce(v_sqlstate, 'ninguno');
  raise notice 'ok  UNIQUE(consultation_id): dos solicitudes = un solo trabajo (idempotencia)';
end;
$$;

-- ---------------------------------------------------------------------------
-- outcome 'error' ⇒ failed y la consulta SIGUE aprobada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
  v_job public.graph_note_exports;
begin
  v_id := pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd02');
  perform public.graph_claim_next_note_export('exec-1');

  v_res := public.graph_report_note_export_result(
    v_id, 'exec-1', 'error', '{"outcome":"error"}'::jsonb, 'HIS_LOGIN_FAILED');
  assert v_res->>'status' = 'failed', 'status esperado failed, fue ' || (v_res->>'status');
  assert (v_res->>'consultation_exported')::boolean = false, 'un error no exporta nada';

  select * into v_job from public.graph_note_exports where id = v_id;
  assert v_job.error_code = 'HIS_LOGIN_FAILED', 'error_code no se guardó';
  assert v_job.attempt_history @> '[{"event":"result","outcome":"error"}]'::jsonb,
    'el historial debe registrar el error';
  assert (select estado from public.consultations where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02') = 'aprobada',
    'tras un error la consulta SIGUE aprobada';
  raise notice 'ok  outcome error ⇒ failed, con error_code e historial, y la consulta sigue aprobada';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retry: misma fila, historial conservado.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
  v_job public.graph_note_exports;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';

  v_res := public.graph_retry_note_export(v_id, '11111111-1111-4111-8111-111111111111');
  assert (v_res->>'ok')::boolean = true, 'el retry desde failed debe funcionar';
  assert v_res->>'status' = 'pending', 'tras retry el status debe ser pending';

  select * into v_job from public.graph_note_exports where id = v_id;
  assert v_job.attempts = 1, 'attempts se conserva como historia, fue ' || v_job.attempts;
  assert v_job.error_code is null, 'el retry limpia error_code';
  assert v_job.result is null, 'el retry limpia result';
  assert v_job.claimed_by is null, 'el retry libera el ejecutor';
  assert v_job.attempt_history @> '[{"event":"retry","from_status":"failed"}]'::jsonb,
    'el historial debe registrar el retry';
  assert jsonb_array_length(v_job.attempt_history) = 3,
    'historial esperado de 3 entradas (claim, result, retry), fue ' || jsonb_array_length(v_job.attempt_history);
  raise notice 'ok  retry reencola la MISMA fila, conserva attempts y acumula historial';

  -- Idempotente: reintentar algo ya en cola no rompe.
  v_res := public.graph_retry_note_export(v_id, null);
  assert (v_res->>'idempotent')::boolean = true, 'retry sobre pending debe ser idempotente';
  raise notice 'ok  retry sobre un trabajo ya en cola es idempotente';
end;
$$;

-- ---------------------------------------------------------------------------
-- No se reintenta lo que ya está exportado.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
  update public.graph_note_exports set status = 'failed' where id = v_id;

  v_res := public.graph_retry_note_export(v_id, null);
  assert (v_res->>'ok')::boolean = false, 'no se reintenta sobre una consulta ya exportada';
  assert v_res->>'code' = 'CONSULTATION_NOT_APPROVED', 'code esperado CONSULTATION_NOT_APPROVED, fue ' || (v_res->>'code');
  raise notice 'ok  retry re-valida la consulta: si ya está exportada, no reencola';

  update public.graph_note_exports set status = 'completed' where id = v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar: solo desde pending.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_res jsonb;
begin
  -- Vacía la cola viva: este bloque necesita que el claim de más abajo se lleve
  -- SU trabajo, no uno que quedó pendiente de un bloque anterior (el claim es
  -- FIFO global).
  update public.graph_note_exports
     set status = 'completed', lease_expires_at = null
   where status in ('pending', 'claimed');

  v_id := pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd03');

  v_res := public.graph_cancel_note_export(v_id, '11111111-1111-4111-8111-111111111111');
  assert v_res->>'status' = 'cancelled', 'cancelar desde pending debe funcionar';
  v_res := public.graph_cancel_note_export(v_id, null);
  assert (v_res->>'idempotent')::boolean = true, 'cancelar dos veces es idempotente';
  raise notice 'ok  cancel desde pending funciona y es idempotente';

  -- Un trabajo en ejecución no se cancela (no hay cancelación remota de SAP).
  v_res := public.graph_retry_note_export(v_id, null);
  assert (v_res->>'ok')::boolean = true, 'un cancelado debe poder reencolarse';
  perform public.graph_claim_next_note_export('exec-9');
  v_res := public.graph_cancel_note_export(v_id, null);
  assert v_res->>'code' = 'EXPORT_NOT_CANCELLABLE', 'code esperado EXPORT_NOT_CANCELLABLE, fue ' || (v_res->>'code');
  raise notice 'ok  un trabajo ya reclamado no se puede cancelar (sin botones placebo)';
end;
$$;

-- ---------------------------------------------------------------------------
-- Techo de intentos.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_count int;
begin
  select id into v_id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03';
  update public.graph_note_exports
     set status = 'pending', attempts = 3, claimed_by = null, lease_expires_at = null
   where id = v_id;
  update public.graph_note_exports set status = 'completed'
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';

  select count(*) into v_count from public.graph_claim_next_note_export('exec-1');
  assert v_count = 0, 'con attempts >= 3 el trabajo no debe reclamarse';
  raise notice 'ok  el techo de intentos evita que un trabajo roto se reclame para siempre';

  -- Con un techo mayor sí se reclama: el máximo es política del claim, no del dato.
  select count(*) into v_count from public.graph_claim_next_note_export('exec-1', 600, 5);
  assert v_count = 1, 'con p_max_attempts=5 debe reclamarse';
  raise notice 'ok  el techo de intentos es parámetro del claim, no un estado muerto en la fila';
end;
$$;

-- ---------------------------------------------------------------------------
-- Estados y hash_source válidos.
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  begin
    update public.graph_note_exports set status = 'inventado'
     where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03';
  exception when check_violation then
    v_ok := true;
  end;
  assert v_ok, 'el CHECK de status debe rechazar estados inventados';

  v_ok := false;
  begin
    update public.graph_note_exports set hash_source = 'confia_en_mi'
     where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03';
  exception when check_violation then
    v_ok := true;
  end;
  assert v_ok, 'el CHECK de hash_source debe rechazar valores fuera del contrato';
  raise notice 'ok  los CHECK de status y hash_source protegen el contrato';
end;
$$;

-- ---------------------------------------------------------------------------
-- outcome inválido.
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.graph_report_note_export_result(
      (select id from public.graph_note_exports where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03'),
      'exec-1', 'casi_ok', '{}'::jsonb);
  exception when others then
    v_ok := sqlerrm like '%GRAPH_RESULT_INVALID_OUTCOME%';
  end;
  assert v_ok, 'un outcome fuera del contrato debe rechazarse';
  raise notice 'ok  outcome fuera del contrato se rechaza';
end;
$$;

-- ---------------------------------------------------------------------------
-- FIFO.
-- ---------------------------------------------------------------------------
do $$
declare
  v_first uuid;
  v_second uuid;
  v_claimed uuid;
begin
  delete from public.graph_note_exports;
  v_first := pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd02');
  perform pg_sleep(0.01);
  v_second := pg_temp.new_export('dddddddd-dddd-4ddd-8ddd-dddddddddd03');

  select id into v_claimed from public.graph_claim_next_note_export('exec-1');
  assert v_claimed = v_first, 'el claim debe respetar FIFO por created_at';
  select id into v_claimed from public.graph_claim_next_note_export('exec-2');
  assert v_claimed = v_second, 'el segundo claim debe llevarse el segundo trabajo';
  raise notice 'ok  el claim reparte en orden FIFO y nunca entrega el mismo trabajo dos veces';
end;
$$;

-- ---------------------------------------------------------------------------
-- Purga de PHI.
-- ---------------------------------------------------------------------------
do $$
declare
  v_purged int;
  v_payload jsonb;
begin
  update public.graph_note_exports
     set status = 'completed', finished_at = now() - interval '100 hours'
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';

  v_purged := public.graph_purge_note_export_payloads(72);
  assert v_purged >= 1, 'la purga debió limpiar al menos un payload';

  select payload into v_payload from public.graph_note_exports
   where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
  assert v_payload = '{}'::jsonb, 'el payload debe quedar vacío tras la purga';
  assert (select purged_at is not null from public.graph_note_exports
           where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02'), 'purged_at debe sellarse';
  assert (select status from public.graph_note_exports
           where consultation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02') = 'completed',
    'la purga no cambia el estado ni la historia';
  raise notice 'ok  la purga borra el PHI del payload y conserva el historial';
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: el médico ve su exportación; otro médico no. Nadie escribe.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from public.graph_note_exports;
  assert v_count > 0, 'el médico dueño debe ver sus exportaciones (lo necesita Realtime)';
  raise notice 'ok  RLS: el médico dueño lee el estado de su exportación';
end;
$$;
do $$
declare v_ok boolean := false;
begin
  begin
    update public.graph_note_exports set status = 'completed';
    -- Sin policy de UPDATE, PostgREST/PostgreSQL no afecta ninguna fila.
    v_ok := not found;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  assert v_ok, 'un usuario autenticado NO puede mover el estado de una exportación';
  raise notice 'ok  RLS: un médico no puede auto-marcar su exportación como completada';
end;
$$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from public.graph_note_exports;
  assert v_count = 0, 'otro médico NO debe ver exportaciones ajenas, vio ' || v_count;
  raise notice 'ok  RLS: otro médico no ve exportaciones que no son suyas';
end;
$$;
rollback;

-- ---------------------------------------------------------------------------
-- Realtime y grants.
-- ---------------------------------------------------------------------------
do $$
begin
  assert exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'graph_note_exports'
  ), 'la tabla debe estar en la publicación de Realtime';
  raise notice 'ok  la tabla está publicada para Realtime';

  assert not has_function_privilege('authenticated', 'public.graph_claim_next_note_export(text,int,int)', 'execute'),
    'authenticated NO puede ejecutar el claim';
  assert not has_function_privilege('authenticated',
    'public.graph_report_note_export_result(uuid,text,text,jsonb,text)', 'execute'),
    'authenticated NO puede reportar resultados (ni marcar exportada)';
  assert has_function_privilege('service_role', 'public.graph_claim_next_note_export(text,int,int)', 'execute'),
    'service_role sí ejecuta el claim';
  raise notice 'ok  solo service_role (Graph) puede reclamar trabajos y confirmar exportaciones';
end;
$$;

-- ---------------------------------------------------------------------------
-- El trigger de inmutabilidad de Notes sigue vigente para todo lo demás.
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  begin
    update public.consultations set estado = 'borrador'
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
  exception when others then
    v_ok := sqlerrm like '%CONSULTATION_IMMUTABLE%';
  end;
  assert v_ok, 'el trigger debe seguir bloqueando exportada -> borrador';
  raise notice 'ok  la exportación no debilita la inmutabilidad de la nota firmada';
end;
$$;

select '── pruebas SQL de graph_note_exports: OK ──' as resultado;
