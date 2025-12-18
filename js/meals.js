// js/meals.js
import { supabase } from "./supabaseClient.js";
import {
  mealsNoFamily,
  mealsHasFamily,
  mealsForm,
  mealDateInput,
  mealTypeInput,
  mealTitleInput,
  mealNotesInput,
  mealsMessage,
  mealsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  getTodayDate,
  selectedDate,
  setSelectedDate,
} from "./state.js";
import { maybeVibrate, openModal, setDinnerLogHandler, showToast } from "./ui.js";

async function logMealToDiary(meal, options = {}) {
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const targetDate = options.date || selectedDate || getTodayDate();
  const title = meal.title?.trim();
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || options.mealType || "dinner";
  const notes = meal.notes || meal.description || null;

  const { error } = await supabase.from("family_meals").insert({
    family_group_id: currentFamilyId,
    added_by: currentUser.id,
    meal_date: targetDate,
    meal_type: mealType,
    title,
    notes,
  });

  if (error) {
    console.error("Error logging meal:", error);
    showToast("Could not add meal to log");
    return;
  }

  if (!options.silent) {
    showToast("Added to log");
    maybeVibrate([16]);
  }

  const viewingTarget = selectedDate === targetDate;
  if (!viewingTarget && options.syncDate !== false) {
    setSelectedDate(targetDate, { force: true });
  } else {
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: targetDate, entity: "meal" },
      })
    );
  }

  if (!options.skipReload) {
    await loadMeals();
  }
}

function formatMealDateLabel(dateValue) {
  if (!dateValue) return "";
  const parts = dateValue.split("-").map(Number);
  const [y, m, d] = parts;
  const date = new Date(y || 0, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function openMealDetailsModal(meal) {
  if (!meal) return;
  const body = document.createElement("div");
  body.className = "diary-detail-body";

  const meta = document.createElement("div");
  meta.className = "diary-detail-meta";

  const mealRow = document.createElement("div");
  mealRow.className = "diary-detail-meta-row";
  mealRow.innerHTML = `<span class="diary-detail-meta-label">Meal</span><span class="diary-detail-meta-value">${
    meal.meal_type
      ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)
      : "Meal"
  }</span>`;
  meta.appendChild(mealRow);

  if (meal.meal_date) {
    const dateRow = document.createElement("div");
    dateRow.className = "diary-detail-meta-row";
    dateRow.innerHTML = `<span class="diary-detail-meta-label">Date</span><span class="diary-detail-meta-value">${formatMealDateLabel(
      meal.meal_date
    )}</span>`;
    meta.appendChild(dateRow);
  }

  body.appendChild(meta);

  if (meal.notes) {
    const notes = document.createElement("p");
    notes.className = "diary-detail-note";
    notes.textContent = meal.notes;
    body.appendChild(notes);
  }

  openModal({
    title: meal.title || "Meal",
    body,
    primaryLabel: "Log this meal",
    onPrimary: async () => {
      await logMealToDiary(
        {
          title: meal.title,
          meal_type: meal.meal_type,
          notes: meal.notes,
        },
        { date: selectedDate }
      );
    },
  });
}

setDinnerLogHandler(async (meal) => {
  await logMealToDiary(
    {
      title: meal.title,
      meal_type: "dinner",
      notes: meal.description || meal.notes,
    },
    { date: selectedDate }
  );
});

export function setMealsFamilyState() {
  if (!mealsNoFamily || !mealsHasFamily) return;

  if (currentFamilyId) {
    mealsNoFamily.style.display = "none";
    mealsHasFamily.style.display = "block";
  } else {
    mealsNoFamily.style.display = "block";
    mealsHasFamily.style.display = "none";
    if (mealsList) mealsList.innerHTML = "";
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }
  }
}

export async function loadMeals() {
  if (!currentFamilyId || !mealsList) return;

  if (mealsMessage) {
    mealsMessage.textContent = "";
    mealsMessage.style.color = "";
  }
  mealsList.innerHTML = "<li>Loading meals...</li>";

  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("meal_date", { ascending: true })
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals:", error);
    mealsList.innerHTML = "<li>Could not load meals.</li>";
  } else {
    renderMeals(data || []);
  }
}

export async function fetchMealsByDate(dateValue) {
  if (!currentFamilyId || !dateValue) return [];

  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .eq("meal_date", dateValue)
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals for date:", error);
    return [];
  }

  return data || [];
}

async function logMealToToday(meal) {
  await logMealToDiary(meal, {
    date: selectedDate || getTodayDate(),
    skipReload: true,
  });
}

function renderMeals(items) {
  if (!mealsList) return;

  if (!items.length) {
    mealsList.innerHTML = "<li>No meals yet. Add one above!</li>";
    return;
  }

  mealsList.innerHTML = "";

  for (const meal of items) {
    const li = document.createElement("li");
    li.dataset.mealId = meal.id;
    li.dataset.mealType = meal.meal_type;
    li.dataset.mealTitle = meal.title;
    li.dataset.mealDate = meal.meal_date;
    li.dataset.mealNotes = meal.notes || "";
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
    title.textContent = meal.title;
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const dateStr = meal.meal_date;
    const typeLabel =
      meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1);
    meta.textContent = `${typeLabel} • ${dateStr}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const logBtn = document.createElement("button");
    logBtn.textContent = "Add to log";
    logBtn.type = "button";
    logBtn.classList.add("ghost-btn", "meal-log-btn");
    logBtn.style.paddingInline = "0.6rem";
    logBtn.style.fontSize = "0.85rem";
    right.appendChild(logBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("meal-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    if (meal.notes) {
      const notes = document.createElement("div");
      notes.textContent = meal.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    mealsList.appendChild(li);
  }
}

// ADD MEAL
if (mealsForm) {
  mealsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (mealsMessage) {
        mealsMessage.textContent = "You need a family group to add meals.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    const dateValue = mealDateInput.value;
    const mealType = mealTypeInput.value;
    const title = mealTitleInput.value.trim();
    const notes = mealNotesInput.value.trim();

    if (!dateValue || !mealType || !title) return;

    const { error } = await supabase.from("family_meals").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      meal_date: dateValue,
      meal_type: mealType,
      title,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding meal:", error);
      if (mealsMessage) {
        mealsMessage.textContent = "Error adding meal.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    const guidedDate = mealsForm.dataset.targetDate;
    const guidedMealType = mealsForm.dataset.targetMealType;
    const shouldMirrorToLog =
      guidedDate && guidedMealType && (guidedDate !== dateValue || guidedMealType !== mealType);

    if (shouldMirrorToLog) {
      await logMealToDiary(
        { title, meal_type: guidedMealType, notes: notes || null },
        { date: guidedDate, silent: true, skipReload: true }
      );
    }

    mealsForm.reset();
    await loadMeals();
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: dateValue, entity: "meal" },
      })
    );
  });
}

// DELETE MEAL
if (mealsList) {
  mealsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const mealId = li.dataset.mealId;
    if (!mealId) return;

    const logBtn = e.target.closest(".meal-log-btn");
    const deleteBtn = e.target.closest(".meal-delete");

    if (logBtn) {
      e.preventDefault();
      e.stopPropagation();
      await logMealToToday({
        title: li.dataset.mealTitle,
        meal_type: li.dataset.mealType,
        notes: li.dataset.mealNotes,
      });
      return;
    }

    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      li.classList.add("list-removing");
      const { error } = await supabase
        .from("family_meals")
        .delete()
        .eq("id", mealId);

      if (error) {
        console.error("Error deleting meal:", error);
        li.classList.remove("list-removing");
        return;
      }

      const removeNode = () => li.remove();
      li.addEventListener("transitionend", removeNode, { once: true });
      setTimeout(removeNode, 220);
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "meal" } })
      );
      return;
    }

    openMealDetailsModal({
      title: li.dataset.mealTitle,
      meal_type: li.dataset.mealType,
      meal_date: li.dataset.mealDate,
      notes: li.dataset.mealNotes,
    });
  });
}
