import { corsHeaders } from "../_shared/cors.ts";

type MacroSet = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

type NormalizedFoodResult = {
  id: string;
  provider: "usda" | "off";
  name: string;
  brandName?: string | null;
  servingGrams?: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  caloriesPer100g?: number | null;
  perServing?: MacroSet | null;
  per100g?: MacroSet | null;
  isOutlier?: boolean;
  outlierReason?: string | null;
};

type UsdaFood = Record<string, unknown> & {
  fdcId?: string | number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: Array<
    Record<string, unknown> & {
      nutrientNumber?: string | number;
      nutrientName?: string;
      value?: number;
      unitName?: string;
    }
  >;
  labelNutrients?: Record<string, { value?: number }>;
};

type OpenFoodFactsProduct = Record<string, unknown> & {
  code?: string;
  id?: string | number;
  _id?: string | number;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity?: number | string;
  nutriments?: Record<string, unknown>;
};

const DISH_TERMS = [
  "mayo",
  "salad",
  "brioche",
  "sandwich",
  "burger",
  "wrap",
  "pizza",
  "cake",
  "fried",
  "battered",
  "casserole",
];
const COMMON_BOOST_TERMS = ["raw", "fresh", "whole"];

const clampLimit = (value: number | null | undefined) =>
  Math.min(25, Math.max(1, Number.isFinite(value as number) ? Number(value) : 12));

const isSimpleQuery = (query: string) => {
  const trimmed = query.trim();
  return trimmed.length > 0 && trimmed.length <= 12 && trimmed.split(/\s+/).length === 1;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const num = Number(match[0]);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
};

const scalePer100g = (per100g: MacroSet, grams: number | null | undefined): MacroSet => {
  const factor = grams ? grams / 100 : 0;
  return {
    calories: per100g.calories != null && grams ? Math.round(per100g.calories * factor) : null,
    protein: per100g.protein != null && grams ? Math.round(per100g.protein * factor * 10) / 10 : null,
    carbs: per100g.carbs != null && grams ? Math.round(per100g.carbs * factor * 10) / 10 : null,
    fat: per100g.fat != null && grams ? Math.round(per100g.fat * factor * 10) / 10 : null,
  };
};

const nutrientLookup = (food: UsdaFood, target: number, fallbackName: string) => {
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  for (const nutrient of nutrients) {
    const num = nutrient?.nutrientNumber ? Number(nutrient.nutrientNumber) : null;
    const name = (nutrient?.nutrientName || "").toString().toLowerCase();
    if (num === target || name.includes(fallbackName)) {
      const val = parseNumber(nutrient?.value);
      if (val != null) return val;
    }
  }
  return null;
};

const normalizeUsdaFood = (food: UsdaFood): NormalizedFoodResult | null => {
  const idRaw = food.fdcId ?? food.id;
  const id = idRaw != null ? String(idRaw) : null;
  if (!id) return null;

  const name = (food.description || "").toString().trim();
  if (!name) return null;

  const labelNutrients = food.labelNutrients || {};
  const labelMacro = (key: string) => parseNumber(labelNutrients?.[key]?.value);
  const perServing: MacroSet = {
    calories: labelMacro("calories"),
    protein: labelMacro("protein"),
    carbs: labelMacro("carbohydrates"),
    fat: labelMacro("fat"),
  };

  const per100g: MacroSet = {
    calories: nutrientLookup(food, 1008, "energy"),
    protein: nutrientLookup(food, 1003, "protein"),
    carbs: nutrientLookup(food, 1005, "carbohydrate"),
    fat: nutrientLookup(food, 1004, "fat"),
  };

  const servingSize = parseNumber(food.servingSize);
  const servingUnit = (food.servingSizeUnit || "").toString().toLowerCase();
  const servingFromLabel = servingUnit === "g" && servingSize ? servingSize : null;

  let servingFromText: number | null = null;
  if (food.householdServingFullText) {
    const match = food.householdServingFullText.toString().match(/(\d+[.,]?\d*)\s*g\b/i);
    if (match?.[1]) {
      const parsed = parseNumber(match[1]);
      if (parsed) servingFromText = parsed;
    }
  }

  const servingGrams = servingFromLabel ?? servingFromText ?? null;
  const hasLabelMacros = Object.values(perServing).some((v) => v != null);
  const has100g = Object.values(per100g).some((v) => v != null);
  const servingMacros = hasLabelMacros
    ? perServing
    : has100g && servingGrams
      ? scalePer100g(per100g, servingGrams)
      : { calories: null, protein: null, carbs: null, fat: null };

  const caloriesPer100g =
    per100g.calories ??
    (servingMacros.calories != null && servingGrams ? (servingMacros.calories / servingGrams) * 100 : null);

  return {
    id,
    provider: "usda",
    name,
    brandName: food.brandOwner || food.brandName || null,
    servingGrams,
    calories: servingMacros.calories ?? null,
    protein: servingMacros.protein ?? null,
    carbs: servingMacros.carbs ?? null,
    fat: servingMacros.fat ?? null,
    caloriesPer100g: caloriesPer100g ?? null,
    perServing: hasLabelMacros ? perServing : servingMacros,
    per100g: has100g ? per100g : null,
  };
};

const pickNumber = (nutriments: Record<string, unknown> | undefined, keys: string[]) => {
  if (!nutriments) return null;
  for (const key of keys) {
    const val = parseNumber(nutriments[key]);
    if (val != null) return val;
  }
  return null;
};

const parseOffServing = (product: OpenFoodFactsProduct): { label: string; grams: number | null } => {
  const rawServingValue = product.serving_size;
  const rawServing =
    typeof rawServingValue === "string"
      ? rawServingValue.trim()
      : typeof rawServingValue === "number"
        ? `${rawServingValue} g`
        : "";
  const findGrams = (text: string): number | null => {
    const match = text.match(/(\d+[.,]?\d*)\s*g\b/i);
    if (match && match[1]) {
      const parsed = parseNumber(match[1]);
      if (parsed && parsed > 0) return parsed;
    }
    return null;
  };

  let grams: number | null = null;
  if (rawServing) {
    const parens = rawServing.match(/\([^()]*\)/g) || [];
    for (const group of parens) {
      const parsed = findGrams(group);
      if (parsed) {
        grams = parsed;
        break;
      }
    }
    if (grams === null) grams = findGrams(rawServing);
  }

  const productQty = parseNumber(product.product_quantity);
  if (grams === null && productQty && productQty > 0) {
    grams = productQty;
  }

  const servingQty = parseNumber(product.serving_quantity);
  const servingUnit = (product.serving_quantity_unit || "").toString().toLowerCase();
  if (grams === null && servingQty && servingQty > 0 && servingUnit === "g") {
    grams = servingQty;
  }

  let label = rawServing || "";
  if (!label && servingQty) {
    label = servingUnit ? `${servingQty} ${servingUnit}` : String(servingQty);
  } else if (!label && productQty) {
    label = `${productQty} g`;
  }

  return { label, grams };
};

const normalizeOffProduct = (product: OpenFoodFactsProduct, fallbackName: string): NormalizedFoodResult | null => {
  const id = product.code || product._id || product.id || fallbackName;
  if (!id) return null;

  const nutriments = product.nutriments ?? {};
  const caloriesFromKj = pickNumber(nutriments, [
    "energy-kj_100g",
    "energy-kj_value",
    "energy_kj_100g",
    "energy_value",
    "energy_100g",
  ]);
  const calories =
    pickNumber(nutriments, [
      "energy-kcal_100g",
      "energy-kcal_value",
      "energy-kcal",
      "energy_kcal_100g",
    ]) ??
    (caloriesFromKj ? Math.round((caloriesFromKj / 4.184) * 100) / 100 : null);
  const protein = pickNumber(nutriments, ["proteins_100g"]);
  const carbs = pickNumber(nutriments, ["carbohydrates_100g"]);
  const fat = pickNumber(nutriments, ["fat_100g"]);

  const per100g: MacroSet = {
    calories: calories ?? null,
    protein: protein ?? null,
    carbs: carbs ?? null,
    fat: fat ?? null,
  };

  const perServingCalories = pickNumber(nutriments, ["energy-kcal_serving", "energy-kcal_value_serving"]);
  const perServingProtein = pickNumber(nutriments, ["proteins_serving"]);
  const perServingCarbs = pickNumber(nutriments, ["carbohydrates_serving"]);
  const perServingFat = pickNumber(nutriments, ["fat_serving"]);

  const { label: servingLabel, grams: servingGrams } = parseOffServing(product);
  const hasServingMacros = [perServingCalories, perServingProtein, perServingCarbs, perServingFat].some(
    (v) => v != null,
  );

  const perServing = hasServingMacros
    ? {
        calories: perServingCalories,
        protein: perServingProtein,
        carbs: perServingCarbs,
        fat: perServingFat,
      }
    : servingGrams
      ? scalePer100g(per100g, servingGrams)
      : { calories: null, protein: null, carbs: null, fat: null };

  const caloriesPer100g =
    per100g.calories ??
    (perServing.calories != null && servingGrams ? (perServing.calories / servingGrams) * 100 : null);

  const name =
    product.product_name ||
    product.generic_name ||
    (typeof fallbackName === "string" && fallbackName.trim()) ||
    "Unknown item";

  return {
    id: String(id),
    provider: "off",
    name,
    brandName: product.brands || null,
    servingGrams: servingGrams ?? null,
    calories: perServing.calories ?? null,
    protein: perServing.protein ?? null,
    carbs: perServing.carbs ?? null,
    fat: perServing.fat ?? null,
    caloriesPer100g: caloriesPer100g ?? null,
    perServing: perServing,
    per100g,
    outlierReason: servingLabel || undefined,
  };
};

const scoreResult = (result: NormalizedFoodResult, query: string, mode: string): number => {
  const name = (result.name || "").toLowerCase().trim();
  const q = query.toLowerCase().trim();
  let score = 0;

  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 25;

  const simple = isSimpleQuery(query);
  if (simple) {
    let penalty = 0;
    for (const term of DISH_TERMS) {
      if (name.includes(term)) {
        penalty -= 30;
        if (penalty <= -60) break;
      }
    }
    score += penalty;
  }

  if (mode === "common") {
    for (const boost of COMMON_BOOST_TERMS) {
      if (name.includes(boost)) {
        score += 10;
      }
    }
  }

  return score;
};

const detectOutlier = (result: NormalizedFoodResult, query: string) => {
  const simple = isSimpleQuery(query);
  if (!simple) return { isOutlier: false, reason: null };

  const calories = result.calories ?? null;
  const grams = result.servingGrams ?? null;
  const calPer100g = result.caloriesPer100g ?? null;

  if (calories != null && calories > 250 && grams != null && grams <= 80) {
    return { isOutlier: true, reason: "High calories for small serving" };
  }
  if (calPer100g != null && calPer100g > 350) {
    return { isOutlier: true, reason: "Dense calories per 100g" };
  }
  if (grams == null && calories != null && calories > 400) {
    return { isOutlier: true, reason: "High calories, serving unknown" };
  }
  return { isOutlier: false, reason: null };
};

const applyQualityLayer = (results: NormalizedFoodResult[], query: string, mode: string) => {
  return results
    .map((item) => {
      const { isOutlier, reason } = detectOutlier(item, query);
      const score = scoreResult(item, query, mode) - (isOutlier ? 80 : 0);
      return { ...item, isOutlier, outlierReason: isOutlier ? reason || "Likely prepared dish" : null, _score: score };
    })
    .sort((a, b) => {
      if (a.isOutlier !== b.isOutlier) return a.isOutlier ? 1 : -1;
      if (b._score !== a._score) return (b._score || 0) - (a._score || 0);
      const aHasCalories = a.calories != null;
      const bHasCalories = b.calories != null;
      if (aHasCalories !== bHasCalories) return aHasCalories ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    })
    .map(({ _score, ...rest }) => rest);
};

const respond = (req: Request, payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });

const fetchUsda = async (query: string, limit: number) => {
  const apiKey = Deno.env.get("USDA_API_KEY");
  if (!apiKey) {
    throw new Error("Missing USDA_API_KEY");
  }

  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", apiKey);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      pageSize: limit,
      dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"],
      sortBy: "dataType.keyword",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`USDA search failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const payload = await resp.json();
  const foods: UsdaFood[] = Array.isArray(payload?.foods) ? payload.foods : [];
  return foods.map(normalizeUsdaFood).filter((f): f is NormalizedFoodResult => Boolean(f));
};

const fetchOpenFoodFacts = async (query: string, limit: number) => {
  const userAgent = Deno.env.get("OPEN_FOOD_FACTS_USER_AGENT");
  if (!userAgent) {
    throw new Error("Missing OPEN_FOOD_FACTS_USER_AGENT");
  }

  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(limit));

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Open Food Facts search failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const payload = await resp.json();
  const products: OpenFoodFactsProduct[] = Array.isArray(payload?.products) ? payload.products : [];
  return products
    .map((product) => normalizeOffProduct(product, query))
    .filter((p): p is NormalizedFoodResult => Boolean(p));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return respond(req, { ok: false, message: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const mode = (url.searchParams.get("mode") || "common").toLowerCase();
  const limit = clampLimit(parseNumber(url.searchParams.get("limit")));

  if (!q) {
    return respond(req, { ok: false, message: "Missing search query" }, 400);
  }

  try {
    const results = mode === "branded" ? await fetchOpenFoodFacts(q, limit) : await fetchUsda(q, limit);
    const ranked = applyQualityLayer(results, q, mode).slice(0, limit);
    return respond(req, { ok: true, q, mode, results: ranked });
  } catch (err) {
    console.error("[food-search] error", err);
    const message = err instanceof Error ? err.message : "Search failed";
    return respond(req, { ok: false, message }, 500);
  }
});
