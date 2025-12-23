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

function coerceIngredientsToText(ingredients) {
  if (!ingredients) return "";

  if (Array.isArray(ingredients)) {
    return ingredients
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          return x.name || x.item || x.ingredient || x.text || JSON.stringify(x);
        }
        return String(x);
      })
      .join(", ");
  }

  if (typeof ingredients === "string") return ingredients;

  try {
    return JSON.stringify(ingredients);
  } catch {
    return String(ingredients);
  }
}

function clampInt(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.round(v);
}

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
  const baseline = pickBaseline(input.meal_type || input.mealType || input.type);
  const estimate = {
    calories: averageRange(baseline.calories),
    protein: averageRange(baseline.protein),
    carbs: averageRange(baseline.carbs),
    fat: averageRange(baseline.fat),
  };

  const ingredientsText = coerceIngredientsToText(input?.ingredients);
  const nameText = (input?.name || input?.title || "").toString();
  const typeText = (input?.meal_type || input?.mealType || input?.type || "").toString();
  const text = `${nameText} ${typeText} ${ingredientsText} ${(input?.notes || "").toString()}`.toLowerCase();

  const biased = applyKeywordAdjustments(estimate, text);
  const calories = clampInt(biased.calories, 550);
  const protein = clampInt(biased.protein, 30);
  const carbs = clampInt(biased.carbs, 60);
  const fat = clampInt(biased.fat, 18);

  return {
    calories,
    protein,
    carbs,
    fat,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
  };
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

export function normalizeMealNutrition(meal) {
  try {
    const m = meal || {};

    const calories = Number(m.calories ?? m.cal ?? m.kcal);
    const protein = Number(m.protein_g ?? m.protein);
    const carbs = Number(m.carbs_g ?? m.carbs);
    const fat = Number(m.fat_g ?? m.fat);

    const hasValid =
      Number.isFinite(calories) &&
      calories > 0 &&
      Number.isFinite(protein) &&
      protein > 0 &&
      Number.isFinite(carbs) &&
      carbs > 0 &&
      Number.isFinite(fat) &&
      fat > 0;

    if (hasValid) {
      const caloriesVal = Math.round(calories);
      const proteinVal = Math.round(protein);
      const carbsVal = Math.round(carbs);
      const fatVal = Math.round(fat);
      return {
        ...m,
        calories: caloriesVal,
        protein: proteinVal,
        carbs: carbsVal,
        fat: fatVal,
        protein_g: proteinVal,
        carbs_g: carbsVal,
        fat_g: fatVal,
      };
    }

    const est = estimateMealNutrition(m);

    const caloriesEst = clampInt(est.calories, 550);
    const proteinEst = clampInt(est.protein ?? est.protein_g, 30);
    const carbsEst = clampInt(est.carbs ?? est.carbs_g, 60);
    const fatEst = clampInt(est.fat ?? est.fat_g, 18);

    return {
      ...m,
      calories: caloriesEst,
      protein: proteinEst,
      carbs: carbsEst,
      fat: fatEst,
      protein_g: proteinEst,
      carbs_g: carbsEst,
      fat_g: fatEst,
    };
  } catch (err) {
    console.warn("[nutrition] normalizeMealNutrition failed, using safe defaults", err);
    return {
      ...(meal || {}),
      calories: 550,
      protein: 30,
      carbs: 60,
      fat: 18,
      protein_g: 30,
      carbs_g: 60,
      fat_g: 18,
    };
  }
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
