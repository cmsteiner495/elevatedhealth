// js/workouts.js
import { supabase } from "./supabaseClient.js";
import {
  workoutsNoFamily,
  workoutsHasFamily,
  workoutsForm,
  workoutDateInput,
  workoutTitleInput,
  workoutTypeInput,
  workoutDifficultyInput,
  workoutDurationInput,
  workoutNotesInput,
  workoutsMessage,
  workoutsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  toLocalDateString,
  toLocalDayKey,
  addDays,
  getTodayDate,
} from "./state.js";
import { guardMutation } from "./debug/mutationGuard.js";
import { maybeVibrate, showToast } from "./ui.js";
import { readWorkoutsStore, saveWorkouts } from "./dataAdapter.js";
import { setWorkouts, upsertWorkout, removeWorkout } from "./ehStore.js";
import { isWorkoutLogged } from "./selectors.js";

let workoutsCache = [];
const LOCAL_ID_PREFIX = "local-";

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

function isWorkoutLoggedAtSchemaError(error) {
  if (!error) return false;
  const message = String(error?.message || error?.details || "").toLowerCase();
  const code = String(error?.code || "");
  return code === "PGRST204" || (message.includes("logged_at") && message.includes("could not find"));
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
      .select()
      .single();
    guardMutation({
      table: "family_workouts",
      operation: "update",
      filters: { id: workoutId, family_group_id: currentFamilyId },
    });
    return query;
  };

  let result = await buildQuery(payload);

  if (!result.error || !isWorkoutLoggedAtSchemaError(result.error)) {
    return result;
  }

  console.warn(
    "[EH WORKOUT] logged_at missing in schema cache; retrying without logged_at. Restart Supabase API / wait for schema cache refresh.",
    result.error
  );

  const { logged_at, ...retryPayload } = payload || {};
  return buildQuery(retryPayload);
}

function parseDuration(value) {
  if (value == null) return null;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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
    workoutsCache = storedWorkouts;
    setWorkouts(storedWorkouts, { reason: "loadWorkouts:unscoped" });
    renderWorkouts();
    if (workoutsMessage && storedWorkouts.length) {
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
      workoutsCache = storedWorkouts;
      setWorkouts(storedWorkouts, { reason: "loadWorkouts:offline" });
      renderWorkouts();
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
    const remoteWorkouts = (data || []).map((item) =>
      normalizeWorkoutRow({ log_id: item.id, ...item })
    );
    const merged = mergeWorkouts(remoteWorkouts, storedWorkouts.map(normalizeWorkoutRow));
    persistWorkoutsForFamily(familyId, merged);
    workoutsCache = merged;
    setWorkouts(merged, { reason: "loadWorkouts" });
    renderWorkouts();
  }
}

export async function fetchWorkoutsByDate(dateValue) {
  if (!dateValue) return [];

  const familyId = currentFamilyId;
  const storedWorkouts = getStoredWorkouts(familyId).map(normalizeWorkoutRow);
  const targetDayKey = normalizeWorkoutDay(dateValue);
  const storedForDate = storedWorkouts.filter(
    (workout) => getWorkoutDayKey(workout) === targetDayKey && isWorkoutLogged(workout)
  );

  if (!familyId) return storedForDate;

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
    return storedForDate;
  }

  const merged = mergeWorkouts(
    (data || []).map((item) => normalizeWorkoutRow({ log_id: item.id, ...item })),
    storedWorkouts.map(normalizeWorkoutRow)
  );
  persistWorkoutsForFamily(familyId, merged);
  return merged.filter(
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

  // If this scheduled workout already exists for today, mark it complete instead of
  // creating a duplicate row.
  const scheduledRowId = workout.id || workout.log_id;
  if (scheduledRowId && getWorkoutDayKey(workout) === targetDate) {
    const updatePayload = {
      completed: true,
      logged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await updateWorkoutLoggedState(scheduledRowId, updatePayload);

    if (error) {
      console.error("Error logging scheduled workout:", error);
      showToast("Couldn't add workout. Try again.");
      return { ok: false, error };
    }

    const mergedRow = normalizeWorkoutRow({
      ...workout,
      ...updatePayload,
      ...(data || {}),
      source: getWorkoutSource(workout),
    });
    workoutsCache = mergeWorkouts(
      workoutsCache.filter((item) => String(item.id) !== String(workout.id)),
      [mergedRow]
    );
    persistWorkoutsForFamily(currentFamilyId, workoutsCache);
    upsertWorkout(mergedRow, { reason: "logWorkout:update" });
    renderWorkouts();
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: targetDate, entity: "exercise" },
      })
    );
    announceDataChange("workouts", targetDate);
    maybeVibrate([12]);
    showToast("Added to log");
    console.log("[EH WORKOUT] schedule add success", {
      id: mergedRow.id || scheduledRowId,
      day: targetDate,
    });
    return { ok: true, workout: mergedRow };
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

  const duration = parseDuration(workout.duration_min ?? workout.duration);
  const source = scheduledId ? "scheduled" : "manual";
  const payload = {
    action: "add",
    family_group_id: currentFamilyId,
    added_by: currentUser.id || null,
    workout_date: targetDate,
    workout_name: title,
    title,
    workout_type: workout.workout_type || workout.workoutType || "workout",
    difficulty: workout.difficulty || null,
    duration_min: duration,
    notes: workout.notes || null,
    scheduled_workout_id: scheduledId ? String(scheduledId) : null,
  };
  console.debug("[WORKOUT INSERT]", payload);

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
    logged_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  workoutsCache = mergeWorkouts(workoutsCache, [optimisticEntry]);
  persistWorkoutsForFamily(currentFamilyId, workoutsCache);
  upsertWorkout(optimisticEntry, { reason: "logWorkout:optimistic" });
  renderWorkouts();

  const { data, error } = await supabase.functions.invoke("family_workouts", {
    body: payload,
  });

  console.debug("[WORKOUT INSERT RESULT]", { data, error });

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

  const persisted = normalizeWorkoutRow({
    ...optimisticEntry,
    ...(data?.workout || {}),
    id: data?.workout?.id || data?.log_id || optimisticEntry.id,
    log_id: data?.log_id || data?.workout?.id || optimisticEntry.log_id,
    workout_date: data?.workout?.workout_date || targetDate,
    completed: true,
    logged_at:
      data?.workout?.logged_at || optimisticEntry.logged_at || new Date().toISOString(),
    source,
  });

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
    if (w.difficulty) {
      const diffLabel =
        w.difficulty.charAt(0).toUpperCase() + w.difficulty.slice(1);
      metaText += ` • ${diffLabel}`;
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

    const normalizeDateValue = (value) => {
      if (!value) return "";
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return toLocalDateString(parsed);
      }
      return value;
    };

    const dateValue = normalizeDateValue(
      workoutDateInput.value || new Date().toISOString()
    );
    const title = workoutTitleInput.value.trim();
    const workoutType = workoutTypeInput.value;
    const difficulty = workoutDifficultyInput.value || null;
    const durationRaw = workoutDurationInput.value;
    const parsedDuration = durationRaw ? parseInt(durationRaw, 10) : null;
    const durationMin = Number.isFinite(parsedDuration) ? parsedDuration : null;
    const notes = workoutNotesInput.value.trim();

    if (!dateValue || !title || !workoutType) {
      if (workoutsMessage) {
        workoutsMessage.textContent = "Please add a title, type, and date.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    const loggedAt = new Date().toISOString();
    const dayKey = toLocalDayKey(dateValue) || dateValue;
    const payload = {
      family_group_id: currentFamilyId || null,
      added_by: currentUser?.id || null,
      workout_date: dayKey,
      title,
      workout_type: workoutType,
      difficulty,
      duration_min: durationMin,
      notes: notes || null,
      completed: true,
      logged_at: loggedAt,
    };
    console.debug("[WORKOUT INSERT]", payload);

    if (!currentFamilyId || !currentUser) {
      if (workoutsMessage) {
        workoutsMessage.textContent = "Join a family to log workouts.";
        workoutsMessage.style.color = "red";
      }
      showToast("Join a family to log workouts.");
      return;
    }

    let persistedWorkout = null;
    const { data, error } = await supabase
      .from("family_workouts")
      .insert(payload)
      .select()
      .single();
    console.debug("[WORKOUT INSERT RESULT]", { data, error });

    if (error) {
      console.error("Error adding workout:", error);
      if (workoutsMessage) {
        workoutsMessage.textContent = "Couldn't save workout. Check your connection and retry.";
        workoutsMessage.style.color = "red";
      }
      showToast("Couldn't save workout. Try again.");
      return;
    }

    persistedWorkout = normalizeWorkoutRow({
      ...data,
      log_id: data?.log_id || data?.id,
      source: "manual",
    });

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
        detail: { date: dateValue, entity: "exercise" },
      })
    );
    announceDataChange("workouts", dateValue);
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
