-- Safety re-assertion of calories_burned column as nullable integer for family_workouts
alter table if exists public.family_workouts
  add column if not exists calories_burned integer;

comment on column public.family_workouts.calories_burned is 'Estimated calories burned for the workout entry';
