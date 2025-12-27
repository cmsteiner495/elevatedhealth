// js/meals.js
import { supabase } from "./supabaseClient.js";
import {
  mealsNoFamily,
  mealsHasFamily,
  mealsForm,
  mealSearchInput,
  mealSearchResults,
  mealSelectedContainer,
  mealSelectedName,
  mealSelectedMacros,
  mealPortionButtons,
  mealClearSelection,
  mealDateInput,
  mealTypeInput,
  mealTitleInput,
  mealCaloriesInput,
  mealProteinInput,
  mealCarbsInput,
  mealFatInput,
  mealNotesInput,
  mealsMessage,
  mealsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  getTodayDate,
  selectedDate,
  setSelectedDate,
} from "./state.js";
import { guardMutation } from "./debug/mutationGuard.js";
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
let nutritionSearchError = null;
let nutritionSearchLoading = false;
let selectedFood = null;
let selectedPortion = 1;
let lastSearchResults = [];
let lastQuickResults = [];
let searchDebounceId = null;
let lastSearchToken = 0;
let selectionToken = 0;

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

function normalizeFoodEntry(food = {}) {
  const servingQty = coerceNumber(food.serving_qty ?? food.servingQty);
  const servingGrams = coerceNumber(
    food.serving_grams ?? food.servingGrams ?? food.serving_weight_grams
  );
  const sourceItemId = food.sourceItemId || food.source_item_id || food.nix_item_id || null;
  const source = food.source || (sourceItemId ? "nutritionix" : "local");
  return {
    ...food,
    source,
    sourceItemId,
    brandName: food.brandName || food.brand || food.brand_name || null,
    name: food.name || food.title || food.food_name || "",
    calories: coerceNumber(
      food.calories ?? food.calorie ?? food.calories_total ?? food.kcal ?? 0
    ),
    protein_g: coerceNumber(food.protein_g ?? food.protein ?? food.protein_total),
    carbs_g: coerceNumber(food.carbs_g ?? food.carbs ?? food.carbs_total ?? food.net_carbs),
    fat_g: coerceNumber(food.fat_g ?? food.fat ?? food.fat_total ?? food.fats),
    serving_qty: servingQty || null,
    serving_unit: food.serving_unit || food.servingUnit || null,
    serving_grams: servingGrams || null,
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

async function fetchNutritionSearchResults(query) {
  try {
    const { data, error } = await supabase.functions.invoke("nutrition-search", {
      body: { query },
    });
    if (error) throw error;
    const payloadResults =
      (data?.ok && Array.isArray(data.results) && data.results) ||
      (Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : []);
    return {
      results: Array.isArray(payloadResults)
        ? payloadResults.map((entry) => normalizeFoodEntry(entry))
        : [],
      error: null,
    };
  } catch (err) {
    console.error("[meals] nutrition-search failed", err);
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
  const qty = coerceNumber(normalized.serving_qty);
  const unit = normalized.serving_unit;
  if (!qty || !unit) return "";
  const roundedQty = Math.round(qty * 100) / 100;
  const grams = coerceNumber(normalized.serving_grams);
  const gramsLabel = grams ? ` (${Math.round(grams)} g)` : "";
  return `${roundedQty} ${unit}${gramsLabel}`;
}

function formatSearchMeta(food = {}) {
  const nutrition = getFoodNutrition(food);
  const calories = Math.round(coerceNumber(nutrition.calories));
  const caloriesText = calories > 0 ? `${calories} cal` : "Macros pending";
  const servingText = formatServingLabel(food);
  return servingText ? `${caloriesText} • ${servingText}` : caloriesText;
}

function getFoodCacheKey(food = {}) {
  const normalized = normalizeFoodEntry(food);
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

  if (hasNutritionBasics(normalized) && normalized.serving_unit) {
    if (cacheKey) {
      foodDetailCache.set(cacheKey, normalized);
    }
    return normalized;
  }

  try {
    const payload = {
      sourceItemId: normalized.sourceItemId || undefined,
      foodName: normalized.name || undefined,
      brandName: normalized.brandName || undefined,
      serving_qty: normalized.serving_qty || undefined,
      serving_unit: normalized.serving_unit || undefined,
    };
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

function applyPortionMultiplier(nutrition = {}, portion = selectedPortion) {
  const factor = Number(portion) && Number(portion) > 0 ? Number(portion) : 1;
  const servingQty = coerceNumber(nutrition.serving_qty);
  const servingGrams = coerceNumber(nutrition.serving_grams);
  return {
    calories: Math.round(coerceNumber(nutrition.calories) * factor),
    protein: Math.round(coerceNumber(nutrition.protein ?? nutrition.protein_g) * factor),
    carbs: Math.round(coerceNumber(nutrition.carbs ?? nutrition.carbs_g) * factor),
    fat: Math.round(coerceNumber(nutrition.fat ?? nutrition.fat_g) * factor),
    serving_qty: servingQty ? servingQty * factor : null,
    serving_unit: nutrition.serving_unit || null,
    serving_grams: servingGrams ? Math.round(servingGrams * factor) : null,
    name: nutrition.name,
    brandName: nutrition.brandName || null,
    sourceItemId: nutrition.sourceItemId || null,
    source: nutrition.source || null,
    raw: nutrition.raw,
  };
}

function buildServingNote(nutrition = {}, portion = selectedPortion) {
  const qty = coerceNumber(nutrition.serving_qty);
  const unit = nutrition.serving_unit;
  if (!qty || !unit) return "";
  const scaledQty = Math.round(qty * portion * 100) / 100;
  const grams = coerceNumber(nutrition.serving_grams);
  const gramsLabel = grams ? ` (~${Math.round(grams * portion)} g)` : "";
  const brandLabel = nutrition.brandName ? ` • ${nutrition.brandName}` : "";
  const sourceLabel =
    nutrition.source === "nutritionix" || !nutrition.source ? " (Nutritionix)" : "";
  return `Serving: ${scaledQty} ${unit}${gramsLabel}${brandLabel}${sourceLabel}`;
}

function mergeNotesWithServing(notes, nutrition = {}, portion = selectedPortion) {
  const servingNote = buildServingNote(nutrition, portion);
  if (!servingNote) return notes || null;
  if (notes && notes.includes(servingNote)) return notes;
  return notes ? `${notes}\n${servingNote}` : servingNote;
}

function getFoodNutrition(food) {
  const normalized = normalizeFoodEntry(food);
  return {
    calories: normalized.calories,
    protein: normalized.protein_g,
    carbs: normalized.carbs_g,
    fat: normalized.fat_g,
    serving_qty: normalized.serving_qty,
    serving_unit: normalized.serving_unit,
    serving_grams: normalized.serving_grams,
    name: normalized.name,
    brandName: normalized.brandName || null,
    sourceItemId: normalized.sourceItemId || null,
    source: normalized.source || null,
    raw: normalized.raw,
  };
}

function getSelectedMealDate() {
  return mealDateInput?.value || selectedDate || getTodayDate();
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
  if (mealSearchInput) mealSearchInput.value = "";
  if (mealSelectedContainer) mealSelectedContainer.hidden = true;
  if (mealSelectedName) mealSelectedName.textContent = "";
  if (mealSelectedMacros) mealSelectedMacros.textContent = "";
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
  const nutrition = applyPortionMultiplier(getFoodNutrition(selectedFood));
  syncManualInputs(nutrition);
  mealSelectedContainer.hidden = false;
  if (mealSelectedName) {
    const label = selectedFood.brandName
      ? `${selectedFood.brandName} — ${selectedFood.name || "Food"}`
      : selectedFood.name || "Food";
    mealSelectedName.textContent = label;
  }
  if (mealSelectedMacros) mealSelectedMacros.textContent = formatSelectedMacros(nutrition);
}

async function selectFood(food) {
  const normalized = normalizeFoodEntry(food);
  selectedFood = normalized;
  const currentToken = ++selectionToken;
  setPortionSelection(1);
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
  const { quickResults = lastQuickResults, loading = false } = options;
  if (!mealSearchResults) return;
  mealSearchResults.innerHTML = "";

  const shouldShowLoading = loading || nutritionSearchLoading;

  if (!query) {
    const hint = document.createElement("div");
    hint.className = "search-hint";
    hint.textContent = "Start typing to search foods.";
    mealSearchResults.appendChild(hint);
    return;
  }

  if (nutritionSearchError) {
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

    const meta = document.createElement("div");
    meta.className = "meal-search-meta";
    meta.textContent = formatSearchMeta(food);

    copy.appendChild(name);
    copy.appendChild(meta);

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
  } else if (!shouldShowLoading && !nutritionSearchError) {
    const empty = document.createElement("div");
    empty.className = "search-hint";
    empty.textContent = "No foods found. Try a different keyword.";
    mealSearchResults.appendChild(empty);
  }

  if (quickResults.length) {
    const quickHeader = document.createElement("div");
    quickHeader.className = "search-hint";
    quickHeader.textContent = "Quick picks (local)";
    mealSearchResults.appendChild(quickHeader);
    quickResults.forEach((food, idx) => renderRow(food, idx, "local"));
  } else if (foodSearchError && !results.length && !shouldShowLoading && !nutritionSearchError) {
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
  const nutrition = applyPortionMultiplier(nutritionSource, portion);
  const baseNotes = mealNotesInput?.value?.trim() || null;
  const notes = mergeNotesWithServing(baseNotes, nutritionSource, portion);

  await logMealToDiary(
    {
      title,
      meal_type: mealType,
      notes,
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
    nutritionSearchError = null;
    nutritionSearchLoading = false;
    renderFoodResults([], "");
    return;
  }

  const token = ++lastSearchToken;
  nutritionSearchLoading = true;
  nutritionSearchError = null;
  renderFoodResults([], trimmed, { loading: true, quickResults: [] });

  const quickResultsPromise = loadFoodDatabase()
    .then(() => searchLocalFoods(trimmed))
    .catch((err) => {
      console.warn("[meals] local food search unavailable", err);
      return [];
    });

  let remoteResults = [];
  try {
    const { results, error } = await fetchNutritionSearchResults(trimmed);
    if (error) throw error;
    remoteResults = results;
  } catch (err) {
    console.error("[meals] nutrition-search failed", err);
    nutritionSearchError = err;
    remoteResults = [];
  }

  const quickMatches = await quickResultsPromise;
  nutritionSearchLoading = false;

  if (token !== lastSearchToken) return;

  lastSearchResults = remoteResults;
  lastQuickResults = quickMatches;
  renderFoodResults(lastSearchResults, trimmed, { quickResults: lastQuickResults });
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
    protein: coerceNumber(normalized.protein),
    carbs: coerceNumber(normalized.carbs),
    fat: coerceNumber(normalized.fat),
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

function announceDataChange(source, date) {
  const detail = source || date ? { source, date } : { source };
  window.dispatchEvent(new CustomEvent("eh:data-changed", { detail }));
  window.dispatchEvent(new CustomEvent("eh:dataChanged", { detail }));
}

export async function logMealToDiary(meal, options = {}) {
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const targetDate = options.date || selectedDate || getTodayDate();
  const title = meal.title?.trim();
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || options.mealType || "dinner";
  const notes = (meal.notes || meal.description || "").trim() || null;
  const totals = computeMealTotals(meal);
  const loggedAt = new Date().toISOString();
  const existingId = meal.id || null;
  const existingClientId = meal.client_id || meal.clientId || null;
  const tempId = existingClientId || existingId || `${LOCAL_ID_PREFIX}${Date.now()}`;
  const payload = {
    family_group_id: currentFamilyId,
    added_by: currentUser.id,
    meal_date: targetDate,
    meal_type: mealType,
    title,
    notes,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    client_id: tempId,
    logged_at: loggedAt,
  };

  clearDeletedMealMarkers(currentFamilyId, [existingId, existingClientId, tempId]);

  const optimisticEntry = {
    id: existingId || tempId,
    client_id: tempId,
    ...payload,
    created_at: new Date().toISOString(),
  };

  upsertStoredMeal(currentFamilyId, optimisticEntry);
  upsertMeal(optimisticEntry, {
    reason: "logMealToDiary:optimistic",
    matchClientId: tempId,
  });
  console.log("[MEAL CREATE] Optimistic insert", {
    tempId,
    date: targetDate,
    mealType,
  });

  let persistedMeal = null;
  const { logged_at: _omitLoggedAt, ...serverPayloadInput } = payload;
  const serverPayload = buildServerMealPayload(serverPayloadInput);
  console.log("[MEAL INSERT] serverPayload", serverPayload);

  const tryUpdateTargets = [
    existingId ? ["id", existingId] : null,
    !existingId && existingClientId ? ["client_id", existingClientId] : null,
  ].filter(Boolean);

  let updateError = null;

  if (tryUpdateTargets.length) {
    for (const [column, value] of tryUpdateTargets) {
      const { data, error } = await supabase
        .from("family_meals")
        .update(serverPayload)
        .eq(column, value)
        .eq("family_group_id", currentFamilyId)
        .select("*")
        .maybeSingle();

      if (error) {
        updateError = error;
        continue;
      }

      if (data) {
        persistedMeal = data;
        updateError = null;
        break;
      } else {
        console.warn("[MEAL UPDATE] No rows matched update", {
          column,
          value,
          family_group_id: currentFamilyId,
        });
      }
    }
  }

  if (!persistedMeal) {
    const { data, error } = await supabase
      .from("family_meals")
      .insert([serverPayload])
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[MEAL INSERT ERROR]", error);
      removeStoredMeal(currentFamilyId, tempId, tempId);
      removeMealByIdOrClientId(tempId, {
        reason: "logMealToDiary:rollback",
        clientId: tempId,
      });
      if (!options.silent) {
        showToast("Couldn't save meal. Try again.");
      }
      return;
    } else if (!data) {
      console.warn("[MEAL INSERT] Insert returned no row", {
        family_group_id: currentFamilyId,
        client_id: tempId,
      });
      await loadMeals();
      return;
    }
    persistedMeal = data;
    updateError = null;
  } else if (updateError) {
    console.error("[MEAL UPDATE ERROR]", updateError);
    if (!options.silent) {
      showToast("Couldn't save meal. Try again.");
    }
    await loadMeals();
    return;
  }

  console.log("[MEAL UPSERT] saved row", persistedMeal);
  const reconciled = {
    ...optimisticEntry,
    ...persistedMeal,
    client_id: persistedMeal?.client_id || tempId,
  };
  upsertStoredMeal(currentFamilyId, reconciled, { matchClientId: tempId });
  upsertMeal(reconciled, {
    reason: "logMealToDiary:reconcile",
    matchClientId: tempId,
  });
  console.log("[MEAL RECONCILE] tempId -> uuid", {
    tempId,
    serverId: persistedMeal?.id,
  });
  if (!options.silent) {
    showToast("Added to log");
    maybeVibrate([16]);
  }
  console.log("[EH MEAL] saved row totals", {
    calories: reconciled.calories ?? 0,
    protein: reconciled.protein ?? 0,
    carbs: reconciled.carbs ?? 0,
    fat: reconciled.fat ?? 0,
  });

  const viewingTarget = selectedDate === targetDate;
  if (!viewingTarget && options.syncDate !== false) {
    setSelectedDate(targetDate, { force: true });
  } else {
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: targetDate, entity: "meal" },
      })
    );
  }

  announceDataChange("meals", targetDate);

  if (!options.skipReload) {
    await loadMeals();
  }
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
          notes: meal.notes,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
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
      notes: meal.description || meal.notes,
      calories: meal.calories || meal.nutrition?.calories,
      protein: meal.protein || meal.nutrition?.protein,
      carbs: meal.carbs || meal.nutrition?.carbs,
      fat: meal.fat || meal.nutrition?.fat,
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

export async function fetchMealsByDate(dateValue) {
  if (!currentFamilyId || !dateValue) return [];

  const storedMeals = filterDeletedMeals(currentFamilyId, getStoredMeals(currentFamilyId));
  const storedForDate = storedMeals.filter(
    (meal) => (meal.meal_date || "") === dateValue && isMealLogged(meal)
  );

  const { data, error } = await applyMealOrdering(
    supabase
      .from("family_meals")
      .select("*")
      .eq("family_group_id", currentFamilyId)
      .eq("meal_date", dateValue)
  );

  if (error) {
    console.error("Error loading meals for date:", error);
    return storedForDate;
  }

  const merged = mergeMeals(data || [], storedMeals);
  const patchKeys = (data || [])
    .filter((meal) => hasIncompleteNutrition(meal))
    .map((meal) => meal.id || meal.client_id);
  const { normalizedMeals, patches } = normalizeMealsWithNutrition(merged, {
    patchKeys,
  });
  const visibleMeals = filterDeletedMeals(currentFamilyId, normalizedMeals);
  persistMealsForFamily(currentFamilyId, visibleMeals);
  await applyNutritionBackfill(patches);
  return visibleMeals.filter(
    (meal) => (meal.meal_date || "") === dateValue && isMealLogged(meal)
  );
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

if (mealClearSelection) {
  mealClearSelection.addEventListener("click", () => {
    clearSelection();
    syncManualInputs({ calories: "", protein: "", carbs: "", fat: "" });
    renderFoodResults([], "");
  });
}

renderFoodResults([], "");

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
    const notesRaw = mealNotesInput.value.trim();

    if (!dateValue || !mealType || !title) return;

    let preparedFood = selectedFood;
    if (preparedFood) {
      preparedFood = await hydrateFoodDetails(preparedFood);
      selectedFood = preparedFood;
    }
    const portion = selectedPortion || 1;
    const nutritionSource = preparedFood ? getFoodNutrition(preparedFood) : getManualNutrition();
    const totals = applyPortionMultiplier(nutritionSource, portion);
    const notesWithServing = preparedFood
      ? mergeNotesWithServing(notesRaw, nutritionSource, portion)
      : notesRaw || null;

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
    const loggedAt = new Date().toISOString();
    const payload = {
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      meal_date: dateValue,
      meal_type: mealType,
      title,
      notes: notesWithServing,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      client_id: tempId,
      completed: true,
      logged_at: loggedAt,
    };
    clearDeletedMealMarkers(currentFamilyId, [tempId]);
    const optimisticEntry = {
      id: tempId,
      client_id: tempId,
      ...payload,
      added_by: currentUser?.id || null,
      created_at: new Date().toISOString(),
      logged: true,
    };
    upsertStoredMeal(currentFamilyId, optimisticEntry);
    upsertMeal(optimisticEntry, {
      reason: "addMeal:optimistic",
      matchClientId: tempId,
    });

    const serverPayload = buildServerMealPayload(payload);
    console.log("[MEAL INSERT] serverPayload", serverPayload);
    const { data, error } = await supabase
      .from("family_meals")
      .insert(serverPayload)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[MEAL INSERT ERROR]", error);
      removeStoredMeal(currentFamilyId, tempId, tempId);
      removeMealByIdOrClientId(tempId, {
        reason: "addMeal:rollback",
        clientId: tempId,
      });
      if (mealsMessage) {
        mealsMessage.textContent = "Error adding meal.";
        mealsMessage.style.color = "red";
      }
    } else if (!data) {
      console.warn("[MEAL INSERT] Insert returned no row", {
        family_group_id: currentFamilyId,
        client_id: tempId,
      });
      if (mealsMessage) {
        mealsMessage.textContent = "Meal saved, but confirmation missing. Reloading…";
        mealsMessage.style.color = "var(--text-muted)";
      }
      await loadMeals();
    } else {
      console.log("[MEAL INSERT] insertedRow", data);
      const reconciled = {
        ...optimisticEntry,
        ...data,
        client_id: data?.client_id || tempId,
      };
      upsertStoredMeal(currentFamilyId, reconciled, {
        matchClientId: tempId,
      });
      upsertMeal(reconciled, { reason: "addMeal:reconcile", matchClientId: tempId });
    }

    console.log("[EH MEAL] saved row totals", {
      calories: optimisticEntry.calories ?? 0,
      protein: optimisticEntry.protein ?? 0,
      carbs: optimisticEntry.carbs ?? 0,
      fat: optimisticEntry.fat ?? 0,
    });

    const guidedDate = mealsForm.dataset.targetDate;
    const guidedMealType = mealsForm.dataset.targetMealType;
    const shouldMirrorToLog =
      guidedDate && guidedMealType && (guidedDate !== dateValue || guidedMealType !== mealType);

    if (shouldMirrorToLog) {
      await logMealToDiary(
        { title, meal_type: guidedMealType, notes: notesWithServing },
        { date: guidedDate, silent: true, skipReload: true }
      );
    }

    mealsForm.reset();
    clearSelection();
    setPortionSelection(1);
    syncManualInputs({ calories: "", protein: "", carbs: "", fat: "" });
    renderFoodResults([], "");
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
        notes: li.dataset.mealNotes,
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
