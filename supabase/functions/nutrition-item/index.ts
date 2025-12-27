import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { corsHeaders } from "../_shared/cors.ts";

type ItemPayload = {
  sourceItemId?: string;
  foodName?: string;
  brandName?: string;
  serving_qty?: number;
  serving_unit?: string;
};

type NutritionixFood = Record<string, unknown> & {
  nix_item_id?: string;
  food_name?: string;
  brand_name?: string;
  serving_qty?: number;
  serving_unit?: string;
  serving_weight_grams?: number;
  nf_calories?: number;
  nf_protein?: number;
  nf_total_carbohydrate?: number;
  nf_total_fat?: number;
};

type NormalizedFood = {
  source: "nutritionix";
  sourceItemId: string;
  name: string;
  brandName: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_qty: number | null;
  serving_unit: string | null;
  serving_grams: number | null;
  raw: unknown;
};

const requestTracker = new Map<string, number>();

function coerceNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function safeRound(value: unknown): number {
  const num = coerceNumber(value);
  return num > 0 ? Math.round(num) : 0;
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

function buildSourceKey(id: string | null, name: string): string {
  if (id) return id;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug ? `natural:${slug}` : "natural:food";
}

function normalizeFood(
  food: NutritionixFood,
  inputId: string | null,
  inputName: string | null,
  inputBrand: string | null
): NormalizedFood {
  const name = String(food.food_name || inputName || food.name || "Food").trim() || "Food";
  const brandName =
    (food.brand_name && String(food.brand_name)) || inputBrand || null;
  const calories = safeRound(food.nf_calories ?? food.calories);
  const protein = safeRound(food.nf_protein ?? food.protein ?? food.protein_g);
  const carbs = safeRound(food.nf_total_carbohydrate ?? food.carbs ?? food.carbs_g);
  const fat = safeRound(food.nf_total_fat ?? food.fat ?? food.fat_g);
  const servingQtyRaw = coerceNumber(food.serving_qty);
  const servingQty = servingQtyRaw > 0 ? servingQtyRaw : null;
  const servingUnit = food.serving_unit ? String(food.serving_unit) : null;
  const servingGrams = coerceNumber(food.serving_weight_grams);
  const sourceItemId = buildSourceKey(
    food.nix_item_id || inputId || null,
    name
  );

  return {
    source: "nutritionix",
    sourceItemId,
    name,
    brandName,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    serving_qty: servingQty,
    serving_unit: servingUnit,
    serving_grams: servingGrams > 0 ? servingGrams : null,
    raw: food,
  };
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

async function fetchBrandedItem(
  nixItemId: string,
  appId: string,
  appKey: string,
  brandName?: string
): Promise<NormalizedFood> {
  const url = `https://trackapi.nutritionix.com/v2/search/item?nix_item_id=${encodeURIComponent(nixItemId)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-app-id": appId,
      "x-app-key": appKey,
      "x-remote-user-id": "0",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Nutritionix item lookup failed (${resp.status}): ${text}`);
  }

  const payload = await resp.json();
  const foods: NutritionixFood[] = Array.isArray(payload?.foods) ? payload.foods : [];
  if (!foods.length) {
    throw new Error("Nutritionix item lookup returned no foods");
  }

  return normalizeFood(foods[0], nixItemId, null, brandName || null);
}

function buildNaturalQuery(body: ItemPayload): string {
  const parts: string[] = [];
  const qty = coerceNumber(body.serving_qty);
  if (qty > 0) parts.push(String(qty));
  if (body.serving_unit) parts.push(String(body.serving_unit));
  if (body.foodName) parts.push(String(body.foodName));
  if (body.brandName) parts.push(`(${String(body.brandName)})`);
  return parts.join(" ").trim();
}

async function fetchNaturalItem(
  query: string,
  appId: string,
  appKey: string,
  brandName?: string
): Promise<NormalizedFood> {
  const resp = await fetch("https://trackapi.nutritionix.com/v2/natural/nutrients", {
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
    throw new Error(`Nutritionix natural lookup failed (${resp.status}): ${text}`);
  }

  const payload = await resp.json();
  const foods: NutritionixFood[] = Array.isArray(payload?.foods) ? payload.foods : [];
  if (!foods.length) {
    throw new Error("Nutritionix natural lookup returned no foods");
  }

  return normalizeFood(foods[0], null, query, brandName || null);
}

async function upsertFoodCache(
  supabaseAdmin: ReturnType<typeof createClient>,
  food: NormalizedFood
) {
  try {
    await supabaseAdmin.from("food_items").upsert({
      source: "nutritionix",
      source_item_id: food.sourceItemId,
      name: food.name,
      brand: food.brandName,
      serving_qty: food.serving_qty,
      serving_unit: food.serving_unit,
      serving_grams: food.serving_grams,
      calories: food.calories ?? 0,
      protein_g: food.protein_g ?? 0,
      carbs_g: food.carbs_g ?? 0,
      fat_g: food.fat_g ?? 0,
      raw_json: food.raw ?? null,
    });
  } catch (err) {
    console.error("Failed to upsert food_items cache", err);
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders;

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
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

  let body: ItemPayload = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sourceItemId =
    typeof body.sourceItemId === "string" && body.sourceItemId.trim()
      ? body.sourceItemId.trim()
      : null;
  const foodName =
    typeof body.foodName === "string" && body.foodName.trim() ? body.foodName.trim() : null;
  const brandName =
    typeof body.brandName === "string" && body.brandName.trim() ? body.brandName.trim() : null;

  if (!sourceItemId && !foodName) {
    return jsonResponse(
      { ok: false, code: "invalid_payload", message: "Send sourceItemId or foodName." },
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

  if (sourceItemId) {
    const { data: cached } = await supabaseAdmin
      .from("food_items")
      .select("*")
      .eq("source", "nutritionix")
      .eq("source_item_id", sourceItemId)
      .maybeSingle();

    if (cached) {
      const normalized = normalizeFood(
        {
          ...cached.raw_json,
          ...cached,
          nix_item_id: cached.source_item_id,
          brand_name: cached.brand,
          serving_qty: cached.serving_qty,
          serving_unit: cached.serving_unit,
          serving_weight_grams: cached.serving_grams,
          nf_calories: cached.calories,
          nf_protein: cached.protein_g,
          nf_total_carbohydrate: cached.carbs_g,
          nf_total_fat: cached.fat_g,
        },
        cached.source_item_id,
        cached.name,
        cached.brand
      );
      return jsonResponse({ ok: true, source: "cache", food: normalized }, 200, cors);
    }
  }

  try {
    let food: NormalizedFood | null = null;

    if (sourceItemId) {
      food = await fetchBrandedItem(sourceItemId, appId, appKey, brandName || undefined);
    } else if (foodName) {
      const query = buildNaturalQuery({ ...body, foodName, brandName });
      food = await fetchNaturalItem(query, appId, appKey, brandName || undefined);
    }

    if (!food) {
      return jsonResponse(
        { ok: false, code: "not_found", message: "Food not found." },
        404,
        cors
      );
    }

    await upsertFoodCache(supabaseAdmin, food);
    return jsonResponse({ ok: true, source: "live", food }, 200, cors);
  } catch (err) {
    console.error("nutrition-item failed", err);
    return jsonResponse(
      {
        ok: false,
        code: "upstream_error",
        message: "Unable to fetch food details right now.",
      },
      502,
      cors
    );
  }
});
