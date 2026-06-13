-- Harden the browser-facing clinical Data API.
-- Anonymous Supabase users use the `authenticated` database role, so every
-- clinical policy must explicitly reject JWTs with is_anonymous=true.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role, public;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

revoke all on table public.patients from anon, authenticated;
revoke all on table public.encounters from anon, authenticated;
revoke all on table public.encounter_events from anon, authenticated;
revoke all on table public.leads from anon, authenticated;

grant select, insert, update, delete on table public.patients to authenticated;
grant select, insert, update, delete on table public.encounters to authenticated;
grant select, insert on table public.encounter_events to authenticated;
grant insert on table public.leads to anon, authenticated;

grant all on table public.patients to service_role;
grant all on table public.encounters to service_role;
grant all on table public.encounter_events to service_role;
grant all on table public.leads to service_role;

alter table public.leads
  add constraint leads_name_length
  check (char_length(btrim(name)) between 1 and 200) not valid;
alter table public.leads
  add constraint leads_contact_required
  check (
    nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  ) not valid;
alter table public.leads
  add constraint leads_field_lengths
  check (
    char_length(coalesce(role, '')) <= 200
    and char_length(coalesce(institution, '')) <= 200
    and char_length(coalesce(email, '')) <= 320
    and char_length(coalesce(phone, '')) <= 50
    and char_length(coalesce(message, '')) <= 4000
    and char_length(coalesce(source, '')) <= 50
  ) not valid;

drop policy if exists "Owners select patients" on public.patients;
drop policy if exists "Owners insert patients" on public.patients;
drop policy if exists "Owners update patients" on public.patients;
drop policy if exists "Owners delete patients" on public.patients;

create policy "Permanent users select own patients"
  on public.patients for select to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

create policy "Permanent users insert own patients"
  on public.patients for insert to authenticated
  with check (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

create policy "Permanent users update own patients"
  on public.patients for update to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  )
  with check (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

create policy "Permanent users delete own patients"
  on public.patients for delete to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

drop policy if exists "Owners can select their encounters" on public.encounters;
drop policy if exists "Owners can insert their encounters" on public.encounters;
drop policy if exists "Owners can update their encounters" on public.encounters;
drop policy if exists "Owners can delete their encounters" on public.encounters;

create policy "Permanent users select own encounters"
  on public.encounters for select to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

create policy "Permanent users insert own encounters"
  on public.encounters for insert to authenticated
  with check (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
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

create policy "Permanent users update own encounters"
  on public.encounters for update to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  )
  with check (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
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

create policy "Permanent users delete own encounters"
  on public.encounters for delete to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = owner_id
  );

drop policy if exists "Owners can read their encounter events" on public.encounter_events;
drop policy if exists "Owners can insert their encounter events" on public.encounter_events;

create policy "Permanent users read own encounter events"
  on public.encounter_events for select to authenticated
  using (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = actor_id
    and exists (
      select 1
      from public.encounters encounter
      where encounter.id = encounter_id
        and encounter.owner_id = (select auth.uid())
    )
  );

create policy "Permanent users append own encounter events"
  on public.encounter_events for insert to authenticated
  with check (
    coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and (select auth.uid()) = actor_id
    and exists (
      select 1
      from public.encounters encounter
      where encounter.id = encounter_id
        and encounter.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Encounter owners receive broadcasts" on realtime.messages;
drop policy if exists "Encounter owners send broadcasts" on realtime.messages;

create policy "Encounter owners receive broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.encounters encounter
      where encounter.owner_id = (select auth.uid())
        and (select realtime.topic()) = 'encounter:' || encounter.id::text
    )
  );

create policy "Encounter owners send broadcasts"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.encounters encounter
      where encounter.owner_id = (select auth.uid())
        and (select realtime.topic()) = 'encounter:' || encounter.id::text
    )
  );
