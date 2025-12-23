-- Ensure family meals table tracks when entries were logged
alter table if exists public.family_meals
add column if not exists logged_at timestamptz not null default now();

-- Optimize diary queries that scope by family group and recency
create index if not exists family_meals_family_group_id_logged_at_idx
  on public.family_meals (family_group_id, logged_at desc);
