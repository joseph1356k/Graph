-- Encounters: the durable per-encounter clinical note (a flat { fieldId: value } map).
-- Mirrors what was applied to the live Supabase project (ref nzccbfccuvyfxujymizr).
create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text,
  note jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.encounters enable row level security;

create policy "Owners can select their encounters"
  on public.encounters for select
  using (auth.uid() = owner_id);

create policy "Owners can insert their encounters"
  on public.encounters for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update their encounters"
  on public.encounters for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners can delete their encounters"
  on public.encounters for delete
  using (auth.uid() = owner_id);

create index if not exists encounters_owner_id_idx on public.encounters (owner_id);
