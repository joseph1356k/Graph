-- ============================================================================
-- El rescate deja de tomar consultas que todavía se están grabando.
--
-- EL PROBLEMA
-- claim_next_note_generation elegía por EDAD: status transcript_ready, sin nota
-- y created_at de hace más de 5 minutos. Pero el encounter se crea cuando el
-- médico EMPIEZA a grabar, y el autoguardado de la web sube la transcripción
-- cada pocos segundos dejándola en transcript_ready. Resultado: toda consulta
-- de más de ~5 minutos quedaba "rescatable" mientras el médico seguía
-- hablando, y el rescate oportunista (disparado por esos mismos autoguardados)
-- generaba una nota con la transcripción a medias:
--   - una llamada completa al modelo de más, compitiendo con la de verdad;
--   - la fila del historial (consultations) nacía con la nota PARCIAL, y como
--     el espejo del servidor solo crea y nunca actualiza, se quedaba así si la
--     web no alcanzaba a reescribirla.
--
-- LA SOLUCIÓN
-- Se elige por QUIETUD, no por edad: updated_at (el trigger lo mueve en cada
-- autoguardado) tiene que llevar p_min_age_minutes sin cambios. Mientras el
-- médico graba, la consulta nunca está quieta. El parámetro conserva su
-- nombre —CREATE OR REPLACE no permite renombrarlo sin romper a quien lo
-- llama— y su default pasa de 5 a 10 minutos de inactividad.
--
-- ADEMÁS: una generación que murió a mitad (la función de Vercel llegaba a su
-- tope de 60 s antes que el timeout del modelo) dejaba la consulta en
-- note_generating para siempre: nadie la marcaba failed y el rescate solo
-- miraba transcript_ready. Ahora también se recoge una note_generating quieta
-- desde hace 15 minutos, muy por encima del tope de la función (300 s), así
-- que nunca se le pisa a una generación viva.
--
-- COMPATIBILIDAD
-- Misma firma y mismo tipo de retorno: el código que llama la RPC no cambia y
-- funciona igual con esta migración aplicada o sin aplicar.
-- ============================================================================

create or replace function public.claim_next_note_generation(
  p_lease_seconds int default 300,
  p_max_attempts int default 3,
  p_min_age_minutes int default 10,
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
   where e.note_json is null
     and coalesce(length(btrim(e.transcript)), 0) > 0
     and (
           e.status = 'transcript_ready'
           -- Generación muerta a mitad: nadie la cerró como failed.
        or (e.status = 'note_generating'
            and e.updated_at < now() - interval '15 minutes')
     )
     -- QUIETA, no vieja: sin autoguardados desde hace p_min_age_minutes. Es
     -- lo que distingue una consulta abandonada de una que se sigue grabando,
     -- y también cubre el margen de no competir con el cliente, que pide la
     -- nota segundos después de guardar la transcripción.
     and e.updated_at < now() - make_interval(mins => greatest(p_min_age_minutes, 1))
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
  'Reclama una consulta QUIETA (sin cambios hace p_min_age_minutes) con transcripción pero sin nota, o una generación muerta a mitad, para regenerarla. Atómico (for update skip locked): dos ejecuciones simultáneas nunca toman la misma.';

-- CREATE OR REPLACE conserva los permisos; se repite el revoke para que la
-- migración se sostenga sola.
revoke all on function public.claim_next_note_generation(int, int, int, int) from public, anon, authenticated;

-- La cola ahora mira dos estados y ordena la quietud por updated_at.
create index if not exists clinical_encounters_rescue_quietud_idx
  on public.clinical_encounters (updated_at)
  where note_json is null and status in ('transcript_ready', 'note_generating');
