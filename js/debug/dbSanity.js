// js/debug/dbSanity.js
// Development-only helpers for quick DB sanity checks from the browser console.

import { supabase } from "../supabaseClient.js";
import { currentFamilyId, currentUser, toLocalDayKey } from "../state.js";

const UPCOMING_DELETE_PREFIX = "eh_upcoming_deleted:";
let cachedUpcomingStrategy = null;

const WORKOUT_DIFFICULTIES = ["Easy", "Medium", "Moderate", "Hard"];
const WORKOUT_DIFFICULTY_MAP = {
  easy: "Easy",
  beginner: "Easy",
  medium: "Medium",
  moderate: "Moderate",
  hard: "Hard",
  intense: "Hard",
};

export function isDebugEnabled() {
  if (typeof window === "undefined" || typeof location === "undefined") return false;
  const host = location.hostname || "";
  const search = location.search || "";
  return host === "localhost" || host === "127.0.0.1" || search.includes("debug=1");
}

export function toYMD(dateLike = new Date()) {
  if (!dateLike) return null;
  const normalized = toLocalDayKey(dateLike);
  if (normalized) return normalized;
  if (typeof dateLike === "string") {
    const fromSplit = dateLike.split("T")[0];
    return fromSplit || null;
  }
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDayKey(parsed);
}

function consoleGroup(label, payload, response) {
  const tag = `[EH_DB] ${label}`;
  // eslint-disable-next-line no-console
  console.groupCollapsed(tag);
  if (payload !== undefined) {
    // eslint-disable-next-line no-console
    console.log("payload", payload);
  }
  if (response !== undefined) {
    // eslint-disable-next-line no-console
    console.log("response", response);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

function isMissingColumn(error, columnName) {
  if (!error || !columnName) return false;
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  const needle = String(columnName || "").toLowerCase();
  return message.includes(`column ${needle}`) || message.includes(`${needle} does not exist`);
}

function isMissingRelation(error, relationName) {
  if (!error || !relationName) return false;
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  const needle = String(relationName || "").toLowerCase();
  return message.includes(`relation \"${needle}`) || message.includes(`table \"${needle}`);
}

function normalizeWorkoutDifficulty(value) {
  if (!value) return null;
  const key = value.toString().trim().toLowerCase();
  const mapped = WORKOUT_DIFFICULTY_MAP[key];
  if (mapped) return mapped;
  const canonical = WORKOUT_DIFFICULTIES.find(
    (item) => item.toLowerCase() === key || item === value
  );
  return canonical || null;
}

async function assertAuthed() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("Not authenticated. Please log in first.");
  return data.user;
}

async function loadFamilyGroupId(userId) {
  if (currentFamilyId) return currentFamilyId;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[EH_DB] Unable to load family group from memberships", error);
    return null;
  }
  return data?.[0]?.family_group_id || null;
}

async function getContext() {
  const user = await assertAuthed();
  const familyGroupId = await loadFamilyGroupId(user.id);
  const context = {
    userId: user.id,
    email: user.email,
    familyGroupId,
    displayName:
      currentUser?.user_metadata?.full_name ||
      currentUser?.user_metadata?.fullName ||
      currentUser?.user_metadata?.name ||
      user.email,
  };
  consoleGroup("context", null, context);
  return context;
}

function applyWorkoutScope(query, ctx) {
  let scoped = query;
  if (ctx.familyGroupId) {
    scoped = scoped.eq("family_group_id", ctx.familyGroupId);
  } else if (ctx.userId) {
    scoped = scoped.or(`added_by.eq.${ctx.userId},user_id.eq.${ctx.userId}`);
  }
  return scoped;
}

function applyMealScope(query, ctx) {
  let scoped = query;
  if (ctx.familyGroupId) {
    scoped = scoped.eq("family_group_id", ctx.familyGroupId);
  } else if (ctx.userId) {
    scoped = scoped.or(`added_by.eq.${ctx.userId},user_id.eq.${ctx.userId}`);
  }
  return scoped;
}

async function listWorkouts(day = new Date()) {
  const ctx = await getContext();
  const targetDay = toYMD(day) || toYMD(new Date());
  const attempts = [
    { column: "workout_date" },
    { column: "date" },
  ];
  let lastError = null;

  for (const attempt of attempts) {
    let query = supabase.from("family_workouts").select("*");
    query = applyWorkoutScope(query, ctx);
    if (attempt.column && targetDay) {
      query = query.eq(attempt.column, targetDay);
    }
    query = query
      .order(attempt.column || "created_at", { ascending: false })
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (!error) {
      consoleGroup("listWorkouts", { day: targetDay, column: attempt.column }, data);
      return data || [];
    }
    lastError = error;
    if (!isMissingColumn(error, attempt.column)) {
      throw error;
    }
  }

  let fallbackQuery = supabase
    .from("family_workouts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);
  fallbackQuery = applyWorkoutScope(fallbackQuery, ctx);
  const { data, error } = await fallbackQuery;
  if (error) throw error;
  consoleGroup("listWorkouts:fallback", { day: targetDay, lastError }, data);
  return data || [];
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function insertWorkout(payload = {}) {
  const ctx = await getContext();
  const targetDate = toYMD(payload.workout_date || payload.date || new Date());
  const basePayload = {
    title: payload.title || payload.workout_name || "Workout",
    workout_type: payload.workout_type || payload.workoutType || "workout",
    difficulty: normalizeWorkoutDifficulty(payload.difficulty),
    duration_min: toNumber(payload.duration_min ?? payload.duration) ?? null,
    notes: payload.notes ?? null,
    workout_date: targetDate,
  };

  const userColumns = ["added_by", "user_id"];
  let insertError = null;
  let inserted = null;

  for (const userColumn of userColumns) {
    const serverPayload = {
      ...basePayload,
      [userColumn]: ctx.userId,
    };
    if (ctx.familyGroupId) {
      serverPayload.family_group_id = ctx.familyGroupId;
    }

    const { data, error } = await supabase
      .from("family_workouts")
      .insert([serverPayload])
      .select("*")
      .maybeSingle();

    if (!error) {
      inserted = data;
      insertError = null;
      break;
    }
      insertError = error;
    if (!isMissingColumn(error, userColumn)) {
      break;
    }
    if (!data) {
      console.warn("[DB SANITY] Workout insert returned no row", {
        userColumn,
        family_group_id: ctx.familyGroupId,
      });
    }
  }

  if (insertError) {
    throw insertError;
  }

  const afterList = await listWorkouts(targetDate);
  consoleGroup("insertWorkout", { payload: basePayload }, { inserted, afterCount: afterList.length });
  return inserted;
}

async function deleteWorkout(id) {
  if (!id) throw new Error("Workout id is required");
  const ctx = await getContext();
  const today = toYMD(new Date());
  const userColumns = ["added_by", "user_id"];
  const scopeQueries = [];

  if (ctx.familyGroupId) {
    scopeQueries.push((query) => query.eq("family_group_id", ctx.familyGroupId));
  }
  if (ctx.userId) {
    userColumns.forEach((col) => {
      scopeQueries.push((query) => query.eq(col, ctx.userId));
    });
  }

  let deleteError = null;
  let deletedRows = [];

  for (const scopeFn of scopeQueries) {
    const scoped = scopeFn(supabase.from("family_workouts").delete().eq("id", id));
    const { data, error } = await scoped.select("id");
    if (!error) {
      deletedRows = data || [];
      deleteError = null;
      break;
    }
    deleteError = error;
    if (!userColumns.some((col) => isMissingColumn(error, col)) && !isMissingColumn(error, "family_group_id")) {
      break;
    }
  }

  if (deleteError) {
    throw deleteError;
  }

  const afterList = await listWorkouts(today);
  consoleGroup("deleteWorkout", { id }, { deleted: deletedRows.length, afterCount: afterList.length });
  return deletedRows.length;
}

async function listMeals(day = new Date()) {
  const ctx = await getContext();
  const targetDay = toYMD(day) || toYMD(new Date());
  const attempts = [
    { column: "meal_date" },
    { column: "date" },
  ];
  let lastError = null;

  for (const attempt of attempts) {
    let query = supabase.from("family_meals").select("*");
    query = applyMealScope(query, ctx);
    if (attempt.column && targetDay) {
      query = query.eq(attempt.column, targetDay);
    }
    query = query
      .order(attempt.column || "created_at", { ascending: false })
      .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (!error) {
      consoleGroup("listMeals", { day: targetDay, column: attempt.column }, data);
      return data || [];
    }
    lastError = error;
    if (!isMissingColumn(error, attempt.column)) {
      throw error;
    }
  }

  let fallbackQuery = supabase
    .from("family_meals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);
  fallbackQuery = applyMealScope(fallbackQuery, ctx);
  const { data, error } = await fallbackQuery;
  if (error) throw error;
  consoleGroup("listMeals:fallback", { day: targetDay, lastError }, data);
  return data || [];
}

async function insertMeal(payload = {}) {
  const ctx = await getContext();
  const targetDate = toYMD(payload.meal_date || payload.date || new Date());
  const basePayload = {
    title: payload.title || "Meal",
    meal_type: payload.meal_type || payload.mealType || "dinner",
    meal_date: targetDate,
    calories: toNumber(payload.calories),
    protein: toNumber(payload.protein),
    carbs: toNumber(payload.carbs),
    fat: toNumber(payload.fat),
    notes: payload.notes ?? null,
  };

  const userColumns = ["added_by", "user_id"];
  let insertError = null;
  let inserted = null;

  for (const userColumn of userColumns) {
    const serverPayload = {
      ...basePayload,
      [userColumn]: ctx.userId,
    };
    if (ctx.familyGroupId) {
      serverPayload.family_group_id = ctx.familyGroupId;
    }

    const { data, error } = await supabase
      .from("family_meals")
      .insert([serverPayload])
      .select("*")
      .maybeSingle();

    if (!error) {
      inserted = data;
      insertError = null;
      break;
    }
      insertError = error;
    if (!isMissingColumn(error, userColumn)) {
      break;
    }
    if (!data) {
      console.warn("[DB SANITY] Meal insert returned no row", {
        userColumn,
        family_group_id: ctx.familyGroupId,
      });
    }
  }

  if (insertError) {
    throw insertError;
  }

  const afterList = await listMeals(targetDate);
  consoleGroup("insertMeal", { payload: basePayload }, { inserted, afterCount: afterList.length });
  return inserted;
}

async function detectUpcomingMealsStrategy() {
  if (cachedUpcomingStrategy) return cachedUpcomingStrategy;

  // Dedicated upcoming meals table?
  const upcomingTableProbe = await supabase
    .from("family_upcoming_meals")
    .select("id, meal_date, title")
    .limit(1);

  if (!upcomingTableProbe.error) {
    cachedUpcomingStrategy = {
      kind: "table",
      table: "family_upcoming_meals",
      dateColumns: ["meal_date", "date"],
    };
    consoleGroup("upcomingMeals:strategy", null, cachedUpcomingStrategy);
    return cachedUpcomingStrategy;
  }

  if (!isMissingRelation(upcomingTableProbe.error, "family_upcoming_meals")) {
    cachedUpcomingStrategy = {
      kind: "table-error",
      table: "family_upcoming_meals",
      error: upcomingTableProbe.error,
    };
    consoleGroup("upcomingMeals:strategy", null, cachedUpcomingStrategy);
    return cachedUpcomingStrategy;
  }

  // Check for an is_upcoming flag on family_meals
  const flagColumns = ["is_upcoming", "upcoming"];
  for (const flagColumn of flagColumns) {
    const { error } = await supabase
      .from("family_meals")
      .select(`id, meal_date, ${flagColumn}`)
      .limit(1);
    if (!error) {
      cachedUpcomingStrategy = {
        kind: "family_meals_flag",
        flagColumn,
      };
      consoleGroup("upcomingMeals:strategy", null, cachedUpcomingStrategy);
      return cachedUpcomingStrategy;
    }
    if (!isMissingColumn(error, flagColumn)) {
      cachedUpcomingStrategy = {
        kind: "family_meals_error",
        flagColumn,
        error,
      };
      consoleGroup("upcomingMeals:strategy", null, cachedUpcomingStrategy);
      return cachedUpcomingStrategy;
    }
  }

  // Default: use family_meals with logged flag/absence of logged_at
  const sample = await supabase
    .from("family_meals")
    .select("id, meal_date, logged, logged_at")
    .limit(1);

  if (sample.error && isMissingRelation(sample.error, "family_meals")) {
    cachedUpcomingStrategy = {
      kind: "plan_generated",
      note: "Upcoming meals appear to be generated outside the database.",
    };
  } else {
    cachedUpcomingStrategy = {
      kind: "family_meals_logged",
      flagColumn: "logged",
    };
  }

  consoleGroup("upcomingMeals:strategy", null, cachedUpcomingStrategy);
  return cachedUpcomingStrategy;
}

async function describeUpcomingMealsSource() {
  const strategy = await detectUpcomingMealsStrategy();
  const description = {
    source:
      strategy.kind === "table"
        ? strategy.table
        : strategy.kind === "plan_generated"
        ? "plan-generated"
        : "family_meals",
    strategy,
  };
  consoleGroup("describeUpcomingMealsSource", null, description);
  return description;
}

function parseRange(range) {
  if (!range) return { start: toYMD(new Date()), end: null };
  if (typeof range === "string" || range instanceof Date) {
    return { start: toYMD(range), end: null };
  }
  const start = toYMD(range.start || range.from || new Date());
  const end = toYMD(range.end || range.to || null);
  return { start, end };
}

async function listUpcomingMeals(dayRange = null) {
  const ctx = await getContext();
  const strategy = await detectUpcomingMealsStrategy();
  if (strategy.kind === "plan_generated") {
    const description = await describeUpcomingMealsSource();
    consoleGroup("listUpcomingMeals", { dayRange }, description);
    return description;
  }
  if (strategy.kind === "table-error") {
    throw strategy.error || new Error("Could not read upcoming meals table");
  }

  const { start, end } = parseRange(dayRange);
  const dateColumns = strategy.dateColumns || ["meal_date", "date"];
  const table = strategy.table || "family_meals";
  let lastError = null;

  for (const dateColumn of dateColumns) {
    let query = supabase.from(table).select("*");
    query = applyMealScope(query, ctx);
    if (start) query = query.gte(dateColumn, start);
    if (end) query = query.lte(dateColumn, end);

    if (strategy.kind === "family_meals_flag" && strategy.flagColumn) {
      query = query.eq(strategy.flagColumn, true);
    } else if (strategy.kind === "family_meals_logged") {
      query = query.eq(strategy.flagColumn, false).order("logged_at", { ascending: true, nullsFirst: true });
    }

    query = query
      .order(dateColumn || "created_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50);

    const { data, error } = await query;
    if (!error) {
      consoleGroup("listUpcomingMeals", { dayRange, dateColumn }, data);
      return data || [];
    }
    lastError = error;
    if (!isMissingColumn(error, dateColumn)) {
      throw error;
    }
  }

  if (strategy.kind === "family_meals_logged") {
    let fallback = supabase.from(table).select("*");
    fallback = applyMealScope(fallback, ctx);
    if (start) fallback = fallback.gte("created_at", start);
    fallback = fallback.order("created_at", { ascending: true }).limit(25);
    const { data, error } = await fallback;
    if (!error) {
      consoleGroup("listUpcomingMeals:fallback", { dayRange, lastError }, data);
      return data || [];
    }
    throw error;
  }

  throw lastError || new Error("Unable to list upcoming meals");
}

async function deleteUpcomingMeal(id) {
  if (!id) throw new Error("Upcoming meal id is required");
  const ctx = await getContext();
  const strategy = await detectUpcomingMealsStrategy();

  if (strategy.kind === "plan_generated") {
    const key = `${UPCOMING_DELETE_PREFIX}${ctx.userId}`;
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    const next = Array.from(new Set([...existing, id]));
    localStorage.setItem(key, JSON.stringify(next));
    consoleGroup("deleteUpcomingMeal:localOnly", { id }, { note: "Local-only removal", stored: next.length });
    return next.length;
  }

  const table = strategy.table || "family_meals";
  const scope = applyMealScope(supabase.from(table).delete().eq("id", id), ctx);
  const { data, error } = await scope.select("id");
  if (error) throw error;
  const after = await listUpcomingMeals();
  consoleGroup("deleteUpcomingMeal", { id }, { deleted: data?.length || 0, afterCount: Array.isArray(after) ? after.length : 0 });
  return data?.length || 0;
}

async function ping() {
  const ctx = await getContext();
  const payload = { ok: true, userId: ctx.userId, familyGroupId: ctx.familyGroupId };
  consoleGroup("ping", null, payload);
  return payload;
}

export function installDbSanity() {
  if (!isDebugEnabled()) return null;
  if (typeof window === "undefined") return null;
  if (window.EH_DB) return window.EH_DB;

  const api = {
    ping,
    listWorkouts,
    insertWorkout,
    deleteWorkout,
    listMeals,
    insertMeal,
    listUpcomingMeals,
    deleteUpcomingMeal,
    describeUpcomingMealsSource,
  };

  window.EH_DB = api;
  // eslint-disable-next-line no-console
  console.info(
    "EH_DB installed. Try: EH_DB.ping(), EH_DB.listWorkouts('2025-12-26'), EH_DB.insertWorkout({title:'Test', workout_type:'Cardio'})"
  );

  return api;
}

export const EH_DB = {
  install: installDbSanity,
};
