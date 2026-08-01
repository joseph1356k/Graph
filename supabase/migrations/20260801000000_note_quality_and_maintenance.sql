-- ============================================================================
-- Tres cosas que el motor clínico necesitaba y no tenía:
--
--   1. note_json_ai — la nota TAL COMO la generó la IA, congelada.
--      Hoy `note_json` se sobrescribe cuando el médico edita, así que la versión
--      original se pierde y es imposible medir si la IA acierta. Sin esto, la
--      pregunta "¿cuánto corrige el médico?" no tiene respuesta posible.
--
--   2. Limpieza de consultas abandonadas.
--      Una consulta creada y nunca grabada se queda en `created` para siempre y
--      ensucia el embudo. El 2026-08-01 había 22 así, la más vieja del 15 de
--      julio. Solo se borran las que NO tienen ni transcripción ni nota: si el
--      médico alcanzó a dictar algo, el registro se respeta siempre.
--
--   3. Índices para las llaves foráneas que no los tenían.
-- ============================================================================

-- 1) Versión IA de la nota ---------------------------------------------------
alter table public.clinical_encounters
  add column if not exists note_json_ai jsonb;

comment on column public.clinical_encounters.note_json_ai is
  'Nota tal como la generó la IA, congelada en la generación. note_json puede ser editada por el médico; esta no se toca. Sirve para medir cuánto corrige el médico (calidad del prompt por especialidad).';

alter table public.clinical_encounters
  add column if not exists note_generated_at timestamptz;

comment on column public.clinical_encounters.note_generated_at is
  'Cuándo se generó note_json_ai. Permite separar la primera generación de las regeneraciones.';

-- 2) Limpieza de consultas abandonadas ---------------------------------------
-- Solo toca filas SIN contenido clínico. El umbral es un parámetro para poder
-- ser conservador en producción (7 días) y estricto en una limpieza puntual.
create or replace function public.purge_abandoned_encounters(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  eliminadas integer;
begin
  with borradas as (
    delete from public.clinical_encounters
    where status = 'created'
      and created_at < now() - make_interval(days => greatest(p_days, 1))
      -- Doble red de seguridad: nunca borrar algo con trabajo del médico.
      and coalesce(length(trim(transcript)), 0) = 0
      and note_json is null
      and note_json_ai is null
    returning id
  )
  select count(*) into eliminadas from borradas;

  return eliminadas;
end;
$$;

comment on function public.purge_abandoned_encounters(integer) is
  'Borra consultas creadas y nunca usadas (sin transcripción ni nota) con más de N días. Jamás borra una consulta con contenido clínico.';

revoke all on function public.purge_abandoned_encounters(integer) from public, anon, authenticated;

-- 3) Índices de llaves foráneas ----------------------------------------------
-- Sin índice, cada borrado o actualización del lado padre hace un recorrido
-- completo de la tabla hija para validar la restricción.
create index if not exists agent_links_organization_id_idx
  on public.agent_links (organization_id);

create index if not exists consultation_addenda_author_id_idx
  on public.consultation_addenda (author_id);

create index if not exists graph_interactions_user_id_idx
  on public.graph_interactions (user_id);

create index if not exists secretary_doctor_access_medico_id_idx
  on public.secretary_doctor_access (medico_id);

-- Consulta de apoyo para el panel de calidad: cuánto se aparta la nota firmada
-- de la que propuso la IA, por especialidad. Se calcula por longitud porque un
-- diff textual completo sería caro y aquí basta la magnitud del cambio.
create or replace view public.clinical_note_edit_stats as
select
  e.template_snapshot->>'specialty' as especialidad,
  count(*) as notas,
  count(*) filter (where e.note_json is distinct from e.note_json_ai) as editadas,
  round(avg(
    case
      when e.note_json_ai is null then null
      else abs(length(e.note_json::text) - length(e.note_json_ai::text))::numeric
           / nullif(length(e.note_json_ai::text), 0) * 100
    end
  ), 1) as cambio_medio_pct
from public.clinical_encounters e
where e.note_json_ai is not null
group by 1;

comment on view public.clinical_note_edit_stats is
  'Cuánto edita el médico la nota generada, por especialidad. Solo metadatos: longitudes y conteos, nunca contenido clínico.';

revoke all on public.clinical_note_edit_stats from anon, authenticated;
