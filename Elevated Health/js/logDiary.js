// js/logDiary.js
import {
  diaryPrevDayBtn,
  diaryNextDayBtn,
  diaryTodayBtn,
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

const sectionLists = {
  breakfast: diaryBreakfastList,
  lunch: diaryLunchList,
  dinner: diaryDinnerList,
  snacks: diarySnacksList,
};

const emptyMessage = "No entries yet";

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

function setListLoading(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '<li class="diary-empty">Loading…</li>';
}

function renderList(listEl, items) {
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

    li.appendChild(title);

    if (item.notes) {
      const notes = document.createElement("div");
      notes.className = "diary-entry-notes";
      notes.textContent = item.notes;
      li.appendChild(notes);
    }

    listEl.appendChild(li);
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

function setDateText(dateValue) {
  if (diaryDateLabel) diaryDateLabel.textContent = formatDateLabel(dateValue);
  if (diaryDateSub) diaryDateSub.textContent = formatDateSubLabel(dateValue);
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

async function loadDiary(dateValue) {
  setDateText(dateValue);

  if (!currentFamilyId) {
    Object.values(sectionLists).forEach((listEl) =>
      renderList(listEl, [])
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

  const byType = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snacks: [],
  };

  meals.forEach((meal) => {
    const key = meal.meal_type || "";
    const normalized = key.toLowerCase();
    if (byType[normalized]) {
      byType[normalized].push(meal);
    }
  });

  Object.entries(sectionLists).forEach(([key, listEl]) => {
    renderList(listEl, byType[key] || []);
  });

  renderExercise(diaryExerciseList, workouts || []);
  calculateCalories(meals || [], workouts || []);
}

function adjustSelectedDate(daysDelta) {
  const date = new Date(selectedDate);
  date.setDate(date.getDate() + daysDelta);
  const nextDate = date.toISOString().slice(0, 10);
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

  handleAddButtons();

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
