-- Landing lead capture. The public landing form inserts leads anonymously
-- (anon key) and they are read only via the dashboard / service role.
-- Mirrors the live Supabase project (ref nzccbfccuvyfxujymizr).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  role text,
  institution text,
  email text,
  phone text,
  message text,
  source text default 'landing'
);

alter table public.leads enable row level security;

-- Anyone (anon + authenticated) can submit a lead. There is intentionally no
-- SELECT/UPDATE/DELETE policy, so leads are not readable by the public; the
-- client insert must use return=minimal (no .select()) or RLS will reject the
-- read-back.
drop policy if exists "anon_insert_leads" on public.leads;
create policy "anon_insert_leads" on public.leads
  for insert to anon, authenticated
  with check (true);
