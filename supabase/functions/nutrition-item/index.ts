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
  serving_grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  per100g: MacroSet;
  macros: MacroSet;
  macros_basis: "per100g";
};

function coerceNumber(value: unknown): number | null {
  if (typeof value === "string") {
    const normalized = value.replace(",", ".");
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
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
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function parseServingGrams(product: OpenFoodFactsProduct): number | null {
  const servingSize = typeof product.serving_size === "string" ? product.serving_size : "";
  const match = servingSize.match(/(\d+[.,]?\d*)\s*g/i);
  if (match && match[1]) {
    const parsed = coerceNumber(match[1]);
    if (parsed && parsed > 0) return parsed;
  }

  const productQty = coerceNumber(product.product_quantity);
  if (productQty && productQty > 0) return productQty;

  const servingQty = coerceNumber(product.serving_quantity);
  const servingUnit = String(product.serving_quantity_unit || "").toLowerCase();
  if (servingQty && servingQty > 0 && servingUnit === "g") return servingQty;

  return null;
}

function normalizeProduct(
  product: OpenFoodFactsProduct,
  fallbackName: string
): NormalizedItem {
  const nutriments = product.nutriments ?? {};
  const calories = pickNumber(nutriments, [
    "energy-kcal_100g",
    "energy-kcal_value",
    "energy-kcal",
    "energy-kcal_serving",
    "energy_kcal_100g",
    "energy_kcal_serving",
  ]);
  const protein = pickNumber(nutriments, [
    "proteins_100g",
    "proteins_serving",
    "proteins",
  ]);
  const carbs = pickNumber(nutriments, [
    "carbohydrates_100g",
    "carbohydrates_serving",
    "carbohydrates",
  ]);
  const fat = pickNumber(nutriments, ["fat_100g", "fat_serving", "fat"]);

  const name =
    product.product_name ||
    product.generic_name ||
    fallbackName ||
    "Unknown item";

  const rawId = product.code ?? product._id ?? product.id ?? fallbackName ?? "item";
  const id = String(rawId);
  const per100g = { calories, protein, carbs, fat };
  const servingGrams = parseServingGrams(product);
  const macros = per100g;

  return {
    id,
    source: "openfoodfacts",
    name,
    title: name,
    brand: product.brands || "",
    serving_size: product.serving_size || "",
    serving_grams: servingGrams,
    calories,
    protein,
    carbs,
    fat,
    per100g,
    macros,
    macros_basis: "per100g",
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
  return jsonResponse(
    {
      id: product.id,
      brand: product.brand,
      serving_size: product.serving_size,
      serving_grams: product.serving_grams,
      calories,
      protein,
      carbs,
      fat,
      macros: macros ?? { calories, protein, carbs, fat },
      per100g: product.per100g,
      macros_basis: product.macros_basis,
      title,
      name,
      source: sourceName,
    },
    200
  );
});
