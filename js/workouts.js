// js/workouts.js
import { supabase } from "./supabaseClient.js";
import {
  workoutsNoFamily,
  workoutsHasFamily,
  workoutsForm,
  workoutDateInput,
  workoutTitleInput,
  workoutTypeInput,
  workoutDurationInput,
  workoutNotesInput,
  workoutsMessage,
  workoutsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  toLocalDayKey,
  addDays,
  getTodayDate,
} from "./state.js";
import { guardMutation } from "./debug/mutationGuard.js";
import { maybeVibrate, showToast } from "./ui.js";
import { readWorkoutsStore, saveWorkouts } from "./dataAdapter.js";
import { setWorkouts, upsertWorkout, removeWorkout } from "./ehStore.js";
import { isWorkoutLogged } from "./selectors.js";
import {
  estimateWorkoutCalories,
  getLatestWeightKgForDate,
} from "./workoutCalories.js";

let workoutsCache = [];
const LOCAL_ID_PREFIX = "local-";
const isDevWorkoutsEnv =
  typeof window !== "undefined" &&
  window.location &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const patchedCaloriesIds = new Set();
const caloriesPatchGuardState = {
  disabled: false,
  logged: false,
};
let manualInsertCaloriesFallbackLogged = false;

function debugWorkouts(...args) {
  if (isDevWorkoutsEnv) {
    console.debug(...args);
  }
}

function getTodayDayKey() {
  return getTodayDate ? getTodayDate() : toLocalDayKey(new Date());
}

function normalizeTitle(value) {
  return (value || "").toString().trim().toLowerCase();
}

function normalizeWorkoutDay(value) {
  return toLocalDayKey(value) || "";
}

function buildWorkoutDateRange(dayKey) {
  const normalized = toLocalDayKey(dayKey);
  if (!normalized) return { startDate: null, nextDate: null };
  return { startDate: normalized, nextDate: addDays(normalized, 1) };
}

function getWorkoutSource(workout) {
  if (!workout) return "manual";
  if (workout.source) return workout.source;
  if (workout.completed === false) return "scheduled";
  return workout.scheduled_workout_id || workout.source_scheduled_id ? "scheduled" : "manual";
}

function getWorkoutDayKey(workout) {
  if (!workout) return "";
  return (
    normalizeWorkoutDay(workout.workout_date || workout.date || workout.day_key) || ""
  );
}

function buildWorkoutKey(workout) {
  if (!workout) return "";
  const id = workout.id || workout.log_id;
  if (id) return `id:${id}`;
  const dayKey = getWorkoutDayKey(workout);
  const normalizedTitle = normalizeTitle(workout.title || workout.workout_name || "");
  const scheduledKey = workout.scheduled_workout_id || workout.source_scheduled_id || "";
  const source = getWorkoutSource(workout);
  return `${source}:${scheduledKey || "unscheduled"}:${dayKey}:${normalizedTitle}`;
}

function normalizeWorkoutRow(workout = {}) {
  const dayKey = getWorkoutDayKey(workout);
  const source = getWorkoutSource(workout);
  const normalizedTitle = workout.title || workout.workout_name || "";
  const normalized = {
    ...workout,
    title: normalizedTitle,
    day_key: dayKey || workout.day_key || null,
    workout_date: workout.workout_date || dayKey || workout.date || null,
    source,
  };
  if (!normalized.log_id && normalized.id) {
    normalized.log_id = normalized.id;
  }
  return normalized;
}

async function updateWorkoutLoggedState(workoutId, payload) {
  if (!currentFamilyId) {
    guardMutation({
      table: "family_workouts",
      operation: "update",
      filters: { id: workoutId },
    });
    return { data: null, error: new Error("Missing family id for workout update") };
  }

  const buildQuery = (body) => {
    const query = supabase
      .from("family_workouts")
      .update(body)
      .eq("id", workoutId)
      .eq("family_group_id", currentFamilyId)
      .select();
    guardMutation({
      table: "family_workouts",
      operation: "update",
      filters: { id: workoutId, family_group_id: currentFamilyId },
    });
    return query;
  };

  const { data, error } = await buildQuery(payload);
  if (error) {
    console.warn("[WORKOUT UPDATE] Update failed", { workoutId, error, payload });
    return { data: null, error };
  }

  const updated = Array.isArray(data) ? data[0] : data || null;
  if (!updated) {
    console.warn("[WORKOUT UPDATE] No rows updated", {
      workoutId,
      family_group_id: currentFamilyId,
    });
  }

  return { data: updated, error: null };
}

function parseDuration(value) {
  if (value == null) return null;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCalories(value) {
  const num = Number(value);
  if (Number.isFinite(num)) return Math.round(num);
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCaloriesSchemaCacheError(error) {
  if (!error) return false;
  const code = error.code || "";
  const message = error.message || "";
  return code === "PGRST204" || message.includes("Could not find the 'calories_burned' column");
}

async function computeWorkoutCalories(workout = {}) {
  try {
    const dayKey = getWorkoutDayKey(workout) || workout.workout_date || new Date();
    const weightKg = await getLatestWeightKgForDate(dayKey);
    const durationMin = parseDuration(workout.duration_min ?? workout.duration);
    const workoutType = workout.workout_type || workout.workoutType || "workout";
    const title = workout.title || workout.workout_name || "";
    return estimateWorkoutCalories({
      workout_type: workoutType,
      title,
      duration_min: durationMin,
      weight_kg: weightKg,
    });
  } catch (err) {
    console.warn("[WORKOUT CALORIES] compute failed; using 0", err);
    return 0;
  }
}

async function maybePatchWorkoutCalories(workout, calories) {
  const workoutId = workout?.id;
  if (!workoutId || workoutId.toString().startsWith(LOCAL_ID_PREFIX)) return;
  if (!currentFamilyId) return;
  if (patchedCaloriesIds.has(workoutId)) return;
  if (caloriesPatchGuardState.disabled) return;

  patchedCaloriesIds.add(workoutId);
  guardMutation({
    table: "family_workouts",
    operation: "update",
    filters: { id: workoutId, family_group_id: currentFamilyId },
  });
  const { error } = await supabase
    .from("family_workouts")
    .update({ calories_burned: calories })
    .eq("id", workoutId)
    .eq("family_group_id", currentFamilyId);

  if (!error) return;

  patchedCaloriesIds.delete(workoutId);

  const message = error?.message || "";
  const code = error?.code || "";
  const schemaCacheMismatch =
    isCaloriesSchemaCacheError(error) || message.includes("schema cache");

  if (schemaCacheMismatch) {
    caloriesPatchGuardState.disabled = true;
    if (!caloriesPatchGuardState.logged) {
      console.info(
        "[WORKOUT CALORIES] Patch disabled for session (schema cache mismatch)",
        { code, message }
      );
      caloriesPatchGuardState.logged = true;
    }
    return;
  }

  console.warn("[WORKOUT CALORIES] Patch failed", { workoutId, error });
}

async function ensureWorkoutCalories(workout = {}) {
  const normalizedDuration = parseDuration(workout.duration_min ?? workout.duration);
  const caloriesFromRow = parseCalories(workout.calories_burned ?? workout.calories);
  const base = {
    ...workout,
    duration_min: normalizedDuration,
  };

  if (caloriesFromRow != null) {
    return { ...base, calories_burned: caloriesFromRow };
  }

  const calories = await computeWorkoutCalories({
    ...workout,
    duration_min: normalizedDuration,
  }).catch((err) => {
    console.warn("[WORKOUT CALORIES] Enrichment failed; using 0", err);
    return 0;
  });
  const withCalories = { ...base, calories_burned: calories };
  if (workout?.id && currentFamilyId) {
    maybePatchWorkoutCalories(workout, calories).catch((err) => {
      console.warn("[WORKOUT CALORIES] Patch promise rejected", err);
    });
  }
  return withCalories;
}

async function enrichWorkoutsWithCalories(workouts = []) {
  const result = [];
  for (const workout of workouts) {
    const normalized = normalizeWorkoutRow(workout);
    const withCalories = await ensureWorkoutCalories(normalized);
    result.push(withCalories);
  }
  return result;
}

function readWorkoutStore() {
  const snapshot = readWorkoutsStore();
  if (
    snapshot.shape === "map" &&
    snapshot.parsed &&
    typeof snapshot.parsed === "object" &&
    !Array.isArray(snapshot.parsed)
  ) {
    return { ...snapshot.parsed };
  }

  const list = Array.isArray(snapshot.parsed) ? snapshot.parsed : [];
  return { unscoped: list };
}

function writeWorkoutStore(store) {
  saveWorkouts(store || {});
}

export function getStoredWorkouts(familyId) {
  const targetKey = familyId || "unscoped";
  const store = readWorkoutStore();
  const list = store[targetKey] || store.unscoped || [];
  const normalized = Array.isArray(list)
    ? list
    : list && typeof list === "object"
    ? Object.values(list)
    : [];
  return normalized.filter(Boolean);
}

function persistWorkoutsForFamily(familyId, workouts = []) {
  const targetKey = familyId || "unscoped";
  const store = readWorkoutStore();
  store[targetKey] = Array.isArray(workouts) ? workouts : [];
  writeWorkoutStore(store);
}

function mergeWorkouts(primary = [], secondary = []) {
  const map = new Map();
  const add = (workout) => {
    if (!workout) return;
    const key = buildWorkoutKey(workout);
    const existing = map.get(key) || {};
    map.set(key, { ...existing, ...workout });
  };
  primary.forEach(add);
  secondary.forEach(add);
  return Array.from(map.values()).sort((a, b) =>
    (getWorkoutDayKey(a) || "").localeCompare(getWorkoutDayKey(b) || "")
  );
}

function upsertStoredWorkout(workout) {
  if (!workout) return;
  const merged = mergeWorkouts(getStoredWorkouts(currentFamilyId), [workout]);
  persistWorkoutsForFamily(currentFamilyId, merged);
}

function removeStoredWorkout(workoutId, familyId = currentFamilyId) {
  if (!workoutId) return;
  const existing = getStoredWorkouts(familyId);
  const filtered = existing.filter(
    (item) =>
      String(item.id) !== String(workoutId) &&
      String(item.log_id || "") !== String(workoutId)
  );
  persistWorkoutsForFamily(familyId, filtered);
}

export function cacheWorkoutsLocally(familyId, workouts = []) {
  const targetKey = familyId || "unscoped";
  persistWorkoutsForFamily(targetKey, workouts);
}

function announceDataChange(entity, date) {
  const detail = entity || date ? { source: entity, date } : { source: entity };
  window.dispatchEvent(new CustomEvent("eh:data-changed", { detail }));
  window.dispatchEvent(new CustomEvent("eh:dataChanged", { detail }));
}

export function setWorkoutsFamilyState() {
  if (!workoutsNoFamily || !workoutsHasFamily) return;

  if (currentFamilyId) {
    workoutsNoFamily.style.display = "none";
    workoutsHasFamily.style.display = "block";
  } else {
    workoutsNoFamily.style.display = "block";
    workoutsHasFamily.style.display = "none";
    workoutsCache = [];
    if (workoutsList) workoutsList.innerHTML = "";
    if (workoutsMessage) {
      workoutsMessage.textContent = "";
      workoutsMessage.style.color = "";
    }
  }
}

export async function loadWorkouts() {
  if (!workoutsList) return;

  const familyId = currentFamilyId;

  if (workoutsMessage) {
    workoutsMessage.textContent = "";
    workoutsMessage.style.color = "";
  }
  workoutsList.innerHTML = "<li>Loading workouts...</li>";

  const storedWorkouts = getStoredWorkouts(familyId).map(normalizeWorkoutRow);
  if (!familyId) {
    const withCalories = await enrichWorkoutsWithCalories(storedWorkouts);
    workoutsCache = withCalories;
    setWorkouts(withCalories, { reason: "loadWorkouts:unscoped" });
    renderWorkouts(withCalories);
    if (workoutsMessage && withCalories.length) {
      workoutsMessage.textContent = "Saved locally (link a family to sync).";
      workoutsMessage.style.color = "var(--text-muted)";
    }
    return;
  }

  const buildLoadQuery = () => {
    return supabase
      .from("family_workouts")
      .select("*")
      .eq("family_group_id", familyId)
      .order("workout_date", { ascending: true })
      .order("created_at", { ascending: true });
  };

  let data = null;
  let error = null;

  const primaryResult = await buildLoadQuery();
  data = primaryResult.data;
  error = primaryResult.error;

  if (error) {
    console.debug("[WORKOUT FETCH]", {
      scope: "all",
      familyId,
      order: ["workout_date", "created_at"],
      error: error?.message || error,
    });
    console.error("Error loading workouts:", error);
    if (storedWorkouts.length) {
      const withCalories = await enrichWorkoutsWithCalories(storedWorkouts);
      workoutsCache = withCalories;
      setWorkouts(withCalories, { reason: "loadWorkouts:offline" });
      renderWorkouts(withCalories);
      if (workoutsMessage) {
        workoutsMessage.textContent = "Showing saved workouts (offline)";
        workoutsMessage.style.color = "var(--text-muted)";
      }
    } else {
      workoutsList.innerHTML = "<li>Could not load workouts.</li>";
      setWorkouts([], { reason: "loadWorkouts:error" });
    }
  } else {
    console.debug("[WORKOUT FETCH]", {
      scope: "all",
      familyId,
      order: ["workout_date", "created_at"],
      count: Array.isArray(data) ? data.length : 0,
    });
    const remoteWorkouts = (data || []).map((item) => normalizeWorkoutRow({ log_id: item.id, ...item }));
    const merged = mergeWorkouts(remoteWorkouts, storedWorkouts.map(normalizeWorkoutRow));
    const withCalories = await enrichWorkoutsWithCalories(merged);
    persistWorkoutsForFamily(familyId, withCalories);
    workoutsCache = withCalories;
    setWorkouts(withCalories, { reason: "loadWorkouts" });
    renderWorkouts(withCalories);
  }
}

export async function fetchWorkoutsByDate(dateValue, options = {}) {
  if (!dateValue) return [];

  const familyId = currentFamilyId;
  const storedWorkouts = getStoredWorkouts(familyId).map(normalizeWorkoutRow);
  const targetDayKey = normalizeWorkoutDay(dateValue);
  const storedForDate = storedWorkouts.filter(
    (workout) => getWorkoutDayKey(workout) === targetDayKey && isWorkoutLogged(workout)
  );

  if (!familyId) return enrichWorkoutsWithCalories(storedForDate);

  console.debug("[EH WORKOUT] fetchWorkoutsByDate", {
    familyId,
    date: dateValue,
    filterDayKey: targetDayKey,
  });

  const { startDate, nextDate } = buildWorkoutDateRange(targetDayKey);

  const buildQuery = (useRange = false) => {
    let query = supabase
      .from("family_workouts")
      .select("*")
      .eq("family_group_id", familyId);

    if (useRange && startDate && nextDate) {
      query = query.gte("workout_date", startDate).lt("workout_date", nextDate);
    } else {
      query = query.eq("workout_date", targetDayKey || dateValue);
    }

    return query.order("workout_date", { ascending: true }).order("created_at", { ascending: true });
  };

  let data = null;
  let error = null;
  let filterType = "eq";

  const primaryResult = await buildQuery(false);
  data = primaryResult.data;
  error = primaryResult.error;

  if (error || (Array.isArray(data) && data.length === 0 && startDate && nextDate)) {
    const fallback = await buildQuery(true);
    data = fallback.data;
    error = fallback.error;
    filterType = "range";
  }

  console.debug("[WORKOUT FETCH]", {
    familyId,
    date: targetDayKey,
    filter: filterType,
    resultCount: Array.isArray(data) ? data.length : 0,
    error: error?.message || null,
  });

  if (error) {
    console.error("Error loading workouts for date:", error);
    if (options.offlineFallback === false) return [];
    return enrichWorkoutsWithCalories(storedForDate);
  }

  const remoteWorkouts = (data || []).map((item) =>
    normalizeWorkoutRow({ log_id: item.id, ...item })
  );
  const withCalories = await enrichWorkoutsWithCalories(remoteWorkouts);
  persistWorkoutsForFamily(familyId, withCalories);
  return withCalories.filter(
    (workout) => getWorkoutDayKey(workout) === targetDayKey && isWorkoutLogged(workout)
  );
}

function findLoggedScheduledMatch(workout, workouts = []) {
  if (!workout) return null;
  if (isWorkoutLogged(workout)) return workout;
  const scheduledId =
    workout.scheduled_workout_id || workout.source_scheduled_id || workout.id || workout.log_id;
  const targetDay = getWorkoutDayKey(workout);
  if (!scheduledId || !targetDay) return null;

  return workouts.find((entry) => {
    if (!isWorkoutLogged(entry)) return false;
    const entryDay = getWorkoutDayKey(entry);
    if (entryDay !== targetDay) return false;
    const matchValues = [
      entry.scheduled_workout_id,
      entry.source_scheduled_id,
      entry.id,
      entry.log_id,
    ]
      .filter((value) => value != null)
      .map(String);
    return matchValues.includes(String(scheduledId));
  });
}

async function deleteWorkoutRow(id) {
  guardMutation({
    table: "family_workouts",
    operation: "delete",
    filters: { id, family_group_id: currentFamilyId },
  });
  const { error } = await supabase
    .from("family_workouts")
    .delete()
    .eq("id", id)
    .eq("family_group_id", currentFamilyId);
  if (error) throw error;
}

export async function deleteWorkoutById(workoutId, options = {}) {
  if (!workoutId) return { error: new Error("Missing workout id") };
  const normalizedId = String(workoutId);
  const dateDetail = options.date || options.workout_date;
  const shouldForceLocalRemoval = normalizedId.startsWith(LOCAL_ID_PREFIX);

  let deleteError = null;

  if (!shouldForceLocalRemoval && !currentFamilyId) {
    guardMutation({
      table: "family_workouts",
      operation: "delete",
      filters: { id: normalizedId },
    });
    deleteError = new Error("Missing family id");
  } else if (!shouldForceLocalRemoval && currentUser?.id) {
    try {
      await deleteWorkoutRow(normalizedId);
    } catch (err) {
      console.error("Delete workout failed", err);
      deleteError = err;
    }
  } else if (!shouldForceLocalRemoval && !currentUser?.id) {
    deleteError = new Error("Not authenticated");
  }

  if (deleteError && shouldForceLocalRemoval) {
    console.warn(
      "[WORKOUT DELETE] Local removal despite error",
      deleteError?.message || deleteError
    );
    deleteError = null;
  }

  if (!deleteError) {
    removeStoredWorkout(normalizedId, currentFamilyId);
    workoutsCache = workoutsCache.filter(
      (workout) =>
        String(workout.id) !== normalizedId && String(workout.log_id || "") !== normalizedId
    );
    persistWorkoutsForFamily(currentFamilyId, workoutsCache);
    removeWorkout(normalizedId, { reason: options.reason || "deleteWorkout" });
    setWorkouts(workoutsCache, { reason: options.reason || "deleteWorkout" });
    announceDataChange("workouts", dateDetail);
  }

  return { error: deleteError };
}

async function logWorkoutToDiary(workout) {
  if (!workout) {
    return { ok: false, error: new Error("Missing workout") };
  }
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log workouts.");
    return { ok: false, error: new Error("Missing auth or family") };
  }

  const targetDate = getWorkoutDayKey(workout) || getTodayDayKey();
  const todayKey = getTodayDayKey();
  if (!targetDate) {
    showToast("Couldn't determine the workout date.");
    return { ok: false, error: new Error("Missing workout date") };
  }
  if (targetDate !== todayKey) {
    showToast("You can only add today's scheduled workouts to the log.");
    return { ok: false, error: new Error("Not eligible for today") };
  }

  const title = (workout.title || "").trim();
  if (!title) {
    showToast("Workout is missing a title.");
    return { ok: false, error: new Error("Missing title") };
  }
  const duration = parseDuration(workout.duration_min ?? workout.duration);
  const existingCalories = parseCalories(workout.calories_burned ?? workout.calories);
  const caloriesBurned =
    existingCalories != null
      ? existingCalories
      : await computeWorkoutCalories({
          ...workout,
          workout_date: targetDate,
          duration_min: duration,
          title,
        });

  // If this scheduled workout already exists for today, mark it complete instead of
  // creating a duplicate row.
  const scheduledRowId = workout.id || workout.log_id;
  if (scheduledRowId && getWorkoutDayKey(workout) === targetDate) {
    const updatePayload = {
      completed: true,
      updated_at: new Date().toISOString(),
      calories_burned: caloriesBurned,
      duration_min: duration,
      workout_date: targetDate,
    };
    const { data, error } = await updateWorkoutLoggedState(scheduledRowId, updatePayload);

    if (error) {
      console.error("Error logging scheduled workout:", error);
      showToast("Couldn't add workout. Try again.");
      return { ok: false, error };
    }
    if (!data) {
      console.warn("[WORKOUT UPDATE] No rows marked complete for scheduled workout", {
        scheduledRowId,
        targetDate,
        family_group_id: currentFamilyId,
      });
      try {
        await loadWorkouts();
      } catch (refreshErr) {
        console.warn("Refresh after empty update failed", refreshErr);
      }
    }

    const mergedRow = normalizeWorkoutRow({
      ...workout,
      ...updatePayload,
      ...(data || {}),
      source: getWorkoutSource(workout),
    });
    const mergedWithCalories = await ensureWorkoutCalories(mergedRow);
    workoutsCache = mergeWorkouts(
      workoutsCache.filter((item) => String(item.id) !== String(workout.id)),
      [mergedWithCalories]
    );
    persistWorkoutsForFamily(currentFamilyId, workoutsCache);
    upsertWorkout(mergedWithCalories, { reason: "logWorkout:update" });
    renderWorkouts(workoutsCache);
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: targetDate, entity: "exercise" },
      })
    );
    announceDataChange("workouts", targetDate);
    maybeVibrate([12]);
    showToast("Added to log");
    console.log("[EH WORKOUT] schedule add success", {
      id: mergedWithCalories.id || scheduledRowId,
      day: targetDate,
    });
    return { ok: true, workout: mergedWithCalories };
  }

  const scheduledId =
    workout.scheduled_workout_id || workout.source_scheduled_id || workout.id || null;
  const stored = getStoredWorkouts(currentFamilyId);
  const duplicate = stored.find((entry) => {
    const entryDay = getWorkoutDayKey(entry) || entry.workout_date || "";
    if (entryDay !== targetDate) return false;
    const scheduledMatch =
      scheduledId &&
      (String(entry.scheduled_workout_id || "") === String(scheduledId) ||
        String(entry.id || "") === String(scheduledId) ||
        String(entry.log_id || "") === String(scheduledId));
    const nameMatch = normalizeTitle(entry.title) === normalizeTitle(title);
    const isSameRow = String(entry.id) === String(workout.id);
    return !isSameRow && (scheduledMatch || nameMatch);
  });
  if (duplicate) {
    showToast("Already logged for this day.");
    return { ok: false, error: new Error("Already logged") };
  }

  const source = scheduledId ? "scheduled" : "manual";
  const payload = {
    action: "add",
    family_group_id: currentFamilyId,
    added_by: currentUser.id || null,
    workout_date: targetDate,
    workout_name: title,
    title,
    workout_type: workout.workout_type || workout.workoutType || "workout",
    duration_min: duration,
    notes: workout.notes || null,
    scheduled_workout_id: scheduledId ? String(scheduledId) : null,
    calories_burned: caloriesBurned,
  };
  debugWorkouts("[WORKOUT INSERT payload]", payload);

  const tempId = `${LOCAL_ID_PREFIX}${Date.now()}`;
  const optimisticEntry = {
    id: tempId,
    log_id: tempId,
    ...workout,
    source,
    title,
    workout_type: payload.workout_type,
    duration_min: duration,
    workout_date: targetDate,
    scheduled_workout_id: payload.scheduled_workout_id,
    completed: true,
    calories_burned: caloriesBurned,
    created_at: new Date().toISOString(),
  };

  workoutsCache = mergeWorkouts(workoutsCache, [optimisticEntry]);
  persistWorkoutsForFamily(currentFamilyId, workoutsCache);
  upsertWorkout(optimisticEntry, { reason: "logWorkout:optimistic" });
  renderWorkouts();

  const { data, error } = await supabase.functions.invoke("family_workouts", {
    body: payload,
  });

  debugWorkouts("[WORKOUT INSERT result]", { data, error });

  if (error || !data?.ok) {
    const details = error?.message || data?.error || "Unknown error";
    console.error("[EH WORKOUT] add failed", error || data);
    console.error("Error adding workout to log via edge function:", error || data);
    workoutsCache = workoutsCache.filter((item) => item.id !== tempId);
    persistWorkoutsForFamily(currentFamilyId, workoutsCache);
    removeWorkout(tempId, { reason: "logWorkout:rollback" });
    renderWorkouts();
    showToast("Couldn't add workout. Try again.");
    if (details) {
      console.warn("family_workouts error:", details);
    }
    console.warn("[EH WORKOUT] schedule add failed", details);
    return { ok: false, error: new Error(details) };
  }

  const persisted = await ensureWorkoutCalories(
    normalizeWorkoutRow({
      ...optimisticEntry,
      ...(data?.workout || {}),
      id: data?.workout?.id || data?.log_id || optimisticEntry.id,
      log_id: data?.log_id || data?.workout?.id || optimisticEntry.log_id,
      workout_date: data?.workout?.workout_date || targetDate,
      completed: true,
      source,
    })
  );

  workoutsCache = mergeWorkouts(
    workoutsCache.filter((item) => item.id !== tempId),
    [persisted]
  );
  persistWorkoutsForFamily(currentFamilyId, workoutsCache);
  upsertWorkout(persisted, { reason: "logWorkout:reconcile" });
  renderWorkouts();
  console.log("[EH WORKOUT] schedule add success", {
    id: persisted.id,
    day: persisted.workout_date,
  });

  document.dispatchEvent(
    new CustomEvent("diary:refresh", {
      detail: { date: targetDate, entity: "exercise" },
    })
  );
  announceDataChange("workouts", targetDate);
  try {
    await loadWorkouts();
  } catch (err) {
    console.warn("Post-log refresh failed", err);
  }
  maybeVibrate([12]);
  showToast("Added to log");
  return { ok: true, workout: persisted };
}

function renderWorkouts(items = workoutsCache) {
  if (!workoutsList) return;
  const today = getTodayDayKey();

  if (!items.length) {
    workoutsList.innerHTML = "<li>No workouts yet. Add one above!</li>";
    return;
  }

  workoutsList.innerHTML = "";

  for (const w of items) {
    const li = document.createElement("li");
    li.dataset.workoutId = w.id || w.log_id;
    li.style.display = "flex";
    li.style.flexDirection = "column";
    li.style.gap = "0.25rem";
    li.style.padding = "0.5rem 0";
    li.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.justifyContent = "space-between";
    topRow.style.alignItems = "center";
    topRow.style.gap = "0.5rem";

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.textContent = w.title;
    title.style.fontWeight = "600";
    if (w.completed) {
      title.style.textDecoration = "line-through";
      title.style.opacity = "0.7";
    }

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const dateStr = getWorkoutDayKey(w) || w.workout_date;
    const typeLabel = w.workout_type
      ? w.workout_type.charAt(0).toUpperCase() + w.workout_type.slice(1)
      : "Workout";

    let metaText = `${typeLabel} • ${dateStr}`;
    const calories = parseCalories(w.calories_burned ?? w.calories);
    if (calories) {
      metaText += ` • ${calories} kcal`;
    }
    if (w.duration_min) {
      metaText += ` • ${w.duration_min} min`;
    }

    meta.textContent = metaText;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const canLogToday = getWorkoutDayKey(w) === today && currentFamilyId;
    const loggedMatch = findLoggedScheduledMatch(w, items);
    const isLogged = isWorkoutLogged(w) || Boolean(loggedMatch);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.classList.add("ghost-btn", "workout-add-log");
    addBtn.textContent = isLogged ? "Added ✓" : "Add";
    addBtn.title = isLogged
      ? "Already added to log"
      : "Add this workout to today's log";
    if (!canLogToday || isLogged) {
      addBtn.disabled = true;
      if (!isLogged && getWorkoutDayKey(w) !== today) {
        addBtn.title = "You can only add today's scheduled workouts to the log.";
      }
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("workout-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(addBtn);
    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    if (w.notes) {
      const notes = document.createElement("div");
      notes.textContent = w.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    workoutsList.appendChild(li);
  }
}

// ADD WORKOUT
if (workoutsForm) {
  workoutsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (workoutsMessage) {
      workoutsMessage.textContent = "";
      workoutsMessage.style.color = "";
    }

    const formatLocalYYYYMMDD = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const normalizeSelectedDay = (value) => {
      if (!value) return "";
      if (value instanceof Date) {
        return formatLocalYYYYMMDD(value);
      }
      if (typeof value === "string") {
        const datePart = value.split("T")[0] || value;
        const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          return match.slice(1).join("-");
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          return formatLocalYYYYMMDD(parsed);
        }
      }
      return "";
    };

    const selectedDay = normalizeSelectedDay(workoutDateInput.value) || getTodayDayKey();
    const title = workoutTitleInput.value.trim();
    const workoutType = workoutTypeInput.value;
    const durationRaw = workoutDurationInput.value;
    const parsedDuration = durationRaw ? parseInt(durationRaw, 10) : null;
    const durationMin = Number.isFinite(parsedDuration) ? parsedDuration : null;
    const notes = workoutNotesInput.value.trim();

    if (!selectedDay || !title || !workoutType) {
      if (workoutsMessage) {
        workoutsMessage.textContent = "Please add a title, type, and date.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    const caloriesBurned = await computeWorkoutCalories({
      workout_date: selectedDay,
      title,
      workout_type: workoutType,
      duration_min: durationMin,
    });
    const payload = {
      family_group_id: currentFamilyId || null,
      added_by: currentUser?.id || null,
      workout_date: selectedDay,
      title,
      workout_type: workoutType,
      duration_min: durationMin,
      notes: notes || null,
      completed: true,
      calories_burned: caloriesBurned,
    };
    if (isDevWorkoutsEnv) {
      console.debug(
        "[WORKOUT INSERT] selectedDay=",
        selectedDay,
        "workout_date=",
        payload.workout_date
      );
    }
    debugWorkouts("[WORKOUT INSERT payload]", payload);

    if (!currentFamilyId || !currentUser) {
      if (workoutsMessage) {
        workoutsMessage.textContent = "Join a family to log workouts.";
        workoutsMessage.style.color = "red";
      }
      showToast("Join a family to log workouts.");
      return;
    }

    let persistedWorkout = null;
    let insertedRow = null;
    try {
      const attemptInsert = (body) =>
        supabase.from("family_workouts").insert(body).select();

      let { data, error } = await attemptInsert(payload);
      debugWorkouts("[WORKOUT INSERT result]", { data, error });

      if (error && isCaloriesSchemaCacheError(error)) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.calories_burned;
        if (!manualInsertCaloriesFallbackLogged) {
          console.info(
            "[WORKOUT INSERT] Retrying without calories_burned (schema cache mismatch)"
          );
          manualInsertCaloriesFallbackLogged = true;
        }
        ({ data, error } = await attemptInsert(fallbackPayload));
        debugWorkouts("[WORKOUT INSERT fallback result]", { data, error });
      }

      if (error) {
        console.error("Error adding workout:", error);
        if (workoutsMessage) {
          workoutsMessage.textContent =
            "Couldn't save workout. Check your connection and retry.";
          workoutsMessage.style.color = "red";
        }
        showToast("Couldn't save workout. Try again.");
        return;
      }

      insertedRow = Array.isArray(data) ? data[0] : data || null;
    } catch (err) {
      console.error("Unexpected error adding workout:", err);
      if (workoutsMessage) {
        workoutsMessage.textContent = "Couldn't save workout. Please retry.";
        workoutsMessage.style.color = "red";
      }
      showToast("Couldn't save workout. Try again.");
      return;
    }

    if (!insertedRow) {
      console.warn("[EH WORKOUT] Insert returned no rows", {
        payload,
        family_group_id: currentFamilyId,
      });
      if (workoutsMessage) {
        workoutsMessage.textContent = "Workout saved, but confirmation was missing. Refreshing…";
        workoutsMessage.style.color = "var(--text-muted)";
      }
      await loadWorkouts();
      return;
    }

    persistedWorkout = await ensureWorkoutCalories(
      normalizeWorkoutRow({
        ...insertedRow,
        log_id: insertedRow?.log_id || insertedRow?.id,
        source: "manual",
      })
    );

    workoutsCache = mergeWorkouts(workoutsCache, [persistedWorkout]);
    upsertStoredWorkout(persistedWorkout);
    upsertWorkout(persistedWorkout, { reason: "addWorkout" });
    console.log("[EH WORKOUT] saved + store upsert");
    renderWorkouts();
    workoutsForm.reset();

    await loadWorkouts();
    showToast("Exercise logged");

    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: selectedDay, entity: "exercise" },
      })
    );
    announceDataChange("workouts", selectedDay);
    maybeVibrate([12]);
  });
}

// TOGGLE COMPLETED + DELETE
if (workoutsList) {
  workoutsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const workoutId = li.dataset.workoutId;
    if (!workoutId) return;

    if (e.target.classList.contains("workout-add-log")) {
      const btn = e.target;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      const workout = workoutsCache.find(
        (item) =>
          String(item.id) === String(workoutId) || String(item.log_id || "") === String(workoutId)
      );
      console.log("[EH WORKOUT] schedule add clicked", {
        workoutId,
        day: getWorkoutDayKey(workout) || workout?.workout_date,
      });
      const result = await logWorkoutToDiary(workout || { id: workoutId });
      if (result?.ok) {
        btn.textContent = "Added ✓";
        btn.title = "Already added to log";
        btn.classList.add("is-added");
      } else {
        console.warn("[EH WORKOUT] schedule add failed", result?.error || "Unknown error");
        btn.disabled = false;
      }
      btn.removeAttribute("aria-busy");
      return;
    }

    if (e.target.classList.contains("workout-delete")) {
      li.classList.add("list-removing");
      const { error } = await deleteWorkoutById(workoutId, {
        reason: "deleteWorkout:list",
      });

      if (error) {
        console.error("Error deleting workout:", error?.message || error);
        if (String(error?.message || "").toLowerCase().includes("rls")) {
          console.error(
            "Supabase RLS: allow workout owners to delete their own rows:\n" +
              "create policy \"Allow users to delete own workouts\" on family_workouts for delete using (auth.uid() = added_by);"
          );
        }
        li.classList.remove("list-removing");
        return;
      }

      setTimeout(() => renderWorkouts(), 160);
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "exercise" } })
      );
      announceDataChange("workouts");
      return;
    }
  });
}
