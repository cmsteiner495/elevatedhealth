// js/meals.js
import { supabase } from "./supabaseClient.js";
import { searchFoods } from "./foodSearchService.js";
import {
  mealsNoFamily,
  mealsHasFamily,
  mealsForm,
  mealSearchInput,
  mealSearchResults,
  mealSearchModeButtons,
  mealSelectedContainer,
  mealSelectedName,
  mealSelectedMacros,
  mealSelectedServingNote,
  mealSelectedGrams,
  mealSelectedGramsInput,
  mealPortionButtons,
  mealClearSelection,
  mealDateInput,
  mealTypeInput,
  mealTitleInput,
  mealCaloriesInput,
  mealProteinInput,
  mealCarbsInput,
  mealFatInput,
  mealsMessage,
  mealsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  getTodayDate,
  getDiaryDateKey,
  selectedDate,
  setSelectedDate,
} from "./state.js";
import { guardMutation } from "./debug/mutationGuard.js";
import { isDebugEnabled } from "./debug/dbSanity.js";
import { maybeVibrate, openModal, setDinnerLogHandler, showToast } from "./ui.js";
import { readMealsStore, saveMeals } from "./dataAdapter.js";
import {
  normalizeMeal,
  setMeals,
  upsertMeal,
  removeMealByIdOrClientId,
} from "./ehStore.js";
import { isMealLogged } from "./selectors.js";
import {
  formatNutritionSummary,
  hasIncompleteNutrition,
  normalizeMealNutrition,
} from "./nutrition.js";

const LOCAL_ID_PREFIX = "local-";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FOODS_DATA_URL = "/src/data/foods.json";
const DELETED_MEALS_KEY = "eh:deleted-meals";
const MEAL_LOG_TABLE = "meal_logs";
const MEAL_LOG_TYPES = new Set(["breakfast", "lunch", "dinner", "snacks"]);

const FAMILY_MEAL_COLUMNS = [
  "id",
  "family_group_id",
  "added_by",
  "meal_date",
  "meal_type",
  "title",
  "notes",
  "calories",
  "protein",
  "carbs",
  "fat",
  "client_id",
  "created_at",
  "updated_at",
];

const nutritionPatchedKeys = new Set();
const foodDetailCache = new Map();
let foodSearchIndex = [];
let foodSearchLoaded = false;
let foodSearchError = null;
let remoteSearchError = null;
let remoteSearchLoading = false;
let selectedFood = null;
let selectedPortion = 1;
let selectedManualGrams = 100;
let lastSearchResults = [];
let lastQuickResults = [];
let searchDebounceId = null;
let lastSearchToken = 0;
let selectionToken = 0;
let mealSearchMode = "common";

function readDeletedMealsMap() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(DELETED_MEALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[MEALS] Could not read deleted meals", err);
    return {};
  }
}

function writeDeletedMealsMap(map) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DELETED_MEALS_KEY, JSON.stringify(map || {}));
  } catch (err) {
    console.warn("[MEALS] Could not persist deleted meals", err);
  }
}

function updateDeletedMeals(familyId, updater) {
  if (!familyId || typeof updater !== "function") return;
  const familyKey = String(familyId);
  const map = readDeletedMealsMap();
  const existing = map[familyKey] || { ids: [], client_ids: [] };
  const next = updater({
    ids: new Set((existing.ids || []).map(String)),
    clientIds: new Set((existing.client_ids || []).map(String)),
  });
  if (!next) return;
  map[familyKey] = {
    ids: Array.from(next.ids),
    client_ids: Array.from(next.clientIds),
  };
  writeDeletedMealsMap(map);
}

function markMealDeletedForFamily(familyId, identifiers = []) {
  updateDeletedMeals(familyId, (entry) => {
    identifiers
      .filter(Boolean)
      .map(String)
      .forEach((id) => {
        entry.ids.add(id);
        entry.clientIds.add(id);
      });
    return entry;
  });
}

function clearDeletedMealMarkers(familyId, identifiers = []) {
  if (!familyId || !identifiers.length) return;
  updateDeletedMeals(familyId, (entry) => {
    identifiers
      .filter(Boolean)
      .map(String)
      .forEach((id) => {
        entry.ids.delete(id);
        entry.clientIds.delete(id);
      });
    return entry;
  });
}

function getDeletedMealsForFamily(familyId) {
  if (!familyId) return { ids: new Set(), clientIds: new Set() };
  const map = readDeletedMealsMap();
  const entry = map[String(familyId)] || { ids: [], client_ids: [] };
  return {
    ids: new Set((entry.ids || []).map(String)),
    clientIds: new Set((entry.client_ids || []).map(String)),
  };
}

function filterDeletedMeals(familyId, meals = []) {
  if (!familyId) return meals;
  const { ids, clientIds } = getDeletedMealsForFamily(familyId);
  if (!ids.size && !clientIds.size) return meals;
  return meals.filter((meal) => {
    const candidates = [
      meal?.id != null ? String(meal.id) : null,
      meal?.client_id != null ? String(meal.client_id) : null,
    ].filter(Boolean);
    return candidates.every((id) => !ids.has(id) && !clientIds.has(id));
  });
}

function sanitizeFamilyMealPayload(payload = {}, context = "family_meals") {
  const entries = Object.entries(payload || {});
  const allowed = new Set(FAMILY_MEAL_COLUMNS);
  const unknownKeys = entries.map(([key]) => key).filter((key) => !allowed.has(key));
  if (unknownKeys.length) {
    console.warn("[FAMILY MEALS] Dropping unknown columns before Supabase insert/update", {
      context,
      unknownKeys,
      payloadPreview: {
        keys: entries.map(([key]) => key),
        sample: Object.fromEntries(entries.slice(0, 5)),
      },
    });
  }

  return entries.reduce((acc, [key, value]) => {
    if (allowed.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export { sanitizeFamilyMealPayload };

function normalizeMealLogType(value, fallback = "dinner") {
  const normalized = (value || "").toString().trim().toLowerCase();
  return MEAL_LOG_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeLogDate(value) {
  return getDiaryDateKey(value || getTodayDate());
}

function normalizeMealLogRow(row = {}) {
  const logDate = normalizeLogDate(row.log_date || row.meal_date || row.date);
  const mealType = normalizeMealLogType(row.meal_type || row.mealType || row.type);
  const calories = Math.round(coerceNumber(row.calories));
  const protein = coerceNumber(row.protein_g ?? row.protein ?? row.macros?.protein);
  const carbs = coerceNumber(row.carbs_g ?? row.carbs ?? row.macros?.carbs);
  const fat = coerceNumber(row.fat_g ?? row.fat ?? row.macros?.fat);
  const servingSizeG = coerceNumber(row.serving_size_g ?? row.serving_size ?? row.serving);
  return {
    ...row,
    title: row.title || row.name || "Meal",
    name: row.name || row.title || "Meal",
    log_date: logDate,
    meal_date: row.meal_date || logDate,
    meal_type: mealType,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    protein,
    carbs,
    fat,
    serving_size_g: servingSizeG || null,
    logged: true,
    logged_at: row.logged_at || row.created_at || logDate,
    dateKey: logDate,
  };
}

export function buildMealLogPayload({ userId, familyGroupId, logDate, mealType, sourceMeal }) {
  const name = sourceMeal?.name || sourceMeal?.title || "Meal";
  const brand = sourceMeal?.brand || sourceMeal?.restaurant || sourceMeal?.source || null;

  const servingSizeG =
    sourceMeal?.serving_size_g ??
    sourceMeal?.servingSizeG ??
    sourceMeal?.serving_size ??
    sourceMeal?.serving ??
    null;

  const calories =
    sourceMeal?.calories ??
    sourceMeal?.kcal ??
    sourceMeal?.energy ??
    0;

  const protein =
    sourceMeal?.protein_g ??
    sourceMeal?.protein ??
    sourceMeal?.macros?.protein ??
    0;

  const carbs =
    sourceMeal?.carbs_g ??
    sourceMeal?.carbs ??
    sourceMeal?.macros?.carbs ??
    0;

  const fat =
    sourceMeal?.fat_g ??
    sourceMeal?.fat ??
    sourceMeal?.macros?.fat ??
    0;
  const source = sourceMeal?.source || null;

  return {
    user_id: userId,
    family_group_id: familyGroupId || null,
    log_date: logDate, // 'YYYY-MM-DD'
    meal_type: mealType, // breakfast/lunch/dinner/snacks
    meal_id: sourceMeal?.id || sourceMeal?.meal_id || null,

    name: String(name),
    brand: brand ? String(brand) : null,
    serving_size_g:
      servingSizeG === null || servingSizeG === undefined || servingSizeG === ""
        ? null
        : Number(servingSizeG),

    calories: Math.round(Number(calories) || 0),
    protein_g: Number(protein) || 0,
    carbs_g: Number(carbs) || 0,
    fat_g: Number(fat) || 0,
    source: source ? String(source) : null,
  };
}

async function refreshDiary(dateValue) {
  try {
    const mod = await import("./logDiary.js");
    if (typeof mod.reloadDiaryFromServer === "function") {
      await mod.reloadDiaryFromServer(dateValue);
    }
  } catch (err) {
    console.warn("[MEALS] Could not refresh diary", err);
  }
}

function sanitizeMealLogPayload(payload = {}) {
  const allowedKeys = new Set([
    "user_id",
    "family_group_id",
    "log_date",
    "meal_date",
    "meal_type",
    "meal_id",
    "name",
    "brand",
    "serving_size_g",
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "source",
    "created_at",
  ]);
  const unknownKeys = Object.keys(payload || {}).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    console.warn("[MEAL LOGS] Dropping unknown columns before Supabase insert", {
      unknownKeys,
      sample: Object.fromEntries(Object.entries(payload || {}).slice(0, 5)),
    });
  }

  const {
    user_id,
    family_group_id = null,
    log_date,
    meal_date,
    meal_type,
    meal_id = null,
    name,
    brand = null,
    serving_size_g,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    source = null,
    created_at = null,
  } = payload || {};

  const normalizedLogDate = normalizeLogDate(log_date || meal_date);
  const normalizedMealType = normalizeMealLogType(meal_type);
  const normalizedServingSize =
    serving_size_g === null || serving_size_g === undefined || serving_size_g === ""
      ? null
      : Number(serving_size_g);

  const sanitized = {
    user_id,
    family_group_id,
    log_date: normalizedLogDate,
    meal_type: normalizedMealType,
    meal_id,
    name: name ? String(name) : "Meal",
    brand: brand ? String(brand) : null,
    serving_size_g: normalizedServingSize,
    calories: Math.round(Number(calories) || 0),
    protein_g: Number(protein_g) || 0,
    carbs_g: Number(carbs_g) || 0,
    fat_g: Number(fat_g) || 0,
  };

  if (source) sanitized.source = String(source);
  if (created_at) sanitized.created_at = created_at;

  return sanitized;
}

async function insertMealLog(payload) {
  const sanitizedPayload = sanitizeMealLogPayload(payload);
  const { data, error } = await supabase.from(MEAL_LOG_TABLE).insert([sanitizedPayload]).select("*");
  console.log("[MEAL LOG INSERT]", { data, error });
  const insertedRow = Array.isArray(data) ? data[0] : data;
  return { data: insertedRow, error };
}

function normalizeMacroSet(macros) {
  if (!macros || typeof macros !== "object") return null;
  return {
    calories: coerceNumber(macros.calories ?? macros.kcal ?? macros.energy ?? 0),
    protein: coerceNumber(macros.protein ?? macros.protein_g ?? 0),
    carbs: coerceNumber(macros.carbs ?? macros.carbohydrates ?? macros.carbs_g ?? 0),
    fat: coerceNumber(macros.fat ?? macros.fat_g ?? 0),
  };
}

function scaleMacroValues(macros = {}, factor = 1) {
  const safeFactor = Number(factor) && Number(factor) > 0 ? Number(factor) : 1;
  return {
    calories: Math.round(coerceNumber(macros.calories) * safeFactor),
    protein: Math.round(coerceNumber(macros.protein ?? macros.protein_g) * safeFactor),
    carbs: Math.round(coerceNumber(macros.carbs ?? macros.carbohydrates ?? macros.carbs_g) * safeFactor),
    fat: Math.round(coerceNumber(macros.fat ?? macros.fat_g) * safeFactor),
  };
}

function scalePer100g(per100g = {}, grams = 100) {
  const factor = (coerceNumber(grams) || 0) / 100;
  const round2 = (value) => Math.round(value * 100) / 100;
  return {
    calories: round2(coerceNumber(per100g.calories) * (factor || 1)),
    protein: round2(coerceNumber(per100g.protein) * (factor || 1)),
    carbs: round2(coerceNumber(per100g.carbs) * (factor || 1)),
    fat: round2(coerceNumber(per100g.fat) * (factor || 1)),
  };
}

function normalizeFoodEntry(food = {}) {
  const servingQty = coerceNumber(food.serving_qty ?? food.servingQty);
  const servingSizeG = coerceNumber(
    food.serving_size_g ?? food.serving_grams ?? food.servingGrams ?? food.serving_weight_grams
  );
  const servingLabel = (food.serving_size || food.servingSize || "").toString().trim() || null;
  const provider = food.provider || food.source || null;
  const sourceItemId = food.sourceItemId || food.source_item_id || food.nix_item_id || null;
  const source = food.source || (sourceItemId ? "nutritionix" : "local");
  const rawId = food.id || sourceItemId || null;
  const id = rawId != null ? String(rawId) : null;
  const macrosBasis = food.macros_basis || food.macrosBasis || null;
  const caloriesPer100gInput = coerceNumber(food.caloriesPer100g ?? food.calories_per_100g);
  const per100g =
    normalizeMacroSet(food.per100g) ||
    (macrosBasis === "per100g" ? normalizeMacroSet(food.macros) : null) ||
    (caloriesPer100gInput
      ? {
          calories: caloriesPer100gInput,
          protein: coerceNumber(food.proteinPer100g ?? food.protein_100g),
          carbs: coerceNumber(food.carbsPer100g ?? food.carbs_100g),
          fat: coerceNumber(food.fatPer100g ?? food.fat_100g),
        }
      : null);
  const perServing =
    normalizeMacroSet(food.perServing) ||
    (macrosBasis === "perServing" ? normalizeMacroSet(food.macros) : null) ||
    (per100g && servingSizeG ? normalizeMacroSet(scalePer100g(per100g, servingSizeG)) : null);
  const macros =
    normalizeMacroSet(food.macros) ||
    perServing ||
    (macrosBasis !== "perServing" ? per100g : null) || {
      calories: coerceNumber(
        food.calories ??
          food.calorie ??
          food.calories_total ??
          food.kcal ??
          food.macros?.calories ??
          0
      ),
      protein: coerceNumber(
        food.protein ?? food.protein_g ?? food.protein_total ?? food.macros?.protein
      ),
      carbs: coerceNumber(
        food.carbs ?? food.carbs_g ?? food.carbs_total ?? food.net_carbs ?? food.macros?.carbs
      ),
      fat: coerceNumber(food.fat ?? food.fat_g ?? food.fat_total ?? food.fats ?? food.macros?.fat),
    };
  const resolvedBasis =
    macrosBasis ||
    (perServing ? "perServing" : per100g ? "per100g" : macros ? "perServing" : null);
  const caloriesPer100g =
    caloriesPer100gInput ||
    (per100g ? coerceNumber(per100g.calories) : null) ||
    (macros?.calories && servingSizeG ? (coerceNumber(macros.calories) / servingSizeG) * 100 : null);

  return {
    ...food,
    id,
    source,
    provider: provider || null,
    sourceItemId,
    brandName: food.brandName || food.brand || food.brand_name || null,
    name: food.name || food.title || food.food_name || "",
    calories: coerceNumber(macros.calories),
    protein_g: coerceNumber(macros.protein),
    carbs_g: coerceNumber(macros.carbs),
    fat_g: coerceNumber(macros.fat),
    serving_qty: servingQty || null,
    serving_unit: food.serving_unit || food.servingUnit || null,
    serving_grams: servingSizeG || null,
    serving_size_g: servingSizeG || null,
    serving_size: servingLabel || (servingSizeG ? `${Math.round(servingSizeG)} g` : null),
    macros_basis: resolvedBasis,
    perServing: perServing || null,
    per100g: per100g || null,
    caloriesPer100g: caloriesPer100g || null,
    isOutlier: Boolean(food.isOutlier),
    outlierReason: food.outlierReason || null,
    macros,
    raw: food.raw || food.raw_json,
  };
}

async function loadFoodDatabase() {
  if (foodSearchLoaded) return foodSearchIndex;
  try {
    const res = await fetch(FOODS_DATA_URL);
    if (!res.ok) throw new Error(`Failed to load foods.json (${res.status})`);
    const data = await res.json();
    foodSearchIndex = Array.isArray(data) ? data.map(normalizeFoodEntry) : [];
    foodSearchLoaded = true;
    foodSearchError = null;
  } catch (err) {
    console.error("[meals] Unable to load food search database", err);
    foodSearchError = err;
    foodSearchIndex = [];
  }
  return foodSearchIndex;
}

async function fetchFoodSearchResults(query, mode = mealSearchMode) {
  try {
    const { results } = await searchFoods(query, { mode, limit: 12 });
    const normalizedResults = results.map((entry) => normalizeFoodEntry(entry));
    return { results: normalizedResults, error: null };
  } catch (err) {
    console.error("[meals] food-search failed", err);
    return { results: [], error: err };
  }
}

function scoreFoodMatch(name, query) {
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return -1;
  let score = 0;
  if (idx === 0) score += 4;
  if (idx > 0) score += 2;
  const words = lower.split(/\s+/);
  if (words.some((w) => w.startsWith(query))) score += 3;
  score -= idx * 0.05;
  return score;
}

function searchLocalFoods(query) {
  if (!query || query.length < 2 || !foodSearchIndex.length) return [];
  const normalizedQuery = query.toLowerCase();
  return foodSearchIndex
    .map((food) => ({
      food,
      score: scoreFoodMatch(food.name || "", normalizedQuery),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || (a.food.name || "").localeCompare(b.food.name || ""))
    .map((entry) => entry.food)
    .slice(0, 12);
}

function formatServingLabel(food = {}) {
  const normalized = normalizeFoodEntry(food);
  if (normalized.serving_size) return normalized.serving_size;
  const servingSizeG = coerceNumber(normalized.serving_size_g ?? normalized.serving_grams);
  if (servingSizeG) return `${Math.round(servingSizeG)} g`;
  const qty = coerceNumber(normalized.serving_qty);
  const unit = normalized.serving_unit;
  if (!qty || !unit) return "";
  const roundedQty = Math.round(qty * 100) / 100;
  const grams = coerceNumber(normalized.serving_grams);
  const gramsLabel = grams ? ` (${Math.round(grams)} g)` : "";
  return `${roundedQty} ${unit}${gramsLabel}`;
}

function getCaloriesPer100gValue(food = {}) {
  const per100g = getPer100gMacros(food);
  const caloriesFromPer100 = coerceNumber(per100g?.calories);
  if (caloriesFromPer100 > 0) return caloriesFromPer100;
  const caloriesField = coerceNumber(food.caloriesPer100g ?? food.calories_per_100g);
  if (caloriesField > 0) return caloriesField;
  const nutrition = getFoodNutrition(food);
  const calories = coerceNumber(nutrition.calories);
  const servingGrams = coerceNumber(nutrition.serving_grams);
  if (calories > 0 && servingGrams > 0) {
    return (calories / servingGrams) * 100;
  }
  return null;
}

function formatResultMacros(food = {}) {
  const nutrition = getFoodNutrition(food);
  const calories = Math.round(coerceNumber(nutrition.calories));
  const protein = Math.round(coerceNumber(nutrition.protein ?? nutrition.protein_g));
  const carbs = Math.round(coerceNumber(nutrition.carbs ?? nutrition.carbs_g));
  const fat = Math.round(coerceNumber(nutrition.fat ?? nutrition.fat_g));
  const hasAny = calories > 0 || protein > 0 || carbs > 0 || fat > 0;
  if (!hasAny) return "Macros pending";
  const calorieText = calories > 0 ? `${calories} cal` : "Calories ?";
  return `${calorieText} • P ${protein}g • C ${carbs}g • F ${fat}g`;
}

function formatResultServing(food = {}) {
  const serving = formatServingLabel(food);
  return serving || "Serving unknown";
}

function formatPer100g(food = {}) {
  const calories100 = getCaloriesPer100gValue(food);
  if (!calories100) return "";
  return `${Math.round(calories100)} cal / 100g`;
}

function getFoodCacheKey(food = {}) {
  const normalized = normalizeFoodEntry(food);
  if (normalized.provider && normalized.id) {
    return `${normalized.provider}:${normalized.id}`;
  }
  if (normalized.sourceItemId) return String(normalized.sourceItemId);
  if (normalized.name) {
    return `${normalized.source || "nutritionix"}:${normalized.name.toLowerCase()}:${
      normalized.brandName || ""
    }`;
  }
  return null;
}

function hasNutritionBasics(food = {}) {
  const nutrition = getFoodNutrition(food);
  return coerceNumber(nutrition.calories) > 0;
}

async function hydrateFoodDetails(food = {}) {
  const normalized = normalizeFoodEntry(food);
  const cacheKey = getFoodCacheKey(normalized);
  if (cacheKey && foodDetailCache.has(cacheKey)) {
    return foodDetailCache.get(cacheKey);
  }

  if (normalized.provider === "usda" || normalized.provider === "off") {
    if (cacheKey) {
      foodDetailCache.set(cacheKey, normalized);
    }
    return normalized;
  }

  if (hasNutritionBasics(normalized) && normalized.serving_unit) {
    if (cacheKey) {
      foodDetailCache.set(cacheKey, normalized);
    }
    return normalized;
  }

  if (!normalized.id) {
    console.warn("[EH] hydrateFoodDetails missing id for selection", normalized);
    return normalized;
  }

  try {
    const payload = {
      id: normalized.id,
      source: normalized.source || undefined,
      title: normalized.title || normalized.name || undefined,
    };
    console.log("[EH] hydrateFoodDetails payload", {
      id: payload.id,
      source: payload.source,
      title: payload.title,
    });
    const { data, error } = await supabase.functions.invoke("nutrition-item", {
      body: payload,
    });
    if (error) throw error;

    const detail = data?.food || data;
    const hydrated = detail ? normalizeFoodEntry(detail) : normalized;
    if (cacheKey) foodDetailCache.set(cacheKey, hydrated);
    return hydrated;
  } catch (err) {
    console.warn("[meals] Failed to hydrate food details", err);
    if (cacheKey && !foodDetailCache.has(cacheKey)) {
      foodDetailCache.set(cacheKey, normalized);
    }
    return normalized;
  }
}

function formatSelectedMacros(nutrition = {}) {
  const calories = Math.round(coerceNumber(nutrition.calories));
  const protein = Math.round(coerceNumber(nutrition.protein ?? nutrition.protein_g));
  const carbs = Math.round(coerceNumber(nutrition.carbs ?? nutrition.carbs_g));
  const fat = Math.round(coerceNumber(nutrition.fat ?? nutrition.fat_g));
  if (calories <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return "No macros yet";
  return `Cal ${calories} • P ${protein}g • C ${carbs}g • F ${fat}g`;
}

function getPer100gMacros(nutrition = {}) {
  if (nutrition.per100g) return nutrition.per100g;
  if (nutrition.macros_basis === "per100g" && nutrition.macros) return nutrition.macros;
  return null;
}

function getPerServingMacros(nutrition = {}) {
  const perServing = normalizeMacroSet(nutrition.perServing);
  if (perServing) return perServing;
  if (nutrition.macros_basis === "perServing" && nutrition.macros) {
    return normalizeMacroSet(nutrition.macros);
  }
  const per100g = normalizeMacroSet(getPer100gMacros(nutrition));
  const servingSizeG = coerceNumber(nutrition.serving_size_g ?? nutrition.serving_grams);
  if (per100g && servingSizeG) {
    return normalizeMacroSet(scalePer100g(per100g, servingSizeG));
  }
  return null;
}

function applyPortionMultiplier(nutrition = {}, portion = selectedPortion, options = {}) {
  const factor = Number(portion) && Number(portion) > 0 ? Number(portion) : 1;
  const servingQty = coerceNumber(nutrition.serving_qty);
  const servingGrams = coerceNumber(nutrition.serving_size_g ?? nutrition.serving_grams);
  const perServing = getPerServingMacros(nutrition);
  const per100g = normalizeMacroSet(getPer100gMacros(nutrition));
  if (perServing) {
    const scaledMacros = scaleMacroValues(perServing, factor);
    return {
      ...scaledMacros,
      serving_qty: servingQty ? servingQty * factor : null,
      serving_unit: nutrition.serving_unit || null,
      serving_grams: servingGrams ? Math.round(servingGrams * factor) : null,
      serving_size_g: servingGrams ? Math.round(servingGrams * factor) : null,
      serving_size: nutrition.serving_size || null,
      name: nutrition.name,
      brandName: nutrition.brandName || null,
      sourceItemId: nutrition.sourceItemId || null,
      source: nutrition.source || null,
      raw: nutrition.raw,
      macros_basis: "perServing",
      perServing,
      per100g,
    };
  }

  if (per100g) {
    const gramsOverride = coerceNumber(options.gramsOverride);
    const effectiveGrams = coerceNumber(servingGrams || gramsOverride) || 100;
    const scaledMacros = scaleMacroValues(per100g, (effectiveGrams / 100) * factor);
    return {
      ...scaledMacros,
      serving_qty: servingQty ? servingQty * factor : null,
      serving_unit: nutrition.serving_unit || null,
      serving_grams: Math.round(effectiveGrams * factor),
      serving_size_g: Math.round(effectiveGrams * factor),
      serving_size: nutrition.serving_size || (effectiveGrams ? `${Math.round(effectiveGrams)} g` : null),
      name: nutrition.name,
      brandName: nutrition.brandName || null,
      sourceItemId: nutrition.sourceItemId || null,
      source: nutrition.source || null,
      raw: nutrition.raw,
      macros_basis: "per100g",
      per100g,
    };
  }

  return {
    calories: Math.round(coerceNumber(nutrition.calories) * factor),
    protein: Math.round(coerceNumber(nutrition.protein ?? nutrition.protein_g) * factor),
    carbs: Math.round(coerceNumber(nutrition.carbs ?? nutrition.carbs_g) * factor),
    fat: Math.round(coerceNumber(nutrition.fat ?? nutrition.fat_g) * factor),
    serving_qty: servingQty ? servingQty * factor : null,
    serving_unit: nutrition.serving_unit || null,
    serving_grams: servingGrams ? Math.round(servingGrams * factor) : null,
    serving_size_g: servingGrams ? Math.round(servingGrams * factor) : null,
    serving_size: nutrition.serving_size || null,
    name: nutrition.name,
    brandName: nutrition.brandName || null,
    sourceItemId: nutrition.sourceItemId || null,
    source: nutrition.source || null,
    raw: nutrition.raw,
  };
}

function buildServingNote(nutrition = {}, portion = selectedPortion) {
  const baseLabel = nutrition.serving_size || "";
  const grams = coerceNumber(nutrition.serving_grams);
  const portionGrams = grams ? Math.round(grams * portion) : null;
  const scaledLabel =
    portion !== 1 && portionGrams
      ? (baseLabel ? `${baseLabel} (x${portion} ≈ ${portionGrams} g)` : `${portionGrams} g`)
      : baseLabel;
  const label =
    scaledLabel ||
    formatServingLabel({
      ...nutrition,
      serving_qty: nutrition.serving_qty ? nutrition.serving_qty * portion : nutrition.serving_qty,
      serving_grams: portionGrams ?? nutrition.serving_grams,
    });
  if (!label) return "";
  const brandLabel = nutrition.brandName ? ` • ${nutrition.brandName}` : "";
  const sourceLabel =
    nutrition.source === "nutritionix" || !nutrition.source ? " (Nutritionix)" : "";
  return `Serving: ${label}${brandLabel}${sourceLabel}`;
}

function mergeNotesWithServing(notes, nutrition = {}, portion = selectedPortion) {
  const servingNote = buildServingNote(nutrition, portion);
  if (!servingNote) return notes || null;
  if (notes && notes.includes(servingNote)) return notes;
  return notes ? `${notes}\n${servingNote}` : servingNote;
}

function getFoodNutrition(food) {
  const normalized = normalizeFoodEntry(food);
  const perServing = getPerServingMacros(normalized);
  const per100g = normalizeMacroSet(normalized.per100g);
  const macros =
    perServing ||
    normalizeMacroSet(normalized.macros) ||
    (normalized.macros_basis !== "perServing" ? per100g : null) ||
    null;
  return {
    calories: coerceNumber(macros?.calories ?? normalized.calories),
    protein: coerceNumber(macros?.protein ?? normalized.protein_g),
    carbs: coerceNumber(macros?.carbs ?? normalized.carbs_g),
    fat: coerceNumber(macros?.fat ?? normalized.fat_g),
    serving_qty: normalized.serving_qty,
    serving_unit: normalized.serving_unit,
    serving_grams: normalized.serving_grams,
    serving_size_g: normalized.serving_size_g ?? normalized.serving_grams,
    serving_size: normalized.serving_size || null,
    name: normalized.name,
    brandName: normalized.brandName || null,
    sourceItemId: normalized.sourceItemId || null,
    source: normalized.source || null,
    raw: normalized.raw,
    macros_basis: normalized.macros_basis || (perServing ? "perServing" : per100g ? "per100g" : null),
    perServing: perServing || null,
    per100g: per100g || null,
    macros,
  };
}

function updateSelectedServingDetails(food = {}, options = {}) {
  const nutrition = options.nutrition || getFoodNutrition(food);
  const gramsLabel = nutrition.serving_grams ? `${Math.round(nutrition.serving_grams)} g` : "";
  const baseServing = nutrition.serving_size || "";
  const servingLabel =
    (selectedPortion !== 1 && baseServing && gramsLabel
      ? `${baseServing} (≈ ${gramsLabel})`
      : baseServing || gramsLabel) || formatServingLabel(nutrition);
  const per100g = getPer100gMacros(nutrition);
  const hasPer100g = Boolean(per100g);
  const hasPerServing = Boolean(nutrition.perServing);
  const servingGrams = coerceNumber(nutrition.serving_grams);
  if (mealSelectedServingNote) {
    mealSelectedServingNote.textContent = servingLabel ? `Serving: ${servingLabel}` : hasPer100g ? "Per 100g" : "";
  }
  if (mealSelectedGrams) {
    const showGrams = hasPer100g && !hasPerServing && !servingGrams;
    mealSelectedGrams.hidden = !showGrams;
    if (showGrams && mealSelectedGramsInput && !mealSelectedGramsInput.value) {
      mealSelectedGramsInput.value = String(selectedManualGrams || 100);
    }
  }
}

function getSelectedMealDate() {
  return getDiaryDateKey(mealDateInput?.value || selectedDate || getTodayDate());
}

function getSelectedMealType() {
  return mealTypeInput?.value || "dinner";
}

function setPortionSelection(value) {
  selectedPortion = Number(value) && Number(value) > 0 ? Number(value) : 1;
  if (mealPortionButtons && mealPortionButtons.length) {
    mealPortionButtons.forEach((btn) => {
      const matches = Number(btn.dataset.portion) === selectedPortion;
      btn.classList.toggle("active", matches);
    });
  }
  updateSelectedPreview();
}

function syncManualInputs(nutrition = {}) {
  if (mealCaloriesInput) mealCaloriesInput.value = nutrition.calories ?? "";
  if (mealProteinInput) mealProteinInput.value = nutrition.protein ?? nutrition.protein_g ?? "";
  if (mealCarbsInput) mealCarbsInput.value = nutrition.carbs ?? nutrition.carbs_g ?? "";
  if (mealFatInput) mealFatInput.value = nutrition.fat ?? nutrition.fat_g ?? "";
}

function getManualNutrition() {
  return {
    calories: coerceNumber(mealCaloriesInput?.value),
    protein: coerceNumber(mealProteinInput?.value),
    carbs: coerceNumber(mealCarbsInput?.value),
    fat: coerceNumber(mealFatInput?.value),
  };
}

function hasManualMacros() {
  const manual = getManualNutrition();
  return (
    manual.calories > 0 ||
    manual.protein > 0 ||
    manual.carbs > 0 ||
    manual.fat > 0
  );
}

function clearSelection() {
  selectedFood = null;
  selectionToken++;
  selectedPortion = 1;
  selectedManualGrams = 100;
  if (mealSearchInput) mealSearchInput.value = "";
  if (mealSelectedContainer) mealSelectedContainer.hidden = true;
  if (mealSelectedName) mealSelectedName.textContent = "";
  if (mealSelectedMacros) mealSelectedMacros.textContent = "";
  if (mealSelectedServingNote) mealSelectedServingNote.textContent = "";
  if (mealSelectedGrams) mealSelectedGrams.hidden = true;
  if (mealSelectedGramsInput) mealSelectedGramsInput.value = "";
  if (mealPortionButtons && mealPortionButtons.length) {
    mealPortionButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.portion === "1"));
  }
}

function updateSelectedPreview() {
  if (!mealSelectedContainer) return;
  if (!selectedFood) {
    mealSelectedContainer.hidden = true;
    return;
  }
  const nutrition = applyPortionMultiplier(getFoodNutrition(selectedFood), selectedPortion, {
    gramsOverride: selectedManualGrams,
  });
  syncManualInputs(nutrition);
  mealSelectedContainer.hidden = false;
  if (mealSelectedName) {
    const label = selectedFood.brandName
      ? `${selectedFood.brandName} — ${selectedFood.name || "Food"}`
      : selectedFood.name || "Food";
    mealSelectedName.textContent = label;
  }
  if (mealSelectedMacros) mealSelectedMacros.textContent = formatSelectedMacros(nutrition);
  updateSelectedServingDetails(selectedFood, { nutrition });
}

async function selectFood(food) {
  const normalized = normalizeFoodEntry(food);
  selectedFood = normalized;
  const currentToken = ++selectionToken;
  setPortionSelection(1);
  selectedManualGrams = 100;
  if (mealSelectedGramsInput) {
    mealSelectedGramsInput.value = String(selectedManualGrams);
  }
  if (mealTitleInput && normalized.name) {
    mealTitleInput.value = normalized.name;
  }
  updateSelectedPreview();
  if (mealSelectedMacros) {
    mealSelectedMacros.textContent = "Loading nutrition…";
  }
  const hydrated = await hydrateFoodDetails(normalized);
  if (currentToken !== selectionToken) return;
  selectedFood = hydrated;
  updateSelectedPreview();
}

function renderFoodResults(results, query, options = {}) {
  const { quickResults = lastQuickResults, loading = false, mode = mealSearchMode } = options;
  if (!mealSearchResults) return;
  mealSearchResults.innerHTML = "";

  const shouldShowLoading = loading || remoteSearchLoading;

  if (!query) {
    const hint = document.createElement("div");
    hint.className = "search-hint";
    hint.textContent = "Start typing to search foods.";
    mealSearchResults.appendChild(hint);
    return;
  }

  if (remoteSearchError) {
    const errorNode = document.createElement("div");
    errorNode.className = "search-hint";
    errorNode.textContent = "Couldn't search foods right now. Showing quick picks.";
    mealSearchResults.appendChild(errorNode);
  } else if (shouldShowLoading) {
    const loadingNode = document.createElement("div");
    loadingNode.className = "search-hint";
    loadingNode.textContent = "Searching foods…";
    mealSearchResults.appendChild(loadingNode);
  }

  const renderRow = (food, idx, source = "remote") => {
    const row = document.createElement("div");
    row.className = "meal-search-result";
    row.dataset.resultIndex = idx;
    row.dataset.resultSource = source;
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    const copy = document.createElement("div");
    copy.className = "meal-search-copy";

    const name = document.createElement("div");
    name.textContent = food.brandName ? `${food.brandName} — ${food.name || "Food"}` : food.name || "Food";

    const macrosMeta = document.createElement("div");
    macrosMeta.className = "meal-search-macros";
    macrosMeta.textContent = formatResultMacros(food);

    const servingMeta = document.createElement("div");
    servingMeta.className = "meal-search-subtext";
    servingMeta.textContent = formatResultServing(food);

    const caloriesPer100g = formatPer100g(food);
    let per100gMeta = null;
    if (caloriesPer100g) {
      per100gMeta = document.createElement("div");
      per100gMeta.className = "meal-search-subtext";
      per100gMeta.textContent = caloriesPer100g;
    }

    let outlierBadge = null;
    if (food.isOutlier) {
      outlierBadge = document.createElement("span");
      outlierBadge.className = "meal-search-outlier";
      outlierBadge.textContent = "Likely prepared dish";
      if (food.outlierReason) {
        outlierBadge.title = food.outlierReason;
      }
    }

    copy.appendChild(name);
    copy.appendChild(macrosMeta);
    copy.appendChild(servingMeta);
    if (per100gMeta) copy.appendChild(per100gMeta);
    if (outlierBadge) copy.appendChild(outlierBadge);

    const actions = document.createElement("div");
    actions.className = "meal-search-actions";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.classList.add("ghost-btn", "meal-search-add");
    addBtn.textContent = "Add";
    addBtn.dataset.resultIndex = idx;
    addBtn.dataset.resultSource = source;

    actions.appendChild(addBtn);

    row.appendChild(copy);
    row.appendChild(actions);
    mealSearchResults.appendChild(row);
  };

  if (Array.isArray(results) && results.length) {
    results.forEach((food, idx) => renderRow(food, idx, "remote"));
  } else if (!shouldShowLoading && !remoteSearchError) {
    const empty = document.createElement("div");
    empty.className = "search-hint";
    empty.textContent = "No foods found. Try a different keyword.";
    mealSearchResults.appendChild(empty);
  }

  if (mode === "common" && quickResults.length) {
    const quickHeader = document.createElement("div");
    quickHeader.className = "search-hint";
    quickHeader.textContent = "Quick picks (local)";
    mealSearchResults.appendChild(quickHeader);
    quickResults.forEach((food, idx) => renderRow(food, idx, "local"));
  } else if (
    mode === "common" &&
    foodSearchError &&
    !results.length &&
    !shouldShowLoading &&
    !remoteSearchError
  ) {
    const quickError = document.createElement("div");
    quickError.className = "search-hint";
    quickError.textContent = "Local quick picks unavailable.";
    mealSearchResults.appendChild(quickError);
  }
}

async function addFoodResultToLog(food) {
  if (!food) return;
  const detailed = await hydrateFoodDetails(food);
  selectedFood = detailed;
  const targetDate = getSelectedMealDate();
  const mealType = getSelectedMealType();
  const title = detailed.name || food.name || "Food";
  const portion = selectedPortion || 1;
  const nutritionSource = getFoodNutrition(detailed);
  const nutrition = applyPortionMultiplier(nutritionSource, portion, {
    gramsOverride: selectedManualGrams,
  });

  await logMealToDiary(
    {
      title,
      meal_type: mealType,
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      nutrition,
    },
    { date: targetDate }
  );
}

async function handleFoodSearch(query) {
  if (!mealSearchResults) return;
  const trimmed = (query || "").trim();
  if (!trimmed || trimmed.length < 2) {
    lastSearchResults = [];
    lastQuickResults = [];
    remoteSearchError = null;
    remoteSearchLoading = false;
    renderFoodResults([], "", { mode: mealSearchMode });
    return;
  }

  const token = ++lastSearchToken;
  remoteSearchLoading = true;
  remoteSearchError = null;
  const mode = mealSearchMode;
  renderFoodResults([], trimmed, { loading: true, quickResults: [], mode });

  const quickResultsPromise =
    mode === "common"
      ? loadFoodDatabase()
          .then(() => searchLocalFoods(trimmed))
          .catch((err) => {
            console.warn("[meals] local food search unavailable", err);
            return [];
          })
      : Promise.resolve([]);

  let remoteResults = [];
  try {
    const { results, error } = await fetchFoodSearchResults(trimmed, mode);
    if (error) throw error || new Error("Food search failed");
    remoteResults = results;
  } catch (err) {
    console.error("[meals] food-search failed", err);
    remoteSearchError = err;
    remoteResults = [];
  }

  const quickMatches = await quickResultsPromise;
  remoteSearchLoading = false;

  if (token !== lastSearchToken) return;

  lastSearchResults = remoteResults;
  lastQuickResults = quickMatches;
  renderFoodResults(lastSearchResults, trimmed, { quickResults: lastQuickResults, mode });
}

function updateMealSearchModeButtons() {
  if (!mealSearchModeButtons || !mealSearchModeButtons.length) return;
  mealSearchModeButtons.forEach((btn) => {
    const btnMode = (btn.dataset.mealSearchMode || "common").toLowerCase();
    btn.classList.toggle("active", btnMode === mealSearchMode);
  });
}

function setMealSearchMode(mode = "common") {
  const normalized = mode === "branded" ? "branded" : "common";
  if (normalized === mealSearchMode) {
    return;
  }
  mealSearchMode = normalized;
  updateMealSearchModeButtons();
  const query = (mealSearchInput?.value || "").trim();
  if (query) {
    handleFoodSearch(query);
  } else {
    renderFoodResults([], "", { mode: mealSearchMode });
  }
}

const MEAL_ORDERING = [
  { column: "meal_date", options: { ascending: true } },
  { column: "meal_type", options: { ascending: true } },
  { column: "created_at", options: { ascending: true } },
  { column: "id", options: { ascending: true } },
];

function applyMealOrdering(query) {
  MEAL_ORDERING.forEach((order) => {
    query.order(order.column, order.options || {});
  });
  return query;
}

function isUUID(value) {
  return UUID_REGEX.test(String(value || ""));
}

function readMealStore() {
  const snapshot = readMealsStore();
  if (
    snapshot.shape === "map" &&
    snapshot.parsed &&
    typeof snapshot.parsed === "object" &&
    !Array.isArray(snapshot.parsed)
  ) {
    return { ...snapshot.parsed };
  }

  const list = Array.isArray(snapshot.parsed) ? snapshot.parsed : [];
  return { unscoped: list };
}

function writeMealStore(store) {
  saveMeals(store || {});
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function computeMealTotals(meal = {}) {
  const normalized = normalizeMeal(meal) || {};
  return {
    calories: coerceNumber(normalized.calories),
    protein: coerceNumber(normalized.protein ?? normalized.protein_g),
    carbs: coerceNumber(normalized.carbs ?? normalized.carbs_g),
    fat: coerceNumber(normalized.fat ?? normalized.fat_g),
  };
}

function buildServerMealPayload(meal = {}) {
  const serverPayload = { ...(meal || {}) };
  if (!isUUID(serverPayload.id)) {
    delete serverPayload.id;
  }
  if (!serverPayload.client_id && meal.id) {
    serverPayload.client_id = meal.id;
  }
  return sanitizeFamilyMealPayload(serverPayload, "family_meals:payload");
}

export function getStoredMeals(familyId) {
  if (!familyId) return [];
  const store = readMealStore();
  const list = store[familyId] || store.unscoped || [];
  const normalized = Array.isArray(list)
    ? list
    : list && typeof list === "object"
    ? Object.values(list)
    : [];
  return normalized.filter(Boolean);
}

function persistMealsForFamily(familyId, meals = []) {
  if (!familyId) return;
  const store = readMealStore();
  store[familyId] = Array.isArray(meals) ? meals : [];
  writeMealStore(store);
}

function mealsMatch(a, b) {
  if (!a || !b) return false;
  const aIds = [a.id, a.client_id].filter(Boolean).map(String);
  const bIds = [b.id, b.client_id].filter(Boolean).map(String);
  const sharesId = aIds.some((id) => bIds.includes(id));
  const sharesMeta =
    (a.meal_date || "") === (b.meal_date || "") &&
    (a.title || "") === (b.title || "") &&
    (a.meal_type || "") === (b.meal_type || "");
  return sharesId || sharesMeta;
}

function mergeMeals(primary = [], secondary = []) {
  const merged = [];
  const add = (meal) => {
    if (!meal) return;
    const existingIdx = merged.findIndex((item) => mealsMatch(item, meal));
    const mergedRow = {
      ...(existingIdx >= 0 ? merged[existingIdx] : {}),
      ...meal,
    };
    if (existingIdx >= 0) {
      merged[existingIdx] = mergedRow;
    } else {
      merged.push(mergedRow);
    }
  };

  primary.forEach(add);
  secondary.forEach(add);

  return merged.sort((a, b) =>
    (a.meal_date || "").localeCompare(b.meal_date || "")
  );
}

function upsertStoredMeal(familyId, meal, options = {}) {
  if (!familyId || !meal) return;
  const existing = getStoredMeals(familyId);
  const matchValue = options.matchClientId || options.matchId;
  const targetIdx = existing.findIndex((entry) =>
    mealsMatch(entry, {
      ...meal,
      client_id: meal.client_id ?? matchValue,
      id: meal.id ?? matchValue,
    })
  );
  const mergedRow = {
    ...(targetIdx >= 0 ? existing[targetIdx] : {}),
    ...meal,
  };
  if (targetIdx >= 0) {
    existing[targetIdx] = mergedRow;
  } else {
    existing.push(meal);
  }
  persistMealsForFamily(familyId, existing);
}

export function removeStoredMeal(familyId, identifier, clientId) {
  if (!familyId || identifier == null) return;
  const existing = getStoredMeals(familyId);
  const filtered = existing.filter(
    (meal) =>
      !mealsMatch(meal, {
        id: identifier,
        client_id: clientId,
      })
  );
  persistMealsForFamily(familyId, filtered);
}

export async function deleteMealById(mealId, options = {}) {
  if (!mealId) return { error: new Error("Missing meal id") };
  if (!currentFamilyId) {
    guardMutation({
      table: "family_meals",
      operation: "delete",
      filters: { id: mealId },
    });
    return { error: new Error("Missing family id") };
  }

  const normalizedId = String(mealId);
  const clientId = options.client_id || options.clientId || normalizedId;
  const shouldForceLocalRemoval =
    !isUUID(normalizedId) || String(clientId || "").startsWith(LOCAL_ID_PREFIX);
  const allowLocalFallback = options.allowLocalFallback === true;
  console.log("[MEAL DELETE] Attempting removal", {
    serverId: normalizedId,
    clientId,
    reason: options.reason,
  });

  let deleteError = null;
  let deletedRows = 0;
  let usedLocalFallback = false;

  const attemptDelete = async (column, value) => {
    const { data, error } = await supabase
      .from("family_meals")
      .delete()
      .eq(column, value)
      .eq("family_group_id", currentFamilyId)
      .select("id, client_id");
    if (error) {
      deleteError = error;
      return;
    }
    deletedRows += data?.length || 0;
  };

  if (isUUID(normalizedId)) {
    await attemptDelete("id", normalizedId);
    if (!deleteError && deletedRows === 0 && clientId && clientId !== normalizedId) {
      console.log("[MEAL DELETE] Fallback to client_id", { clientId });
      await attemptDelete("client_id", clientId);
    }
  } else if (clientId) {
    await attemptDelete("client_id", clientId);
  }

  if (!deleteError) {
    removeStoredMeal(currentFamilyId, normalizedId, clientId);
    removeMealByIdOrClientId(normalizedId, {
      clientId,
      reason: options.reason || "deleteMeal",
    });
    markMealDeletedForFamily(currentFamilyId, [normalizedId, clientId]);
    announceDataChange("meals", options.date || options.meal_date);
  } else if (deleteError && allowLocalFallback && shouldForceLocalRemoval) {
    console.warn("[MEAL DELETE] Local removal despite server error", deleteError);
    removeStoredMeal(currentFamilyId, normalizedId, clientId);
    removeMealByIdOrClientId(normalizedId, {
      clientId,
      reason: options.reason || "deleteMeal:fallback",
    });
    markMealDeletedForFamily(currentFamilyId, [normalizedId, clientId]);
    announceDataChange("meals", options.date || options.meal_date);
    usedLocalFallback = true;
    deleteError = null;
  }

  return { error: deleteError, fallback: usedLocalFallback };
}

export async function deleteMealLogById(logId, options = {}) {
  if (!logId) return { error: new Error("Missing meal log id") };
  if (!currentUser?.id) return { error: new Error("Missing user") };

  const normalizedId = String(logId);
  const clientId = options.client_id || options.clientId || normalizedId;
  const targetDate = options.date || options.log_date || options.meal_date;

  const attemptDelete = async (column, value) =>
    supabase
      .from(MEAL_LOG_TABLE)
      .delete()
      .eq("user_id", currentUser.id)
      .eq(column, value)
      .select("*");

  let response = await attemptDelete("id", normalizedId);

  if ((!response.data || response.data.length === 0) && !response.error && clientId && clientId !== normalizedId) {
    response = await attemptDelete("client_id", clientId);
  }

  console.log("[MEAL LOG DELETE]", {
    id: normalizedId,
    clientId,
    data: response.data,
    error: response.error,
  });

  if (response.error) {
    return { error: response.error };
  }

  announceDataChange("meals", targetDate);
  await refreshDiary(targetDate || selectedDate);

  return { data: Array.isArray(response.data) ? response.data[0] : response.data };
}

function announceDataChange(source, date) {
  const detail = source || date ? { source, date } : { source };
  window.dispatchEvent(new CustomEvent("eh:data-changed", { detail }));
  window.dispatchEvent(new CustomEvent("eh:dataChanged", { detail }));
}

export async function logMealToDiary(meal, options = {}) {
  const userId = currentUser?.id || null;
  if (!supabase || typeof supabase.from !== "function") {
    console.warn("[ADD EARLY RETURN] missing supabase client");
    showToast("Missing Supabase client");
    return { error: new Error("Missing Supabase client") };
  }

  if (!currentUser) {
    console.warn("[ADD EARLY RETURN] missing auth", {
      userId,
      familyId: currentFamilyId || null,
    });
    showToast("Please sign in to log meals.");
    return { error: new Error("Missing auth") };
  }

  const targetDate =
    getDiaryDateKey(options.date || selectedDate || getTodayDate()) || getTodayDate();
  const title = (meal.title || meal.name || "Meal").trim();
  if (!title) {
    console.warn("[ADD EARLY RETURN] missing meal title", { mealId: meal.id || null });
    showToast("Meal is missing a title.");
    return { error: new Error("Missing title") };
  }

  const mealType = normalizeMealLogType(meal.meal_type || meal.mealType || options.mealType);
  const totals = computeMealTotals(meal);
  const existingId = meal.id || null;
  const existingClientId = meal.client_id || meal.clientId || null;
  const tempId = existingClientId || existingId || `${LOCAL_ID_PREFIX}${Date.now()}`;
  const servingSizeG =
    meal.serving_size_g ?? meal.servingSizeG ?? meal.serving_size ?? meal.serving ?? null;
  const mealSource = meal.source || null;

  const sourceMeal = {
    id: existingId,
    meal_id: meal.meal_id || meal.mealId || existingId || null,
    title,
    name: meal.name || title,
    brand: meal.brand || meal.restaurant || mealSource || null,
    serving_size_g: servingSizeG,
    calories:
      Math.round(coerceNumber(totals.calories ?? meal.calories ?? meal.nutrition?.calories)) || 0,
    protein: coerceNumber(
      totals.protein ?? meal.protein_g ?? meal.protein ?? meal.nutrition?.protein_g ?? meal.nutrition?.protein
    ),
    carbs: coerceNumber(
      totals.carbs ?? meal.carbs_g ?? meal.carbs ?? meal.nutrition?.carbs_g ?? meal.nutrition?.carbs
    ),
    fat: coerceNumber(
      totals.fat ?? meal.fat_g ?? meal.fat ?? meal.nutrition?.fat_g ?? meal.nutrition?.fat
    ),
    source: mealSource,
  };

  const payload = buildMealLogPayload({
    userId,
    familyGroupId: currentFamilyId,
    logDate: targetDate,
    mealType,
    sourceMeal,
  });

  const { data, error } = await insertMealLog(payload);
  if (error) {
    console.error("[MEAL LOG INSERT ERROR]", { error, payload });
    if (!options.silent) {
      showToast(`Couldn't save meal: ${error.message}`);
    }
    return { error };
  }

  console.log("[MEAL LOG INSERT OK]", data);

  const reconciled = normalizeMealLogRow({
    ...payload,
    ...(data || {}),
    client_id: data?.client_id || tempId,
  });

  upsertMeal(reconciled, {
    reason: "logMealToDiary:insert",
    matchClientId: tempId,
  });
  console.log("[EH MEAL] saved row totals", {
    calories: reconciled.calories ?? 0,
    protein: reconciled.protein ?? 0,
    carbs: reconciled.carbs ?? 0,
    fat: reconciled.fat ?? 0,
  });

  announceDataChange("meals", targetDate);

  await refreshDiary(targetDate);

  if (!options.silent) {
    showToast("Added to log");
    maybeVibrate([16]);
  }

  return { data: reconciled };
}

function formatMealDateLabel(dateValue) {
  if (!dateValue) return "";
  const parts = dateValue.split("-").map(Number);
  const [y, m, d] = parts;
  const date = new Date(y || 0, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatMealNutritionSummary(meal) {
  return formatNutritionSummary(meal);
}

function openMealDetailsModal(meal) {
  if (!meal) return;
  const body = document.createElement("div");
  body.className = "diary-detail-body";

  const meta = document.createElement("div");
  meta.className = "diary-detail-meta";

  const mealRow = document.createElement("div");
  mealRow.className = "diary-detail-meta-row";
  mealRow.innerHTML = `<span class="diary-detail-meta-label">Meal</span><span class="diary-detail-meta-value">${
    meal.meal_type
      ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)
      : "Meal"
  }</span>`;
  meta.appendChild(mealRow);

  if (meal.meal_date) {
    const dateRow = document.createElement("div");
    dateRow.className = "diary-detail-meta-row";
    dateRow.innerHTML = `<span class="diary-detail-meta-label">Date</span><span class="diary-detail-meta-value">${formatMealDateLabel(
      meal.meal_date
    )}</span>`;
    meta.appendChild(dateRow);
  }

  body.appendChild(meta);

  if (meal.notes) {
    const notes = document.createElement("p");
    notes.className = "diary-detail-note";
    notes.textContent = meal.notes;
    body.appendChild(notes);
  }

  openModal({
    title: meal.title || "Meal",
    body,
    primaryLabel: "Log this meal",
    onPrimary: async () => {
      await logMealToDiary(
        {
          title: meal.title,
          meal_type: meal.meal_type,
          calories: meal.calories,
          protein: meal.protein_g || meal.protein || meal.nutrition?.protein_g || meal.nutrition?.protein,
          carbs: meal.carbs_g || meal.carbs || meal.nutrition?.carbs_g || meal.nutrition?.carbs,
          fat: meal.fat_g || meal.fat || meal.nutrition?.fat_g || meal.nutrition?.fat,
          nutrition: meal.nutrition || meal.macros,
        },
        { date: selectedDate }
      );
    },
  });
}

setDinnerLogHandler(async (meal) => {
  await logMealToDiary(
    {
      title: meal.title,
      meal_type: "dinner",
      calories: meal.calories || meal.nutrition?.calories,
      protein: meal.protein_g || meal.protein || meal.nutrition?.protein_g || meal.nutrition?.protein,
      carbs: meal.carbs_g || meal.carbs || meal.nutrition?.carbs_g || meal.nutrition?.carbs,
      fat: meal.fat_g || meal.fat || meal.nutrition?.fat_g || meal.nutrition?.fat,
      nutrition: meal.nutrition || meal.macros,
    },
    { date: selectedDate }
  );
});

export function setMealsFamilyState() {
  if (!mealsNoFamily || !mealsHasFamily) return;

  if (currentFamilyId) {
    mealsNoFamily.style.display = "none";
    mealsHasFamily.style.display = "block";
  } else {
    mealsNoFamily.style.display = "block";
    mealsHasFamily.style.display = "none";
    if (mealsList) mealsList.innerHTML = "";
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }
  }
}

function normalizeMealsWithNutrition(meals = [], options = {}) {
  const normalizedMeals = [];
  const patches = [];
  const patchKeys = new Set(
    Array.isArray(options.patchKeys)
      ? options.patchKeys
          .filter(Boolean)
          .map(String)
      : options.patchKeys instanceof Set
      ? Array.from(options.patchKeys)
      : []
  );

  meals.forEach((meal) => {
    if (!meal) return;
    let nutrition = null;
    let normalized = meal;
    try {
      nutrition = normalizeMealNutrition({
        ...meal,
        ingredients: meal.ingredients || meal.notes,
      });
      normalized = { ...meal, ...nutrition };
      normalizedMeals.push(normalized);
    } catch (err) {
      console.warn("[meals] Failed to normalize meal, leaving as-is", meal?.id, err);
      normalizedMeals.push(meal);
    }

    const mealKey = meal.id || meal.client_id;
    const shouldPatch =
      hasIncompleteNutrition(meal) ||
      (mealKey && patchKeys.has(String(mealKey)));

    if (shouldPatch && nutrition) {
      patches.push({
        meal: normalized,
        nutrition,
      });
    }
  });

  return { normalizedMeals, patches };
}

async function applyNutritionBackfill(patches = []) {
  if (!currentFamilyId || !Array.isArray(patches) || !patches.length) return;

  for (const entry of patches) {
    const meal = entry?.meal;
    const nutrition = entry?.nutrition;
    if (!meal || !nutrition) continue;

    const matchValue = isUUID(meal.id) ? meal.id : meal.client_id;
    if (!matchValue || nutritionPatchedKeys.has(String(matchValue))) continue;

    const payload = sanitizeFamilyMealPayload(
      {
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        family_group_id: currentFamilyId,
      },
      "family_meals:nutrition-backfill"
    );

    const matchColumn = isUUID(meal.id) ? "id" : "client_id";

    try {
      const { error } = await supabase
        .from("family_meals")
        .update(payload)
        .eq(matchColumn, matchValue)
        .eq("family_group_id", currentFamilyId);

      if (error) {
        console.error("[MEALS] Failed to backfill nutrition", {
          error,
          matchValue,
          matchColumn,
        });
        continue;
      }

      nutritionPatchedKeys.add(String(matchValue));
    } catch (err) {
      console.error("[MEALS] Exception during nutrition backfill", {
        error: err,
        matchValue,
        matchColumn,
      });
    }
  }
}

export async function loadMeals() {
  if (!currentFamilyId || !mealsList) return;

  if (mealsMessage) {
    mealsMessage.textContent = "";
    mealsMessage.style.color = "";
  }
  mealsList.innerHTML = "<li>Loading meals...</li>";

  const storedMeals = filterDeletedMeals(currentFamilyId, getStoredMeals(currentFamilyId));
  const { data, error } = await applyMealOrdering(
    supabase
      .from("family_meals")
      .select("*")
      .eq("family_group_id", currentFamilyId)
  );

  if (error) {
    console.error("Error loading meals:", error);
    console.warn("[EH MEALS] load failed", error);
    if (storedMeals.length) {
      mealsList.innerHTML = "";
      const { normalizedMeals } = normalizeMealsWithNutrition(storedMeals);
      renderMeals(normalizedMeals);
      persistMealsForFamily(currentFamilyId, normalizedMeals);
      setMeals(normalizedMeals, { reason: "loadMeals:offline" });
      if (mealsMessage) {
        mealsMessage.textContent = "Showing saved meals (offline)";
        mealsMessage.style.color = "var(--text-muted)";
      }
    } else {
      mealsList.innerHTML = "<li>Could not load meals.</li>";
      setMeals([], { reason: "loadMeals:error" });
    }
  } else {
    const remoteMeals = data || [];
    const merged = mergeMeals(remoteMeals, storedMeals);
    const patchKeys = remoteMeals
      .filter((meal) => hasIncompleteNutrition(meal))
      .map((meal) => meal.id || meal.client_id);
    const { normalizedMeals, patches } = normalizeMealsWithNutrition(merged, {
      patchKeys,
    });
    const visibleMeals = filterDeletedMeals(currentFamilyId, normalizedMeals);
    persistMealsForFamily(currentFamilyId, visibleMeals);
    setMeals(visibleMeals, { reason: "loadMeals" });
    renderMeals(visibleMeals);
    console.log("[EH MEALS] load success", {
      remote: remoteMeals.length,
      stored: storedMeals.length,
      normalized: normalizedMeals.length,
      visible: visibleMeals.length,
    });
    await applyNutritionBackfill(patches);
  }
}

export async function fetchMealsByDate(dateValue, options = {}) {
  const userId = currentUser?.id;
  const targetDate = getDiaryDateKey(dateValue);
  if (!userId || !targetDate) return [];

  const { data, error } = await supabase
    .from(MEAL_LOG_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("log_date", targetDate)
    .order("log_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (isDebugEnabled()) {
    console.debug("[EH DIARY] fetchMealsByDate (meal_logs)", {
      userId,
      dateKey: targetDate,
      remoteCount: Array.isArray(data) ? data.length : 0,
      error: error?.message || null,
    });
  }

  if (error) {
    console.error("Error loading meals for date:", error);
    return [];
  }

  const normalizedMeals = (data || []).map((meal) => normalizeMealLogRow(meal));
  setMeals(normalizedMeals, { reason: "fetchMealsByDate:meal_logs" });
  return normalizedMeals;
}

async function logMealToToday(meal) {
  await logMealToDiary(meal, {
    date: selectedDate || getTodayDate(),
    skipReload: true,
  });
}

function renderMeals(items) {
  if (!mealsList) return;

  const upcomingMeals = Array.isArray(items)
    ? items.filter((meal) => meal && !isMealLogged(meal))
    : [];

  if (!upcomingMeals.length) {
    mealsList.innerHTML = "<li>No upcoming meals. Add one above!</li>";
    return;
  }

  mealsList.innerHTML = "";

  for (const meal of upcomingMeals) {
    const totals = computeMealTotals(meal);
    const li = document.createElement("li");
    li.dataset.mealId = meal.id || "";
    li.dataset.mealClientId = meal.client_id || meal.id || "";
    li.dataset.mealType = meal.meal_type;
    li.dataset.mealTitle = meal.title;
    li.dataset.mealDate = meal.meal_date;
    li.dataset.mealNotes = meal.notes || "";
    li.dataset.mealCalories = totals.calories ?? "";
    li.dataset.mealProtein = totals.protein ?? "";
    li.dataset.mealCarbs = totals.carbs ?? "";
    li.dataset.mealFat = totals.fat ?? "";
    li.style.display = "flex";
    li.style.flexDirection = "column";
    li.style.gap = "0.25rem";
    li.style.padding = "0.5rem 0";
    li.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.justifyContent = "space-between";
    topRow.style.alignItems = "center";
    topRow.style.gap = "0.5rem";

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.textContent = meal.title;
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const dateStr = meal.meal_date || "";
    const mealTypeValue = meal.meal_type || "meal";
    const typeLabel =
      mealTypeValue.charAt(0).toUpperCase() + mealTypeValue.slice(1);
    meta.textContent = `${typeLabel} • ${dateStr}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const logBtn = document.createElement("button");
    logBtn.textContent = "Add";
    logBtn.type = "button";
    logBtn.dataset.action = "add-upcoming-meal";
    logBtn.dataset.mealId = meal.id || "";
    logBtn.dataset.mealClientId = meal.client_id || meal.id || "";
    logBtn.classList.add("ghost-btn", "meal-log-btn");
    logBtn.style.paddingInline = "0.6rem";
    logBtn.style.fontSize = "0.85rem";
    right.appendChild(logBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("meal-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    const nutritionSummary = formatMealNutritionSummary(meal);
    if (nutritionSummary) {
      const nutrition = document.createElement("div");
      nutrition.textContent = nutritionSummary;
      nutrition.style.fontSize = "0.8rem";
      nutrition.style.opacity = "0.85";
      li.appendChild(nutrition);
    }

    if (meal.notes) {
      const notes = document.createElement("div");
      notes.textContent = meal.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    mealsList.appendChild(li);
  }
}

updateMealSearchModeButtons();

if (mealSearchInput) {
  mealSearchInput.addEventListener("input", (e) => {
    const query = (e.target.value || "").trim();
    if (searchDebounceId) {
      clearTimeout(searchDebounceId);
    }
    searchDebounceId = setTimeout(() => handleFoodSearch(query), 300);
  });
  mealSearchInput.addEventListener("focus", async () => {
    if (!foodSearchLoaded && !foodSearchError) {
      await loadFoodDatabase();
    }
    renderFoodResults(lastSearchResults, (mealSearchInput.value || "").trim());
  });
}

if (mealSearchModeButtons && mealSearchModeButtons.length) {
  mealSearchModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = (btn.dataset.mealSearchMode || "common").toLowerCase();
      setMealSearchMode(mode);
    });
  });
}

if (mealSearchResults) {
  mealSearchResults.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".meal-search-add");
    if (addBtn) {
      const idx = Number(addBtn.dataset.resultIndex);
      const source = addBtn.dataset.resultSource || "remote";
      const food = source === "local" ? lastQuickResults[idx] : lastSearchResults[idx];
      if (food) {
        addFoodResultToLog(food);
      }
      return;
    }
    const target = e.target.closest(".meal-search-result");
    if (!target) return;
    const idx = Number(target.dataset.resultIndex);
    const source = target.dataset.resultSource || "remote";
    const food = source === "local" ? lastQuickResults[idx] : lastSearchResults[idx];
    if (food) {
      selectFood(food);
      if (mealSearchInput) mealSearchInput.value = food.name || "";
    }
  });
  mealSearchResults.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest(".meal-search-add")) return;
    const target = e.target.closest(".meal-search-result");
    if (!target) return;
    e.preventDefault();
    const idx = Number(target.dataset.resultIndex);
    const source = target.dataset.resultSource || "remote";
    const food = source === "local" ? lastQuickResults[idx] : lastSearchResults[idx];
    if (food) {
      selectFood(food);
      if (mealSearchInput) mealSearchInput.value = food.name || "";
    }
  });
}

if (mealPortionButtons && mealPortionButtons.length) {
  mealPortionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const portion = btn.dataset.portion || "1";
      setPortionSelection(portion);
    });
  });
}

if (mealSelectedGramsInput) {
  mealSelectedGramsInput.addEventListener("input", () => {
    const value = coerceNumber(mealSelectedGramsInput.value);
    selectedManualGrams = value > 0 ? value : 100;
    updateSelectedPreview();
  });
}

  if (mealClearSelection) {
    mealClearSelection.addEventListener("click", () => {
      clearSelection();
      syncManualInputs({ calories: "", protein: "", carbs: "", fat: "" });
      renderFoodResults([], "", { mode: mealSearchMode });
    });
  }

renderFoodResults([], "", { mode: mealSearchMode });

// ADD MEAL
if (mealsForm) {
  mealsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (mealsMessage) {
        mealsMessage.textContent = "You need a family group to add meals.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    const dateValue = mealDateInput.value;
    const mealType = mealTypeInput.value;
    const title = mealTitleInput.value.trim() || selectedFood?.name?.trim();

    if (!dateValue || !mealType || !title) return;

    let preparedFood = selectedFood;
    if (preparedFood) {
      preparedFood = await hydrateFoodDetails(preparedFood);
      selectedFood = preparedFood;
    }
    const portion = selectedPortion || 1;
    const nutritionSource = preparedFood ? getFoodNutrition(preparedFood) : getManualNutrition();
    const totals = applyPortionMultiplier(nutritionSource, portion, {
      gramsOverride: selectedManualGrams,
    });

    if (!preparedFood && !hasManualMacros()) {
      if (mealsMessage) {
        mealsMessage.textContent = "Select a food or enter macros manually.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    if (!totals.calories || totals.calories <= 0) {
      if (mealsMessage) {
        mealsMessage.textContent = "Calories must be greater than zero.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    const tempId = `${LOCAL_ID_PREFIX}${Date.now()}`;
    const { error } = await logMealToDiary(
      {
        title,
        meal_type: mealType,
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        client_id: tempId,
      },
      { date: dateValue, silent: true, mealType }
    );

    if (error && mealsMessage) {
      mealsMessage.textContent = "Error adding meal.";
      mealsMessage.style.color = "red";
    }

    mealsForm.reset();
    clearSelection();
    setPortionSelection(1);
    syncManualInputs({ calories: "", protein: "", carbs: "", fat: "" });
    renderFoodResults([], "", { mode: mealSearchMode });
    await loadMeals();
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: dateValue, entity: "meal" },
      })
    );
    announceDataChange("meals", dateValue);
  });
}

// DELETE MEAL
if (mealsList) {
  mealsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const mealId = li.dataset.mealId;
    const mealClientId = li.dataset.mealClientId;
    const identifier = mealId || mealClientId;
    if (!identifier) return;

    const logBtn = e.target.closest(".meal-log-btn");
    const deleteBtn = e.target.closest(".meal-delete");

    if (logBtn) {
      e.preventDefault();
      e.stopPropagation();
      await logMealToToday({
        title: li.dataset.mealTitle,
        meal_type: li.dataset.mealType,
        calories: li.dataset.mealCalories,
        protein: li.dataset.mealProtein,
        carbs: li.dataset.mealCarbs,
        fat: li.dataset.mealFat,
      });
      return;
    }

    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (deleteBtn.disabled) return;
      deleteBtn.disabled = true;
      deleteBtn.setAttribute("aria-busy", "true");
      li.classList.add("list-removing");
      const { error, fallback } = await deleteMealById(identifier, {
        date: li.dataset.mealDate,
        client_id: mealClientId,
        reason: "deleteMeal:planner",
      });

      if (error) {
        console.error("Error deleting meal:", error);
        li.classList.remove("list-removing");
        deleteBtn.disabled = false;
        deleteBtn.removeAttribute("aria-busy");
        showToast("Couldn't delete meal. Try again.");
        return;
      }

      if (fallback) {
        console.warn("[MEAL DELETE] Applied local-only removal fallback", {
          identifier,
          clientId: mealClientId,
        });
      }

      const removeNode = () => li.remove();
      li.addEventListener("transitionend", removeNode, { once: true });
      setTimeout(removeNode, 220);
      await loadMeals();
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "meal" } })
      );
      return;
    }

    openMealDetailsModal({
      title: li.dataset.mealTitle,
      meal_type: li.dataset.mealType,
      meal_date: li.dataset.mealDate,
      notes: li.dataset.mealNotes,
    });
  });
}
