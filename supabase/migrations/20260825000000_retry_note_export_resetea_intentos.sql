-- El reintento devolvía el trabajo a 'pending' pero dejaba `attempts` intacto, y
-- graph_claim_next_note_export solo reparte lo que cumple `attempts < p_max_attempts`.
-- Un trabajo agotado (3 de 3) quedaba en cola para siempre: ningún ejecutor podía
-- verlo, y la web culpaba al equipo de escritorio de no encenderse —«El asistente
-- de escritorio no ha tomado la tarea. ¿Está encendido el equipo?»— mientras la
-- función que reparte tenía decidido no dárselo a nadie. El botón prometía algo
-- que el claim no podía cumplir. Visto en producción el 2026-08-25.
--
-- Conservar los intentos ERA intencional: el test decía «conserva attempts» como
-- si fuera la intención. Lo era, y estaba mal. Reintentar es un acto humano
-- deliberado: quien lo pulsa ya sabe que falló y pide empezar de nuevo, así que
-- devolverle el presupuesto de intentos es lo que ese gesto significa. Un límite
-- de intentos protege del bucle automático, no de la persona que decide.
--
-- Nada se pierde de la auditoría: attempt_history ya guardaba 'attempts_so_far'
-- antes del reset, así que el historial sigue contando cuántas veces se intentó y
-- cuándo se pidió volver a empezar.
CREATE OR REPLACE FUNCTION public.graph_retry_note_export(p_export_id uuid, p_requested_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if v_job.status = 'pending' and v_job.attempts = 0 then
    -- Ya está en cola Y reclamable: el botón de reintentar es idempotente.
    -- El `attempts = 0` importa: un 'pending' con los intentos agotados NO está
    -- en cola de verdad —nadie puede cogerlo—, así que ahí el reintento sí tiene
    -- trabajo que hacer y no debe contestar que ya estaba listo.
    return jsonb_build_object('ok', true, 'code', 'ALREADY_PENDING', 'idempotent', true,
                              'status', 'pending', 'export_id', v_job.id);
  end if;

  if v_job.status not in ('failed', 'needs_doctor', 'cancelled', 'pending') then
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
         attempts = 0,
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
$function$;
