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
import { currentUser, currentFamilyId, toLocalDateString } from "./state.js";
import { maybeVibrate, showToast } from "./ui.js";
import { readWorkoutsStore, saveWorkouts } from "./dataAdapter.js";
import { setWorkouts, upsertWorkout, removeWorkout } from "./ehStore.js";

let workoutsCache = [];
const LOCAL_ID_PREFIX = "local-";

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
    const key = workout.id
      ? `id:${workout.id}`
      : `${workout.workout_date || ""}:${workout.title || ""}`;
    const existing = map.get(key) || {};
    map.set(key, { ...existing, ...workout });
  };
  primary.forEach(add);
  secondary.forEach(add);
  return Array.from(map.values()).sort((a, b) =>
    (a.workout_date || "").localeCompare(b.workout_date || "")
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
  const filtered = existing.filter((item) => String(item.id) !== String(workoutId));
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

  const storedWorkouts = getStoredWorkouts(familyId);
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

  const { data, error } = await supabase
    .from("family_workouts")
    .select("*")
    .eq("family_group_id", familyId)
    .order("workout_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
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
    const remoteWorkouts = data || [];
    const merged = mergeWorkouts(remoteWorkouts, storedWorkouts);
    persistWorkoutsForFamily(familyId, merged);
    workoutsCache = merged;
    setWorkouts(merged, { reason: "loadWorkouts" });
    renderWorkouts();
  }
}

export async function fetchWorkoutsByDate(dateValue) {
  if (!dateValue) return [];

  const familyId = currentFamilyId;
  const storedWorkouts = getStoredWorkouts(familyId);
  const storedForDate = storedWorkouts.filter(
    (workout) => (workout.workout_date || "") === dateValue
  );

  if (!familyId) return storedForDate;

  const { data, error } = await supabase
    .from("family_workouts")
    .select("*")
    .eq("family_group_id", familyId)
    .eq("workout_date", dateValue)
    .order("workout_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading workouts for date:", error);
    return storedForDate;
  }

  const merged = mergeWorkouts(data || [], storedWorkouts);
  persistWorkoutsForFamily(familyId, merged);
  return merged.filter((workout) => (workout.workout_date || "") === dateValue);
}

export async function deleteWorkoutById(workoutId, options = {}) {
  if (!workoutId) return { error: new Error("Missing workout id") };
  const normalizedId = String(workoutId);
  const familyId = currentFamilyId;
  const dateDetail = options.date || options.workout_date;
  const shouldForceLocalRemoval = normalizedId.startsWith(LOCAL_ID_PREFIX);

  let deleteError = null;

  if (familyId && !shouldForceLocalRemoval) {
    let query = supabase
      .from("family_workouts")
      .delete()
      .eq("id", normalizedId)
      .eq("family_group_id", familyId);
    if (currentUser?.id) {
      query = query.eq("user_id", currentUser.id);
    }
    const { error } = await query;
    if (error) {
      deleteError = error;
    }
  }

  if (deleteError && shouldForceLocalRemoval) {
    console.warn("[WORKOUT DELETE] Local removal despite error", deleteError);
    deleteError = null;
  }

  if (!deleteError) {
    removeStoredWorkout(normalizedId, familyId);
    workoutsCache = workoutsCache.filter((workout) => String(workout.id) !== normalizedId);
    persistWorkoutsForFamily(familyId, workoutsCache);
    removeWorkout(normalizedId, { reason: options.reason || "deleteWorkout" });
    setWorkouts(workoutsCache, { reason: options.reason || "deleteWorkout" });
    announceDataChange("workouts", dateDetail);
  }

  return { error: deleteError };
}

function renderWorkouts(items = workoutsCache) {
  if (!workoutsList) return;

  if (!items.length) {
    workoutsList.innerHTML = "<li>No workouts yet. Add one above!</li>";
    return;
  }

  workoutsList.innerHTML = "";

  for (const w of items) {
    const li = document.createElement("li");
    li.dataset.workoutId = w.id;
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

    const dateStr = w.workout_date;
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

    const completedCheckbox = document.createElement("input");
    completedCheckbox.type = "checkbox";
    completedCheckbox.checked = w.completed || false;
    completedCheckbox.classList.add("workout-completed-checkbox");

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("workout-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(completedCheckbox);
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

    const payload = {
      family_group_id: currentFamilyId || null,
      added_by: currentUser?.id || null,
      user_id: currentUser?.id || null,
      workout_date: dateValue,
      title,
      workout_type: workoutType,
      difficulty,
      duration_min: durationMin,
      notes: notes || null,
    };

    let persistedWorkout = null;

    if (currentFamilyId && currentUser) {
      const { data, error } = await supabase
        .from("family_workouts")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error("Error adding workout:", error);
        if (error?.message) console.error("Workout API message:", error.message);
        if (error?.details)
          console.error("Workout API details:", error.details);
        if (error?.hint) console.error("Workout API hint:", error.hint);
        if (error?.status) console.error("Workout API status:", error.status);

        if (workoutsMessage) {
          workoutsMessage.textContent = "Saved locally (sync coming soon).";
          workoutsMessage.style.color = "var(--text-muted)";
        }
      } else {
        persistedWorkout = data;
      }
    }

    const localWorkout =
      persistedWorkout ||
      {
        ...payload,
        id: `local-${Date.now()}`,
        created_at: new Date().toISOString(),
      };

    workoutsCache = mergeWorkouts(workoutsCache, [localWorkout]);
    upsertStoredWorkout(localWorkout);
    upsertWorkout(localWorkout, { reason: "addWorkout" });
    console.log("[EH WORKOUT] saved + store upsert");
    renderWorkouts();
    workoutsForm.reset();

    if (persistedWorkout) {
      await loadWorkouts();
      showToast("Exercise logged");
    } else {
      showToast("Saved locally (sync coming soon)");
      if (workoutsMessage) {
        workoutsMessage.textContent = "Saved locally (sync coming soon).";
        workoutsMessage.style.color = "var(--text-muted)";
      }
    }

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

    if (e.target.classList.contains("workout-completed-checkbox")) {
      const completed = e.target.checked;
      const updated = workoutsCache.map((workout) =>
        workout.id === workoutId ? { ...workout, completed } : workout
      );
      workoutsCache = updated;
      renderWorkouts();
      const { error } = await supabase
        .from("family_workouts")
        .update({ completed, updated_at: new Date().toISOString() })
        .eq("id", workoutId);

      if (error) {
        console.error("Error updating workout:", error);
        workoutsCache = workoutsCache.map((workout) =>
          workout.id === workoutId ? { ...workout, completed: !completed } : workout
        );
        renderWorkouts();
        return;
      }
      persistWorkoutsForFamily(currentFamilyId, workoutsCache);
      setWorkouts(workoutsCache, { reason: "toggleWorkout" });
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "exercise" } })
      );
      announceDataChange("workouts");
      return;
    }

    if (e.target.classList.contains("workout-delete")) {
      li.classList.add("list-removing");
      const { error } = await deleteWorkoutById(workoutId, {
        reason: "deleteWorkout:list",
      });

      if (error) {
        console.error("Error deleting workout:", error);
        if (String(error?.message || "").toLowerCase().includes("rls")) {
          console.error(
            "Supabase RLS: allow workout owners to delete their own rows:\n" +
              "create policy \"Allow users to delete own workouts\" on family_workouts for delete using (auth.uid() = user_id);"
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
