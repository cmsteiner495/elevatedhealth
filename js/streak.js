// js/streak.js
import { addDays, toLocalDayKey } from "./state.js";
import { isWorkoutLogged } from "./selectors.js";

function getWorkoutDayKey(workout) {
  const candidate =
    workout?.day_key ||
    workout?.workout_date ||
    workout?.date ||
    workout?.logged_at ||
    workout?.loggedAt ||
    workout?.created_at ||
    workout?.updated_at;
  // We normalize to a local calendar day so every device uses the user's local time
  // instead of mixing UTC/local offsets when calculating streaks.
  return toLocalDayKey(candidate);
}

export function computeWorkoutStreak(workouts = [], now = new Date()) {
  const todayKey = toLocalDayKey(now);
  if (!todayKey) return 0;

  const workoutDays = new Set();
  workouts.forEach((workout) => {
    if (!isWorkoutLogged(workout)) return;
    const dayKey = getWorkoutDayKey(workout);
    if (dayKey) {
      workoutDays.add(dayKey);
    }
  });

  let streak = 0;
  let cursor = todayKey;
  while (workoutDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function collectWorkoutDayKeys(workouts = []) {
  return Array.from(
    new Set(
      workouts
        .filter(isWorkoutLogged)
        .map((workout) => getWorkoutDayKey(workout))
        .filter(Boolean)
    )
  );
}
