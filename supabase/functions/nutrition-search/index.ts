import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

type InstantFood = Record<string, unknown> & {
  nix_item_id?: string;
  food_name?: string;
  brand_name?: string;
  serving_qty?: number;
  serving_unit?: string;
  nf_calories?: number;
  calories?: number;
  tag_id?: string | number;
};

type NormalizedFoodResult = {
  source: "nutritionix";
  sourceItemId: string;
  name: string;
  brandName: string | null;
  calories: number | null;
  servingUnit: string | null;
  servingQty: number | null;
};

const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const requestTracker = new Map<string, number>();

function coerceNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function allowRequest(userId: string | null): boolean {
  const key = userId || "anon";
  const now = Date.now();
  const last = requestTracker.get(key) ?? 0;
  if (now - last < 350) {
    return false;
  }
  requestTracker.set(key, now);
  return true;
}

function normalizeInstantFood(item: InstantFood, sourceHint: string): NormalizedFoodResult {
  const name = String(item.food_name || item.name || "").trim() || "Food";
  const brandName =
    (item.brand_name && String(item.brand_name)) ||
    (sourceHint === "common" ? "Common food" : null);
  const caloriesRaw = coerceNumber(item.nf_calories ?? item.calories);
  const calories = caloriesRaw > 0 ? Math.round(caloriesRaw) : null;
  const servingQty = coerceNumber(item.serving_qty);
  const servingUnit = item.serving_unit ? String(item.serving_unit) : null;
  const sourceItemId =
    String(item.nix_item_id || item.tag_id || `${sourceHint}:${name}`).trim() ||
    `${sourceHint}:${name}`; // fall back to name

  return {
    source: "nutritionix",
    sourceItemId,
    name,
    brandName,
    calories,
    servingUnit,
    servingQty: servingQty || null,
  };
}

async function fetchInstantResults(
  query: string,
  appId: string,
  appKey: string
): Promise<NormalizedFoodResult[]> {
  const resp = await fetch("https://trackapi.nutritionix.com/v2/search/instant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-id": appId,
      "x-app-key": appKey,
      "x-remote-user-id": "0",
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Nutritionix instant search failed (${resp.status}): ${text}`);
  }

  const payload = await resp.json();
  const branded: InstantFood[] = Array.isArray(payload?.branded) ? payload.branded : [];
  const common: InstantFood[] = Array.isArray(payload?.common) ? payload.common : [];

  const normalized = [
    ...branded.slice(0, 35).map((item) => normalizeInstantFood(item, "branded")),
    ...common.slice(0, 20).map((item) => normalizeInstantFood(item, "common")),
  ];

  const seen = new Set<string>();
  const deduped: NormalizedFoodResult[] = [];
  for (const item of normalized) {
    const key = `${item.source}:${item.sourceItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, 40);
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders;

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method === "GET") {
    return jsonResponse({ ok: true, fn: "nutrition-search" }, 200, cors);
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, code: "method_not_allowed" }, 405, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appId = Deno.env.get("NUTRITIONIX_APP_ID");
  const appKey = Deno.env.get("NUTRITIONIX_APP_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.error("Missing Supabase env (SUPABASE_URL / SUPABASE keys)");
    return jsonResponse({ ok: false, code: "server_misconfigured" }, 500, cors);
  }

  if (!appId || !appKey) {
    console.error("Missing Nutritionix credentials");
    return jsonResponse({ ok: false, code: "missing_api_credentials" }, 500, cors);
  }

  let body: { query?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawQuery = typeof body.query === "string" ? body.query : "";
  const query = normalizeQuery(rawQuery);

  if (!query || query.length < 2) {
    return jsonResponse(
      { ok: false, code: "invalid_query", message: "Query must be at least 2 characters." },
      400,
      cors
    );
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401, cors);
  }

  if (!allowRequest(user.id)) {
    return jsonResponse({ ok: false, code: "rate_limited" }, 429, cors);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const cacheCutoff = new Date(Date.now() - SEARCH_CACHE_TTL_MS).toISOString();
  const { data: cached } = await supabaseAdmin
    .from("food_search_cache")
    .select("results_json, created_at")
    .eq("query", query)
    .gte("created_at", cacheCutoff)
    .maybeSingle();

  if (cached?.results_json) {
    return jsonResponse(
      {
        ok: true,
        source: "cache",
        cached_at: cached.created_at,
        results: cached.results_json,
      },
      200,
      cors
    );
  }

  try {
    const results = await fetchInstantResults(query, appId, appKey);
    await supabaseAdmin
      .from("food_search_cache")
      .upsert({ query, results_json: results, created_at: new Date().toISOString() });

    return jsonResponse({ ok: true, source: "live", results }, 200, cors);
  } catch (err) {
    console.error("nutrition-search failed", err);
    return jsonResponse(
      { ok: false, code: "upstream_error", message: "Search failed. Try again shortly." },
      502,
      cors
    );
  }
});
