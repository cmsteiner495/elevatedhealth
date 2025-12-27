// js/debug/mutationGuard.js
import { isDebugEnabled } from "./dbSanity.js";

const TABLES_REQUIRING_FAMILY_SCOPE = new Set([
  "family_meals",
  "family_workouts",
  "grocery_list_items",
  "progress_logs",
  "ai_coach_messages",
]);

export function guardMutation({ table, operation, filters = {} } = {}) {
  if (!isDebugEnabled()) return;
  if (!table || !operation) return;
  const normalizedOp = String(operation || "").toLowerCase();
  if (normalizedOp !== "delete" && normalizedOp !== "update") return;
  if (!TABLES_REQUIRING_FAMILY_SCOPE.has(table)) return;

  const hasFamilyScope =
    Object.prototype.hasOwnProperty.call(filters, "family_group_id") &&
    filters.family_group_id != null &&
    filters.family_group_id !== "";

  if (!hasFamilyScope) {
    // eslint-disable-next-line no-console
    console.warn(
      "[EH MUTATION GUARD] Missing family_group_id scope",
      JSON.stringify({ table, operation, filters })
    );
  }
}
