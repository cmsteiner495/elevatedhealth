// js/meals.js
import { supabase } from "./supabaseClient.js";
import {
  mealsNoFamily,
  mealsHasFamily,
  mealsForm,
  mealDateInput,
  mealTypeInput,
  mealTitleInput,
  mealNotesInput,
  mealsMessage,
  mealsList,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  getTodayDate,
  selectedDate,
  setSelectedDate,
} from "./state.js";
import { maybeVibrate, openModal, setDinnerLogHandler, showToast } from "./ui.js";
import { readMealsStore, saveMeals } from "./dataAdapter.js";
import {
  normalizeMeal,
  setMeals,
  upsertMeal,
  removeMealByIdOrClientId,
} from "./ehStore.js";
import { isMealLogged } from "./selectors.js";
import {
  formatNutritionSummary,
  hasIncompleteNutrition,
  normalizeMealNutrition,
} from "./nutrition.js";

const LOCAL_ID_PREFIX = "local-";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FAMILY_MEAL_COLUMNS = [
  "id",
  "family_group_id",
  "added_by",
  "meal_date",
  "meal_type",
  "title",
  "notes",
  "calories",
  "protein",
  "carbs",
  "fat",
  "client_id",
  "logged_at",
  "created_at",
  "updated_at",
];

const nutritionPatchedKeys = new Set();

function sanitizeFamilyMealPayload(payload = {}, context = "family_meals") {
  const entries = Object.entries(payload || {});
  const allowed = new Set(FAMILY_MEAL_COLUMNS);
  const unknownKeys = entries.map(([key]) => key).filter((key) => !allowed.has(key));
  if (unknownKeys.length) {
    console.warn("[FAMILY MEALS] Dropping unknown columns before Supabase insert/update", {
      context,
      unknownKeys,
      payloadPreview: {
        keys: entries.map(([key]) => key),
        sample: Object.fromEntries(entries.slice(0, 5)),
      },
    });
  }

  return entries.reduce((acc, [key, value]) => {
    if (allowed.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export { sanitizeFamilyMealPayload };

function isUUID(value) {
  return UUID_REGEX.test(String(value || ""));
}

function readMealStore() {
  const snapshot = readMealsStore();
  if (
    snapshot.shape === "map" &&
    snapshot.parsed &&
    typeof snapshot.parsed === "object" &&
    !Array.isArray(snapshot.parsed)
  ) {
    return { ...snapshot.parsed };
  }

  const list = Array.isArray(snapshot.parsed) ? snapshot.parsed : [];
  return { unscoped: list };
}

function writeMealStore(store) {
  saveMeals(store || {});
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function computeMealTotals(meal = {}) {
  const normalized = normalizeMeal(meal) || {};
  return {
    calories: coerceNumber(normalized.calories),
    protein: coerceNumber(normalized.protein),
    carbs: coerceNumber(normalized.carbs),
    fat: coerceNumber(normalized.fat),
  };
}

function buildServerMealPayload(meal = {}) {
  const serverPayload = { ...(meal || {}) };
  if (!isUUID(serverPayload.id)) {
    delete serverPayload.id;
  }
  if (!serverPayload.client_id && meal.id) {
    serverPayload.client_id = meal.id;
  }
  return sanitizeFamilyMealPayload(serverPayload, "family_meals:payload");
}

export function getStoredMeals(familyId) {
  if (!familyId) return [];
  const store = readMealStore();
  const list = store[familyId] || store.unscoped || [];
  const normalized = Array.isArray(list)
    ? list
    : list && typeof list === "object"
    ? Object.values(list)
    : [];
  return normalized.filter(Boolean);
}

function persistMealsForFamily(familyId, meals = []) {
  if (!familyId) return;
  const store = readMealStore();
  store[familyId] = Array.isArray(meals) ? meals : [];
  writeMealStore(store);
}

function mealsMatch(a, b) {
  if (!a || !b) return false;
  const aIds = [a.id, a.client_id].filter(Boolean).map(String);
  const bIds = [b.id, b.client_id].filter(Boolean).map(String);
  const sharesId = aIds.some((id) => bIds.includes(id));
  const sharesMeta =
    (a.meal_date || "") === (b.meal_date || "") &&
    (a.title || "") === (b.title || "") &&
    (a.meal_type || "") === (b.meal_type || "");
  return sharesId || sharesMeta;
}

function mergeMeals(primary = [], secondary = []) {
  const merged = [];
  const add = (meal) => {
    if (!meal) return;
    const existingIdx = merged.findIndex((item) => mealsMatch(item, meal));
    const mergedRow = {
      ...(existingIdx >= 0 ? merged[existingIdx] : {}),
      ...meal,
    };
    if (existingIdx >= 0) {
      merged[existingIdx] = mergedRow;
    } else {
      merged.push(mergedRow);
    }
  };

  primary.forEach(add);
  secondary.forEach(add);

  return merged.sort((a, b) =>
    (a.meal_date || "").localeCompare(b.meal_date || "")
  );
}

function upsertStoredMeal(familyId, meal, options = {}) {
  if (!familyId || !meal) return;
  const existing = getStoredMeals(familyId);
  const matchValue = options.matchClientId || options.matchId;
  const targetIdx = existing.findIndex((entry) =>
    mealsMatch(entry, {
      ...meal,
      client_id: meal.client_id ?? matchValue,
      id: meal.id ?? matchValue,
    })
  );
  const mergedRow = {
    ...(targetIdx >= 0 ? existing[targetIdx] : {}),
    ...meal,
  };
  if (targetIdx >= 0) {
    existing[targetIdx] = mergedRow;
  } else {
    existing.push(meal);
  }
  persistMealsForFamily(familyId, existing);
}

export function removeStoredMeal(familyId, identifier, clientId) {
  if (!familyId || identifier == null) return;
  const existing = getStoredMeals(familyId);
  const filtered = existing.filter(
    (meal) =>
      !mealsMatch(meal, {
        id: identifier,
        client_id: clientId,
      })
  );
  persistMealsForFamily(familyId, filtered);
}

export async function deleteMealById(mealId, options = {}) {
  if (!mealId) return { error: new Error("Missing meal id") };
  if (!currentFamilyId) return { error: new Error("Missing family id") };

  const normalizedId = String(mealId);
  const clientId = options.client_id || options.clientId || normalizedId;
  const shouldForceLocalRemoval =
    !isUUID(normalizedId) || String(clientId || "").startsWith(LOCAL_ID_PREFIX);
  console.log("[MEAL DELETE] Attempting removal", {
    serverId: normalizedId,
    clientId,
    reason: options.reason,
  });

  let deleteError = null;
  let deletedRows = 0;

  const attemptDelete = async (column, value) => {
    const { data, error } = await supabase
      .from("family_meals")
      .delete()
      .eq(column, value)
      .eq("family_group_id", currentFamilyId)
      .select("id, client_id");
    if (error) {
      deleteError = error;
      return;
    }
    deletedRows += data?.length || 0;
  };

  if (isUUID(normalizedId)) {
    await attemptDelete("id", normalizedId);
    if (!deleteError && deletedRows === 0 && clientId && clientId !== normalizedId) {
      console.log("[MEAL DELETE] Fallback to client_id", { clientId });
      await attemptDelete("client_id", clientId);
    }
  } else if (clientId) {
    await attemptDelete("client_id", clientId);
  }

  if (deleteError && shouldForceLocalRemoval) {
    console.warn("[MEAL DELETE] Local removal despite error", deleteError);
    deleteError = null;
  }

  if (!deleteError) {
    removeStoredMeal(currentFamilyId, normalizedId, clientId);
    removeMealByIdOrClientId(normalizedId, {
      clientId,
      reason: options.reason || "deleteMeal",
    });
    announceDataChange("meals", options.date || options.meal_date);
  }

  return { error: deleteError };
}

function announceDataChange(source, date) {
  const detail = source || date ? { source, date } : { source };
  window.dispatchEvent(new CustomEvent("eh:data-changed", { detail }));
  window.dispatchEvent(new CustomEvent("eh:dataChanged", { detail }));
}

export async function logMealToDiary(meal, options = {}) {
  if (!currentUser || !currentFamilyId) {
    showToast("Join a family to log meals.");
    return;
  }

  const targetDate = options.date || selectedDate || getTodayDate();
  const title = meal.title?.trim();
  if (!title) return;

  const mealType = meal.meal_type || meal.mealType || options.mealType || "dinner";
  const notes = (meal.notes || meal.description || "").trim() || null;
  const totals = computeMealTotals(meal);
  const loggedAt = new Date().toISOString();
  const existingId = meal.id || null;
  const existingClientId = meal.client_id || meal.clientId || null;
  const tempId = existingClientId || existingId || `${LOCAL_ID_PREFIX}${Date.now()}`;
  const payload = {
    family_group_id: currentFamilyId,
    added_by: currentUser.id,
    meal_date: targetDate,
    meal_type: mealType,
    title,
    notes,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    client_id: tempId,
    logged_at: loggedAt,
  };

  const optimisticEntry = {
    id: existingId || tempId,
    client_id: tempId,
    ...payload,
    created_at: new Date().toISOString(),
  };

  upsertStoredMeal(currentFamilyId, optimisticEntry);
  upsertMeal(optimisticEntry, {
    reason: "logMealToDiary:optimistic",
    matchClientId: tempId,
  });
  console.log("[MEAL CREATE] Optimistic insert", {
    tempId,
    date: targetDate,
    mealType,
  });

  let persistedMeal = null;
  const serverPayload = buildServerMealPayload(payload);
  console.log("[MEAL INSERT] serverPayload", serverPayload);

  const tryUpdateTargets = [
    existingId ? ["id", existingId] : null,
    !existingId && existingClientId ? ["client_id", existingClientId] : null,
  ].filter(Boolean);

  let updateError = null;

  if (tryUpdateTargets.length) {
    for (const [column, value] of tryUpdateTargets) {
      const { data, error } = await supabase
        .from("family_meals")
        .update(serverPayload)
        .eq(column, value)
        .eq("family_group_id", currentFamilyId)
        .select("*")
        .maybeSingle();

      if (error) {
        updateError = error;
        continue;
      }

      if (data) {
        persistedMeal = data;
        updateError = null;
        break;
      }
    }
  }

  if (!persistedMeal) {
    const { data, error } = await supabase
      .from("family_meals")
      .insert(serverPayload)
      .select("*")
      .single();

    if (error) {
      console.error("[MEAL INSERT ERROR]", error);
      removeStoredMeal(currentFamilyId, tempId, tempId);
      removeMealByIdOrClientId(tempId, {
        reason: "logMealToDiary:rollback",
        clientId: tempId,
      });
      if (!options.silent) {
        showToast("Couldn't save meal. Try again.");
      }
      return;
    }
    persistedMeal = data;
    updateError = null;
  } else if (updateError) {
    console.error("[MEAL UPDATE ERROR]", updateError);
    if (!options.silent) {
      showToast("Couldn't save meal. Try again.");
    }
    await loadMeals();
    return;
  }

  console.log("[MEAL UPSERT] saved row", persistedMeal);
  const reconciled = {
    ...optimisticEntry,
    ...persistedMeal,
    client_id: persistedMeal?.client_id || tempId,
  };
  upsertStoredMeal(currentFamilyId, reconciled, { matchClientId: tempId });
  upsertMeal(reconciled, {
    reason: "logMealToDiary:reconcile",
    matchClientId: tempId,
  });
  console.log("[MEAL RECONCILE] tempId -> uuid", {
    tempId,
    serverId: persistedMeal?.id,
  });
  if (!options.silent) {
    showToast("Added to log");
    maybeVibrate([16]);
  }
  console.log("[EH MEAL] saved row totals", {
    calories: reconciled.calories ?? 0,
    protein: reconciled.protein ?? 0,
    carbs: reconciled.carbs ?? 0,
    fat: reconciled.fat ?? 0,
  });

  const viewingTarget = selectedDate === targetDate;
  if (!viewingTarget && options.syncDate !== false) {
    setSelectedDate(targetDate, { force: true });
  } else {
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: targetDate, entity: "meal" },
      })
    );
  }

  announceDataChange("meals", targetDate);

  if (!options.skipReload) {
    await loadMeals();
  }
}

function formatMealDateLabel(dateValue) {
  if (!dateValue) return "";
  const parts = dateValue.split("-").map(Number);
  const [y, m, d] = parts;
  const date = new Date(y || 0, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatMealNutritionSummary(meal) {
  return formatNutritionSummary(meal);
}

function openMealDetailsModal(meal) {
  if (!meal) return;
  const body = document.createElement("div");
  body.className = "diary-detail-body";

  const meta = document.createElement("div");
  meta.className = "diary-detail-meta";

  const mealRow = document.createElement("div");
  mealRow.className = "diary-detail-meta-row";
  mealRow.innerHTML = `<span class="diary-detail-meta-label">Meal</span><span class="diary-detail-meta-value">${
    meal.meal_type
      ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)
      : "Meal"
  }</span>`;
  meta.appendChild(mealRow);

  if (meal.meal_date) {
    const dateRow = document.createElement("div");
    dateRow.className = "diary-detail-meta-row";
    dateRow.innerHTML = `<span class="diary-detail-meta-label">Date</span><span class="diary-detail-meta-value">${formatMealDateLabel(
      meal.meal_date
    )}</span>`;
    meta.appendChild(dateRow);
  }

  body.appendChild(meta);

  if (meal.notes) {
    const notes = document.createElement("p");
    notes.className = "diary-detail-note";
    notes.textContent = meal.notes;
    body.appendChild(notes);
  }

  openModal({
    title: meal.title || "Meal",
    body,
    primaryLabel: "Log this meal",
    onPrimary: async () => {
      await logMealToDiary(
        {
          title: meal.title,
          meal_type: meal.meal_type,
          notes: meal.notes,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          nutrition: meal.nutrition || meal.macros,
        },
        { date: selectedDate }
      );
    },
  });
}

setDinnerLogHandler(async (meal) => {
  await logMealToDiary(
    {
      title: meal.title,
      meal_type: "dinner",
      notes: meal.description || meal.notes,
      calories: meal.calories || meal.nutrition?.calories,
      protein: meal.protein || meal.nutrition?.protein,
      carbs: meal.carbs || meal.nutrition?.carbs,
      fat: meal.fat || meal.nutrition?.fat,
      nutrition: meal.nutrition || meal.macros,
    },
    { date: selectedDate }
  );
});

export function setMealsFamilyState() {
  if (!mealsNoFamily || !mealsHasFamily) return;

  if (currentFamilyId) {
    mealsNoFamily.style.display = "none";
    mealsHasFamily.style.display = "block";
  } else {
    mealsNoFamily.style.display = "block";
    mealsHasFamily.style.display = "none";
    if (mealsList) mealsList.innerHTML = "";
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }
  }
}

function normalizeMealsWithNutrition(meals = [], options = {}) {
  const normalizedMeals = [];
  const patches = [];
  const patchKeys = new Set(
    Array.isArray(options.patchKeys)
      ? options.patchKeys
          .filter(Boolean)
          .map(String)
      : options.patchKeys instanceof Set
      ? Array.from(options.patchKeys)
      : []
  );

  meals.forEach((meal) => {
    if (!meal) return;
    let nutrition = null;
    let normalized = meal;
    try {
      nutrition = normalizeMealNutrition({
        ...meal,
        ingredients: meal.ingredients || meal.notes,
      });
      normalized = { ...meal, ...nutrition };
      normalizedMeals.push(normalized);
    } catch (err) {
      console.warn("[meals] Failed to normalize meal, leaving as-is", meal?.id, err);
      normalizedMeals.push(meal);
    }

    const mealKey = meal.id || meal.client_id;
    const shouldPatch =
      hasIncompleteNutrition(meal) ||
      (mealKey && patchKeys.has(String(mealKey)));

    if (shouldPatch && nutrition) {
      patches.push({
        meal: normalized,
        nutrition,
      });
    }
  });

  return { normalizedMeals, patches };
}

async function applyNutritionBackfill(patches = []) {
  if (!currentFamilyId || !Array.isArray(patches) || !patches.length) return;

  for (const entry of patches) {
    const meal = entry?.meal;
    const nutrition = entry?.nutrition;
    if (!meal || !nutrition) continue;

    const matchValue = isUUID(meal.id) ? meal.id : meal.client_id;
    if (!matchValue || nutritionPatchedKeys.has(String(matchValue))) continue;

    const payload = sanitizeFamilyMealPayload(
      {
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        family_group_id: currentFamilyId,
      },
      "family_meals:nutrition-backfill"
    );

    const matchColumn = isUUID(meal.id) ? "id" : "client_id";

    try {
      const { error } = await supabase
        .from("family_meals")
        .update(payload)
        .eq(matchColumn, matchValue)
        .eq("family_group_id", currentFamilyId);

      if (error) {
        console.error("[MEALS] Failed to backfill nutrition", {
          error,
          matchValue,
          matchColumn,
        });
        continue;
      }

      nutritionPatchedKeys.add(String(matchValue));
    } catch (err) {
      console.error("[MEALS] Exception during nutrition backfill", {
        error: err,
        matchValue,
        matchColumn,
      });
    }
  }
}

export async function loadMeals() {
  if (!currentFamilyId || !mealsList) return;

  if (mealsMessage) {
    mealsMessage.textContent = "";
    mealsMessage.style.color = "";
  }
  mealsList.innerHTML = "<li>Loading meals...</li>";

  const storedMeals = getStoredMeals(currentFamilyId);
  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("meal_date", { ascending: true })
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals:", error);
    if (storedMeals.length) {
      mealsList.innerHTML = "";
      const { normalizedMeals } = normalizeMealsWithNutrition(storedMeals);
      renderMeals(normalizedMeals);
      persistMealsForFamily(currentFamilyId, normalizedMeals);
      setMeals(normalizedMeals, { reason: "loadMeals:offline" });
      if (mealsMessage) {
        mealsMessage.textContent = "Showing saved meals (offline)";
        mealsMessage.style.color = "var(--text-muted)";
      }
    } else {
      mealsList.innerHTML = "<li>Could not load meals.</li>";
      setMeals([], { reason: "loadMeals:error" });
    }
  } else {
    const remoteMeals = data || [];
    const merged = mergeMeals(remoteMeals, storedMeals);
    const patchKeys = remoteMeals
      .filter((meal) => hasIncompleteNutrition(meal))
      .map((meal) => meal.id || meal.client_id);
    const { normalizedMeals, patches } = normalizeMealsWithNutrition(merged, {
      patchKeys,
    });
    persistMealsForFamily(currentFamilyId, normalizedMeals);
    setMeals(normalizedMeals, { reason: "loadMeals" });
    renderMeals(normalizedMeals);
    await applyNutritionBackfill(patches);
  }
}

export async function fetchMealsByDate(dateValue) {
  if (!currentFamilyId || !dateValue) return [];

  const storedMeals = getStoredMeals(currentFamilyId);
  const storedForDate = storedMeals.filter(
    (meal) => (meal.meal_date || "") === dateValue && isMealLogged(meal)
  );

  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .eq("meal_date", dateValue)
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals for date:", error);
    return storedForDate;
  }

  const merged = mergeMeals(data || [], storedMeals);
  const patchKeys = (data || [])
    .filter((meal) => hasIncompleteNutrition(meal))
    .map((meal) => meal.id || meal.client_id);
  const { normalizedMeals, patches } = normalizeMealsWithNutrition(merged, {
    patchKeys,
  });
  persistMealsForFamily(currentFamilyId, normalizedMeals);
  await applyNutritionBackfill(patches);
  return normalizedMeals.filter(
    (meal) => (meal.meal_date || "") === dateValue && isMealLogged(meal)
  );
}

async function logMealToToday(meal) {
  await logMealToDiary(meal, {
    date: selectedDate || getTodayDate(),
    skipReload: true,
  });
}

function renderMeals(items) {
  if (!mealsList) return;

  const upcomingMeals = Array.isArray(items)
    ? items.filter((meal) => meal && !isMealLogged(meal))
    : [];

  if (!upcomingMeals.length) {
    mealsList.innerHTML = "<li>No upcoming meals. Add one above!</li>";
    return;
  }

  mealsList.innerHTML = "";

  for (const meal of upcomingMeals) {
    const totals = computeMealTotals(meal);
    const li = document.createElement("li");
    li.dataset.mealId = meal.id || "";
    li.dataset.mealClientId = meal.client_id || meal.id || "";
    li.dataset.mealType = meal.meal_type;
    li.dataset.mealTitle = meal.title;
    li.dataset.mealDate = meal.meal_date;
    li.dataset.mealNotes = meal.notes || "";
    li.dataset.mealCalories = totals.calories ?? "";
    li.dataset.mealProtein = totals.protein ?? "";
    li.dataset.mealCarbs = totals.carbs ?? "";
    li.dataset.mealFat = totals.fat ?? "";
    li.style.display = "flex";
    li.style.flexDirection = "column";
    li.style.gap = "0.25rem";
    li.style.padding = "0.5rem 0";
    li.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.justifyContent = "space-between";
    topRow.style.alignItems = "center";
    topRow.style.gap = "0.5rem";

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.textContent = meal.title;
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const dateStr = meal.meal_date || "";
    const mealTypeValue = meal.meal_type || "meal";
    const typeLabel =
      mealTypeValue.charAt(0).toUpperCase() + mealTypeValue.slice(1);
    meta.textContent = `${typeLabel} • ${dateStr}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const logBtn = document.createElement("button");
    logBtn.textContent = "Add to log";
    logBtn.type = "button";
    logBtn.classList.add("ghost-btn", "meal-log-btn");
    logBtn.style.paddingInline = "0.6rem";
    logBtn.style.fontSize = "0.85rem";
    right.appendChild(logBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("meal-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    const nutritionSummary = formatMealNutritionSummary(meal);
    if (nutritionSummary) {
      const nutrition = document.createElement("div");
      nutrition.textContent = nutritionSummary;
      nutrition.style.fontSize = "0.8rem";
      nutrition.style.opacity = "0.85";
      li.appendChild(nutrition);
    }

    if (meal.notes) {
      const notes = document.createElement("div");
      notes.textContent = meal.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    mealsList.appendChild(li);
  }
}

// ADD MEAL
if (mealsForm) {
  mealsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (mealsMessage) {
      mealsMessage.textContent = "";
      mealsMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (mealsMessage) {
        mealsMessage.textContent = "You need a family group to add meals.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    const dateValue = mealDateInput.value;
    const mealType = mealTypeInput.value;
    const title = mealTitleInput.value.trim();
    const notes = mealNotesInput.value.trim();
    const totals = computeMealTotals({});

    if (!dateValue || !mealType || !title) return;

    const tempId = `${LOCAL_ID_PREFIX}${Date.now()}`;
    const payload = {
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      meal_date: dateValue,
      meal_type: mealType,
      title,
      notes: notes || null,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
    fat: totals.fat,
    client_id: tempId,
    logged_at: null,
  };
    const optimisticEntry = {
      id: tempId,
      client_id: tempId,
      ...payload,
      added_by: currentUser?.id || null,
      created_at: new Date().toISOString(),
    };
    upsertStoredMeal(currentFamilyId, optimisticEntry);
    upsertMeal(optimisticEntry, {
      reason: "addMeal:optimistic",
      matchClientId: tempId,
    });

    const serverPayload = buildServerMealPayload(payload);
    console.log("[MEAL INSERT] serverPayload", serverPayload);
    const { data, error } = await supabase
      .from("family_meals")
      .insert(serverPayload)
      .select("*")
      .single();

    if (error) {
      console.error("[MEAL INSERT ERROR]", error);
      removeStoredMeal(currentFamilyId, tempId, tempId);
      removeMealByIdOrClientId(tempId, {
        reason: "addMeal:rollback",
        clientId: tempId,
      });
      if (mealsMessage) {
        mealsMessage.textContent = "Error adding meal.";
        mealsMessage.style.color = "red";
      }
    } else {
      console.log("[MEAL INSERT] insertedRow", data);
      const reconciled = {
        ...optimisticEntry,
        ...data,
        client_id: data?.client_id || tempId,
      };
      upsertStoredMeal(currentFamilyId, reconciled, {
        matchClientId: tempId,
      });
      upsertMeal(reconciled, { reason: "addMeal:reconcile", matchClientId: tempId });
    }

    console.log("[EH MEAL] saved row totals", {
      calories: optimisticEntry.calories ?? 0,
      protein: optimisticEntry.protein ?? 0,
      carbs: optimisticEntry.carbs ?? 0,
      fat: optimisticEntry.fat ?? 0,
    });

    const guidedDate = mealsForm.dataset.targetDate;
    const guidedMealType = mealsForm.dataset.targetMealType;
    const shouldMirrorToLog =
      guidedDate && guidedMealType && (guidedDate !== dateValue || guidedMealType !== mealType);

    if (shouldMirrorToLog) {
      await logMealToDiary(
        { title, meal_type: guidedMealType, notes: notes || null },
        { date: guidedDate, silent: true, skipReload: true }
      );
    }

    mealsForm.reset();
    await loadMeals();
    document.dispatchEvent(
      new CustomEvent("diary:refresh", {
        detail: { date: dateValue, entity: "meal" },
      })
    );
    announceDataChange("meals", dateValue);
  });
}

// DELETE MEAL
if (mealsList) {
  mealsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const mealId = li.dataset.mealId;
    if (!mealId) return;

    const logBtn = e.target.closest(".meal-log-btn");
    const deleteBtn = e.target.closest(".meal-delete");

    if (logBtn) {
      e.preventDefault();
      e.stopPropagation();
      await logMealToToday({
        title: li.dataset.mealTitle,
        meal_type: li.dataset.mealType,
        notes: li.dataset.mealNotes,
        calories: li.dataset.mealCalories,
        protein: li.dataset.mealProtein,
        carbs: li.dataset.mealCarbs,
        fat: li.dataset.mealFat,
      });
      return;
    }

    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (deleteBtn.disabled) return;
      deleteBtn.disabled = true;
      deleteBtn.setAttribute("aria-busy", "true");
      li.classList.add("list-removing");
      const { error } = await deleteMealById(mealId, {
        date: li.dataset.mealDate,
        client_id: li.dataset.mealClientId,
        reason: "deleteMeal:planner",
      });

      if (error) {
        console.error("Error deleting meal:", error);
        li.classList.remove("list-removing");
        deleteBtn.disabled = false;
        deleteBtn.removeAttribute("aria-busy");
        showToast("Couldn't delete meal. Try again.");
        return;
      }

      const removeNode = () => li.remove();
      li.addEventListener("transitionend", removeNode, { once: true });
      setTimeout(removeNode, 220);
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "meal" } })
      );
      return;
    }

    openMealDetailsModal({
      title: li.dataset.mealTitle,
      meal_type: li.dataset.mealType,
      meal_date: li.dataset.mealDate,
      notes: li.dataset.mealNotes,
    });
  });
}
