-- Nutrition search caching tables for Nutritionix proxy
create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_item_id text not null,
  name text not null,
  brand text null,
  serving_qty numeric null,
  serving_unit text null,
  serving_grams numeric null,
  calories numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  raw_json jsonb null,
  created_at timestamptz default now()
);

create unique index if not exists food_items_source_item_id_unique
  on public.food_items (source, source_item_id);

create table if not exists public.food_search_cache (
  query text primary key,
  results_json jsonb not null,
  created_at timestamptz default now()
);
