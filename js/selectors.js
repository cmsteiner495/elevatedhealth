// js/selectors.js
import { addDays, getTodayDate } from "./state.js";

const MACRO_KEYS = ["protein", "carbs", "fat"];

function buildDateWindow() {
  const today = getTodayDate();
  const dates = [];
  for (let i = 6; i >= 0; i -= 1) {
    dates.push(addDays(today, -i));
  }
  return dates;
}

function normalizeLogDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const parts = value.split("T")[0] || value;
    const [y, m, d] = parts.split("-").map(Number);
    if ([y, m, d].every((v) => Number.isFinite(v))) {
      const month = String(m || 1).padStart(2, "0");
      const day = String(d || 1).padStart(2, "0");
      return `${y}-${month}-${day}`;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
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
  const meals = Array.isArray(state.meals) ? state.meals : [];
  const workouts = Array.isArray(state.workouts) ? state.workouts : [];

  const macrosToday = { protein: 0, carbs: 0, fat: 0 };
  const caloriesByDate = Object.fromEntries(labels.map((date) => [date, 0]));
  const workoutsByDate = Object.fromEntries(labels.map((date) => [date, 0]));

  meals.forEach((meal) => {
    const date = normalizeLogDate(meal.meal_date || meal.date);
    if (!date) return;
    if (caloriesByDate[date] !== undefined) {
      const calories = parseMetricNumber(meal.calories ?? meal.nutrition?.calories);
      caloriesByDate[date] += calories;
    }
    if (date === today) {
      MACRO_KEYS.forEach((key) => {
        macrosToday[key] += parseMetricNumber(meal[key] ?? meal.nutrition?.[key]);
      });
    }
  });

  workouts.forEach((workout) => {
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
  };
}
