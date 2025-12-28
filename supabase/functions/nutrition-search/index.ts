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
) {
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
  const normalized = {
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

    console.log("nutrition-search query", query);

    if (!query) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");

    const resp = await fetch(url.toString(), { method: "GET" });
    console.log("nutrition-search upstream status", resp.status);
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

    console.log("nutrition-search product count", products.length);

    const results = products
      .map((product) => normalizeProduct(product, query))
      .filter((product): product is NonNullable<typeof product> => !!product);

    if (results.length === 0) {
      const fallback = {
        id: `off:stub:${query}`,
        source: "openfoodfacts",
        name: query,
        brand: "",
        serving_size: "",
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      };
      return new Response(JSON.stringify([fallback]), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
