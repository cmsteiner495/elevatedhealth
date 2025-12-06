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
import { maybeVibrate, setDinnerLogHandler, showToast } from "./ui.js";

setDinnerLogHandler(async (meal) => {
  await logMealToToday({
    title: meal.title,
    meal_type: "dinner",
    notes: meal.description || meal.notes,
  });
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
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const today = getTodayDate();
  const title = meal.title?.trim();
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || "dinner";
  const notes = meal.notes || null;

  const { error } = await supabase.from("family_meals").insert({
    family_group_id: currentFamilyId,
    added_by: currentUser.id,
    meal_date: today,
    meal_type: mealType,
    title,
    notes,
  });

  if (error) {
    console.error("Error logging meal:", error);
    showToast("Could not add meal to log");
    return;
  }

  showToast("Added to today’s log");
  maybeVibrate([16]);
  const isViewingToday = selectedDate === today;
  if (!isViewingToday) {
    setSelectedDate(today);
  }
  document.dispatchEvent(
    new CustomEvent("diary:refresh", { detail: { date: today, entity: "meal" } })
  );
  await loadMeals();
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

    if (e.target.classList.contains("meal-log-btn")) {
      await logMealToToday({
        title: li.dataset.mealTitle,
        meal_type: li.dataset.mealType,
        notes: li.dataset.mealNotes,
      });
      return;
    }

    if (e.target.classList.contains("meal-delete")) {
      const { error } = await supabase
        .from("family_meals")
        .delete()
        .eq("id", mealId);

      if (error) {
        console.error("Error deleting meal:", error);
        return;
      }

      await loadMeals();
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "meal" } })
      );
      return;
    }
  });
}
