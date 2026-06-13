-- Patients + link encounters to a patient (for per-patient history). Mirrors the
-- live Supabase project (ref nzccbfccuvyfxujymizr).
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  mrn text,
  created_at timestamptz not null default now()
);

alter table public.patients enable row level security;

create policy "Owners select patients" on public.patients for select using (auth.uid() = owner_id);
create policy "Owners insert patients" on public.patients for insert with check (auth.uid() = owner_id);
create policy "Owners update patients" on public.patients for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Owners delete patients" on public.patients for delete using (auth.uid() = owner_id);

create index if not exists patients_owner_id_idx on public.patients (owner_id);

alter table public.encounters add column if not exists patient_id uuid references public.patients(id) on delete set null;
create index if not exists encounters_patient_id_idx on public.encounters (patient_id);
