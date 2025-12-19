// js/dataAdapter.js
const STORAGE_KEYS = {
  meals: { primary: "ehmeals", legacy: ["eh:meals"] },
  workouts: { primary: "ehworkouts", legacy: ["eh:workouts"] },
};

function safeParse(raw, key) {
  if (!raw) {
    return { entries: [], parsed: [], shape: "array", hadValue: false };
  }

  try {
    const parsed = JSON.parse(raw);
    const isArray = Array.isArray(parsed);
    const isObject = parsed && typeof parsed === "object" && !isArray;

    const entries = isArray
      ? parsed.filter(Boolean)
      : isObject
      ? Object.values(parsed).flatMap((value) => {
          if (Array.isArray(value)) return value.filter(Boolean);
          return value ? [value] : [];
        })
      : [];

    return {
      entries,
      parsed: parsed || [],
      shape: isObject ? "map" : "array",
      hadValue: true,
    };
  } catch (err) {
    console.warn(`Resetting ${key} due to corrupted JSON`, err);
    try {
      localStorage.setItem(key, JSON.stringify([]));
    } catch (writeErr) {
      console.warn(`Could not reset ${key}`, writeErr);
    }
    return { entries: [], parsed: [], shape: "array", hadValue: true };
  }
}

function readStorage(config) {
  if (typeof localStorage === "undefined") {
    return {
      entries: [],
      parsed: [],
      shape: "array",
      key: config.primary,
      hadValue: false,
    };
  }

  const attemptKeys = [config.primary, ...(config.legacy || [])];
  for (const key of attemptKeys) {
    try {
      const raw = localStorage.getItem(key);
      const parsedResult = safeParse(raw, key);
      if (parsedResult.hadValue || parsedResult.entries.length) {
        return { ...parsedResult, key };
      }
    } catch (err) {
      console.warn(`Could not read ${key} from storage`, err);
    }
  }

  return {
    entries: [],
    parsed: [],
    shape: "array",
    key: config.primary,
    hadValue: false,
  };
}

function inferShape(value, fallback = "array") {
  if (!value) return fallback;
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "map";
  return fallback;
}

function normalizeForShape(value, shape) {
  if (shape === "map") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    const map = {};
    const list = Array.isArray(value)
      ? value
      : Object.values(value || {}).flatMap((item) =>
          Array.isArray(item) ? item : item ? [item] : []
        );
    list.forEach((item, idx) => {
      if (!item) return;
      const keyCandidate =
        item.id ||
        item.meal_id ||
        item.workout_id ||
        item.created_at ||
        item.title ||
        `item-${idx}`;
      map[String(keyCandidate)] = item;
    });
    return map;
  }

  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) =>
      Array.isArray(item) ? item : item ? [item] : []
    );
  }
  return [];
}

function writeStorage(config, value) {
  const snapshot = readStorage(config);
  const targetShape = snapshot.hadValue ? snapshot.shape : inferShape(value);
  const normalized = normalizeForShape(value, targetShape);

  if (typeof localStorage === "undefined") return normalized;

  try {
    localStorage.setItem(config.primary, JSON.stringify(normalized));
  } catch (err) {
    console.warn(`Could not persist ${config.primary}`, err);
  }

  return normalized;
}

export function readMealsStore() {
  return readStorage(STORAGE_KEYS.meals);
}

export function readWorkoutsStore() {
  return readStorage(STORAGE_KEYS.workouts);
}

export function getMeals() {
  return readMealsStore().entries;
}

export function getWorkouts() {
  return readWorkoutsStore().entries;
}

export function saveMeals(meals) {
  return writeStorage(STORAGE_KEYS.meals, meals);
}

export function saveWorkouts(workouts) {
  return writeStorage(STORAGE_KEYS.workouts, workouts);
}

export default {
  getMeals,
  getWorkouts,
  saveMeals,
  saveWorkouts,
  readMealsStore,
  readWorkoutsStore,
};
