-- 003: resting burn setting + per-day active calories. Safe to re-run.
alter table user_settings add column if not exists resting_calories int; -- kcal/day; null = not set

create table if not exists daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  active_calories int not null, -- e.g. Apple Watch "Active Energy"
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
alter table daily_activity enable row level security;
drop policy if exists "own activity" on daily_activity;
create policy "own activity" on daily_activity
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
