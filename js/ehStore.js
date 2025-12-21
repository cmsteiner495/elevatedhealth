// js/ehStore.js
const subscribers = new Set();

const state = {
  hydrated: false,
  meals: [],
  workouts: [],
};

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

function normalizeDateKey(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const datePart = (value || "").split("T")[0] || value;
    const [y, m, d] = datePart.split("-").map(Number);
    if ([y, m, d].every((n) => Number.isFinite(n))) {
      const year = y;
      const month = String(m || 1).padStart(2, "0");
      const day = String(d || 1).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeMeal(meal = {}) {
  if (!meal || typeof meal !== "object") return null;

  const nutrition = meal.nutrition || meal.macros || {};
  const clientId = meal.client_id ?? meal.clientId ?? null;
  const calories =
    meal.calories ??
    nutrition.calories ??
    meal.calories_total ??
    meal.total_calories ??
    meal.kcal ??
    meal.kcals ??
    meal.energy_kcal ??
    meal.energy;
  const protein =
    meal.protein ??
    nutrition.protein ??
    meal.protein_g ??
    meal.protein_total ??
    meal.protein_grams;
  const carbs =
    meal.carbs ??
    nutrition.carbs ??
    meal.carbohydrates ??
    meal.carbs_total ??
    meal.net_carbs ??
    meal.total_carbs;
  const fat =
    meal.fat ??
    nutrition.fat ??
    meal.fat_g ??
    meal.fat_total ??
    meal.fats ??
    meal.total_fat;

  const dateSource =
    meal.dateKey ||
    meal.meal_date ||
    meal.date ||
    meal.logged_at ||
    meal.loggedAt ||
    meal.log_date ||
    meal.created_at ||
    meal.timestamp;
  const dateKey = normalizeDateKey(dateSource);

  return {
    ...meal,
    id: meal.id ?? null,
    client_id: clientId,
    calories: parseMetricNumber(calories),
    protein: parseMetricNumber(protein),
    carbs: parseMetricNumber(carbs),
    fat: parseMetricNumber(fat),
    dateKey,
  };
}

function freezeList(list = []) {
  return Object.freeze(
    list.map((item) => Object.freeze({ ...(item || {}) }))
  );
}

function freezeState(nextState) {
  return Object.freeze({
    ...nextState,
    meals: freezeList(nextState.meals || []),
    workouts: freezeList(nextState.workouts || []),
  });
}

function emit(reason) {
  const snapshot = getState();
  console.log(
    `[EH STORE] update: ${reason} meals=${snapshot.meals.length} workouts=${snapshot.workouts.length}`
  );
  subscribers.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (err) {
      console.error("Store subscriber error", err);
    }
  });
}

export function subscribe(fn) {
  if (typeof fn !== "function") return () => {};
  subscribers.add(fn);
  fn(getState());
  return () => {
    subscribers.delete(fn);
  };
}

export function getState() {
  return freezeState(state);
}

export function setMeals(meals, options = {}) {
  const nextMeals = Array.isArray(meals)
    ? meals
        .map((meal) => normalizeMeal(meal))
        .filter(Boolean)
        .map((meal) => ({ ...(meal || {}) }))
    : [];
  state.meals = nextMeals;
  if (options.hydrated !== false) {
    state.hydrated = true;
  }
  emit(options.reason || "setMeals");
}

export function setWorkouts(workouts, options = {}) {
  const nextWorkouts = Array.isArray(workouts)
    ? workouts.map((workout) => ({ ...(workout || {}) }))
    : [];
  state.workouts = nextWorkouts;
  if (options.hydrated !== false) {
    state.hydrated = true;
  }
  emit(options.reason || "setWorkouts");
}

function matchesMealIdentifier(meal, identifier) {
  if (!meal || identifier == null) return false;
  const normalizedId = String(identifier);
  return (
    (meal.id != null && String(meal.id) === normalizedId) ||
    (meal.client_id != null && String(meal.client_id) === normalizedId)
  );
}

function findMealIndex(meals = [], identifiers = []) {
  const candidates = identifiers.filter((value) => value != null).map(String);
  return meals.findIndex((meal) =>
    candidates.some((id) => matchesMealIdentifier(meal, id))
  );
}

export function upsertMeal(mealRow, options = {}) {
  const normalized = normalizeMeal(mealRow);
  if (!normalized) return;
  const identifiers = [
    normalized.id,
    normalized.client_id,
    options.matchClientId,
    options.matchId,
  ].filter(Boolean);
  const nextMeals = [...state.meals];
  const existingIdx = findMealIndex(nextMeals, identifiers);
  const merged = {
    ...(existingIdx >= 0 ? nextMeals[existingIdx] : {}),
    ...normalized,
  };
  if (existingIdx >= 0) {
    nextMeals[existingIdx] = merged;
  } else {
    nextMeals.push(merged);
  }
  state.meals = nextMeals;
  emit(options.reason || "upsertMeal");
}

export function removeMeal(id, options = {}) {
  removeMealByIdOrClientId(id, options);
}

export function removeMealByIdOrClientId(identifier, options = {}) {
  if (identifier == null) return;
  const candidates = [
    identifier,
    options.clientId,
    options.client_id,
    options.matchId,
    options.matchClientId,
  ].filter(Boolean);
  state.meals = state.meals.filter(
    (meal) =>
      !candidates.some((id) => matchesMealIdentifier(meal, id))
  );
  emit(options.reason || "removeMeal");
}

export function upsertWorkout(workoutRow, options = {}) {
  if (!workoutRow) return;
  const key =
    workoutRow.id ||
    `${workoutRow.workout_date || ""}:${workoutRow.title || ""}:${workoutRow.workout_type || ""}`;
  const map = new Map(
    state.workouts.map((w) => [
      w.id || `${w.workout_date}:${w.title}:${w.workout_type || ""}`,
      w,
    ])
  );
  map.set(key, { ...(map.get(key) || {}), ...workoutRow });
  state.workouts = Array.from(map.values());
  emit(options.reason || "upsertWorkout");
}

export function removeWorkout(id, options = {}) {
  if (id == null) return;
  state.workouts = state.workouts.filter((workout) => String(workout.id) !== String(id));
  emit(options.reason || "removeWorkout");
}
