// js/ehStore.js
const subscribers = new Set();

const state = {
  hydrated: false,
  meals: [],
  workouts: [],
};

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
  const nextMeals = Array.isArray(meals) ? meals.map((meal) => ({ ...(meal || {}) })) : [];
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

export function upsertMeal(mealRow, options = {}) {
  if (!mealRow) return;
  const key = mealRow.id || `${mealRow.meal_date || ""}:${mealRow.title || ""}`;
  const map = new Map(state.meals.map((m) => [m.id || `${m.meal_date}:${m.title}`, m]));
  map.set(key, { ...(map.get(key) || {}), ...mealRow });
  state.meals = Array.from(map.values());
  emit(options.reason || "upsertMeal");
}

export function removeMeal(id, options = {}) {
  if (id == null) return;
  state.meals = state.meals.filter((meal) => String(meal.id) !== String(id));
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
