# Elevated Health Data Contract v1

This contract documents the current sources of truth, schema expectations, and canonical entrypoints for Elevated Health data domains. Dates use local calendar days unless noted.

## Meals log

1. **Source of truth**
   - Supabase table: `family_meals` (persistent). Offline cache: localStorage `ehmeals` keyed by `family_group_id`.
   - Upcoming vs. logged meals share the same table; `completed`/`logged_at` determine “logged”.

2. **Schema assumptions**
   - Primary key: `id` (UUID). Client temp IDs stored in `client_id`.
   - Ownership: `family_group_id` required; `added_by` user ID stored on inserts.
   - Date column: `meal_date` (string `YYYY-MM-DD`).
   - Required fields to insert: `family_group_id`, `meal_date`, `meal_type`, `title`. Macros (`calories`, `protein`, `carbs`, `fat`) optional but expected when available; `notes` optional; `client_id` used for optimistic IDs; `completed`/`logged_at` mark log state.

3. **Canonical date format rule**
   - `meal_date` uses `YYYY-MM-DD` local day keys derived via `toLocalDayKey`.

4. **Canonical CRUD entrypoints**
   - Read: `loadMeals()` (lists all), `fetchMealsByDate(date)` (filters by `meal_date`).
   - Create/Update: `logMealToDiary(meal, options)` (updates by `id`/`client_id` then inserts), meal form submit handler (guided add) builds payload then inserts.
   - Delete: `deleteMealById(mealId, options)` (server + local fallback), list removal handler in `bindMealsListRemoveButtons()`.
   - Plan seeding: `applyCoachUpdates()` bulk inserts planned rows with macros.

5. **Invariants**
   - Any meal shown after reload must come from Supabase or the cached `ehmeals` merge; local temp IDs reconcile to server IDs when available.
   - Logged meals have `logged_at` or `completed=true`; upcoming/plan items keep `logged_at` null and `completed` false.
   - Deletions should scope to `family_group_id` plus `id`/`client_id`; optimistic delete marks must be reconciled with server on next sync.

## Upcoming meals (plan)

1. **Source of truth**
   - Supabase `family_meals` table with plan rows (`completed=false`, `logged_at` null). No dedicated `family_upcoming_meals` table is used in production code; dev probes check for it.

2. **Schema assumptions**
   - Same as Meals log; plan rows may omit macros if AI did not supply them.

3. **Canonical date format rule**
   - `meal_date` `YYYY-MM-DD` local day key.

4. **Canonical CRUD entrypoints**
   - Read: `loadMeals()` with UI filtering for `!isMealLogged(meal)`.
   - Create/Update: `applyCoachUpdates()` bulk inserts plan rows; `logMealToDiary()` will update/replace plan rows when logging them.
   - Delete: `deleteMealById()` preferred; list delete handler currently calls Supabase directly by `id`.

5. **Invariants**
   - Plan items must be persisted in Supabase to survive reload; local-only plan edits risk drift.
   - Logging a planned meal should promote the same row (match by `id` or `client_id`) rather than creating duplicates.

## Workouts log

1. **Source of truth**
   - Supabase table: `family_workouts`. Offline cache: localStorage `ehworkouts` keyed by `family_group_id`.
   - Edge function `family_workouts` handles authenticated inserts/deletes for diary logging.

2. **Schema assumptions**
   - Primary key: `id` (UUID). `log_id` mirrors `id` for compatibility.
   - Ownership: `family_group_id` required for synced rows; `added_by` user ID captured on inserts.
   - Date column: `workout_date` (`YYYY-MM-DD` local). Optional `scheduled_workout_id` links plan rows.
   - Required fields to insert: `family_group_id`, `workout_date`, `title/workout_name`, `workout_type`; `duration_min`, `difficulty`, `notes`, `scheduled_workout_id`, `completed` optional/derived. `created_at` is the canonical timestamp.
   - Difficulty constraint: `family_workouts_difficulty_check` allows `BEGINNER`, `INTERMEDIATE`, or `ADVANCED`; send `NULL` when the UI selection is empty or unmapped.

3. **Canonical date format rule**
   - `workout_date` uses `YYYY-MM-DD` local day keys from `toLocalDayKey`.

4. **Canonical CRUD entrypoints**
   - Read: `loadWorkouts()` (full list), `fetchWorkoutsByDate(date)` (eq or gte/lt range by day).
   - Create: `logWorkoutToDiary()` (invokes `family_workouts` edge function with payload), workouts form submit (direct insert when authenticated).
   - Update: `updateWorkoutLoggedState()` marks scheduled rows completed for today.
   - Delete: `deleteWorkoutById()` (direct delete by `id`), edge function delete action (`action: delete`).
   - Plan seeding: `applyCoachUpdates()` bulk deletes+inserts for generated week plans.

5. **Invariants**
   - Logged workouts carry `completed=true`; `created_at` records when the row was added. Scheduled/plan rows keep `completed=false` until promoted.
   - Family-scoped queries should include `family_group_id`; offline-only rows should be reconciled to Supabase when connectivity returns.
   - Diary streaks rely on Supabase-backed `family_workouts`; cached data is refreshed then re-cached.

## Scheduled workouts (plan)

1. **Source of truth**
   - Supabase `family_workouts` with `completed=false`. AI coach seeds week plans; manual adds can also be scheduled by leaving `completed` false.

2. **Schema assumptions**
   - Same as Workouts log; `scheduled_workout_id` or source IDs may link plan to logged entries.

3. **Canonical date format rule**
   - `workout_date` `YYYY-MM-DD` local day key.

4. **Canonical CRUD entrypoints**
   - Read: `loadWorkouts()` and UI filters for `!isWorkoutLogged`.
   - Create/Replace: `applyCoachUpdates()` (bulk delete by date range, then insert), manual workout form inserts with `completed=true` (currently treated as logged immediately).
   - Promote to log: `logWorkoutToDiary()` updates plan rows by `id` when day matches.

5. **Invariants**
   - Plan rows should stay in Supabase until completed; avoid local-only mutations for plan state.
   - When promoting to log, reuse the same row where possible to prevent duplicate plan/log rows for the same day.

## Progress / weight

1. **Source of truth**
   - Supabase table: `progress_logs`. No local cache; reload requires Supabase fetch.

2. **Schema assumptions**
   - Primary key: `id` (UUID).
   - Ownership: `family_group_id` required; `user_id` stored on insert.
   - Date column: `log_date` (`YYYY-MM-DD`).
   - Required fields to insert: `family_group_id`, `user_id`, `log_date`; metrics (`weight_lb`, `water_oz`, `sleep_hours`, `steps`, `mood`, `notes`) optional.

3. **Canonical date format rule**
   - `log_date` uses `YYYY-MM-DD` local day keys supplied by the UI date input.

4. **Canonical CRUD entrypoints**
   - Read: `loadProgressLogs()` (family scoped, ordered by `log_date`).
   - Create: progress form submit handler inserts a single row.
   - Delete: progress list click handler deletes by `id`.

5. **Invariants**
   - All persisted entries must include `family_group_id`; UI should not cache progress locally beyond in-memory store.
   - Deletions should honor `family_group_id` to avoid cross-family removals.

## Grocery list

1. **Source of truth**
   - Supabase table: `grocery_list_items`. In-memory list mirrors server; no durable local cache.

2. **Schema assumptions**
   - Primary key: `id`.
   - Ownership: `family_group_id` required; `added_by` stored on insert.
   - Date columns: none (list items are timeless).
   - Required fields to insert: `family_group_id`, `name`; optional `quantity`, `category`, `added_by`; `checked` toggled via updates.

3. **Canonical date format rule**
   - Not applicable; list items are not date-keyed.

4. **Canonical CRUD entrypoints**
   - Read: `loadGroceryItems()` (family scoped, ordered by `created_at`).
   - Create: grocery form submit handler inserts a row.
   - Update: checkbox handler updates `checked` (and `updated_at`).
   - Delete: list delete handler deletes by `id`; AI coach sync may bulk delete then insert.

5. **Invariants**
   - Mutations should include `family_group_id` in filters to avoid cross-family edits.
   - Coach bulk sync replaces the entire family list; UI should refresh immediately after.
