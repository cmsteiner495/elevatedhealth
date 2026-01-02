// js/logDiary.js
import {
  diaryPrevDayBtn,
  diaryNextDayBtn,
  diaryTodayBtn,
  diaryCalendarBtn,
  diaryDatePicker,
  diaryDateMeta,
  diaryDateLabel,
  diaryDateSub,
  diaryRefreshBtn,
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
  diarySectionTotals,
} from "./dom.js";
import {
  currentFamilyId,
  currentUser,
  addDays,
  getTodayDate,
  onSelectedDateChange,
  selectedDate,
  setSelectedDate,
  toLocalDateString,
  getDiaryDateKey,
  toLocalDayKey,
} from "./state.js";
import { deleteMealLogById, fetchMealsByDate, logMealToDiary } from "./meals.js";
import { deleteWorkoutById, fetchWorkoutsByDate, loadWorkouts } from "./workouts.js";
import { closeModal, openModal, showToast } from "./ui.js";
import { isMealLogged, isWorkoutLogged } from "./selectors.js";
import { isDebugEnabled } from "./debug/dbSanity.js";

const sectionLists = {
  breakfast: diaryBreakfastList,
  lunch: diaryLunchList,
  dinner: diaryDinnerList,
  snacks: diarySnacksList,
};

const mealTotals = {
  breakfast: 0,
  lunch: 0,
  dinner: 0,
  snacks: 0,
};

const emptyMessage = "No entries yet";
const authRequiredMessage = "Please sign in to sync your diary.";
const familyRequiredMessage = "Join a family to log meals and workouts.";

let currentDiaryMeals = [];
let currentDiaryWorkouts = [];
let storedTodayKey = toLocalDayKey(new Date());
let dayChangeIntervalId = null;

function parseMetricNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toLocalDate(dateValue) {
  const parts = (dateValue || "")
    .toString()
    .split("-")
    .map((v) => parseInt(v, 10));
  const [y, m, d] = parts;
  return new Date(y || 0, (m || 1) - 1, d || 1);
}

function formatDateLabel(dateValue) {
  const date = toLocalDate(dateValue);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDateSubLabel(dateValue) {
  const date = toLocalDate(dateValue);
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function offsetDate(dateValue, daysDelta) {
  return addDays(dateValue, daysDelta);
}

function syncDatePicker(dateValue) {
  if (diaryDatePicker) diaryDatePicker.value = dateValue;
}

function setListLoading(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '<li class="diary-empty">Loading…</li>';
}

function renderEmpty(listEl, message = emptyMessage) {
  if (!listEl) return;
  listEl.innerHTML = `<li class="diary-empty">${message}</li>`;
}

function matchesMealIdentifier(meal, identifier, clientId) {
  if (!meal) return false;
  const identifiers = [identifier, clientId].filter(Boolean).map(String);
  return identifiers.some(
    (id) =>
      (meal.id != null && String(meal.id) === id) ||
      (meal.client_id != null && String(meal.client_id) === id)
  );
}

function createMealEntry(item, sectionKey) {
  const caloriesValue = getEntryCalories(item);

  const li = document.createElement("li");
  li.className = "diary-entry";
  li.dataset.mealId = item.id;
  li.dataset.mealClientId = item.client_id || item.clientId || item.id || "";
  li.dataset.mealType = sectionKey;
  li.dataset.mealDate = item.meal_date || "";
  li.dataset.mealTitle = item.title || "";
  li.dataset.mealNotes = item.notes || "";
  li.dataset.mealDescription = item.description || "";
  li.dataset.mealCalories = caloriesValue;
  li.dataset.mealProtein =
    item.protein_g ??
    item.protein ??
    item.nutrition?.protein_g ??
    item.nutrition?.protein ??
    "";
  li.dataset.mealCarbs =
    item.carbs_g ??
    item.carbs ??
    item.nutrition?.carbs_g ??
    item.nutrition?.carbs ??
    "";
  li.dataset.mealFat =
    item.fat_g ??
    item.fat ??
    item.nutrition?.fat_g ??
    item.nutrition?.fat ??
    "";
  li.dataset.mealUrl = item.recipe_url || item.recipeUrl || "";

  const row = document.createElement("div");
  row.className = "diary-entry-row";

  const textWrap = document.createElement("div");
  textWrap.className = "diary-entry-copy";

  const title = document.createElement("div");
  title.className = "diary-entry-title";
  title.textContent = item.title;
  textWrap.appendChild(title);

  if (caloriesValue != null) {
    const caloriesLabel = document.createElement("div");
    caloriesLabel.className = "diary-entry-calories";
    caloriesLabel.textContent = `${caloriesValue} cal`;
    textWrap.appendChild(caloriesLabel);
  }

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

function renderList(listEl, items, sectionKey, options = {}) {
  if (!listEl) return;
  const emptyText = options.emptyText || emptyMessage;

  if (!items.length) {
    renderEmpty(listEl, emptyText);
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item) => {
    listEl.appendChild(createMealEntry(item, sectionKey));
  });
}

function getEntryCalories(entry) {
  const caloriesValue =
    entry?.macros?.calories ??
    entry?.calories ??
    entry?.nutrition?.calories ??
    0;
  return Math.round(parseMetricNumber(caloriesValue));
}

function getSectionCalories(entries = []) {
  return entries.reduce((sum, entry) => sum + getEntryCalories(entry), 0);
}

function updateSectionTotals(byType) {
  Object.entries(byType).forEach(([key, entries]) => {
    const total = getSectionCalories(entries || []);
    mealTotals[key] = total;
    const target = diarySectionTotals?.[key];
    if (target) {
      target.textContent = `Total: ${total} cal`;
      target.style.display = entries && entries.length ? "inline-flex" : "none";
    }
  });
}

function createWorkoutEntry(item) {
  const li = document.createElement("li");
  li.className = "diary-entry";
  li.dataset.logId = item.log_id || item.id || "";
  li.dataset.workoutId = item.workout_id || item.id || "";
  li.dataset.workoutDate = item.workout_date || "";
  li.dataset.workoutTitle = item.title || "";

  const row = document.createElement("div");
  row.className = "diary-entry-row";

  const textWrap = document.createElement("div");
  textWrap.className = "diary-entry-copy";

  const title = document.createElement("div");
  title.className = "diary-entry-title";
  title.textContent = item.title || "Workout";
  textWrap.appendChild(title);

  const typeLabel = item.workout_type
    ? item.workout_type.charAt(0).toUpperCase() + item.workout_type.slice(1)
    : "Exercise";
  const parts = [typeLabel];
  if (item.duration_min) parts.push(`${item.duration_min} min`);
  const calories = parseMetricNumber(item.calories_burned ?? item.calories);
  if (calories) parts.push(`${calories} kcal`);
  if (item.workout_date) parts.push(item.workout_date);

  if (parts.length) {
    const meta = document.createElement("div");
    meta.className = "diary-entry-notes";
    meta.textContent = parts.join(" • ");
    textWrap.appendChild(meta);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost-btn diary-entry-remove";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute(
    "aria-label",
    `Remove ${item.title || "workout"} from exercise log`
  );

  row.appendChild(textWrap);
  row.appendChild(removeBtn);
  li.appendChild(row);

  if (item.notes) {
    const notes = document.createElement("div");
    notes.className = "diary-entry-notes";
    notes.textContent = item.notes;
    li.appendChild(notes);
  }

  return li;
}

function renderExercise(listEl, items, options = {}) {
  if (!listEl) return;
  const emptyText = options.emptyText || emptyMessage;

  if (!items.length) {
    renderEmpty(listEl, emptyText);
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item) => {
    listEl.appendChild(createWorkoutEntry(item));
  });
}

function buildMealMetaRow(label, value) {
  const row = document.createElement("div");
  row.className = "diary-detail-meta-row";

  const heading = document.createElement("span");
  heading.className = "diary-detail-meta-label";
  heading.textContent = label;

  const content = document.createElement("span");
  content.className = "diary-detail-meta-value";
  content.textContent = value;

  row.appendChild(heading);
  row.appendChild(content);
  return row;
}

function buildNutritionPills(nutrition = {}) {
  const hasAny = ["calories", "protein", "carbs", "fat"].some(
    (key) => nutrition[key]
  );
  if (!hasAny) return null;

  const row = document.createElement("div");
  row.className = "ai-dinner-meta";

  const addPill = (label, value) => {
    if (!value) return;
    const pill = document.createElement("span");
    pill.className = "ai-dinner-pill";
    pill.textContent = `${label}: ${value}`;
    row.appendChild(pill);
  };

  addPill("Calories", nutrition.calories);
  addPill("Protein", nutrition.protein);
  addPill("Carbs", nutrition.carbs);
  addPill("Fat", nutrition.fat);

  return row;
}

async function logMealFromDetail(meal) {
  if (!meal) return;
  if (!currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const title = meal.title || meal.name;
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || meal.type || "dinner";

  await logMealToDiary(
    {
      title,
      meal_type: mealType,
      calories: meal.calories || meal.nutrition?.calories,
      protein: meal.protein_g || meal.protein || meal.nutrition?.protein_g || meal.nutrition?.protein,
      carbs: meal.carbs_g || meal.carbs || meal.nutrition?.carbs_g || meal.nutrition?.carbs,
      fat: meal.fat_g || meal.fat || meal.nutrition?.fat_g || meal.nutrition?.fat,
      nutrition: meal.nutrition || meal.macros,
    },
    { date: selectedDate }
  );

  closeModal();
}

function showMealDetails(entry) {
  if (!entry) return;
  const entryId = entry.dataset.mealId;
  const mealClientId = entry.dataset.mealClientId;
  const mealData =
    currentDiaryMeals.find((meal) =>
      matchesMealIdentifier(meal, entryId, mealClientId)
    ) || {};

  const title =
    mealData.title ||
    entry.dataset.mealTitle ||
    entry.querySelector(".diary-entry-title")?.textContent ||
    "Meal";
  const notes = mealData.notes || entry.dataset.mealNotes || "";
  const description = mealData.description || entry.dataset.mealDescription || "";
  const type = mealData.meal_type || entry.dataset.mealType;
  const date = mealData.meal_date || entry.dataset.mealDate;
  const recipeUrl = mealData.recipe_url || mealData.recipeUrl || entry.dataset.mealUrl;

  const body = document.createElement("div");
  body.className = "diary-detail-body";

  if (type || date) {
    const headline = document.createElement("div");
    headline.className = "diary-detail-meta-row diary-detail-headline";
    const parts = [];
    if (type) {
      parts.push(type.charAt(0).toUpperCase() + type.slice(1));
    }
    if (date) {
      parts.push(formatDateSubLabel(date));
    }
    headline.textContent = parts.join(" · ");
    body.appendChild(headline);
  }

  const metaBlock = document.createElement("div");
  metaBlock.className = "diary-detail-meta";
  metaBlock.appendChild(
    buildMealMetaRow(
      "Meal",
      type ? type.charAt(0).toUpperCase() + type.slice(1) : "Meal"
    )
  );
  if (date) {
    metaBlock.appendChild(buildMealMetaRow("Date", formatDateSubLabel(date)));
  }
  body.appendChild(metaBlock);

  if (description) {
    const desc = document.createElement("p");
    desc.textContent = description;
    desc.className = "diary-detail-note";
    body.appendChild(desc);
  }

  if (notes && notes !== description) {
    const notesEl = document.createElement("p");
    notesEl.textContent = notes;
    notesEl.className = "diary-detail-note";
    body.appendChild(notesEl);
  }

  const nutritionSource =
    mealData.nutrition || {
      calories: mealData.calories ?? entry.dataset.mealCalories,
      protein:
        mealData.protein_g ??
        mealData.protein ??
        entry.dataset.mealProtein,
      carbs:
        mealData.carbs_g ??
        mealData.carbs ??
        entry.dataset.mealCarbs,
      fat:
        mealData.fat_g ??
        mealData.fat ??
        entry.dataset.mealFat,
    };
  const nutrition = buildNutritionPills(nutritionSource);
  if (nutrition) {
    body.appendChild(nutrition);
  }

  if (recipeUrl) {
    const link = document.createElement("a");
    link.href = recipeUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "ai-dinner-pill";
    link.textContent = "View full recipe";
    body.appendChild(link);
  }

  const modalConfig = { title, body, primaryLabel: null };
  const canLog = Boolean(currentFamilyId && title);
  if (canLog) {
    modalConfig.primaryLabel = "Log this meal";
    modalConfig.onPrimary = () => logMealFromDetail({
      ...mealData,
      title,
      meal_type: type,
      description,
      notes,
    });
  }

  openModal(modalConfig);
}

function setDateText(dateValue) {
  const normalized = toLocalDateString(toLocalDate(dateValue));
  if (diaryDateLabel) diaryDateLabel.textContent = formatDateLabel(normalized);
  if (diaryDateSub) diaryDateSub.textContent = formatDateSubLabel(normalized);
  syncDatePicker(dateValue);
}

function calculateCalories(meals, workouts) {
  const goal = 2000;
  const food = meals.reduce((sum, meal) => {
    const calories = meal.calories ?? meal.nutrition?.calories;
    return sum + parseMetricNumber(calories);
  }, 0);
  const exercise = workouts.reduce((sum, workout) => {
    const calories = workout.calories_burned ?? workout.calories;
    return sum + parseMetricNumber(calories);
  }, 0);
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

async function fetchDiaryFromSupabase(dateValue) {
  const targetDate = getDiaryDateKey(dateValue) || getTodayDate();

  const [meals, workouts] = await Promise.all([
    fetchMealsByDate(targetDate, { offlineFallback: true }),
    fetchWorkoutsByDate(targetDate, { offlineFallback: true }),
  ]);

  return { targetDate, meals, workouts };
}

function renderDiaryEntries(meals = [], workouts = []) {
  currentDiaryMeals = (meals || []).filter(isMealLogged);
  currentDiaryWorkouts = (workouts || []).filter(isWorkoutLogged);

  const byType = groupMealsByType(currentDiaryMeals);

  Object.entries(sectionLists).forEach(([key, listEl]) => {
    renderList(listEl, byType[key] || [], key);
  });
  updateSectionTotals(byType);

  renderExercise(diaryExerciseList, currentDiaryWorkouts);
  calculateCalories(currentDiaryMeals, currentDiaryWorkouts);
}

async function loadDiary(dateValue) {
  const targetDate = getDiaryDateKey(dateValue) || getTodayDate();
  setDateText(targetDate);

  const renderDiaryEmptyState = (message) => {
    currentDiaryMeals = [];
    currentDiaryWorkouts = [];
    Object.entries(sectionLists).forEach(([key, listEl]) =>
      renderList(listEl, [], key, { emptyText: message })
    );
    updateSectionTotals({
      breakfast: [],
      lunch: [],
      dinner: [],
      snacks: [],
    });
    renderExercise(diaryExerciseList, [], { emptyText: message });
    calculateCalories([], []);
  };

  if (!currentUser) {
    renderDiaryEmptyState(authRequiredMessage);
    return;
  }

  if (!currentFamilyId) {
    renderDiaryEmptyState(familyRequiredMessage);
    return;
  }

  Object.values(sectionLists).forEach((listEl) => setListLoading(listEl));
  setListLoading(diaryExerciseList);

  const { meals, workouts } = await fetchDiaryFromSupabase(targetDate);
  renderDiaryEntries(meals, workouts);

  if (isDebugEnabled()) {
    console.debug("[EH DIARY] loaded entries", {
      userId: currentUser?.id || null,
      familyId: currentFamilyId || null,
      dateKey: targetDate,
      meals: currentDiaryMeals.length,
      workouts: currentDiaryWorkouts.length,
    });
  }
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
      const dateValue = getDiaryDateKey(selectedDate) || getDiaryDateKey(new Date());
      if (!target) return;
      const normalizedTarget = (target || "").toString().trim().toLowerCase();
      const isExercise = normalizedTarget === "exercise";
      const targetTab = isExercise ? "workouts-tab" : "meals-tab";
      document.dispatchEvent(
        new CustomEvent("diary:add", {
          detail: { section: normalizedTarget || target, date: dateValue, targetTab },
        })
      );
    });
  });
}

// Remove a meal from the log and refresh UI without a full reload.
async function removeMealFromDiary(mealId, entryEl) {
  const normalizedMealId = mealId ?? entryEl?.dataset?.mealId;
  const clientId = entryEl?.dataset?.mealClientId || normalizedMealId;
  if (!normalizedMealId) {
    console.error("removeMealFromDiary: missing meal id", {
      mealId,
      entryEl,
    });
    showToast("Couldn't delete meal. Missing meal id.");
    return;
  }

  const removeBtn = entryEl?.querySelector?.(".diary-entry-remove");
  if (removeBtn) {
    removeBtn.disabled = true;
    removeBtn.setAttribute("aria-busy", "true");
  }
  if (entryEl) {
    entryEl.classList.add("diary-entry-removing");
  }

  const { error } = await deleteMealLogById(normalizedMealId, {
    client_id: clientId,
    date: entryEl?.dataset?.mealDate || selectedDate,
    reason: "deleteMeal:diary",
  });

  if (error) {
    console.error("Error removing meal from diary:", error);
    if (entryEl) {
      entryEl.classList.remove("diary-entry-removing");
    }
    if (removeBtn) {
      removeBtn.disabled = false;
      removeBtn.removeAttribute("aria-busy");
    }
    showToast("Couldn't delete meal. Try again.");
    return;
  }

  const dateDetail = entryEl?.dataset?.mealDate || selectedDate;
  window.dispatchEvent(
    new CustomEvent("eh:data-changed", { detail: { source: "meals", date: dateDetail } })
  );
  window.dispatchEvent(
    new CustomEvent("eh:dataChanged", { detail: { source: "meals", date: dateDetail } })
  );

  await reloadDiaryFromServer(dateDetail);
}

async function removeWorkoutFromDiary(workoutId, entryEl) {
  const normalizedWorkoutId =
    workoutId ?? entryEl?.dataset?.logId ?? entryEl?.dataset?.workoutId;
  if (!normalizedWorkoutId) {
    console.error("removeWorkoutFromDiary: missing workout id", {
      workoutId,
      entryEl,
    });
    showToast("Couldn't delete workout. Missing id.");
    return;
  }

  const removeBtn = entryEl?.querySelector?.(".diary-entry-remove");
  if (removeBtn) {
    removeBtn.disabled = true;
    removeBtn.setAttribute("aria-busy", "true");
  }
  if (entryEl) {
    entryEl.classList.add("diary-entry-removing");
  }

  const { error } = await deleteWorkoutById(normalizedWorkoutId, {
    date: entryEl?.dataset?.workoutDate || selectedDate,
    reason: "deleteWorkout:diary",
  });

  if (error) {
    console.error(
      "Error removing workout from diary:",
      error?.message || error,
      error?.details || ""
    );
    if (String(error?.message || "").toLowerCase().includes("rls")) {
      console.error(
        "Supabase RLS: allow workout owners to delete their own rows:\n" +
          "create policy \"Allow users to delete own workouts\" on family_workouts for delete using (auth.uid() = added_by);"
      );
    }
    if (entryEl) {
      entryEl.classList.remove("diary-entry-removing");
    }
    if (removeBtn) {
      removeBtn.disabled = false;
      removeBtn.removeAttribute("aria-busy");
    }
    showToast("Couldn't delete workout. Try again.");
    return;
  }

  const dateDetail = entryEl?.dataset?.workoutDate || selectedDate;
  window.dispatchEvent(
    new CustomEvent("eh:data-changed", { detail: { source: "workouts", date: dateDetail } })
  );
  window.dispatchEvent(
    new CustomEvent("eh:dataChanged", { detail: { source: "workouts", date: dateDetail } })
  );

  try {
    await Promise.all([loadWorkouts(), reloadDiaryFromServer(dateDetail)]);
  } catch (err) {
    console.warn("Post-delete refresh failed", err);
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
      if (removeBtn) {
        const entry = removeBtn.closest(".diary-entry");
        const mealId = entry?.dataset?.mealId;
        if (!mealId) return;
        removeMealFromDiary(mealId, entry);
        return;
      }

      const entry = event.target.closest(".diary-entry");
      if (!entry) return;
      showMealDetails(entry);
    });
  });
}

function attachExerciseListHandlers() {
  if (!diaryExerciseList) return;
  diaryExerciseList.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".diary-entry-remove");
    if (!removeBtn) return;
    const entry = removeBtn.closest(".diary-entry");
    const workoutId = entry?.dataset?.logId || entry?.dataset?.workoutId;
    if (!workoutId) return;
    removeWorkoutFromDiary(workoutId, entry);
  });
}

export async function reloadDiaryFromServer(dateValue) {
  return loadDiary(dateValue || selectedDate);
}

export function refreshDiaryForSelectedDate() {
  return loadDiary(selectedDate);
}

function handleDayRollover(nextTodayKey) {
  storedTodayKey = nextTodayKey;
  setSelectedDate(nextTodayKey, { force: true });
}

function checkForDayChange() {
  const nextTodayKey = toLocalDayKey(new Date());
  if (!nextTodayKey || nextTodayKey === storedTodayKey) return;
  handleDayRollover(nextTodayKey);
}

function startDayChangeWatcher() {
  storedTodayKey = toLocalDayKey(new Date());
  if (dayChangeIntervalId) {
    clearInterval(dayChangeIntervalId);
  }
  window.addEventListener("focus", checkForDayChange);
  document.addEventListener("visibilitychange", checkForDayChange);
  dayChangeIntervalId = window.setInterval(checkForDayChange, 60 * 1000);
}

export function initDiary() {
  const openDatePicker = () => {
    if (!diaryDatePicker) return;
    diaryDatePicker.value = selectedDate;
    if (diaryDatePicker.showPicker) {
      diaryDatePicker.showPicker();
    } else {
      diaryDatePicker.focus();
      diaryDatePicker.click();
    }
  };

  if (diaryPrevDayBtn)
    diaryPrevDayBtn.addEventListener("click", () => adjustSelectedDate(-1));
  if (diaryNextDayBtn)
    diaryNextDayBtn.addEventListener("click", () => adjustSelectedDate(1));
  if (diaryTodayBtn)
    diaryTodayBtn.addEventListener("click", () => setSelectedDate(getTodayDate()));
  if (diaryRefreshBtn) {
    diaryRefreshBtn.addEventListener("click", () => {
      refreshDiaryForSelectedDate();
    });
  }
  if (diaryCalendarBtn) {
    diaryCalendarBtn.addEventListener("click", () => {
      openDatePicker();
    });
  }
  if (diaryDatePicker) {
    diaryDatePicker.addEventListener("change", (e) => {
      const next = e.target.value;
      if (!next) return;
      setSelectedDate(next, { force: true });
    });
  }

  if (diaryDateMeta) {
    diaryDateMeta.addEventListener("click", openDatePicker);
    diaryDateMeta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDatePicker();
      }
    });
  }

  handleAddButtons();
  attachDiaryListHandlers();
  attachExerciseListHandlers();
  startDayChangeWatcher();

  onSelectedDateChange(async (dateValue) => {
    setDateText(dateValue);
    await loadDiary(dateValue);
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
