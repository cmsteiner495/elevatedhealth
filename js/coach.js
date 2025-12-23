// js/coach.js
import { supabase } from "./supabaseClient.js";
import {
  coachMessages,
  coachForm,
  coachInput,
  coachGenerateWeek,
  coachStatus,
  coachTypingPill,
  workoutTypeInput,
  workoutDifficultyInput,
} from "./dom.js";
import { currentUser, currentFamilyId, toLocalDayKey } from "./state.js";
import { loadMeals, sanitizeFamilyMealPayload } from "./meals.js";
import { loadWorkouts } from "./workouts.js";
import { loadGroceryItems } from "./grocery.js";
import { maybeVibrate, showToast } from "./ui.js";

function setCoachThinking(isThinking) {
  if (!coachTypingPill) return;
  coachTypingPill.style.display = isThinking ? "inline-flex" : "none";
}

function appendCoachMessage(role, text) {
  if (!coachMessages) return;

  const row = document.createElement("div");
  row.classList.add("coach-message");
  row.classList.add(
    role === "user" ? "coach-message-user" : "coach-message-assistant"
  );

  const bubble = document.createElement("div");
  bubble.classList.add(
    "coach-bubble",
    role === "user" ? "coach-bubble-user" : "coach-bubble-assistant"
  );
  bubble.textContent = text;

  row.appendChild(bubble);
  coachMessages.appendChild(row);
  coachMessages.scrollTop = coachMessages.scrollHeight;
}

// Load coach message history from Supabase
export async function loadCoachHistory() {
  if (!coachMessages) return;

  coachMessages.innerHTML = "";

  if (!currentFamilyId || !currentUser) {
    appendCoachMessage(
      "assistant",
      "I’m Ella, your Elevated Health coach. Once you’re connected to a family, I’ll remember what we discuss."
    );
    return;
  }

  const { data, error } = await supabase
    .from("ai_coach_messages")
    .select("role, content")
    .eq("family_group_id", currentFamilyId)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error loading coach history:", error);
    appendCoachMessage(
      "assistant",
      "I’m ready whenever you are. (I couldn’t load our past messages right now.)"
    );
    return;
  }

  if (!data || data.length === 0) {
    appendCoachMessage(
      "assistant",
      "I’m Ella. Ask me anything about meals, workouts, or progress, or use the 7-Day Plan button."
    );
    return;
  }

  for (const msg of data) {
    const role = msg.role === "user" ? "user" : "assistant";
    appendCoachMessage(role, msg.content);
  }
}

// Log coach message
async function logCoachMessage(role, content, mode = "chat") {
  if (!currentFamilyId || !currentUser) return;

  try {
    await supabase.from("ai_coach_messages").insert({
      family_group_id: currentFamilyId,
      user_id: currentUser.id,
      role,
      mode,
      content,
    });
  } catch (err) {
    console.error("Error logging coach message:", err);
  }
}

// Workout / difficulty normalizers
const UI_WORKOUT_TYPES = workoutTypeInput
  ? Array.from(workoutTypeInput.options)
      .map((opt) => opt.value)
      .filter((v) => v && v.trim().length > 0)
  : [];

const DEFAULT_WORKOUT_TYPE = UI_WORKOUT_TYPES[0] || "cardio";

function normalizeWorkoutType(raw) {
  if (!raw) return DEFAULT_WORKOUT_TYPE;
  const value = String(raw).toLowerCase().trim();

  const direct = UI_WORKOUT_TYPES.find((opt) => opt.toLowerCase() === value);
  if (direct) return direct;

  const lowerOpts = UI_WORKOUT_TYPES.map((o) => o.toLowerCase());
  const pickBy = (predicate) => {
    const idx = lowerOpts.findIndex(predicate);
    return idx !== -1 ? UI_WORKOUT_TYPES[idx] : null;
  };

  if (
    value.includes("walk") ||
    value.includes("run") ||
    value.includes("cardio")
  ) {
    const chosen = pickBy(
      (o) => o.includes("cardio") || o.includes("walk") || o.includes("run")
    );
    if (chosen) return chosen;
  }

  if (
    value.includes("strength") ||
    value.includes("weights") ||
    value.includes("dumbbell")
  ) {
    const chosen = pickBy(
      (o) => o.includes("strength") || o.includes("weight")
    );
    if (chosen) return chosen;
  }

  if (
    value.includes("stretch") ||
    value.includes("yoga") ||
    value.includes("mobility")
  ) {
    const chosen = pickBy(
      (o) =>
        o.includes("mobility") || o.includes("stretch") || o.includes("yoga")
    );
    if (chosen) return chosen;
  }

  if (value.includes("rest") || value.includes("off")) {
    const chosen = pickBy((o) => o.includes("rest"));
    if (chosen) return chosen;
  }

  return DEFAULT_WORKOUT_TYPE;
}

const UI_DIFFICULTIES = workoutDifficultyInput
  ? Array.from(workoutDifficultyInput.options)
      .map((opt) => opt.value)
      .filter((v) => v && v.trim().length > 0)
  : [];

function normalizeDifficulty(raw) {
  if (!raw || !UI_DIFFICULTIES.length) return null;
  const v = String(raw).toLowerCase().trim();

  const direct = UI_DIFFICULTIES.find((opt) => opt.toLowerCase() === v);
  if (direct) return direct;

  const lowerOpts = UI_DIFFICULTIES.map((d) => d.toLowerCase());
  const pickBy = (predicate) => {
    const idx = lowerOpts.findIndex(predicate);
    return idx !== -1 ? UI_DIFFICULTIES[idx] : null;
  };

  if (v.includes("easy") || v.includes("light")) {
    const easy = pickBy((d) => d.includes("easy"));
    if (easy) return easy;
  }

  if (v.includes("medium") || v.includes("moderate")) {
    const med = pickBy((d) => d.includes("medium") || d.includes("moderate"));
    if (med) return med;
  }

  if (v.includes("hard") || v.includes("intense") || v.includes("heavy")) {
    const hard = pickBy((d) => d.includes("hard"));
    if (hard) return hard;
  }

  return null;
}

// APPLY COACH UPDATES
async function applyCoachUpdates(updates) {
  console.log("AI coach updates received:", updates);

  if (!updates) {
    console.warn("No updates object, nothing to apply.");
    return;
  }
  if (!currentFamilyId || !currentUser) {
    console.warn("Cannot apply updates: missing currentFamilyId or currentUser", {
      currentFamilyId,
      currentUser,
    });
    return;
  }

  const SAFE_WORKOUT_TYPE = "cardio";
  const coerceNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  try {
    const mealDates = Array.isArray(updates.meals)
      ? [
          ...new Set(
            updates.meals
              .map((m) => m.meal_date || m.date)
              .filter(Boolean)
          ),
        ]
      : [];

    const workoutDates = Array.isArray(updates.workouts)
      ? [
          ...new Set(
            updates.workouts
              .map((w) => w.workout_date || w.date)
              .filter(Boolean)
          ),
        ]
      : [];

    // MEALS
    if (Array.isArray(updates.meals) && updates.meals.length > 0) {
      const mealRows = updates.meals
        .map((m, index) => {
          const mealDate = toLocalDayKey(m.meal_date || m.date);
          const mealType = (m.meal_type || m.type || "dinner")
            .toString()
            .toLowerCase();
          const title = m.title?.toString().trim();
          if (!mealDate || !title) {
            console.warn("[AI COACH] Skipping meal with missing fields", {
              mealDate,
              title,
              index,
              raw: m,
            });
            return null;
          }

          const calories = coerceNumber(
            m.calories ?? m.calories_total ?? m.nutrition?.calories
          );
          const protein = coerceNumber(
            m.protein ?? m.nutrition?.protein ?? m.protein_g
          );
          const carbs = coerceNumber(m.carbs ?? m.nutrition?.carbs);
          const fat = coerceNumber(m.fat ?? m.nutrition?.fat);
          const clientId = (m.client_id || m.clientId || "")
            .toString()
            .trim();

          return {
            family_group_id: currentFamilyId,
            added_by: currentUser.id,
            meal_date: mealDate,
            meal_type: mealType,
            title,
            notes: m.notes ? `[Ella] ${m.notes}` : "[Ella]",
            calories,
            protein,
            carbs,
            fat,
            client_id:
              clientId ||
              `ella-${mealDate}-${mealType}-${title}`.slice(0, 120),
            logged_at: null,
          };
        })
        .filter(Boolean);

      if (mealRows.length > 0) {
        console.log("[AI COACH] Prepared meal rows", {
          count: mealRows.length,
          sample: mealRows[0],
        });

        const sanitizedRows = mealRows.map((row, index) => ({
          ...sanitizeFamilyMealPayload(row, `coach:insert:${index}`),
        }));

        const { error } = await supabase.from("family_meals").insert(sanitizedRows);
        if (error) {
          console.error("Error inserting meals from AI coach:", {
            error,
            details: error?.details,
            hint: error?.hint,
            code: error?.code,
            payloadPreview: { count: sanitizedRows.length, sample: sanitizedRows[0] },
          });
        } else {
          console.log("Inserted meals from AI coach:", mealRows);
        }
      }
    }

    // WORKOUTS
    if (workoutDates.length > 0) {
      const { error: deleteWorkoutsError } = await supabase
        .from("family_workouts")
        .delete()
        .eq("family_group_id", currentFamilyId)
        .in("workout_date", workoutDates);

      if (deleteWorkoutsError) {
        console.error(
          "Error deleting existing workouts for plan range:",
          deleteWorkoutsError
        );
      }
    }

    if (Array.isArray(updates.workouts) && updates.workouts.length > 0) {
      const workoutRows = updates.workouts
        .map((w) => {
          const workoutDate = w.workout_date || w.date;
          const title = w.title;
          if (!workoutDate || !title) return null;

          // Normalize type, but intentionally do NOT send difficulty
          // to avoid violating the Supabase difficulty check constraint.
          const safeType = normalizeWorkoutType(w.workout_type || w.type);

          const row = {
            family_group_id: currentFamilyId,
            added_by: currentUser.id,
            workout_date: workoutDate,
            title,
            workout_type: safeType || SAFE_WORKOUT_TYPE,
            duration_min:
              w.duration_min != null ? w.duration_min : w.duration || null,
            notes: w.notes ? `[Ella] ${w.notes}` : "[Ella]",
            completed: false,
          };

          // If you later sync this with your DB constraint, you can
          // set a default difficulty here, e.g.:
          // row.difficulty = "medium";

          return row;
        })
        .filter(Boolean);

      console.log(
        "Workout rows for AI coach (difficulty omitted):",
        workoutRows
      );

      if (workoutRows.length > 0) {
        const { error } = await supabase
          .from("family_workouts")
          .insert(workoutRows);
        if (error) {
          console.error("Error inserting workouts from AI coach:", error);
        } else {
          console.log("Inserted workouts from AI coach:", workoutRows);
        }
      }
    }

    // GROCERY LIST
    if (
      Array.isArray(updates.groceryItems) &&
      updates.groceryItems.length > 0
    ) {
      const { error: deleteGroceriesError } = await supabase
        .from("grocery_list_items")
        .delete()
        .eq("family_group_id", currentFamilyId);

      if (deleteGroceriesError) {
        console.error("Error clearing grocery list:", deleteGroceriesError);
      }

      const groceryRows = updates.groceryItems
        .map((g) => {
          const name = g.name;
          if (!name) return null;

          return {
            family_group_id: currentFamilyId,
            added_by: currentUser.id,
            name,
            quantity: g.quantity || null,
            category: g.category || null,
          };
        })
        .filter(Boolean);

      if (groceryRows.length > 0) {
        const { error } = await supabase
          .from("grocery_list_items")
          .insert(groceryRows);
        if (error) {
          console.error("Error inserting grocery items from AI coach:", error);
        } else {
          console.log("Inserted grocery items from AI coach:", groceryRows);
        }
      }
    }

    await Promise.all([loadMeals(), loadWorkouts(), loadGroceryItems()]);
    showToast("Ella updated your week");
    maybeVibrate([12, 10]);
  } catch (err) {
    console.error("Error applying AI coach updates:", err);
  }
}

function formatCoachReply(reply, updates, mode) {
  const hasPlanUpdates =
    updates &&
    (Array.isArray(updates.meals) ||
      Array.isArray(updates.workouts) ||
      Array.isArray(updates.groceryItems));

  if (mode === "plan" && hasPlanUpdates) {
    return (
      "I’ve generated a fresh 7-day workout and dinner plan for your family " +
      "and updated your Meals, Workouts, and Grocery tabs."
    );
  }

  if (typeof reply === "string") {
    const trimmed = reply.trim();
    if (trimmed.startsWith("```")) {
      return (
        "I’ve created or updated your plan. " +
        "Check the Meals, Workouts, and Grocery tabs for the details."
      );
    }
    return reply;
  }

  return "I’ve updated your plan based on your request.";
}

// Call Supabase Edge Function
async function callAICoach(promptText, options = {}) {
  const mode = options.mode || "chat";

  try {
    const { data, error } = await supabase.functions.invoke("ai-coach", {
      body: {
        prompt: promptText,
        mode,
      },
    });

    console.log("Raw ai-coach response:", { data, error });

    if (error) {
      console.error("ai-coach function error:", error);
      throw error;
    }

    if (!data || !data.reply) {
      throw new Error("No reply from AI coach function.");
    }

    const reply = data.reply;
    const updates = data.updates || null;

    if (updates) {
      await applyCoachUpdates(updates);
    }

    const formattedReply = formatCoachReply(reply, updates, mode);
    return { reply: formattedReply, updates };
  } catch (err) {
    console.error("AI coach call failed:", err);

    let fallbackReply;
    if (mode === "plan") {
      fallbackReply =
        "I ran into a problem generating a full 7-day plan. " +
        "Once everything is wired up, this button will create a complete weekly workout and dinner schedule for your family.";
    } else {
      fallbackReply =
        "I ran into an error trying to respond. Please try again in a moment.";
    }

    return { reply: fallbackReply, updates: null };
  }
}

// Public init for coach UI
export async function runWeeklyPlanGeneration() {
  if (!currentUser || !currentFamilyId) {
    if (coachStatus) {
      coachStatus.textContent =
        "You need to be logged in and connected to a family group to generate plans.";
      coachStatus.style.color = "red";
    }
    return;
  }

  const promptText = `
Generate a simple 7-day workout and dinner plan for a small family.
Keep meals budget-friendly and easy to cook.
Keep workouts realistic for busy adults (30–45 minutes, mix of strength, walking, and rest days).
Return your answer in clear sections: Workouts and Meals.
  `.trim();

  const userDisplayText =
    "Generate a simple 7-day workout and dinner plan for us.";

  appendCoachMessage("user", userDisplayText);
  logCoachMessage("user", userDisplayText, "plan");
  setCoachThinking(true);

  if (coachStatus) {
    coachStatus.textContent = "";
    coachStatus.style.color = "";
  }

  try {
    const { reply } = await callAICoach(promptText, { mode: "plan" });
    appendCoachMessage("assistant", reply);
    logCoachMessage("assistant", reply, "plan");
    setCoachThinking(false);
    showToast("Ella completed a 7-day plan");
    maybeVibrate([14, 18]);
  } catch (err) {
    console.error(err);
    const fallback =
      "I couldn’t generate the plan right now. Please try again later.";
    appendCoachMessage("assistant", fallback);
    logCoachMessage("assistant", fallback, "plan");
    setCoachThinking(false);
    if (coachStatus) {
      coachStatus.textContent = "Error generating plan.";
      coachStatus.style.color = "red";
    }
  }
}

export function initCoachHandlers() {
  // Chat submit
  if (coachForm && coachInput) {
    coachForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!coachInput.value.trim()) return;

      const userText = coachInput.value.trim();
      coachInput.value = "";

      appendCoachMessage("user", userText);
      logCoachMessage("user", userText, "chat");
      setCoachThinking(true);

      if (coachStatus) {
        coachStatus.textContent = "";
        coachStatus.style.color = "";
      }

      try {
        const { reply } = await callAICoach(userText);
        appendCoachMessage("assistant", reply);
        logCoachMessage("assistant", reply, "chat");
        setCoachThinking(false);
      } catch (err) {
        console.error(err);
        const fallback =
          "I ran into an error trying to respond. Please try again in a moment.";
        appendCoachMessage("assistant", fallback);
        logCoachMessage("assistant", fallback, "chat");
        setCoachThinking(false);
        if (coachStatus) {
          coachStatus.textContent = "Error talking to AI coach.";
          coachStatus.style.color = "red";
        }
      }
    });
  }

  // 7-day plan button
  if (coachGenerateWeek) {
    coachGenerateWeek.addEventListener("click", () => runWeeklyPlanGeneration());
  }
}
