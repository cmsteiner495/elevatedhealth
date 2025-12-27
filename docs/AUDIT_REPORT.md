# Audit Report

## Mismatches
- **Meal deletion missing family scoping (MED):** `bindMealsListRemoveButtons` deletes `family_meals` rows by `id` only, skipping the `family_group_id` filter used elsewhere, which risks accidental cross-family deletes under lax RLS. (js/app.js:1887-1891)
- **Workout mutations without family guardrails (MED):** `deleteWorkoutRow` and `deleteWorkoutById` delete by `id` only, and `updateWorkoutLoggedState` updates by `id` without scoping to `family_group_id`, relying solely on RLS to prevent cross-family edits. (js/workouts.js:99-115,399-444)
- **Grocery and progress deletes lack family scoping (LOW/MED):** Grocery toggle/delete and progress delete operations filter only by `id`, which could target another family if IDs collide and RLS is permissive. (js/grocery.js:204-227; js/progress.js:249-252)
- **Local-only fallbacks risk drift (MED):** Meal delete falls back to local removal on errors, and workout form inserts are saved locally when Supabase fails with no resync path, so local/offline state can diverge from the database. (js/meals.js:612-679; js/workouts.js:799-859)
- **Upcoming meals data shape unclear (MED):** The app treats planned meals as `family_meals` rows with `completed=false`, while dev tooling still probes for a `family_upcoming_meals` table or flags, signaling no explicit schema flag for “plan” vs. “logged”. (js/debug/dbSanity.js:355-430; js/meals.js filtering uses `isMealLogged`)

## Single Source of Truth Gaps
- **Offline workout entries stay local:** When Supabase inserts fail or the user is unauthenticated, workouts are stored locally with “sync coming soon,” but no process pushes them to Supabase later, so the authoritative source is ambiguous. (js/workouts.js:799-859)
- **Meal delete fallbacks:** Local-only deletion when Supabase errors can leave orphaned server rows visible on other devices. (js/meals.js:612-679)
- **Plan vs. log signaling:** Planned meals/workouts rely on `completed`/`logged_at` rather than a dedicated flag or table, making it hard to enforce invariants or validate queries.
- **Grocery/progress ownership filters:** Missing `family_group_id` filters in mutations reduce confidence that Supabase is the sole arbiter of the list/log state.

## Risk rating
- **HIGH:** None identified in this pass.
- **MED:** Missing family scoping on deletes/updates; local-only fallbacks for meals/workouts; unclear plan-vs-log signaling.
- **LOW:** Grocery/progress `id`-only filters under strict RLS; coach bulk replacements clearing grocery/workout plans without confirmation.

## Suggested remediation order
1. Add `family_group_id` filters to all `delete`/`update` calls for meals, workouts, grocery items, and progress logs; mirror filters in edge functions.
2. Implement a sync path (or user prompt) for locally cached workouts/meals created when Supabase is unavailable; label unsynced entries in the UI.
3. Introduce an explicit plan flag (e.g., `is_planned`/`completed`) or dedicated table for upcoming meals and scheduled workouts, and update queries/guards accordingly.
4. Ensure meal deletion handlers reuse `deleteMealById` (with client ID fallback) instead of direct `id` deletes from the list view.
5. Extend grocery/progress mutations to include `family_group_id` filters and add defensive logging for RLS denials.
6. Add optional dev guards to log when queries reference non-contract columns (e.g., `day_key`) or mutate local-only state for Supabase-backed domains.
