-- 002: more micronutrients on food entries. Safe to re-run.
alter table food_entries add column if not exists saturated_fat numeric not null default 0; -- g
alter table food_entries add column if not exists cholesterol numeric not null default 0;   -- mg
alter table food_entries add column if not exists potassium numeric not null default 0;     -- mg
alter table food_entries add column if not exists calcium numeric not null default 0;       -- mg
alter table food_entries add column if not exists iron numeric not null default 0;          -- mg
alter table food_entries add column if not exists magnesium numeric not null default 0;     -- mg
alter table food_entries add column if not exists vitamin_c numeric not null default 0;     -- mg
alter table food_entries add column if not exists vitamin_d numeric not null default 0;     -- mcg
