-- El consentimiento no forma parte del flujo de captura actual. Conservamos
-- la columna histórica para no alterar encuentros existentes, pero eliminamos
-- toda condición de inserción ligada a ella.
alter table public.clinical_encounters
  alter column consent drop not null,
  alter column consent drop default;

drop policy if exists "Doctors create own clinical encounters" on public.clinical_encounters;
create policy "Doctors create own clinical encounters"
  on public.clinical_encounters for insert to authenticated
  with check ((select auth.uid()) = doctor_id);
