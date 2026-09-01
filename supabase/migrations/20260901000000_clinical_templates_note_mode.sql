-- Modo de generación de nota por plantilla.
--
-- Hasta ahora la única forma de que una plantilla saliera literal (palabra por
-- palabra) era que la especialidad estuviera en una lista del código. El flag
-- de plantilla no existía en la tabla y el de sección se perdía al re-guardar.
-- Con esta columna el médico decide por plantilla, y dentro de `sections` cada
-- entrada puede llevar `"mode": "inherit" | "interpretive" | "verbatim"`.
--
-- 'auto' = decidir por especialidad (comportamiento actual).

alter table public.clinical_templates
  add column if not exists note_mode text not null default 'auto';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clinical_templates_note_mode_check'
  ) then
    alter table public.clinical_templates
      add constraint clinical_templates_note_mode_check
      check (note_mode in ('auto', 'interpretive', 'verbatim'));
  end if;
end
$$;

comment on column public.clinical_templates.note_mode is
  'Modo de generación: auto (por especialidad), interpretive (conversación médico-paciente) o verbatim (dictado literal). Las secciones pueden sobreescribirlo con sections[].mode.';
