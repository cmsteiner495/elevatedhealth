// js/workoutDifficulty.js
// Canonical workout difficulty normalization shared across the app.

export const WORKOUT_DIFFICULTIES = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

const WORKOUT_DIFFICULTY_LABELS = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

const WORKOUT_DIFFICULTY_MAP = {
  easy: "BEGINNER",
  beginner: "BEGINNER",
  low: "BEGINNER",
  medium: "INTERMEDIATE",
  moderate: "INTERMEDIATE",
  intermediate: "INTERMEDIATE",
  hard: "ADVANCED",
  intense: "ADVANCED",
  advanced: "ADVANCED",
};

function isEmptyDifficulty(value) {
  if (!value) return true;
  const trimmed = value.toString().trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return lower === "select…" || lower === "select..." || lower === "select";
}

export function normalizeWorkoutDifficulty(value) {
  if (isEmptyDifficulty(value)) return null;
  const key = value.toString().trim().toLowerCase();
  const mapped = WORKOUT_DIFFICULTY_MAP[key];
  if (mapped) return mapped;
  const canonical = WORKOUT_DIFFICULTIES.find(
    (item) => item.toLowerCase() === key || item === value
  );
  return canonical || null;
}

export function formatWorkoutDifficulty(value) {
  const normalized = normalizeWorkoutDifficulty(value);
  if (!normalized) return "";
  const upper = normalized.toUpperCase();
  return WORKOUT_DIFFICULTY_LABELS[upper] || upper.charAt(0) + upper.slice(1).toLowerCase();
}
