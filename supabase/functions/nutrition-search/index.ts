import { corsHeaders } from "../_shared/cors.ts";

const BUILD_VERSION = "nutrition-search v2";
const BUILD_TIMESTAMP = new Date().toISOString();
const BUILD_MARKER = `${BUILD_VERSION} ${BUILD_TIMESTAMP}`;

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

type NormalizedFood = {
  id: string;
  source: string;
  name: string;
  title: string;
  brand: string;
  serving_size: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sourceItemId: string;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickNumber(
  nutriments: Record<string, unknown> | undefined,
  keys: string[]
): number | null {
  if (!nutriments) return null;
  for (const key of keys) {
    const value = nutriments[key];
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeProduct(
  product: OpenFoodFactsProduct,
  fallbackName: string,
): NormalizedFood | null {
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

  const source = "openfoodfacts";
  const code = product.code;
  if (!code) return null;
  const id = `off:${code}`;

  const title =
    product.product_name ||
    product.generic_name ||
    fallbackName ||
    "Unknown item";
  const name = title;
  const normalized: NormalizedFood = {
    id,
    source,
    name,
    title,
    brand: product.brands || "",
    serving_size: product.serving_size || "",
    calories,
    protein,
    carbs,
    fat,
    sourceItemId: id,
  };

  return normalized;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Health check so we can confirm it exists in prod and verify the build marker
  // In browser: open Network tab, trigger a search, and confirm the "nutrition-search"
  // response payload includes the "build" field shown below.
  if (req.method === "GET") {
    return jsonResponse({
      ok: true,
      fn: "nutrition-search",
      build: BUILD_MARKER,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const queryRaw = body?.query ?? body?.q ?? body?.search ?? "";
    const query = typeof queryRaw === "string" ? queryRaw.trim() : "";

    console.log("nutrition-search query", query);

    if (!query) {
      return jsonResponse({ build: BUILD_MARKER, results: [] });
    }

    const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    console.log("nutrition-search upstream status", resp.status);
    if (!resp.ok) {
      const text = await resp.text();
      console.error("OpenFoodFacts search failed", resp.status, text);
      return jsonResponse(
        { build: BUILD_MARKER, error: "Search failed" },
        502,
      );
    }

    const payload = await resp.json();
    const products: OpenFoodFactsProduct[] = Array.isArray(payload?.products)
      ? payload.products
      : [];

    console.log("nutrition-search product count", products.length);

    const results = products
      .map((product) => normalizeProduct(product, query))
      .filter((product): product is NonNullable<typeof product> => !!product);

    return jsonResponse({ build: BUILD_MARKER, results });
  } catch (err) {
    console.error("nutrition-search error", err);
    return jsonResponse(
      { build: BUILD_MARKER, error: String(err) },
      500,
    );
  }
});
