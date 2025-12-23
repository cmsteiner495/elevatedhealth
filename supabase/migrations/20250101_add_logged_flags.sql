-- Add explicit logged flags for meals so planned items stay scheduled until manually logged
alter table if exists public.family_meals
add column if not exists logged boolean default false,
add column if not exists logged_at timestamptz;

-- Backfill existing meals as logged to preserve historical summaries
update public.family_meals
set logged = coalesce(logged, true)
where logged is null;

-- Ensure workouts track completion status separately from their schedule
alter table if exists public.family_workouts
add column if not exists completed boolean default false,
add column if not exists logged_at timestamptz;

-- Backfill workouts: treat null completed as false to avoid accidental auto-log
update public.family_workouts
set completed = coalesce(completed, false)
where completed is null;
