-- Add client_id for tracking local client-generated identifiers
alter table public.family_meals
add column if not exists client_id text;

-- Optional but recommended: index for faster lookups/deletes via client_id
create index if not exists family_meals_client_id_idx
  on public.family_meals (client_id);

-- Ensure relevant RLS policies permit inserting/updating client_id if policies are column-scoped.
