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

function normalizeProduct(product: OpenFoodFactsProduct, fallbackName: string) {
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

  const rawId =
    product.code ?? product._id ?? product.id ?? fallbackName ?? "item";
  const id =
    typeof rawId === "string"
      ? rawId
      : rawId !== undefined && rawId !== null
        ? String(rawId)
        : "item";

  const name =
    product.product_name ||
    product.generic_name ||
    fallbackName ||
    "Unknown item";
  const normalized = {
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

  return normalized;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Health check so we can confirm it exists in prod
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, fn: "nutrition-search" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = body?.query ?? body?.q ?? body?.search ?? "";

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(
      "https://world.openfoodfacts.org/cgi/search.pl"
    );
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");

    const resp = await fetch(url.toString(), { method: "GET" });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("OpenFoodFacts search failed", resp.status, text);
      return new Response(
        JSON.stringify({ error: "Search failed" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const payload = await resp.json();
    const products: OpenFoodFactsProduct[] = Array.isArray(payload?.products)
      ? payload.products
      : [];

    const results = products.map((product) =>
      normalizeProduct(product, query)
    );

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("nutrition-search error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
