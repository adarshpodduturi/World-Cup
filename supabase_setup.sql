-- Paste this whole block into Supabase → SQL Editor → New query → Run.
-- It creates one table that stores each game's full state as JSON,
-- and allows the app (using the public anon key) to read and write it.

create table if not exists public.games (
  code        text primary key,
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Turn on Row Level Security, then allow anonymous read + write.
-- (Fine for a friends' game. No private data lives here.)
alter table public.games enable row level security;

create policy "anyone can read games"
  on public.games for select
  using (true);

create policy "anyone can insert games"
  on public.games for insert
  with check (true);

create policy "anyone can update games"
  on public.games for update
  using (true) with check (true);

-- Let the app receive realtime updates when a row changes.
alter publication supabase_realtime add table public.games;
