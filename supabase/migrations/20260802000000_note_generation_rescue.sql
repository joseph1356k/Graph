-- ============================================================================
-- Rescate de consultas que se quedaron a mitad de camino.
--
-- EL PROBLEMA
-- La cadena "guardar transcripción → generar nota → publicar en el historial"
-- la empujaba el navegador del médico. Si se cerraba la pestaña, se caía el
-- internet o el proveedor de IA tardaba de más, la consulta quedaba en
-- transcript_ready y NADIE la retomaba: sin reintento, sin cola, sin nadie
-- revisando qué quedó a medias. El 2026-08-02 había 13 así (más 2 fallidas),
-- todas con el dictado del médico guardado y ninguna visible para él.
--
-- LA SOLUCIÓN
-- La cola es esta misma tabla filtrada por estado —no hace falta una tabla
-- aparte— y el claim sigue el patrón ya probado de graph_note_exports:
-- `for update skip locked` + lease que vence si el proceso muere + tope de
-- intentos. Mismo diseño que un broker de mensajes, sobre Postgres.
--
-- LO QUE NO HACE
-- No toca el flujo normal: el cliente sigue pidiendo generar la nota y este
-- rescate solo recoge lo que quedó atrás. Y no toca las consultas viejas: la
-- ventana de 24 horas las deja fuera por diseño (decisión del propietario).
-- ============================================================================

alter table public.clinical_encounters
  add column if not exists generation_attempts integer not null default 0;

comment on column public.clinical_encounters.generation_attempts is
  'Intentos de generación hechos por el rescate automático. El tope se aplica en el claim, no con un CHECK: el historial de intentos se conserva.';

alter table public.clinical_encounters
  add column if not exists generation_lease_until timestamptz;

comment on column public.clinical_encounters.generation_lease_until is
  'Reserva del rescate sobre esta consulta. Vencida ⇒ re-reclamable: si el proceso muere a mitad, otro la toma en vez de quedar bloqueada para siempre.';

alter table public.clinical_encounters
  add column if not exists last_generation_error text;

comment on column public.clinical_encounters.last_generation_error is
  'Código del último fallo de generación. Tipado y SIN PHI: nunca transcripción ni contenido de nota.';

-- Índice parcial: la cola solo mira consultas sin nota, que son pocas frente al
-- total. Un índice completo sería desperdicio.
create index if not exists clinical_encounters_rescue_idx
  on public.clinical_encounters (created_at)
  where status = 'transcript_ready' and note_json is null;

-- ---------------------------------------------------------------------------
-- Claim atómico. Devuelve una consulta lista para regenerar, o nada.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_note_generation(
  p_lease_seconds int default 300,
  p_max_attempts int default 3,
  p_min_age_minutes int default 5,
  p_max_age_hours int default 24
)
returns setof public.clinical_encounters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select e.id into v_id
    from public.clinical_encounters e
   where e.status = 'transcript_ready'
     and e.note_json is null
     and coalesce(length(btrim(e.transcript)), 0) > 0
     -- Margen inferior: no competir con el cliente, que en el flujo normal
     -- pide la nota segundos después de guardar la transcripción.
     and e.created_at < now() - make_interval(mins => greatest(p_min_age_minutes, 1))
     -- Margen superior: deja fuera las consultas viejas a propósito. Regenerar
     -- una nota de hace semanas sorprendería al médico más de lo que ayuda.
     and e.created_at > now() - make_interval(hours => greatest(p_max_age_hours, 1))
     and e.generation_attempts < p_max_attempts
     and (e.generation_lease_until is null or e.generation_lease_until < now())
   order by e.created_at
     for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.clinical_encounters e
     set generation_lease_until = now() + make_interval(secs => p_lease_seconds),
         generation_attempts = e.generation_attempts + 1,
         updated_at = now()
   where e.id = v_id
   returning e.*;
end;
$$;

comment on function public.claim_next_note_generation(int, int, int, int) is
  'Reclama una consulta con transcripción pero sin nota para regenerarla. Atómico (for update skip locked): dos ejecuciones simultáneas nunca toman la misma.';

revoke all on function public.claim_next_note_generation(int, int, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cierre de un intento fallido.
-- ---------------------------------------------------------------------------
create or replace function public.release_note_generation(
  p_encounter_id uuid,
  p_error_code text default null,
  p_max_attempts int default 3
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_status text;
begin
  select generation_attempts into v_attempts
    from public.clinical_encounters where id = p_encounter_id;

  if v_attempts is null then
    return 'no_existe';
  end if;

  -- Agotados los intentos, la consulta pasa a failed para que deje de
  -- reintentarse en vacío y aparezca en la alerta. La transcripción se
  -- conserva intacta: el trabajo del médico nunca se descarta.
  if v_attempts >= p_max_attempts then
    v_status := 'failed';
  else
    v_status := 'transcript_ready';
  end if;

  update public.clinical_encounters
     set status = v_status,
         generation_lease_until = null,
         last_generation_error = left(coalesce(p_error_code, 'UNKNOWN'), 200),
         updated_at = now()
   where id = p_encounter_id;

  return v_status;
end;
$$;

comment on function public.release_note_generation(uuid, text, int) is
  'Libera la reserva tras un intento fallido. Agotados los intentos marca failed, pero jamás borra la transcripción del médico.';

revoke all on function public.release_note_generation(uuid, text, int) from public, anon, authenticated;
