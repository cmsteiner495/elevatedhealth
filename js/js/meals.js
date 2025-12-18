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
import { currentUser, currentFamilyId } from "./state.js";

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
  });
}

// DELETE MEAL
if (mealsList) {
  mealsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const mealId = li.dataset.mealId;
    if (!mealId) return;

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
      return;
    }
  });
}
