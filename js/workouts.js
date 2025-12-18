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
import { currentUser, currentFamilyId } from "./state.js";
import { maybeVibrate, showToast } from "./ui.js";

let workoutsCache = [];

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
  if (!currentFamilyId || !workoutsList) return;

  if (workoutsMessage) {
    workoutsMessage.textContent = "";
    workoutsMessage.style.color = "";
  }
  workoutsList.innerHTML = "<li>Loading workouts...</li>";

  const { data, error } = await supabase
    .from("family_workouts")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("workout_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading workouts:", error);
    workoutsList.innerHTML = "<li>Could not load workouts.</li>";
  } else {
    workoutsCache = data || [];
    renderWorkouts();
  }
}

export async function fetchWorkoutsByDate(dateValue) {
  if (!currentFamilyId || !dateValue) return [];

  const { data, error } = await supabase
    .from("family_workouts")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .eq("workout_date", dateValue)
    .order("workout_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading workouts for date:", error);
    return [];
  }

  return data || [];
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

    if (!currentUser || !currentFamilyId) {
      if (workoutsMessage) {
        workoutsMessage.textContent =
          "You need a family group to add workouts.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    const dateValue = workoutDateInput.value;
    const title = workoutTitleInput.value.trim();
    const workoutType = workoutTypeInput.value;
    const difficulty = workoutDifficultyInput.value || null;
    const durationRaw = workoutDurationInput.value;
    const durationMin = durationRaw ? Number(durationRaw) : null;
    const notes = workoutNotesInput.value.trim();

    if (!dateValue || !title || !workoutType) return;

    const { error } = await supabase.from("family_workouts").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      workout_date: dateValue,
      title,
      workout_type: workoutType,
      difficulty,
      duration_min: durationMin,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding workout:", error);
      if (workoutsMessage) {
        workoutsMessage.textContent = "Error adding workout.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    workoutsForm.reset();
    await loadWorkouts();
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: dateValue, entity: "exercise" },
      })
    );
    showToast("Exercise logged");
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
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "exercise" } })
      );
      return;
    }

    if (e.target.classList.contains("workout-delete")) {
      li.classList.add("list-removing");
      const { error } = await supabase
        .from("family_workouts")
        .delete()
        .eq("id", workoutId);

      if (error) {
        console.error("Error deleting workout:", error);
        li.classList.remove("list-removing");
        return;
      }

      workoutsCache = workoutsCache.filter((workout) => workout.id !== workoutId);
      setTimeout(() => renderWorkouts(), 160);
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "exercise" } })
      );
      return;
    }
  });
}
