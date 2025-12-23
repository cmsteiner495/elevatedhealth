// js/selectors.js
import { getTodayDate, getLast7DaysLocal, toLocalDayKey } from "./state.js";

const MACRO_KEYS = ["protein", "carbs", "fat"];

export function isMealLogged(meal) {
  if (!meal) return false;
  if (meal.logged_at || meal.loggedAt) return true;
  if (meal.completed === true) return true;
  if (meal.completed === false) return false;
  if (meal.logged === true) return true;
  if (meal.logged === false) return false;
  return false;
}

export function isWorkoutLogged(workout) {
  if (!workout) return false;
  if (workout.completed === true) return true;
  if (workout.completed === false) return false;
  if (workout.logged_at) return true;
  if (workout.loggedAt) return true;
  return workout.logged === true;
}

function buildDateWindow() {
  const days = getLast7DaysLocal();
  return days.map((day) => toLocalDayKey(day));
}

function normalizeLogDate(value) {
  const key = toLocalDayKey(value);
  return key || null;
}

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

export function computeDashboardModel(state = {}) {
  const labels = buildDateWindow();
  const today = getTodayDate();
  const meals = Array.isArray(state.meals)
    ? state.meals.map((meal) => ({
        ...meal,
        dateKey: meal.dateKey || normalizeLogDate(meal.meal_date || meal.date),
      }))
    : [];
  const workouts = Array.isArray(state.workouts) ? state.workouts : [];
  const loggedMeals = meals.filter(isMealLogged);
  const loggedWorkouts = workouts.filter(isWorkoutLogged);

  const macrosToday = { protein: 0, carbs: 0, fat: 0 };
  const caloriesByDate = Object.fromEntries(labels.map((date) => [date, 0]));
  const workoutsByDate = Object.fromEntries(labels.map((date) => [date, 0]));
  const mealsToday = [];

  loggedMeals.forEach((meal) => {
    const date = meal.dateKey || normalizeLogDate(meal.meal_date || meal.date);
    if (!date) return;
    if (caloriesByDate[date] !== undefined) {
      const calories = parseMetricNumber(meal.calories);
      caloriesByDate[date] += calories;
    }
    if (date === today) {
      mealsToday.push(meal);
    }
  });

  mealsToday.forEach((meal) => {
    MACRO_KEYS.forEach((key) => {
      macrosToday[key] += parseMetricNumber(meal[key]);
    });
  });

  loggedWorkouts.forEach((workout) => {
    const date = normalizeLogDate(workout.workout_date || workout.date);
    if (!date) return;
    if (workoutsByDate[date] !== undefined) {
      workoutsByDate[date] += 1;
    }
  });

  return {
    labels,
    macrosToday,
    calories7Days: labels.map((date) => caloriesByDate[date] || 0),
    workouts7Days: labels.map((date) => workoutsByDate[date] || 0),
    mealsTodayCount: mealsToday.length,
    todayKey: today,
    firstMeal: loggedMeals.length ? loggedMeals[0] : null,
  };
}
