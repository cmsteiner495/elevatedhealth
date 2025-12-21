import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

type ActionPayload = {
  action?: string;
  log_id?: string;
  user_id?: string | null;
  family_group_id?: string | null;
  day_key?: string | null;
  workout_date?: string | null;
  workout_name?: string | null;
  title?: string | null;
  workout_type?: string | null;
  difficulty?: string | null;
  duration_min?: number | null;
  notes?: string | null;
  scheduled_workout_id?: string | number | null;
};

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function getCorsHeaders(origin: string | null) {
  const allowOrigin =
    allowedOrigins.length === 0
      ? "*"
      : origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    Vary: "Origin",
  };
}

async function readJsonBody(req: Request): Promise<ActionPayload> {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));
  const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...headers,
      },
    });

  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        status: 204,
        headers: corsHeaders,
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

    if (action === "remove") {
      const logId = String(payload.log_id || "").trim();

      if (!logId) {
        return jsonResponse({ ok: false, error: "missing log_id" }, 400);
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
        return jsonResponse(
          { ok: false, error: "Unexpected server error", details: `${err}` },
          500
        );
      }
    }

    if (action === "add") {
      const familyGroupId = String(payload.family_group_id || "").trim();
      const dayKey = String(payload.day_key || payload.workout_date || "").trim();
      const workoutName = String(payload.workout_name || payload.title || "").trim();
      const workoutType = String(payload.workout_type || "workout").trim();
      const difficulty = payload.difficulty ? String(payload.difficulty) : null;
      const durationMin =
        typeof payload.duration_min === "number"
          ? payload.duration_min
          : payload.duration_min
          ? Number(payload.duration_min)
          : null;
      const notes = payload.notes ? String(payload.notes) : null;
      const scheduledWorkoutId = payload.scheduled_workout_id
        ? String(payload.scheduled_workout_id)
        : null;

      if (!familyGroupId) {
        return jsonResponse({ ok: false, error: "missing family_group_id" }, 400);
      }

      if (!dayKey) {
        return jsonResponse({ ok: false, error: "missing day_key" }, 400);
      }

      if (!workoutName) {
        return jsonResponse({ ok: false, error: "missing workout name" }, 400);
      }

      const insertPayload = {
        family_group_id: familyGroupId,
        user_id: user.id,
        added_by: user.id,
        title: workoutName,
        workout_name: workoutName,
        workout_type: workoutType || "workout",
        difficulty,
        duration_min: Number.isFinite(durationMin) ? durationMin : null,
        notes,
        scheduled_workout_id: scheduledWorkoutId,
        day_key: dayKey,
        workout_date: dayKey,
        completed: true,
      };

      try {
        const { data: inserted, error: insertError } = await supabase
          .from("family_workouts")
          .insert(insertPayload)
          .select()
          .single();

        if (insertError) {
          console.error("Insert failed", insertError);
          return jsonResponse(
            { ok: false, error: insertError.message || "Insert failed" },
            500
          );
        }

        return jsonResponse({ ok: true, workout: inserted, log_id: inserted?.id });
      } catch (err) {
        console.error("Unexpected insert error", err);
        return jsonResponse(
          { ok: false, error: "Unexpected server error", details: `${err}` },
          500
        );
      }
    }

    return jsonResponse({ ok: false, error: "Unsupported action" }, 400);
  } catch (err) {
    console.error("Unhandled family_workouts error", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Unexpected server error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
