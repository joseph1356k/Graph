-- Allow Supabase anonymous sessions to exercise the EMR demo while preserving
-- strict per-user ownership. This keeps RLS enabled and still requires
-- owner_id/actor_id to match auth.uid().

drop policy if exists "Permanent users select own patients" on public.patients;
drop policy if exists "Permanent users insert own patients" on public.patients;
drop policy if exists "Permanent users update own patients" on public.patients;
drop policy if exists "Permanent users delete own patients" on public.patients;
drop policy if exists "Authenticated users select own patients" on public.patients;
drop policy if exists "Authenticated users insert own patients" on public.patients;
drop policy if exists "Authenticated users update own patients" on public.patients;
drop policy if exists "Authenticated users delete own patients" on public.patients;

create policy "Authenticated users select own patients"
  on public.patients for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Authenticated users insert own patients"
  on public.patients for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Authenticated users update own patients"
  on public.patients for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Authenticated users delete own patients"
  on public.patients for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Permanent users select own encounters" on public.encounters;
drop policy if exists "Permanent users insert own encounters" on public.encounters;
drop policy if exists "Permanent users update own encounters" on public.encounters;
drop policy if exists "Permanent users delete own encounters" on public.encounters;
drop policy if exists "Authenticated users select own encounters" on public.encounters;
drop policy if exists "Authenticated users insert own encounters" on public.encounters;
drop policy if exists "Authenticated users update own encounters" on public.encounters;
drop policy if exists "Authenticated users delete own encounters" on public.encounters;

create policy "Authenticated users select own encounters"
  on public.encounters for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Authenticated users insert own encounters"
  on public.encounters for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (
      patient_id is null
      or exists (
        select 1
        from public.patients patient
        where patient.id = patient_id
          and patient.owner_id = (select auth.uid())
      )
    )
  );

create policy "Authenticated users update own encounters"
  on public.encounters for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (
      patient_id is null
      or exists (
        select 1
        from public.patients patient
        where patient.id = patient_id
          and patient.owner_id = (select auth.uid())
      )
    )
  );

create policy "Authenticated users delete own encounters"
  on public.encounters for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Permanent users read own encounter events" on public.encounter_events;
drop policy if exists "Permanent users append own encounter events" on public.encounter_events;
drop policy if exists "Authenticated users read own encounter events" on public.encounter_events;
drop policy if exists "Authenticated users append own encounter events" on public.encounter_events;

create policy "Authenticated users read own encounter events"
  on public.encounter_events for select to authenticated
  using (
    (select auth.uid()) = actor_id
    and exists (
      select 1
      from public.encounters encounter
      where encounter.id = encounter_id
        and encounter.owner_id = (select auth.uid())
    )
  );

create policy "Authenticated users append own encounter events"
  on public.encounter_events for insert to authenticated
  with check (
    (select auth.uid()) = actor_id
    and exists (
      select 1
      from public.encounters encounter
      where encounter.id = encounter_id
        and encounter.owner_id = (select auth.uid())
    )
  );

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "Encounter owners receive broadcasts" on realtime.messages';
    execute 'drop policy if exists "Encounter owners send broadcasts" on realtime.messages';

    execute $policy$
      create policy "Encounter owners receive broadcasts"
        on realtime.messages for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and exists (
            select 1
            from public.encounters encounter
            where encounter.owner_id = (select auth.uid())
              and (select realtime.topic()) = 'encounter:' || encounter.id::text
          )
        )
    $policy$;

    execute $policy$
      create policy "Encounter owners send broadcasts"
        on realtime.messages for insert to authenticated
        with check (
          realtime.messages.extension = 'broadcast'
          and exists (
            select 1
            from public.encounters encounter
            where encounter.owner_id = (select auth.uid())
              and (select realtime.topic()) = 'encounter:' || encounter.id::text
          )
        )
    $policy$;
  end if;
end
$$;
