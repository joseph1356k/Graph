-- Phone microphone pairing for Vercel-compatible voice.
-- The browser clients never access these tables directly. Vercel Functions use
-- the service_role key or direct Postgres credentials to persist short-lived
-- pairing sessions and relay events between the phone and desktop.

create table if not exists public.phone_voice_sessions (
  id text primary key,
  token_hash text not null,
  owner_id text not null,
  owner_email text,
  context jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz
);

create table if not exists public.phone_voice_events (
  id bigserial primary key,
  session_id text not null references public.phone_voice_sessions(id) on delete cascade,
  source text not null check (source in ('desktop', 'phone', 'system')),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.phone_voice_sessions enable row level security;
alter table public.phone_voice_events enable row level security;

revoke all on table public.phone_voice_sessions from anon, authenticated;
revoke all on table public.phone_voice_events from anon, authenticated;
revoke all on sequence public.phone_voice_events_id_seq from anon, authenticated;

grant all on table public.phone_voice_sessions to service_role;
grant all on table public.phone_voice_events to service_role;
grant usage, select on sequence public.phone_voice_events_id_seq to service_role;

create index if not exists phone_voice_sessions_owner_id_idx
  on public.phone_voice_sessions (owner_id, expires_at);

create index if not exists phone_voice_events_session_id_id_idx
  on public.phone_voice_events (session_id, id);

create index if not exists phone_voice_events_created_at_idx
  on public.phone_voice_events (created_at);
