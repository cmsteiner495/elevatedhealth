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
import { readMealsStore, saveMeals } from "./dataAdapter.js";
import { normalizeMeal, setMeals, upsertMeal, removeMeal } from "./ehStore.js";

function readMealStore() {
  const snapshot = readMealsStore();
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

function writeMealStore(store) {
  saveMeals(store || {});
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function computeMealTotals(meal = {}) {
  const normalized = normalizeMeal(meal) || {};
  return {
    calories: coerceNumber(normalized.calories),
    protein: coerceNumber(normalized.protein),
    carbs: coerceNumber(normalized.carbs),
    fat: coerceNumber(normalized.fat),
  };
}

export function getStoredMeals(familyId) {
  if (!familyId) return [];
  const store = readMealStore();
  const list = store[familyId] || store.unscoped || [];
  const normalized = Array.isArray(list)
    ? list
    : list && typeof list === "object"
    ? Object.values(list)
    : [];
  return normalized.filter(Boolean);
}

function persistMealsForFamily(familyId, meals = []) {
  if (!familyId) return;
  const store = readMealStore();
  store[familyId] = Array.isArray(meals) ? meals : [];
  writeMealStore(store);
}

function mergeMeals(primary = [], secondary = []) {
  const map = new Map();
  const add = (meal) => {
    if (!meal) return;
    const key = meal.id
      ? `id:${meal.id}`
      : `${meal.meal_date || ""}:${meal.title || ""}:${meal.meal_type || ""}`;
    const existing = map.get(key) || {};
    map.set(key, { ...existing, ...meal });
  };

  primary.forEach(add);
  secondary.forEach(add);

  return Array.from(map.values()).sort((a, b) =>
    (a.meal_date || "").localeCompare(b.meal_date || "")
  );
}

function upsertStoredMeal(familyId, meal) {
  if (!familyId || !meal) return;
  const merged = mergeMeals(getStoredMeals(familyId), [meal]);
  persistMealsForFamily(familyId, merged);
}

export function removeStoredMeal(familyId, mealId) {
  if (!familyId || !mealId) return;
  const existing = getStoredMeals(familyId);
  const filtered = existing.filter((meal) => String(meal.id) !== String(mealId));
  persistMealsForFamily(familyId, filtered);
}

export async function deleteMealById(mealId, options = {}) {
  if (!mealId) return { error: new Error("Missing meal id") };
  if (!currentFamilyId) return { error: new Error("Missing family id") };

  const query = supabase
    .from("family_meals")
    .delete()
    .eq("id", mealId)
    .eq("family_group_id", currentFamilyId);

  const { error } = await query;
  if (error) return { error };

  removeStoredMeal(currentFamilyId, mealId);
  removeMeal(mealId, { reason: options.reason || "deleteMeal" });
  announceDataChange("meals", options.date || options.meal_date);
  return { error: null };
}

function announceDataChange(source, date) {
  const detail = source || date ? { source, date } : { source };
  window.dispatchEvent(new CustomEvent("eh:data-changed", { detail }));
  window.dispatchEvent(new CustomEvent("eh:dataChanged", { detail }));
}

export async function logMealToDiary(meal, options = {}) {
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const targetDate = options.date || selectedDate || getTodayDate();
  const title = meal.title?.trim();
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || options.mealType || "dinner";
  const notes = (meal.notes || meal.description || "").trim() || null;
  const totals = computeMealTotals(meal);
  const payload = {
    family_group_id: currentFamilyId,
    added_by: currentUser.id,
    meal_date: targetDate,
    meal_type: mealType,
    title,
    notes,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
  };

  let persistedMeal = null;
  const { data, error } = await supabase
    .from("family_meals")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("Error logging meal:", error);
    if (!options.silent) {
      showToast("Saved locally; sync when online");
    }
  } else {
    persistedMeal = data;
    if (!options.silent) {
      showToast("Added to log");
      maybeVibrate([16]);
    }
  }

  const localEntry = persistedMeal || {
    id: meal.id || `local-${Date.now()}`,
    ...payload,
    created_at: new Date().toISOString(),
  };
  const savedRow = persistedMeal || localEntry;
  upsertStoredMeal(currentFamilyId, localEntry);
  upsertMeal(savedRow, { reason: "logMealToDiary" });
  console.log("[EH MEAL] saved row totals", {
    calories: savedRow.calories ?? 0,
    protein: savedRow.protein ?? 0,
    carbs: savedRow.carbs ?? 0,
    fat: savedRow.fat ?? 0,
  });

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

  announceDataChange("meals", targetDate);

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
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          nutrition: meal.nutrition || meal.macros,
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
      calories: meal.calories || meal.nutrition?.calories,
      protein: meal.protein || meal.nutrition?.protein,
      carbs: meal.carbs || meal.nutrition?.carbs,
      fat: meal.fat || meal.nutrition?.fat,
      nutrition: meal.nutrition || meal.macros,
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

  const storedMeals = getStoredMeals(currentFamilyId);
  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("meal_date", { ascending: true })
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals:", error);
    if (storedMeals.length) {
      mealsList.innerHTML = "";
      renderMeals(storedMeals);
      setMeals(storedMeals, { reason: "loadMeals:offline" });
      if (mealsMessage) {
        mealsMessage.textContent = "Showing saved meals (offline)";
        mealsMessage.style.color = "var(--text-muted)";
      }
    } else {
      mealsList.innerHTML = "<li>Could not load meals.</li>";
      setMeals([], { reason: "loadMeals:error" });
    }
  } else {
    const remoteMeals = data || [];
    const merged = mergeMeals(remoteMeals, storedMeals);
    persistMealsForFamily(currentFamilyId, merged);
    setMeals(merged, { reason: "loadMeals" });
    renderMeals(merged);
  }
}

export async function fetchMealsByDate(dateValue) {
  if (!currentFamilyId || !dateValue) return [];

  const storedMeals = getStoredMeals(currentFamilyId);
  const storedForDate = storedMeals.filter(
    (meal) => (meal.meal_date || "") === dateValue
  );

  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .eq("meal_date", dateValue)
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals for date:", error);
    return storedForDate;
  }

  const merged = mergeMeals(data || [], storedMeals);
  persistMealsForFamily(currentFamilyId, merged);
  return merged.filter((meal) => (meal.meal_date || "") === dateValue);
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
    li.dataset.mealCalories = meal.calories ?? meal.nutrition?.calories ?? "";
    li.dataset.mealProtein = meal.protein ?? meal.nutrition?.protein ?? "";
    li.dataset.mealCarbs = meal.carbs ?? meal.nutrition?.carbs ?? "";
    li.dataset.mealFat = meal.fat ?? meal.nutrition?.fat ?? "";
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

    const dateStr = meal.meal_date || "";
    const mealTypeValue = meal.meal_type || "meal";
    const typeLabel =
      mealTypeValue.charAt(0).toUpperCase() + mealTypeValue.slice(1);
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
    const totals = computeMealTotals({});

    if (!dateValue || !mealType || !title) return;

    let persistedMeal = null;
    const payload = {
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      meal_date: dateValue,
      meal_type: mealType,
      title,
      notes: notes || null,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
    };
    const { data, error } = await supabase
      .from("family_meals")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Error adding meal:", error);
      if (mealsMessage) {
        mealsMessage.textContent = "Error adding meal.";
        mealsMessage.style.color = "red";
      }
    } else {
      persistedMeal = data;
    }

    const localEntry = persistedMeal || {
      id: `local-${Date.now()}`,
      ...payload,
      added_by: currentUser?.id || null,
      created_at: new Date().toISOString(),
    };
    upsertStoredMeal(currentFamilyId, localEntry);
    upsertMeal(localEntry, { reason: "addMeal" });
    console.log("[EH MEAL] saved row totals", {
      calories: localEntry.calories ?? 0,
      protein: localEntry.protein ?? 0,
      carbs: localEntry.carbs ?? 0,
      fat: localEntry.fat ?? 0,
    });

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
    announceDataChange("meals", dateValue);
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
        calories: li.dataset.mealCalories,
        protein: li.dataset.mealProtein,
        carbs: li.dataset.mealCarbs,
        fat: li.dataset.mealFat,
      });
      return;
    }

    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (deleteBtn.disabled) return;
      deleteBtn.disabled = true;
      deleteBtn.setAttribute("aria-busy", "true");
      li.classList.add("list-removing");
      const { error } = await deleteMealById(mealId, {
        date: li.dataset.mealDate,
        reason: "deleteMeal:planner",
      });

      if (error) {
        console.error("Error deleting meal:", error);
        li.classList.remove("list-removing");
        deleteBtn.disabled = false;
        deleteBtn.removeAttribute("aria-busy");
        showToast("Couldn't delete meal. Try again.");
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
