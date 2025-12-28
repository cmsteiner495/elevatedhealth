import { corsHeaders } from "../_shared/cors.ts";

type OpenFoodFactsProduct = Record<string, unknown> & {
  code?: string;
  _id?: string;
  id?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
};

type NormalizedItem = {
  id: string | undefined;
  source: "openfoodfacts";
  name: string;
  title: string;
  brand: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  macros: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

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

  const rawId =
    product.code ?? product._id ?? product.id ?? fallbackName ?? "item";
  const id =
    typeof rawId === "string"
      ? rawId
      : rawId !== undefined && rawId !== null
        ? String(rawId)
        : "item";

  return {
    id,
    source: "openfoodfacts",
    name,
    title: name,
    brand: product.brands || "",
    serving_size: product.serving_size || "",
    calories,
    protein,
    carbs,
    fat,
    macros: { calories, protein, carbs, fat },
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
  const urls = [
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(id)}.json`,
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(id)}.json`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) continue;
      const payload = await resp.json();
      const status = payload?.status;
      const product = payload?.product as OpenFoodFactsProduct | undefined;
      if (product && (status === 1 || status === "1" || status === "success")) {
        return normalizeProduct(product, id);
      }
    } catch (err) {
      console.error("OpenFoodFacts item fetch failed", url, err);
    }
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

  const idRaw = body?.id;
  const sourceRaw = body?.source;
  const id =
    typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : undefined;
  const source =
    typeof sourceRaw === "string" && sourceRaw.trim()
      ? sourceRaw.trim().toLowerCase()
      : "openfoodfacts";

  if (!id) {
    return jsonResponse({ error: "Missing id" }, 400);
  }

  if (source !== "openfoodfacts") {
    return jsonResponse({ error: "Unsupported source" }, 400);
  }

  const product = await fetchOpenFoodFactsProduct(id);
  if (!product) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  return jsonResponse(product, 200);
});
