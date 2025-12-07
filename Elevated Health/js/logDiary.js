// js/logDiary.js
import { supabase } from "./supabaseClient.js";
import {
  diaryPrevDayBtn,
  diaryNextDayBtn,
  diaryTodayBtn,
  diaryCalendarBtn,
  diaryDatePicker,
  diaryDateLabel,
  diaryDateSub,
  diaryAddButtons,
  diaryBreakfastList,
  diaryLunchList,
  diaryDinnerList,
  diarySnacksList,
  diaryExerciseList,
  diaryCaloriesGoal,
  diaryCaloriesFood,
  diaryCaloriesExercise,
  diaryCaloriesRemaining,
  dashboardCaloriesFill,
} from "./dom.js";
import {
  currentFamilyId,
  getTodayDate,
  onSelectedDateChange,
  selectedDate,
  setSelectedDate,
} from "./state.js";
import { fetchMealsByDate } from "./meals.js";
import { fetchWorkoutsByDate } from "./workouts.js";
import { openModal } from "./ui.js";

const sectionLists = {
  breakfast: diaryBreakfastList,
  lunch: diaryLunchList,
  dinner: diaryDinnerList,
  snacks: diarySnacksList,
};

const emptyMessage = "No entries yet";

let currentDiaryMeals = [];
let currentDiaryWorkouts = [];

function formatDateLabel(dateValue) {
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDateSubLabel(dateValue) {
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function offsetDate(dateValue, daysDelta) {
  const parts = dateValue?.split("-").map(Number);
  if (!parts || parts.length < 3) return dateValue;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + daysDelta);
  return date.toISOString().slice(0, 10);
}

function syncDatePicker(dateValue) {
  if (diaryDatePicker) diaryDatePicker.value = dateValue;
}

function setListLoading(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '<li class="diary-empty">Loading…</li>';
}

function createMealEntry(item, sectionKey) {
  const li = document.createElement("li");
  li.className = "diary-entry";
  li.dataset.mealId = item.id;
  li.dataset.mealType = sectionKey;
  li.dataset.mealDate = item.meal_date || "";

  const row = document.createElement("div");
  row.className = "diary-entry-row";

  const textWrap = document.createElement("div");
  textWrap.className = "diary-entry-copy";

  const title = document.createElement("div");
  title.className = "diary-entry-title";
  title.textContent = item.title;
  textWrap.appendChild(title);

  if (item.notes) {
    const notes = document.createElement("div");
    notes.className = "diary-entry-notes";
    notes.textContent = item.notes;
    textWrap.appendChild(notes);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost-btn diary-entry-remove";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", `Remove ${item.title} from ${sectionKey}`);

  row.appendChild(textWrap);
  row.appendChild(removeBtn);
  li.appendChild(row);

  return li;
}

function renderList(listEl, items, sectionKey) {
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = `<li class="diary-empty">${emptyMessage}</li>`;
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item) => {
    listEl.appendChild(createMealEntry(item, sectionKey));
  });
}

function renderExercise(listEl, items) {
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = `<li class="diary-empty">${emptyMessage}</li>`;
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "diary-entry";

    const title = document.createElement("div");
    title.className = "diary-entry-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "diary-entry-notes";
    const typeLabel = item.workout_type
      ? item.workout_type.charAt(0).toUpperCase() + item.workout_type.slice(1)
      : "Exercise";
    const parts = [typeLabel];
    if (item.duration_min) parts.push(`${item.duration_min} min`);
    if (item.difficulty)
      parts.push(
        item.difficulty.charAt(0).toUpperCase() + item.difficulty.slice(1)
      );
    meta.textContent = parts.join(" • ");

    li.appendChild(title);
    if (parts.length) li.appendChild(meta);
    if (item.notes) {
      const notes = document.createElement("div");
      notes.className = "diary-entry-notes";
      notes.textContent = item.notes;
      li.appendChild(notes);
    }

    listEl.appendChild(li);
  });
}

function showMealDetails(entry) {
  if (!entry) return;
  const title = entry.dataset.mealTitle || entry.querySelector(".diary-entry-title")?.textContent || "Meal";
  const notes = entry.dataset.mealNotes || "Quick AI suggestion";
  const meta = document.createElement("div");
  meta.className = "subtitle tiny";
  const type = entry.dataset.mealType;
  const date = entry.dataset.mealDate;
  meta.textContent = `${type ? type.charAt(0).toUpperCase() + type.slice(1) : "Meal"}${date ? ` • ${formatDateSubLabel(date)}` : ""}`;

  const notesEl = document.createElement("div");
  notesEl.textContent = notes;
  notesEl.className = "text-soft";

  const body = document.createElement("div");
  body.appendChild(meta);
  body.appendChild(notesEl);

  openModal({ title, body, primaryLabel: null });
}

function setDateText(dateValue) {
  if (diaryDateLabel) diaryDateLabel.textContent = formatDateLabel(dateValue);
  if (diaryDateSub) diaryDateSub.textContent = formatDateSubLabel(dateValue);
  syncDatePicker(dateValue);
}

function calculateCalories(meals, workouts) {
  // UI-only placeholder calculations for now. Plug real calories later.
  const goal = 2000;
  const food = meals.reduce(
    (sum, meal) => sum + (meal.calories ?? 450),
    0
  );
  const exercise = workouts.reduce(
    (sum, workout) => sum + (workout.calories || 0),
    0
  );
  const remaining = goal - food + exercise;
  const percent = Math.max(0, Math.min(100, Math.round((food / goal) * 100)));

  if (diaryCaloriesGoal) diaryCaloriesGoal.textContent = goal;
  if (diaryCaloriesFood) diaryCaloriesFood.textContent = food;
  if (diaryCaloriesExercise) diaryCaloriesExercise.textContent = exercise;
  if (diaryCaloriesRemaining)
    diaryCaloriesRemaining.textContent = Math.max(remaining, 0);
  if (dashboardCaloriesFill) {
    dashboardCaloriesFill.style.width = `${percent}%`;
    dashboardCaloriesFill.setAttribute("aria-valuenow", String(percent));
  }
}

function groupMealsByType(meals) {
  const byType = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snacks: [],
  };

  meals.forEach((meal) => {
    const normalized = (meal.meal_type || "").toLowerCase();
    if (byType[normalized]) {
      byType[normalized].push(meal);
    }
  });

  return byType;
}

async function loadDiary(dateValue) {
  setDateText(dateValue);

  if (!currentFamilyId) {
    currentDiaryMeals = [];
    currentDiaryWorkouts = [];
    Object.entries(sectionLists).forEach(([key, listEl]) =>
      renderList(listEl, [], key)
    );
    renderExercise(diaryExerciseList, []);
    calculateCalories([], []);
    return;
  }

  Object.values(sectionLists).forEach((listEl) => setListLoading(listEl));
  setListLoading(diaryExerciseList);

  const [meals, workouts] = await Promise.all([
    fetchMealsByDate(dateValue),
    fetchWorkoutsByDate(dateValue),
  ]);

  currentDiaryMeals = meals || [];
  currentDiaryWorkouts = workouts || [];

  const byType = groupMealsByType(currentDiaryMeals);

  Object.entries(sectionLists).forEach(([key, listEl]) => {
    renderList(listEl, byType[key] || [], key);
  });

  renderExercise(diaryExerciseList, workouts || []);
  calculateCalories(meals || [], workouts || []);
}

function adjustSelectedDate(daysDelta) {
  const nextDate = offsetDate(selectedDate, daysDelta);
  setSelectedDate(nextDate);
}

function handleAddButtons() {
  if (!diaryAddButtons) return;
  diaryAddButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.diaryAdd;
      if (!target) return;
      document.dispatchEvent(
        new CustomEvent("diary:add", {
          detail: { section: target, date: selectedDate },
        })
      );
    });
  });
}

// Remove a meal from the log and refresh UI without a full reload.
async function removeMealFromDiary(mealId, entryEl) {
  if (!mealId) return;
  if (entryEl) {
    entryEl.classList.add("diary-entry-removing");
  }

  const { error } = await supabase
    .from("family_meals")
    .delete()
    .eq("id", mealId);

  if (error) {
    console.error("Error removing meal from diary:", error);
    if (entryEl) {
      entryEl.classList.remove("diary-entry-removing");
    }
    return;
  }

  currentDiaryMeals = currentDiaryMeals.filter((meal) => meal.id !== mealId);

  const updateUI = () => {
    const byType = groupMealsByType(currentDiaryMeals);

    Object.entries(sectionLists).forEach(([key, listEl]) => {
      renderList(listEl, byType[key] || [], key);
    });

    calculateCalories(currentDiaryMeals, currentDiaryWorkouts);
  };

  if (entryEl) {
    setTimeout(updateUI, 180);
  } else {
    updateUI();
  }
}

function attachDiaryListHandlers() {
  const lists = [
    diaryBreakfastList,
    diaryLunchList,
    diaryDinnerList,
    diarySnacksList,
  ];

  lists.forEach((listEl) => {
    if (!listEl) return;
    listEl.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".diary-entry-remove");
      if (!removeBtn) return;
      const entry = removeBtn.closest(".diary-entry");
      const mealId = entry?.dataset?.mealId;
      if (!mealId) return;
      removeMealFromDiary(mealId, entry);
    });
  });
}

export function refreshDiaryForSelectedDate() {
  loadDiary(selectedDate);
}

export function initDiary() {
  if (diaryPrevDayBtn)
    diaryPrevDayBtn.addEventListener("click", () => adjustSelectedDate(-1));
  if (diaryNextDayBtn)
    diaryNextDayBtn.addEventListener("click", () => adjustSelectedDate(1));
  if (diaryTodayBtn)
    diaryTodayBtn.addEventListener("click", () => setSelectedDate(getTodayDate()));
  if (diaryCalendarBtn) {
    diaryCalendarBtn.addEventListener("click", () => {
      if (diaryDatePicker?.showPicker) {
        diaryDatePicker.showPicker();
      } else if (diaryDatePicker) {
        diaryDatePicker.focus();
        diaryDatePicker.click();
      }
    });
  }
  if (diaryDatePicker) {
    diaryDatePicker.addEventListener("change", (e) => {
      const next = e.target.value;
      if (!next) return;
      setSelectedDate(next, { force: true });
    });
  }

  handleAddButtons();
  attachDiaryListHandlers();

  onSelectedDateChange((dateValue) => {
    setDateText(dateValue);
    loadDiary(dateValue);
    document.dispatchEvent(
      new CustomEvent("diary:date-changed", { detail: { date: dateValue } })
    );
  });

  document.addEventListener("diary:refresh", (event) => {
    const detailDate = event.detail?.date;
    if (!detailDate || detailDate === selectedDate) {
      refreshDiaryForSelectedDate();
    }
  });

  const logPanel = document.getElementById("log-tab");
  if (logPanel) {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    logPanel.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    });

    logPanel.addEventListener("touchmove", (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const deltaX = t.clientX - startX;
      const deltaY = Math.abs(t.clientY - startY);
      if (deltaY > 40) {
        tracking = false;
        return;
      }
      if (Math.abs(deltaX) > 60) {
        adjustSelectedDate(deltaX > 0 ? -1 : 1);
        tracking = false;
      }
    });

    logPanel.addEventListener("touchend", () => {
      tracking = false;
    });
  }

  document.addEventListener("family:changed", () => {
    refreshDiaryForSelectedDate();
  });

  setDateText(selectedDate);
  loadDiary(selectedDate);
}
