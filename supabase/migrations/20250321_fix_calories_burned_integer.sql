-- Ensure calories_burned exists as nullable integer on family_workouts
alter table if exists public.family_workouts
  add column if not exists calories_burned integer;

alter table if exists public.family_workouts
  alter column calories_burned type integer using nullif(round(calories_burned)::integer, 0);

comment on column public.family_workouts.calories_burned is 'Estimated calories burned for the workout entry';
