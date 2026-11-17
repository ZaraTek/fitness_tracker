-- Full current schema. Paste into the Supabase SQL Editor on a new project.
-- Safe to re-run.

-- ---------- settings (one row per user) ----------
create table if not exists user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  unit text not null default 'lb' check (unit in ('lb', 'kg')),
  calorie_target int not null default 2200,   -- what you aim to eat
  maintenance_calories int not null default 2700, -- what you burn; deficit/surplus is measured against this
  protein_target int not null default 160,
  carb_target int not null default 220,
  fat_target int not null default 70,
  updated_at timestamptz not null default now()
);
alter table user_settings enable row level security;
drop policy if exists "own settings" on user_settings;
create policy "own settings" on user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- gym ----------
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('push', 'pull', 'legs')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table exercises enable row level security;
drop policy if exists "own exercises" on exercises;
create policy "own exercises" on exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  category text not null check (category in ('push', 'pull', 'legs')),
  notes text,
  created_at timestamptz not null default now()
);
alter table workouts enable row level security;
drop policy if exists "own workouts" on workouts;
create policy "own workouts" on workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null references workouts(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete cascade,
  set_number int not null default 1,
  reps int not null,
  weight numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table workout_sets enable row level security;
drop policy if exists "own sets" on workout_sets;
create policy "own sets" on workout_sets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists workout_sets_exercise_idx on workout_sets (exercise_id);

-- ---------- food ----------
create table if not exists food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  name text not null,
  calories int not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  fiber numeric not null default 0,
  sugar numeric not null default 0,
  sodium numeric not null default 0, -- mg
  created_at timestamptz not null default now()
);
alter table food_entries enable row level security;
drop policy if exists "own food" on food_entries;
create policy "own food" on food_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists food_entries_date_idx on food_entries (user_id, date);

-- ---------- progress ----------
create table if not exists weigh_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight numeric not null, -- stored in the user's chosen unit
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
alter table weigh_ins enable row level security;
drop policy if exists "own weigh_ins" on weigh_ins;
create policy "own weigh_ins" on weigh_ins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  path text not null, -- object path inside the progress-photos bucket
  note text,
  created_at timestamptz not null default now()
);
alter table progress_photos enable row level security;
drop policy if exists "own photos" on progress_photos;
create policy "own photos" on progress_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- storage: private bucket, files live under <user_id>/ ----------
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

drop policy if exists "own photo files read" on storage.objects;
create policy "own photo files read" on storage.objects
  for select using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own photo files insert" on storage.objects;
create policy "own photo files insert" on storage.objects
  for insert with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own photo files delete" on storage.objects;
create policy "own photo files delete" on storage.objects
  for delete using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
