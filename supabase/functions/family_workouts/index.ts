import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const allowedOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function buildCors(origin: string | null) {
  const allowOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : "http://127.0.0.1:5500";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

type ActionPayload = {
  id?: string | null;
  action?: string;
  log_id?: string;
  workout_id?: string | null;
  added_by?: string | null;
  family_group_id?: string | null;
  day_key?: string | null;
  workout_date?: string | null;
  diary_date?: string | null;
  workout_name?: string | null;
  title?: string | null;
  workout_type?: string | null;
  difficulty?: string | null;
  duration_min?: number | null;
  notes?: string | null;
  scheduled_workout_id?: string | number | null;
};

function json(body: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

function jsonError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  cors: Record<string, string>
) {
  return json({ ok: false, code, ...extra }, status, cors);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = buildCors(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, code: "method_not_allowed" }, 405, cors);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
      return json(
        { ok: false, code: "server_misconfigured", message: "Missing Supabase env" },
        500,
        cors
      );
    }

    let body: ActionPayload | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    if (!body || typeof body !== "object") {
      return jsonError(400, "invalid_json", { hint: "Send JSON body" }, cors);
    }

    if (!body.action) {
      return jsonError(400, "missing_action", { required: ["action"] }, cors);
    }

    const normalizedAction = (body.action || "").toLowerCase();
    const action = normalizedAction === "remove" ? "delete" : normalizedAction;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? "",
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Auth error", authError);
      return jsonError(401, "unauthorized", { message: "No valid session" }, cors);
    }

    if (action === "delete") {
      if (!body.id) {
        return jsonError(
          400,
          "missing_id",
          { required: ["id"], received: body },
          cors
        );
      }

      const workoutId = String(body.id).trim();
      const diaryDate = (body.diary_date || "").toString().trim();

      const deleteQuery = supabase
        .from("family_workouts")
        .delete()
        .eq("id", workoutId)
        .eq("added_by", user.id);

      const { data: deletedRows, error: delErr } = await deleteQuery.select();

      if (delErr) {
        console.error("Delete failed", delErr);
        return jsonError(500, "delete_failed", { details: String(delErr) }, cors);
      }

      if (!deletedRows || deletedRows.length === 0) {
        return jsonError(
          404,
          "not_found",
          { message: "No matching workout row for this user", id: workoutId },
          cors
        );
      }

      return json(
        { ok: true, action: "delete", id: workoutId, diary_date: diaryDate },
        200,
        cors
      );
    }

    if (action === "add") {
      const familyGroupId = String(body.family_group_id || "").trim();
      const dayKey = String(body.day_key || body.workout_date || "").trim();
      const workoutName = String(body.workout_name || body.title || "").trim();
      const workoutType = String(body.workout_type || "workout").trim();
      const difficulty = body.difficulty ? String(body.difficulty) : null;
      const durationMin =
        typeof body.duration_min === "number"
          ? body.duration_min
          : body.duration_min
          ? Number(body.duration_min)
          : null;
      const notes = body.notes ? String(body.notes) : null;
      const scheduledWorkoutId = body.scheduled_workout_id
        ? String(body.scheduled_workout_id)
        : null;

      if (!familyGroupId) {
        return jsonError(
          400,
          "missing_family_group_id",
          { required: ["family_group_id"] },
          cors
        );
      }

      if (!dayKey) {
        return jsonError(400, "missing_day_key", { required: ["day_key"] }, cors);
      }

      if (!workoutName) {
        return jsonError(400, "missing_workout_name", { required: ["workout_name"] }, cors);
      }

      const insertPayload = {
        family_group_id: familyGroupId,
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
        logged_at: new Date().toISOString(),
      };

      try {
        const { data: inserted, error: insertError } = await supabase
          .from("family_workouts")
          .insert(insertPayload)
          .select()
          .single();

        if (insertError) {
          console.error("Insert failed", insertError);
          return jsonError(
            500,
            "insert_failed",
            { details: insertError.message || "Insert failed" },
            cors
          );
        }

        return json({ ok: true, workout: inserted, log_id: inserted?.id }, 200, cors);
      } catch (err) {
        console.error("Unexpected insert error", err);
        return jsonError(500, "unexpected_error", { details: `${err}` }, cors);
      }
    }

    return jsonError(400, "unsupported_action", { action: body.action }, cors);
  } catch (err) {
    console.error("Unhandled family_workouts error", err);
    return json({ ok: false, code: "unexpected_error", details: `${err}` }, 500, cors);
  }
});
