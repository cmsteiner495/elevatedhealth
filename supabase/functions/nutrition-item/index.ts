import { corsHeaders } from "../_shared/cors.ts";

type OpenFoodFactsProduct = Record<string, unknown> & {
  code?: string;
  _id?: string;
  id?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity?: number | string;
  nutriments?: Record<string, unknown>;
};

type MacroSet = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type NormalizedItem = {
  id: string | undefined;
  source: "openfoodfacts";
  name: string;
  title: string;
  brand: string;
  serving_size: string;
  serving_size_g: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  perServing: MacroSet;
  per100g: MacroSet;
  macros: MacroSet;
  macros_basis: "perServing" | "per100g";
};

function coerceNumber(value: unknown): number | null {
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (normalized) {
      const num = Number(normalized[0]);
      return Number.isFinite(num) ? num : null;
    }
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickNumber(
  nutriments: Record<string, unknown> | undefined,
  keys: string[]
): number {
  if (!nutriments) return 0;
  for (const key of keys) {
    const value = nutriments[key];
    const num = coerceNumber(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function parseServingInfo(product: OpenFoodFactsProduct): { label: string; grams: number | null } {
  const rawServing = typeof product.serving_size === "string" ? product.serving_size.trim() : "";
  const findGrams = (text: string): number | null => {
    const match = text.match(/(\d+[.,]?\d*)\s*g\b/i);
    if (match && match[1]) {
      const parsed = coerceNumber(match[1]);
      if (parsed && parsed > 0) return parsed;
    }
    return null;
  };

  let grams: number | null = null;

  if (rawServing) {
    const parenMatches = rawServing.match(/\([^()]*\)/g) || [];
    for (const group of parenMatches) {
      const parsed = findGrams(group);
      if (parsed) {
        grams = parsed;
        break;
      }
    }

    if (grams === null) {
      grams = findGrams(rawServing);
    }
  }

  const productQty = coerceNumber(product.product_quantity);
  if (grams === null && productQty && productQty > 0) {
    grams = productQty;
  }

  const servingQty = coerceNumber(product.serving_quantity);
  const servingUnit = String(product.serving_quantity_unit || "").toLowerCase();
  if (grams === null && servingQty && servingQty > 0 && servingUnit === "g") {
    grams = servingQty;
  }

  let label = rawServing || "";
  if (!label && servingQty) {
    label = servingUnit ? `${servingQty} ${servingUnit}` : String(servingQty);
  } else if (!label && productQty) {
    label = `${productQty} g`;
  }

  if (grams === null) {
    grams = 100;
    label = "100g";
  }

  return { label: label || "100g", grams };
}

function scaleMacroSet(macros: MacroSet, grams: number): MacroSet {
  const factor = grams / 100;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    calories: round2((macros.calories || 0) * factor),
    protein: round2((macros.protein || 0) * factor),
    carbs: round2((macros.carbs || 0) * factor),
    fat: round2((macros.fat || 0) * factor),
  };
}

function normalizeProduct(
  product: OpenFoodFactsProduct,
  fallbackName: string
): NormalizedItem {
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
    ]) ||
    (caloriesFromKj ? Math.round((caloriesFromKj / 4.184) * 100) / 100 : 0);
  const protein = pickNumber(nutriments, ["proteins_100g"]);
  const carbs = pickNumber(nutriments, ["carbohydrates_100g"]);
  const fat = pickNumber(nutriments, ["fat_100g"]);

  const name =
    product.product_name ||
    product.generic_name ||
    fallbackName ||
    "Unknown item";
  const { label: servingLabel, grams: servingSizeG } = parseServingInfo(product);

  const rawId = product.code ?? product._id ?? product.id ?? fallbackName ?? "item";
  const id = String(rawId);
  const per100g = {
    calories: calories || 0,
    protein: protein || 0,
    carbs: carbs || 0,
    fat: fat || 0,
  };
  const perServing = scaleMacroSet(per100g, servingSizeG || 100);
  const macros = perServing;

  return {
    id,
    source: "openfoodfacts",
    name,
    title: name,
    brand: product.brands || "",
    serving_size: servingLabel,
    serving_size_g: servingSizeG,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    perServing,
    per100g,
    macros,
    macros_basis: "perServing",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchOpenFoodFactsProduct(
  id: string
): Promise<NormalizedItem | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(id)}.json`;

  try {
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) return null;
    const payload = await resp.json();
    const status = payload?.status;
    const product = payload?.product as OpenFoodFactsProduct | undefined;
    if (product && (status === 1 || status === "1" || status === "success")) {
      return normalizeProduct(product, id);
    }
  } catch (err) {
    console.error("OpenFoodFacts item fetch failed", url, err);
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ ok: true, fn: "nutrition-item" }, 200);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawId = body?.id ?? body?.code ?? body?.productId ?? body?.product_id;
  const id =
    typeof rawId === "string" && rawId.trim()
      ? rawId.trim()
      : rawId !== undefined && rawId !== null
        ? String(rawId)
        : undefined;
  const sourceRaw = body?.source;
  const source =
    typeof sourceRaw === "string" && sourceRaw.trim()
      ? sourceRaw.trim().toLowerCase()
      : "openfoodfacts";

  if (!id) {
    return jsonResponse({ error: "Missing product id" }, 400);
  }

  if (source !== "openfoodfacts") {
    return jsonResponse({ error: "Unsupported source" }, 400);
  }

  const product = await fetchOpenFoodFactsProduct(id);
  if (!product) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const { calories, protein, carbs, fat, macros, name, title, source: sourceName } = product;
  const responseBody = {
    id: product.id,
    brand: product.brand,
    serving_size: product.serving_size,
    serving_size_g: product.serving_size_g,
    calories,
    protein,
    carbs,
    fat,
    macros: macros ?? { calories, protein, carbs, fat },
    perServing: product.perServing,
    per100g: product.per100g,
    macros_basis: product.macros_basis,
    title,
    name,
    source: sourceName,
  };

  return jsonResponse({ ...responseBody, food: responseBody }, 200);
});
