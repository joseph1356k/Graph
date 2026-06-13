-- Append-only audit trail: one row per field change (human or AI), with its origin,
-- evidence, confidence and previous value. Mirrors the live Supabase project.
create table if not exists public.encounter_events (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  field_id text not null,
  old_value text,
  new_value text,
  source text not null default 'human',
  confidence numeric,
  evidence text,
  actor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.encounter_events enable row level security;

create policy "Owners can read their encounter events"
  on public.encounter_events for select
  using (auth.uid() = actor_id);

create policy "Owners can insert their encounter events"
  on public.encounter_events for insert
  with check (auth.uid() = actor_id);

create index if not exists encounter_events_encounter_id_idx
  on public.encounter_events (encounter_id, created_at);
