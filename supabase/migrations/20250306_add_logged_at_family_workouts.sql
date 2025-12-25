-- Ensure scheduled workouts can be marked as logged and avoid schema cache misses
alter table if exists public.family_workouts
add column if not exists logged_at timestamptz;

-- Backfill logged_at for already completed workouts
update public.family_workouts
set logged_at = coalesce(logged_at, created_at, now())
where completed is true
  and logged_at is null;

-- Helpful index for diary lookups
create index if not exists family_workouts_family_group_id_logged_at_idx
  on public.family_workouts (family_group_id, logged_at desc);
