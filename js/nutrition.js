// js/nutrition.js
const NUTRIENT_KEYS = ["calories", "protein", "carbs", "fat"];

const MEAL_TYPE_BASELINES = {
  breakfast: { calories: [350, 550], protein: [20, 35], carbs: [30, 60], fat: [10, 20] },
  lunch: { calories: [450, 700], protein: [25, 45], carbs: [40, 70], fat: [12, 25] },
  dinner: { calories: [500, 800], protein: [30, 55], carbs: [40, 80], fat: [15, 30] },
  snack: { calories: [150, 300], protein: [8, 20], carbs: [15, 35], fat: [5, 15] },
  default: { calories: [450, 700], protein: [25, 45], carbs: [40, 70], fat: [12, 25] },
};

const KEYWORD_ADJUSTMENTS = [
  {
    keywords: ["salmon", "trout", "tuna"],
    delta: { protein: 10, fat: 6, calories: 70, carbs: -6 },
  },
  {
    keywords: ["chicken", "turkey"],
    delta: { protein: 8, fat: 4, calories: 50 },
  },
  {
    keywords: ["beef", "steak", "pork"],
    delta: { protein: 10, fat: 10, calories: 110 },
  },
  {
    keywords: ["tofu", "tempeh", "edamame"],
    delta: { protein: 8, fat: 5, calories: 60, carbs: 5 },
  },
  {
    keywords: ["quinoa", "brown rice", "rice", "grain", "pasta", "noodle"],
    delta: { carbs: 18, calories: 90 },
  },
  {
    keywords: ["salad", "greens", "veggie", "vegetable"],
    delta: { carbs: -8, calories: -40, fat: 5, protein: 2 },
  },
  {
    keywords: ["burrito", "taco", "wrap", "sandwich"],
    delta: { carbs: 20, calories: 110, protein: 6, fat: 6 },
  },
  {
    keywords: ["smoothie", "shake", "yogurt", "oat", "oatmeal"],
    delta: { carbs: 22, calories: 100, protein: 6, fat: 4 },
  },
  {
    keywords: ["egg", "eggs"],
    delta: { protein: 10, fat: 7, calories: 90, carbs: -6 },
  },
  {
    keywords: ["soup", "stew", "chili", "curry"],
    delta: { protein: 6, carbs: 12, fat: 5, calories: 80 },
  },
  {
    keywords: ["avocado", "nuts", "almond", "peanut", "pesto", "seeds"],
    delta: { fat: 7, calories: 70, protein: 4 },
  },
];

function coerceNumber(value) {
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

function coercePositiveInt(value) {
  const num = Math.round(coerceNumber(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function pickBaseline(mealType = "") {
  const key = mealType.toLowerCase();
  return MEAL_TYPE_BASELINES[key] || MEAL_TYPE_BASELINES.default;
}

function averageRange([min, max]) {
  return (Number(min) + Number(max)) / 2;
}

function clampNutrition(values) {
  const result = {};
  for (const key of NUTRIENT_KEYS) {
    const value = Math.round(values[key] || 0);
    result[key] = Math.max(1, value);
  }
  return result;
}

function applyKeywordAdjustments(base, text = "") {
  if (!text) return base;
  const lower = text.toLowerCase();
  const adjusted = { ...base };

  for (const rule of KEYWORD_ADJUSTMENTS) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      for (const key of Object.keys(rule.delta)) {
        adjusted[key] = (adjusted[key] || 0) + (rule.delta[key] || 0);
      }
    }
  }

  return adjusted;
}

export function estimateMealNutrition(input = {}) {
  const baseline = pickBaseline(input.meal_type || input.type);
  const estimate = {
    calories: averageRange(baseline.calories),
    protein: averageRange(baseline.protein),
    carbs: averageRange(baseline.carbs),
    fat: averageRange(baseline.fat),
  };

  const descriptor = [
    input.title || "",
    input.name || "",
    input.ingredients ? input.ingredients.join(" ") : "",
    input.notes || "",
  ]
    .filter(Boolean)
    .join(" ");

  const biased = applyKeywordAdjustments(estimate, descriptor);
  return clampNutrition(biased);
}

function extractRawNutrition(meal = {}) {
  return {
    calories: coercePositiveInt(
      meal.calories ??
        meal.calories_total ??
        meal.nutrition?.calories ??
        meal.total_calories ??
        meal.kcal ??
        meal.kcals ??
        meal.energy_kcal ??
        meal.energy
    ),
    protein: coercePositiveInt(
      meal.protein ??
        meal.nutrition?.protein ??
        meal.protein_g ??
        meal.protein_total ??
        meal.protein_grams
    ),
    carbs: coercePositiveInt(
      meal.carbs ??
        meal.nutrition?.carbs ??
        meal.carbohydrates ??
        meal.carbs_total ??
        meal.net_carbs ??
        meal.total_carbs ??
        meal.carbs_g
    ),
    fat: coercePositiveInt(
      meal.fat ?? meal.nutrition?.fat ?? meal.fat_g ?? meal.fat_total ?? meal.fats ?? meal.total_fat
    ),
  };
}

export function hasIncompleteNutrition(meal = {}) {
  const raw = extractRawNutrition(meal);
  return NUTRIENT_KEYS.some((key) => raw[key] <= 0);
}

export function normalizeMealNutrition(meal = {}) {
  const raw = extractRawNutrition(meal);
  const isComplete = NUTRIENT_KEYS.every((key) => raw[key] > 0);
  if (isComplete) return raw;

  const estimate = estimateMealNutrition({
    meal_type: meal.meal_type || meal.type,
    title: meal.title || meal.name,
    ingredients: meal.ingredients,
    notes: meal.notes,
  });

  const normalized = {};
  for (const key of NUTRIENT_KEYS) {
    const rawValue = raw[key];
    normalized[key] = rawValue > 0 ? rawValue : estimate[key];
  }
  return clampNutrition(normalized);
}

export function formatNutritionSummary(meal = {}) {
  const nutrition = normalizeMealNutrition(meal);
  const valid = NUTRIENT_KEYS.every((key) => Number.isFinite(nutrition[key]) && nutrition[key] > 0);
  if (!valid) return "—";
  return `Cal ${nutrition.calories} • P ${nutrition.protein}g • C ${nutrition.carbs}g • F ${nutrition.fat}g`;
}

export function getNutritionKeys() {
  return [...NUTRIENT_KEYS];
}

export default {
  estimateMealNutrition,
  normalizeMealNutrition,
  hasIncompleteNutrition,
  formatNutritionSummary,
  getNutritionKeys,
};
