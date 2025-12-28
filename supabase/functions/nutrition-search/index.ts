import { corsHeaders } from "../_shared/cors.ts";

const BUILD_VERSION = "nutrition-search v3";
const BUILD_TIMESTAMP = new Date().toISOString();
const BUILD_MARKER = `${BUILD_VERSION} ${BUILD_TIMESTAMP}`;

type OpenFoodFactsProduct = Record<string, unknown> & {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
};

type NutritionSearchResult = {
  id: string;
  name: string;
  brand: string | null;
  source: "openfoodfacts";
};

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : corsHeaders["Access-Control-Allow-Origin"] || "*";
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowOrigin,
    "Content-Type": "application/json",
  };
}

function respond(
  req: Request,
  payload: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: getCorsHeaders(req),
  });
}

function normalizeProduct(
  product: OpenFoodFactsProduct,
  fallbackName: string,
): NutritionSearchResult | null {
  const id = typeof product.code === "string" && product.code.trim()
    ? product.code.trim()
    : null;
  if (!id) return null;

  const name = (product.product_name || product.generic_name || fallbackName || "Unknown").toString();
  const brand = product.brands?.toString().trim() || null;

  return {
    id,
    name,
    brand,
    source: "openfoodfacts",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  // Health check
  if (req.method === "GET") {
    return respond(req, {
      ok: true,
      fn: "nutrition-search",
      build: BUILD_MARKER,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const queryRaw =
      (typeof body?.q === "string" && body.q) ||
      (typeof body?.query === "string" && body.query) ||
      (typeof body?.search === "string" && body.search) ||
      "";
    const query = queryRaw.trim();

    console.log("nutrition-search query", query);

    if (!query) {
      return respond(req, { results: [] });
    }

    const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");

    try {
      const resp = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      console.log("nutrition-search upstream status", resp.status);

      if (!resp.ok) {
        const text = await resp.text();
        console.error("OpenFoodFacts search failed", resp.status, text);
        return respond(req, {
          results: [],
          error: `OpenFoodFacts search failed (${resp.status})`,
        });
      }

      const payload = await resp.json();
      const products: OpenFoodFactsProduct[] = Array.isArray(payload?.products)
        ? payload.products
        : [];

      const results = products
        .map((product) => normalizeProduct(product, query))
        .filter((item): item is NutritionSearchResult => Boolean(item));

      console.log("nutrition-search product count", results.length);

      return respond(req, { results });
    } catch (err) {
      console.error("OpenFoodFacts request error", err);
      return respond(req, { results: [], error: String(err) });
    }
  } catch (err) {
    console.error("nutrition-search error", err);
    return respond(req, { results: [], error: String(err) });
  }
});
