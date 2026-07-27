-- ============================================================================
-- graph_note_exports — cola durable de exportaciones de nota clínica al HIS.
--
-- El médico firma la nota en Miracle Notes y pulsa "Exportar a HC". Notes NO
-- marca nada como exportado: le pide a Graph un trabajo de exportación. Graph
-- valida (consulta aprobada + firmada, hash de la firma re-verificado contra la
-- versión realmente firmada), congela un snapshot y lo persiste aquí. Un
-- ejecutor de Operations (hoy el simulador `scripts/simulate-operations-executor.js`,
-- mañana el cliente Windows) reclama el trabajo por pull y reporta el resultado.
-- Solo un resultado 'ok' confirmado mueve la consulta de 'aprobada' a 'exportada'.
--
-- Patrón de acceso (espejo de graph_windows_*): el cliente ejecutor habla SOLO
-- con Graph (/api/v1, X-API-Key) y es Graph quien escribe aquí con service-role.
-- Por eso RLS está activado SIN políticas de escritura para authenticated: la
-- única política es de LECTURA, para que el médico dueño vea el estado de su
-- propia exportación (incluido Supabase Realtime).
--
-- Depende de tablas que crea el repo de Miracle Notes en el MISMO proyecto
-- Supabase (public.consultations, public.audit_events). Esta migración se aplica
-- después de las de Notes.
-- ============================================================================

create table if not exists public.graph_note_exports (
  id uuid primary key default gen_random_uuid(),
  -- Familia del trabajo. Hoy solo 'note_export'; deja la puerta abierta a otros
  -- trabajos ejecutables por el mismo carril claim/result sin migración.
  kind text not null default 'note_export',
  -- LA clave de idempotencia: una consulta = un trabajo de exportación. Dos
  -- clics (o dos pestañas) chocan aquí, no crean trabajos duplicados.
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  -- Copiados de la consulta al crear el trabajo: sostienen la política de
  -- lectura sin tener que hacer join contra consultations en cada policy.
  organization_id uuid not null,
  doctor_id uuid not null,
  -- Quién pulsó "Exportar" (puede no ser el médico tratante: admin/supervisor).
  requested_by uuid not null,
  -- Workflow de automatización a ejecutar en el HIS. En el piloto, uno por org.
  workflow_id text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'needs_doctor', 'failed', 'cancelled')),
  -- ++ en cada claim. El máximo se aplica en el claim, no con un CHECK: el
  -- historial de intentos se conserva.
  attempts int not null default 0,
  -- Identidad del ejecutor que tiene el trabajo (email registrado en el piloto).
  claimed_by text,
  -- claim + lease. Vencido ⇒ re-reclamable (no es un estado, es una condición).
  lease_expires_at timestamptz,
  -- Snapshot PHI autocontenido: lo que se va a escribir en el HIS. Purgable.
  payload jsonb not null default '{}'::jsonb,
  -- Hash del contenido firmado (contrato compartido con Notes).
  payload_hash text not null,
  -- 'firma': el hash venía en consultations.firma.hash y se re-verificó.
  -- 'computed_at_export': la nota no traía hash (notas históricas) y se calculó
  -- al exportar — queda explícito en auditoría que no hubo re-verificación.
  hash_source text not null default 'firma'
    check (hash_source in ('firma', 'computed_at_export')),
  -- {outcome, folio?, unresolved_fields?[labels], detail_code?}
  result jsonb,
  -- Tipado y sin PHI.
  error_code text,
  -- Historial append-only de intentos, resultados y errores (sin PHI): cada
  -- claim/result/retry/cancel añade una entrada. Es la bitácora clínico-operativa
  -- de "qué se intentó y qué falló".
  attempt_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Marca de purga del payload (PHI) tras el estado terminal.
  purged_at timestamptz,
  constraint graph_note_exports_consultation_unique unique (consultation_id)
);

alter table public.graph_note_exports enable row level security;

-- Claim FIFO: solo recorre la cola viva, no la historia completa.
create index if not exists graph_note_exports_pending_idx
  on public.graph_note_exports (created_at)
  where status = 'pending';
-- Recuperación de leases vencidos.
create index if not exists graph_note_exports_lease_idx
  on public.graph_note_exports (lease_expires_at)
  where status = 'claimed';
-- Lectura del médico (y Realtime).
create index if not exists graph_note_exports_doctor_idx
  on public.graph_note_exports (doctor_id, created_at desc);

-- updated_at siempre real, incluso si alguien actualiza por fuera de las RPCs.
create or replace function public.graph_note_exports_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists graph_note_exports_touch_updated_at on public.graph_note_exports;
create trigger graph_note_exports_touch_updated_at
  before update on public.graph_note_exports
  for each row execute function public.graph_note_exports_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Lectura: el médico dueño ve el estado de su exportación. Escritura: nadie
-- (solo service-role, que salta RLS). Sin grants de insert/update/delete.
-- ---------------------------------------------------------------------------
grant select on table public.graph_note_exports to authenticated;

drop policy if exists "doctor reads own note exports" on public.graph_note_exports;
create policy "doctor reads own note exports" on public.graph_note_exports
  for select to authenticated
  using (doctor_id = (select auth.uid()));

-- Admin/supervisor de la organización, espejando las policies de consultations.
-- Condicional: private.current_org()/current_app_role() los crea el repo de
-- Notes. Si aún no existen, la migración no falla y queda solo la policy del
-- médico dueño (que es la que necesita la UI).
do $$
begin
  if to_regprocedure('private.current_org()') is not null
     and to_regprocedure('private.current_app_role()') is not null then
    execute $ddl$
      drop policy if exists "org admins read note exports" on public.graph_note_exports;
      create policy "org admins read note exports" on public.graph_note_exports
        for select to authenticated
        using (
          organization_id = (select private.current_org())
          and (select private.current_app_role()) in ('admin', 'supervisor')
        );
    $ddl$;
  end if;
end;
$$;

-- Realtime: Notes se suscribe a la fila del trabajo para pintar el estado en
-- vivo. Sin esto el frontend cae al polling (que también está implementado).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'graph_note_exports'
     ) then
    execute 'alter publication supabase_realtime add table public.graph_note_exports';
  end if;
end;
$$;

-- ============================================================================
-- RPC 1 — claim: el ejecutor de Operations reclama el siguiente trabajo.
--
-- FIFO con FOR UPDATE SKIP LOCKED: varios ejecutores en paralelo nunca se
-- llevan el mismo trabajo. Elegible = 'pending', o 'claimed' con lease vencido
-- (un ejecutor que se apagó a media tarea no bloquea la cola para siempre).
-- ============================================================================
create or replace function public.graph_claim_next_note_export(
  p_claimed_by text,
  p_lease_seconds int default 600,
  p_max_attempts int default 3
)
returns setof public.graph_note_exports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_claimed_by), '') = '' then
    raise exception 'GRAPH_CLAIM_REQUIRES_IDENTITY: p_claimed_by es obligatorio';
  end if;

  select e.id into v_id
    from public.graph_note_exports e
   where e.kind = 'note_export'
     and e.attempts < p_max_attempts
     and (
       e.status = 'pending'
       or (e.status = 'claimed' and e.lease_expires_at is not null and e.lease_expires_at < now())
     )
   order by e.created_at
     for update skip locked
   limit 1;

  -- Cola vacía: el ejecutor recibe 204 y vuelve a preguntar luego.
  if v_id is null then
    return;
  end if;

  return query
  update public.graph_note_exports e
     set status = 'claimed',
         claimed_by = p_claimed_by,
         claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = e.attempts + 1,
         attempt_history = e.attempt_history || jsonb_build_object(
           'event', 'claimed',
           'at', now(),
           'attempt', e.attempts + 1,
           'claimed_by', p_claimed_by,
           'previous_status', e.status
         )
   where e.id = v_id
  returning e.*;
end;
$$;

-- ============================================================================
-- RPC 2 — result: el ejecutor reporta el desenlace.
--
-- Es LA transición que decide si la consulta queda exportada. En una sola
-- transacción: cierra el trabajo, y SOLO si outcome='ok' mueve la consulta
-- 'aprobada' -> 'exportada' (la única transición que permite el trigger de
-- inmutabilidad de Notes) y deja el rastro en audit_events.
--
-- Subsume el `graph_mark_exported` conceptual del plan: un único punto de
-- escritura cross-boundary sobre consultations, en vez de dos funciones que
-- pudieran divergir.
--
-- Idempotente: repetir el mismo resultado terminal devuelve ack sin
-- re-transicionar (el cliente DEBE reintentar hasta recibir ack, así que los
-- reenvíos son esperados, no una anomalía).
-- ============================================================================
create or replace function public.graph_report_note_export_result(
  p_export_id uuid,
  p_claimed_by text,
  p_outcome text,
  p_result jsonb default '{}'::jsonb,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.graph_note_exports;
  v_status text;
  v_folio text;
  v_actor text;
  v_rows int := 0;
  v_consultation_exported boolean := false;
begin
  if p_outcome not in ('ok', 'needs_doctor', 'error') then
    raise exception 'GRAPH_RESULT_INVALID_OUTCOME: outcome invalido (%)', p_outcome;
  end if;

  select * into v_job
    from public.graph_note_exports
   where id = p_export_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_FOUND');
  end if;

  -- Ya terminal: ack idempotente. No se re-transiciona ni se re-audita.
  if v_job.status in ('completed', 'needs_doctor', 'failed', 'cancelled') then
    return jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_TERMINAL',
      'idempotent', true,
      'status', v_job.status,
      'export_id', v_job.id,
      'consultation_exported', false
    );
  end if;

  -- Un trabajo que nadie reclamó no puede reportar resultado.
  if v_job.status <> 'claimed' then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_CLAIMED', 'status', v_job.status);
  end if;

  -- Solo el ejecutor que tiene el trabajo lo cierra.
  if coalesce(btrim(p_claimed_by), '') <> '' and v_job.claimed_by is distinct from p_claimed_by then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_OWNED', 'status', v_job.status);
  end if;

  -- Lease vencido: el trabajo ya es re-reclamable por otro ejecutor; aceptar
  -- este resultado tardío podría pisar una ejecución en curso.
  if v_job.lease_expires_at is not null and v_job.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_LEASE_EXPIRED', 'status', v_job.status);
  end if;

  v_status := case p_outcome
    when 'ok' then 'completed'
    when 'needs_doctor' then 'needs_doctor'
    else 'failed'
  end;
  v_folio := nullif(btrim(coalesce(p_result->>'folio', '')), '');

  update public.graph_note_exports
     set status = v_status,
         result = coalesce(p_result, '{}'::jsonb),
         error_code = case when p_outcome = 'ok' then null else nullif(btrim(coalesce(p_error_code, '')), '') end,
         finished_at = now(),
         lease_expires_at = null,
         attempt_history = attempt_history || jsonb_build_object(
           'event', 'result',
           'at', now(),
           'attempt', v_job.attempts,
           'outcome', p_outcome,
           'status', v_status,
           'claimed_by', v_job.claimed_by,
           'error_code', nullif(btrim(coalesce(p_error_code, '')), ''),
           'folio', v_folio
         )
   where id = p_export_id;

  -- ÚNICO camino a 'exportada': un 'ok' confirmado por el ejecutor.
  if p_outcome = 'ok' then
    update public.consultations
       set estado = 'exportada'
     where id = v_job.consultation_id
       and estado = 'aprobada';
    get diagnostics v_rows = row_count;
    v_consultation_exported := v_rows > 0;

    v_actor := coalesce(nullif(btrim(coalesce(v_job.claimed_by, '')), ''), 'Asistente de escritorio');
    insert into public.audit_events (organization_id, consultation_id, actor_name, accion, detalle)
    values (
      v_job.organization_id,
      v_job.consultation_id,
      v_actor,
      'Nota exportada a HC (automática)',
      concat_ws(' · ',
        concat('export ', v_job.id),
        concat('intento ', v_job.attempts),
        case when v_folio is not null then concat('folio ', v_folio) end,
        case when not v_consultation_exported then 'la consulta ya no estaba en aprobada' end
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'RESULT_APPLIED',
    'idempotent', false,
    'status', v_status,
    'export_id', v_job.id,
    'consultation_exported', v_consultation_exported
  );
end;
$$;

-- ============================================================================
-- RPC 3 — retry: reintentar la MISMA fila.
--
-- Solo desde un estado terminal no exitoso. `attempts` NO se resetea (es
-- historia); el máximo se aplica en el claim, así que el retry sube el techo de
-- intentos permitidos para esta fila. Re-valida que la consulta siga 'aprobada':
-- si ya está exportada (p. ej. marcada a mano), no hay nada que reintentar.
-- ============================================================================
create or replace function public.graph_retry_note_export(
  p_export_id uuid,
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.graph_note_exports;
  v_estado text;
begin
  select * into v_job
    from public.graph_note_exports
   where id = p_export_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_FOUND');
  end if;

  if v_job.status = 'pending' then
    -- Ya está en cola: el botón de reintentar es idempotente.
    return jsonb_build_object('ok', true, 'code', 'ALREADY_PENDING', 'idempotent', true,
                              'status', 'pending', 'export_id', v_job.id);
  end if;

  if v_job.status not in ('failed', 'needs_doctor', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_RETRYABLE', 'status', v_job.status);
  end if;

  select estado into v_estado from public.consultations where id = v_job.consultation_id;
  if v_estado is distinct from 'aprobada' then
    return jsonb_build_object('ok', false, 'code', 'CONSULTATION_NOT_APPROVED', 'consultation_estado', v_estado);
  end if;

  -- El payload es el snapshot de la nota FIRMADA: se reintenta tal cual, no se
  -- reconstruye (la nota es inmutable, y así el reintento no puede cambiar lo
  -- que se envía al HIS).
  update public.graph_note_exports
     set status = 'pending',
         claimed_by = null,
         claimed_at = null,
         lease_expires_at = null,
         finished_at = null,
         error_code = null,
         result = null,
         attempt_history = attempt_history || jsonb_build_object(
           'event', 'retry',
           'at', now(),
           'from_status', v_job.status,
           'attempts_so_far', v_job.attempts,
           'requested_by', p_requested_by
         )
   where id = p_export_id;

  return jsonb_build_object('ok', true, 'code', 'RETRY_QUEUED', 'idempotent', false,
                            'status', 'pending', 'export_id', v_job.id);
end;
$$;

-- ============================================================================
-- RPC 4 — cancel: solo desde 'pending'.
--
-- Un trabajo 'claimed' ya se está ejecutando contra el HIS y no hay cancelación
-- remota de SAP: ofrecer un botón que no cancela nada sería un placebo.
-- ============================================================================
create or replace function public.graph_cancel_note_export(
  p_export_id uuid,
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.graph_note_exports;
begin
  select * into v_job
    from public.graph_note_exports
   where id = p_export_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_FOUND');
  end if;

  if v_job.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_CANCELLED', 'idempotent', true,
                              'status', 'cancelled', 'export_id', v_job.id);
  end if;

  if v_job.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'EXPORT_NOT_CANCELLABLE', 'status', v_job.status);
  end if;

  update public.graph_note_exports
     set status = 'cancelled',
         finished_at = now(),
         lease_expires_at = null,
         attempt_history = attempt_history || jsonb_build_object(
           'event', 'cancelled',
           'at', now(),
           'requested_by', p_requested_by
         )
   where id = p_export_id;

  return jsonb_build_object('ok', true, 'code', 'CANCELLED', 'idempotent', false,
                            'status', 'cancelled', 'export_id', v_job.id);
end;
$$;

-- ============================================================================
-- RPC 5 — purga de PHI: vacía `payload` de los trabajos terminales antiguos.
-- El historial (estados, intentos, error_code, folio) se conserva; el contenido
-- clínico no tiene por qué seguir en la cola una vez ejecutado.
-- ============================================================================
create or replace function public.graph_purge_note_export_payloads(
  p_older_than_hours int default 72
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int := 0;
begin
  update public.graph_note_exports
     set payload = '{}'::jsonb,
         purged_at = now()
   where status in ('completed', 'needs_doctor', 'failed', 'cancelled')
     and purged_at is null
     and finished_at is not null
     and finished_at < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Estas RPCs las invoca ÚNICAMENTE Graph con service-role. Ningún cliente
-- autenticado (ni anónimo) puede reclamar trabajos, reportar resultados o
-- mover una consulta a 'exportada'.
revoke all on function public.graph_claim_next_note_export(text, int, int) from public, anon, authenticated;
revoke all on function public.graph_report_note_export_result(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.graph_retry_note_export(uuid, uuid) from public, anon, authenticated;
revoke all on function public.graph_cancel_note_export(uuid, uuid) from public, anon, authenticated;
revoke all on function public.graph_purge_note_export_payloads(int) from public, anon, authenticated;

grant execute on function public.graph_claim_next_note_export(text, int, int) to service_role;
grant execute on function public.graph_report_note_export_result(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.graph_retry_note_export(uuid, uuid) to service_role;
grant execute on function public.graph_cancel_note_export(uuid, uuid) to service_role;
grant execute on function public.graph_purge_note_export_payloads(int) to service_role;
