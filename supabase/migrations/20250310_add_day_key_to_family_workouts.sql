-- Add day_key column to align with frontend day-based queries and inserts
alter table if exists public.family_workouts
  add column if not exists day_key text;

-- Backfill existing rows using the workout_date (preferred) or created_at
update public.family_workouts
set day_key = coalesce(
  day_key,
  to_char(coalesce(workout_date::date, created_at::date), 'YYYY-MM-DD')
)
where day_key is null
   or day_key = '';

-- Index to speed up diary lookups
create index if not exists family_workouts_family_group_id_day_key_idx
  on public.family_workouts (family_group_id, day_key);
