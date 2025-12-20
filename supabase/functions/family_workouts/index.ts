import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

type ActionPayload = {
  action?: string;
  log_id?: string;
  user_id?: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function readJsonBody(req: Request): Promise<ActionPayload> {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return jsonResponse(
      { ok: false, error: "Server misconfigured: missing Supabase env" },
      500
    );
  }

  const payload = await readJsonBody(req);
  const action = (payload.action || "").toLowerCase();

  if (action !== "remove") {
    return jsonResponse({ ok: false, error: "Unsupported action" }, 400);
  }

  const logId = String(payload.log_id || "").trim();

  if (!logId) {
    return jsonResponse({ ok: false, error: "missing log_id" }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") || "",
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Auth error", authError);
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  if (payload.user_id && payload.user_id !== user.id) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  try {
    const { error: deleteError, count } = await supabase
      .from("family_workouts")
      .delete()
      .eq("id", logId)
      .eq("user_id", user.id)
      .select("id", { count: "exact" });

    if (deleteError) {
      console.error("Delete failed", deleteError);
      return jsonResponse(
        { ok: false, error: deleteError.message || "Delete failed" },
        500
      );
    }

    if (!count) {
      return jsonResponse(
        { ok: false, error: "Workout log not found", log_id: logId },
        404
      );
    }

    return jsonResponse({ ok: true, deleted: count, log_id: logId });
  } catch (err) {
    console.error("Unexpected delete error", err);
    return jsonResponse({ ok: false, error: "Unexpected server error" }, 500);
  }
});
