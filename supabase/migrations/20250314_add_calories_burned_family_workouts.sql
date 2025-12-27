-- Add calories_burned to capture estimated workout energy expenditure
alter table if exists public.family_workouts
  add column if not exists calories_burned numeric;

comment on column public.family_workouts.calories_burned is 'Estimated calories burned for the workout entry';
