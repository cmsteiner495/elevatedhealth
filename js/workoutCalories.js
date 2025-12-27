// js/workoutCalories.js
import { supabase } from "./supabaseClient.js";
import { getState } from "./ehStore.js";
import { currentFamilyId, toLocalDayKey } from "./state.js";

const LB_TO_KG = 0.45359237;
const weightCache = new Map();

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeDuration(value) {
  const parsed = parseNumber(value);
  return parsed ?? null;
}

function normalizeWeightKgFromLog(log = {}) {
  const weightKg = parseNumber(log.weight_kg ?? log.weightKg);
  if (weightKg != null) return weightKg;
  const weightLb = parseNumber(log.weight_lb ?? log.weightLb ?? log.weight);
  if (weightLb != null) return weightLb * LB_TO_KG;
  return null;
}

function pickMet({ workout_type, title }) {
  const normalizedTitle = (title || "").toString().toLowerCase();
  if (normalizedTitle.includes("hiit")) return 9;
  if (normalizedTitle.includes("run") || normalizedTitle.includes("jog")) return 7;
  if (normalizedTitle.includes("walk")) return 3.3;
  if (normalizedTitle.includes("cycle") || normalizedTitle.includes("bike")) return 6.8;
  if (normalizedTitle.includes("yoga")) return 2.5;

  const normalizedType = (workout_type || "").toString().toLowerCase();
  if (normalizedType === "cardio") return 5.0;
  if (normalizedType === "strength") return 3.5;
  if (normalizedType === "mobility" || normalizedType === "stretching") return 2.3;
  if (normalizedType === "sports" || normalizedType === "sport") return 6.0;

  return 3.5;
}

export function estimateWorkoutCalories({
  workout_type,
  title,
  duration_min,
  weight_kg,
}) {
  const duration = normalizeDuration(duration_min);
  const safeDuration = duration ?? 30;
  const weight = parseNumber(weight_kg) ?? 70;
  const met = pickMet({ workout_type, title });
  const calories = met * weight * (safeDuration / 60);
  const rounded = Math.round(calories);
  return Number.isFinite(rounded) ? rounded : 0;
}

async function fetchLatestWeightFromDb(targetDayKey) {
  if (!currentFamilyId) return null;
  const { data, error } = await supabase
    .from("progress_logs")
    .select("log_date, weight_lb, weight_kg")
    .eq("family_group_id", currentFamilyId)
    .lte("log_date", targetDayKey)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[WORKOUT CALORIES] weight lookup failed", error);
    return null;
  }

  return data || null;
}

export async function getLatestWeightKgForDate(dateValue) {
  const targetDayKey = toLocalDayKey(dateValue) || toLocalDayKey(new Date());
  if (weightCache.has(targetDayKey)) {
    return weightCache.get(targetDayKey);
  }
  const progressLogs = getState().progressLogs || [];
  const matchingLog = [...progressLogs]
    .filter((log) => log.dayKey && log.dayKey <= targetDayKey)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))[0];

  const fromStore = normalizeWeightKgFromLog(matchingLog);
  if (fromStore != null) {
    weightCache.set(targetDayKey, fromStore);
    return fromStore;
  }

  const dbLog = await fetchLatestWeightFromDb(targetDayKey);
  const fromDb = normalizeWeightKgFromLog(dbLog);
  if (fromDb != null) {
    weightCache.set(targetDayKey, fromDb);
    return fromDb;
  }

  console.info("[WORKOUT CALORIES] No weight found; using 70kg fallback");
  weightCache.set(targetDayKey, 70);
  return 70;
}
