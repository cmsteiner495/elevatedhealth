// js/app.js
import { supabase } from "./supabaseClient.js";

console.log("EH app.js VERSION 4.1 (Coach memory)");

// DOM elements
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");

const signupForm = document.getElementById("signup-form");
const signupEmail = document.getElementById("signup-email");
const signupPassword = document.getElementById("signup-password");
const signupDisplayName = document.getElementById("signup-display-name");
const signupMessage = document.getElementById("signup-message");

const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");

const logoutButton = document.getElementById("logout-button");
const welcomeText = document.getElementById("welcome-text");

// Global-ish state
let currentUser = null;
let currentFamilyId = null;

// Tabs
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

// Family
const familyStatus = document.getElementById("family-status");

// Grocery DOM elements
const groceryNoFamily = document.getElementById("grocery-no-family");
const groceryHasFamily = document.getElementById("grocery-has-family");
const groceryForm = document.getElementById("grocery-form");
const groceryName = document.getElementById("grocery-name");
const groceryQuantity = document.getElementById("grocery-quantity");
const groceryCategory = document.getElementById("grocery-category");
const groceryMessage = document.getElementById("grocery-message");
const groceryList = document.getElementById("grocery-list");

// Meals DOM elements
const mealsNoFamily = document.getElementById("meals-no-family");
const mealsHasFamily = document.getElementById("meals-has-family");
const mealsForm = document.getElementById("meals-form");
const mealDateInput = document.getElementById("meal-date");
const mealTypeInput = document.getElementById("meal-type");
const mealTitleInput = document.getElementById("meal-title");
const mealNotesInput = document.getElementById("meal-notes");
const mealsMessage = document.getElementById("meals-message");
const mealsList = document.getElementById("meals-list");

// Workouts DOM elements
const workoutsNoFamily = document.getElementById("workouts-no-family");
const workoutsHasFamily = document.getElementById("workouts-has-family");
const workoutsForm = document.getElementById("workouts-form");
const workoutDateInput = document.getElementById("workout-date");
const workoutTitleInput = document.getElementById("workout-title");
const workoutTypeInput = document.getElementById("workout-type");
const workoutDifficultyInput = document.getElementById("workout-difficulty");
const workoutDurationInput = document.getElementById("workout-duration");
const workoutNotesInput = document.getElementById("workout-notes");
const workoutsMessage = document.getElementById("workouts-message");
const workoutsList = document.getElementById("workouts-list");

// Progress DOM elements
const progressNoFamily = document.getElementById("progress-no-family");
const progressHasFamily = document.getElementById("progress-has-family");
const progressForm = document.getElementById("progress-form");
const progressDateInput = document.getElementById("progress-date");
const progressWeightInput = document.getElementById("progress-weight");
const progressWaterInput = document.getElementById("progress-water");
const progressSleepInput = document.getElementById("progress-sleep");
const progressStepsInput = document.getElementById("progress-steps");
const progressMoodInput = document.getElementById("progress-mood");
const progressNotesInput = document.getElementById("progress-notes");
const progressMessage = document.getElementById("progress-message");
const progressList = document.getElementById("progress-list");

// AI Coach DOM elements
const coachMessages = document.getElementById("coach-messages");
const coachForm = document.getElementById("coach-form");
const coachInput = document.getElementById("coach-input");
const coachGenerateWeek = document.getElementById("coach-generate-week");
const coachStatus = document.getElementById("coach-message");
const coachTypingPill = document.getElementById("coach-typing-pill");

//
// Helper: toggle UI based on auth state
//
function showAuth() {
  authSection.style.display = "block";
  appSection.style.display = "none";
}

function showApp() {
  authSection.style.display = "none";
  appSection.style.display = "block";
}

//
// Grocery helpers
//
function setGroceryFamilyState() {
  if (!groceryNoFamily || !groceryHasFamily) return;

  if (currentFamilyId) {
    groceryNoFamily.style.display = "none";
    groceryHasFamily.style.display = "block";
  } else {
    groceryNoFamily.style.display = "block";
    groceryHasFamily.style.display = "none";
    if (groceryList) groceryList.innerHTML = "";
    if (groceryMessage) {
      groceryMessage.textContent = "";
      groceryMessage.style.color = "";
    }
  }
}

async function loadGroceryItems() {
  if (!currentFamilyId || !groceryList) {
    return;
  }

  if (groceryMessage) {
    groceryMessage.textContent = "";
    groceryMessage.style.color = "";
  }
  groceryList.innerHTML = "<li>Loading items...</li>";

  const { data, error } = await supabase
    .from("grocery_list_items")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading grocery items:", error);
    groceryList.innerHTML = "<li>Could not load grocery items.</li>";
    return;
  }

  renderGroceryList(data || []);
}

function renderGroceryList(items) {
  if (!groceryList) return;

  if (!items.length) {
    groceryList.innerHTML = "<li>No items yet. Add something above!</li>";
    return;
  }

  groceryList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.dataset.itemId = item.id;
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.gap = "0.5rem";
    li.style.padding = "0.25rem 0";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.5rem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.checked || false;
    checkbox.classList.add("grocery-checkbox");

    const text = document.createElement("span");
    text.textContent = item.name + (item.quantity ? ` (${item.quantity})` : "");
    if (item.checked) {
      text.style.textDecoration = "line-through";
      text.style.opacity = "0.6";
    }

    left.appendChild(checkbox);
    left.appendChild(text);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    if (item.category) {
      const cat = document.createElement("span");
      cat.textContent = item.category;
      cat.style.fontSize = "0.75rem";
      cat.style.opacity = "0.8";
      right.appendChild(cat);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("grocery-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(right);
    groceryList.appendChild(li);
  }
}

//
// Meals helpers
//
function setMealsFamilyState() {
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

async function loadMeals() {
  if (!currentFamilyId || !mealsList) return;

  if (mealsMessage) {
    mealsMessage.textContent = "";
    mealsMessage.style.color = "";
  }
  mealsList.innerHTML = "<li>Loading meals...</li>";

  const { data, error } = await supabase
    .from("family_meals")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("meal_date", { ascending: true })
    .order("meal_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading meals:", error);
    mealsList.innerHTML = "<li>Could not load meals.</li>";
  } else {
    renderMeals(data || []);
  }
}

function renderMeals(items) {
  if (!mealsList) return;

  if (!items.length) {
    mealsList.innerHTML = "<li>No meals yet. Add one above!</li>";
    return;
  }

  mealsList.innerHTML = "";

  for (const meal of items) {
    const li = document.createElement("li");
    li.dataset.mealId = meal.id;
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

    const dateStr = meal.meal_date;
    const typeLabel =
      meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1);
    meta.textContent = `${typeLabel} • ${dateStr}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("meal-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

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

//
// Workouts helpers
//
function setWorkoutsFamilyState() {
  if (!workoutsNoFamily || !workoutsHasFamily) return;

  if (currentFamilyId) {
    workoutsNoFamily.style.display = "none";
    workoutsHasFamily.style.display = "block";
  } else {
    workoutsNoFamily.style.display = "block";
    workoutsHasFamily.style.display = "none";
    if (workoutsList) workoutsList.innerHTML = "";
    if (workoutsMessage) {
      workoutsMessage.textContent = "";
      workoutsMessage.style.color = "";
    }
  }
}

async function loadWorkouts() {
  if (!currentFamilyId || !workoutsList) return;

  if (workoutsMessage) {
    workoutsMessage.textContent = "";
    workoutsMessage.style.color = "";
  }
  workoutsList.innerHTML = "<li>Loading workouts...</li>";

  const { data, error } = await supabase
    .from("family_workouts")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("workout_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading workouts:", error);
    workoutsList.innerHTML = "<li>Could not load workouts.</li>";
  } else {
    renderWorkouts(data || []);
  }
}

function renderWorkouts(items) {
  if (!workoutsList) return;

  if (!items.length) {
    workoutsList.innerHTML = "<li>No workouts yet. Add one above!</li>";
    return;
  }

  workoutsList.innerHTML = "";

  for (const w of items) {
    const li = document.createElement("li");
    li.dataset.workoutId = w.id;
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
    title.textContent = w.title;
    title.style.fontWeight = "600";
    if (w.completed) {
      title.style.textDecoration = "line-through";
      title.style.opacity = "0.7";
    }

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const dateStr = w.workout_date;
    const typeLabel = w.workout_type
      ? w.workout_type.charAt(0).toUpperCase() + w.workout_type.slice(1)
      : "Workout";

    let metaText = `${typeLabel} • ${dateStr}`;
    if (w.difficulty) {
      const diffLabel =
        w.difficulty.charAt(0).toUpperCase() + w.difficulty.slice(1);
      metaText += ` • ${diffLabel}`;
    }
    if (w.duration_min) {
      metaText += ` • ${w.duration_min} min`;
    }

    meta.textContent = metaText;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const completedCheckbox = document.createElement("input");
    completedCheckbox.type = "checkbox";
    completedCheckbox.checked = w.completed || false;
    completedCheckbox.classList.add("workout-completed-checkbox");

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("workout-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(completedCheckbox);
    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    if (w.notes) {
      const notes = document.createElement("div");
      notes.textContent = w.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    workoutsList.appendChild(li);
  }
}

//
// Progress helpers
//
function setProgressFamilyState() {
  if (!progressNoFamily || !progressHasFamily) return;

  if (currentFamilyId) {
    progressNoFamily.style.display = "none";
    progressHasFamily.style.display = "block";
  } else {
    progressNoFamily.style.display = "block";
    progressHasFamily.style.display = "none";
    if (progressList) progressList.innerHTML = "";
    if (progressMessage) {
      progressMessage.textContent = "";
      progressMessage.style.color = "";
    }
  }
}

async function loadProgressLogs() {
  if (!currentFamilyId || !progressList) return;

  if (progressMessage) {
    progressMessage.textContent = "";
    progressMessage.style.color = "";
  }
  progressList.innerHTML = "<li>Loading progress...</li>";

  const { data, error } = await supabase
    .from("progress_logs")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("log_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading progress logs:", error);
    progressList.innerHTML = "<li>Could not load progress.</li>";
  } else {
    renderProgressLogs(data || []);
  }
}

function renderProgressLogs(items) {
  if (!progressList) return;

  if (!items.length) {
    progressList.innerHTML = "<li>No progress entries yet. Add one above!</li>";
    return;
  }

  progressList.innerHTML = "";

  for (const p of items) {
    const li = document.createElement("li");
    li.dataset.progressId = p.id;
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
    const dateStr = p.log_date;
    title.textContent = `Progress • ${dateStr}`;
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const parts = [];
    if (p.weight_lb != null) parts.push(`${p.weight_lb} lb`);
    if (p.water_oz != null) parts.push(`${p.water_oz} oz water`);
    if (p.sleep_hours != null) parts.push(`${p.sleep_hours} hrs sleep`);
    if (p.steps != null) parts.push(`${p.steps} steps`);
    if (p.mood) parts.push(`Mood: ${p.mood}`);

    meta.textContent = parts.join(" • ") || "No metrics recorded";

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("progress-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    if (p.notes) {
      const notes = document.createElement("div");
      notes.textContent = p.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    progressList.appendChild(li);
  }
}

//
// AI Coach helpers
//
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
async function loadCoachHistory() {
  if (!coachMessages) return;

  // Clear current view
  coachMessages.innerHTML = "";

  // No family group yet -> generic welcome
  if (!currentFamilyId || !currentUser) {
    appendCoachMessage(
      "assistant",
      "I’m your AI Coach. Once you’re connected to a family, I’ll remember what we discuss."
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
      "I’m your AI Coach. Ask me anything about meals, workouts, or progress, or use the 7-Day Plan button."
    );
    return;
  }

  for (const msg of data) {
    const role = msg.role === "user" ? "user" : "assistant";
    appendCoachMessage(role, msg.content);
  }
}

// Log a single coach message to Supabase
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

// === Workout type normalizer (currently unused but kept for future) ===
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

// === Difficulty normalizer based on UI select options ===
const UI_DIFFICULTIES = workoutDifficultyInput
  ? Array.from(workoutDifficultyInput.options)
      .map((opt) => opt.value)
      .filter((v) => v && v.trim().length > 0)
  : [];

function normalizeDifficulty(raw) {
  if (!raw || !UI_DIFFICULTIES.length) return null;
  const v = String(raw).toLowerCase().trim();

  const direct = UI_DIFFICULTIES.find(
    (opt) => opt.toLowerCase() === v
  );
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

// === APPLY COACH UPDATES (overwrite plan range) ===
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
    if (mealDates.length > 0) {
      const { error: deleteMealsError } = await supabase
        .from("family_meals")
        .delete()
        .eq("family_group_id", currentFamilyId)
        .in("meal_date", mealDates);

      if (deleteMealsError) {
        console.error(
          "Error deleting existing meals for plan range:",
          deleteMealsError
        );
      }
    }

    if (Array.isArray(updates.meals) && updates.meals.length > 0) {
      const mealRows = updates.meals
        .map((m) => {
          const mealDate = m.meal_date || m.date;
          const mealType = m.meal_type || m.type || "dinner";
          const title = m.title;
          if (!mealDate || !title) return null;

          return {
            family_group_id: currentFamilyId,
            added_by: currentUser.id,
            meal_date: mealDate,
            meal_type: mealType,
            title,
            notes: m.notes ? `[AI Coach] ${m.notes}` : "[AI Coach]",
          };
        })
        .filter(Boolean);

      if (mealRows.length > 0) {
        const { error } = await supabase.from("family_meals").insert(mealRows);
        if (error) {
          console.error("Error inserting meals from AI coach:", error);
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

          const safeDifficulty = normalizeDifficulty(w.difficulty);

          return {
            family_group_id: currentFamilyId,
            added_by: currentUser.id,
            workout_date: workoutDate,
            title,
            workout_type: SAFE_WORKOUT_TYPE,
            difficulty: safeDifficulty,
            duration_min:
              w.duration_min != null ? w.duration_min : w.duration || null,
            notes: w.notes ? `[AI Coach] ${w.notes}` : "[AI Coach]",
          };
        })
        .filter(Boolean);

      console.log("Workout rows for AI coach (with safe type):", workoutRows);

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
  } catch (err) {
    console.error("Error applying AI coach updates:", err);
  }
}

// Format AI coach reply so we don't show raw JSON/code blocks to the user
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

// AI Coach: call Supabase Edge Function
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

//
// On page load: check if user is logged in
//
async function init() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (session?.user) {
    currentUser = session.user;
    await loadUserProfile(currentUser);
    await loadFamilyState(currentUser);
    showApp();
  } else {
    currentUser = null;
    currentFamilyId = null;
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    showAuth();
  }
}

//
// Load profile from Supabase and update UI
//
async function loadUserProfile(user) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile:", error);
    welcomeText.textContent = `Welcome, ${user.email}`;
    return;
  }

  if (!profile) {
    const { data: newProfile, error: insertError } = await supabase
      .from("profiles")
      .insert({
        user_id: user.id,
        display_name: user.email,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating profile:", insertError);
      welcomeText.textContent = `Welcome, ${user.email}`;
      return;
    }

    welcomeText.textContent = `Welcome, ${
      newProfile.display_name || user.email
    }`;
    return;
  }

  welcomeText.textContent = `Welcome, ${profile.display_name || user.email}`;
}

//
// SIGN UP handler
//
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupMessage.textContent = "";

  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  const displayName = signupDisplayName.value.trim();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    console.error(error);
    signupMessage.textContent = error.message;
    signupMessage.style.color = "red";
    return;
  }

  signupMessage.textContent =
    "Account created! If email confirmation is required, check your inbox, then log in.";
  signupMessage.style.color = "limegreen";
  signupForm.reset();
});

//
// LOGIN handler
//
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMessage.textContent = "";

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error(error);
    loginMessage.textContent = error.message;
    loginMessage.style.color = "red";
    return;
  }

  const user = data.user;
  if (user) {
    currentUser = user;
    await loadUserProfile(user);
    await loadFamilyState(user);
    showApp();
    loginForm.reset();
    loginMessage.textContent = "";
  }
});

//
// TAB SWITCHING
//
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.tab;

    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    tabPanels.forEach((panel) => {
      if (panel.id === targetId) {
        panel.style.display = "block";
      } else {
        panel.style.display = "none";
      }
    });
  });
});

//
// Load family group info and show appropriate UI
//
async function loadFamilyState(user) {
  familyStatus.innerHTML = "Loading family info...";
  currentFamilyId = null;
  setGroceryFamilyState();
  setMealsFamilyState();
  setWorkoutsFamilyState();
  setProgressFamilyState();

  const { data: memberships, error } = await supabase
    .from("family_members")
    .select("id, role, family_group_id, family_groups(name)")
    .eq("user_id", user.id);

  if (error) {
    console.error("Error loading family memberships:", error);
    familyStatus.innerHTML = "<p>Could not load family info.</p>";
    await loadCoachHistory();
    return;
  }

  if (!memberships || memberships.length === 0) {
    familyStatus.innerHTML = `
      <div class="card">
        <h3>No family group yet</h3>
        <p>Create a family group so you can share meal plans, workouts, and grocery lists.</p>
        <button id="create-family-btn">Create Family Group</button>
      </div>
    `;

    const createBtn = document.getElementById("create-family-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => handleCreateFamily(user));
    }

    currentFamilyId = null;
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    await loadCoachHistory();
  } else {
    const m = memberships[0];
    const familyName = m.family_groups?.name || "Your Family Group";
    const role = m.role;

    currentFamilyId = m.family_group_id;

    familyStatus.innerHTML = `
      <div class="card">
        <h3>${familyName}</h3>
        <p>Role: <strong>${role}</strong></p>
        <p>You’re connected! Future UI will show members, invites, etc.</p>
      </div>
    `;

    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();

    await loadGroceryItems();
    await loadMeals();
    await loadWorkouts();
    await loadProgressLogs();
    await loadCoachHistory();
  }
}

//
// Create family group
//
async function handleCreateFamily(user) {
  const name = window.prompt(
    "Enter a name for your family group:",
    "Steiner Family Health"
  );

  if (!name || !name.trim()) {
    return;
  }

  const { data: family, error: familyError } = await supabase
    .from("family_groups")
    .insert({
      name: name.trim(),
      created_by: user.id,
    })
    .select()
    .single();

  if (familyError) {
    console.error("Error creating family group:", familyError);
    alert("There was an error creating the family group.");
    return;
  }

  const { error: memberError } = await supabase.from("family_members").insert({
    family_group_id: family.id,
    user_id: user.id,
    role: "admin",
  });

  if (memberError) {
    console.error("Error creating family membership:", memberError);
    alert(
      "Family was created, but we could not link your account. Please contact support (you)."
    );
    return;
  }

  currentFamilyId = family.id;
  await loadFamilyState(user);
  alert("Family group created successfully!");
}

//
// ADD GROCERY ITEM
//
if (groceryForm) {
  groceryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (groceryMessage) {
      groceryMessage.textContent = "";
      groceryMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (groceryMessage) {
        groceryMessage.textContent = "You need a family group to add items.";
        groceryMessage.style.color = "red";
      }
      return;
    }

    const name = groceryName.value.trim();
    const quantity = groceryQuantity.value.trim();
    const category = groceryCategory.value.trim();

    if (!name) return;

    const { error } = await supabase.from("grocery_list_items").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      name,
      quantity: quantity || null,
      category: category || null,
    });

    if (error) {
      console.error("Error adding grocery item:", error);
      if (groceryMessage) {
        groceryMessage.textContent = "Error adding item.";
        groceryMessage.style.color = "red";
      }
      return;
    }

    groceryForm.reset();
    await loadGroceryItems();
  });
}

//
// GROCERY: TOGGLE CHECK + DELETE
//
if (groceryList) {
  groceryList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const itemId = li.dataset.itemId;
    if (!itemId) return;

    // Toggle checked
    if (e.target.classList.contains("grocery-checkbox")) {
      const checked = e.target.checked;

      const { error } = await supabase
        .from("grocery_list_items")
        .update({ checked, updated_at: new Date().toISOString() })
        .eq("id", itemId);

      if (error) {
        console.error("Error updating grocery item:", error);
        return;
      }

      await loadGroceryItems();
      return;
    }

    // DELETE WITHOUT CONFIRM
    if (e.target.classList.contains("grocery-delete")) {
      const { error } = await supabase
        .from("grocery_list_items")
        .delete()
        .eq("id", itemId);

      if (error) {
        console.error("Error deleting grocery item:", error);
        return;
      }

      await loadGroceryItems();
      return;
    }
  });
}

//
// ADD MEAL
//
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

    if (!dateValue || !mealType || !title) {
      return;
    }

    const { error } = await supabase.from("family_meals").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      meal_date: dateValue,
      meal_type: mealType,
      title,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding meal:", error);
      if (mealsMessage) {
        mealsMessage.textContent = "Error adding meal.";
        mealsMessage.style.color = "red";
      }
      return;
    }

    mealsForm.reset();
    await loadMeals();
  });
}

//
// MEALS: DELETE
//
if (mealsList) {
  mealsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const mealId = li.dataset.mealId;
    if (!mealId) return;

    if (e.target.classList.contains("meal-delete")) {
      const { error } = await supabase
        .from("family_meals")
        .delete()
        .eq("id", mealId);

      if (error) {
        console.error("Error deleting meal:", error);
        return;
      }

      await loadMeals();
      return;
    }
  });
}

//
// ADD WORKOUT
//
if (workoutsForm) {
  workoutsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (workoutsMessage) {
      workoutsMessage.textContent = "";
      workoutsMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (workoutsMessage) {
        workoutsMessage.textContent =
          "You need a family group to add workouts.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    const dateValue = workoutDateInput.value;
    const title = workoutTitleInput.value.trim();
    const workoutType = workoutTypeInput.value;
    const difficulty = workoutDifficultyInput.value || null;
    const durationRaw = workoutDurationInput.value;
    const durationMin = durationRaw ? Number(durationRaw) : null;
    const notes = workoutNotesInput.value.trim();

    if (!dateValue || !title || !workoutType) {
      return;
    }

    const { error } = await supabase.from("family_workouts").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      workout_date: dateValue,
      title,
      workout_type: workoutType,
      difficulty,
      duration_min: durationMin,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding workout:", error);
      if (workoutsMessage) {
        workoutsMessage.textContent = "Error adding workout.";
        workoutsMessage.style.color = "red";
      }
      return;
    }

    workoutsForm.reset();
    await loadWorkouts();
  });
}

//
// WORKOUTS: TOGGLE COMPLETED + DELETE
//
if (workoutsList) {
  workoutsList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const workoutId = li.dataset.workoutId;
    if (!workoutId) return;

    if (e.target.classList.contains("workout-completed-checkbox")) {
      const completed = e.target.checked;

      const { error } = await supabase
        .from("family_workouts")
        .update({ completed, updated_at: new Date().toISOString() })
        .eq("id", workoutId);

      if (error) {
        console.error("Error updating workout:", error);
        return;
      }

      await loadWorkouts();
      return;
    }

    if (e.target.classList.contains("workout-delete")) {
      const { error } = await supabase
        .from("family_workouts")
        .delete()
        .eq("id", workoutId);

      if (error) {
        console.error("Error deleting workout:", error);
        return;
      }

      await loadWorkouts();
      return;
    }
  });
}

//
// ADD PROGRESS ENTRY
//
if (progressForm) {
  progressForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (progressMessage) {
      progressMessage.textContent = "";
      progressMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (progressMessage) {
        progressMessage.textContent = "You need a family group to log progress.";
        progressMessage.style.color = "red";
      }
      return;
    }

    const dateValue = progressDateInput.value;
    if (!dateValue) return;

    const weightRaw = progressWeightInput.value;
    const waterRaw = progressWaterInput.value;
    const sleepRaw = progressSleepInput.value;
    const stepsRaw = progressStepsInput.value;
    const mood = progressMoodInput.value.trim();
    const notes = progressNotesInput.value.trim();

    const weight = weightRaw ? Number(weightRaw) : null;
    const water = waterRaw ? Number(waterRaw) : null;
    const sleep = sleepRaw ? Number(sleepRaw) : null;
    const steps = stepsRaw ? Number(stepsRaw) : null;

    const { error } = await supabase.from("progress_logs").insert({
      family_group_id: currentFamilyId,
      user_id: currentUser.id,
      log_date: dateValue,
      weight_lb: weight,
      water_oz: water,
      sleep_hours: sleep,
      steps: steps,
      mood: mood || null,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding progress entry:", error);
      if (progressMessage) {
        progressMessage.textContent = "Error adding progress.";
        progressMessage.style.color = "red";
      }
      return;
    }

    progressForm.reset();
    await loadProgressLogs();
  });
}

//
// PROGRESS: DELETE
//
if (progressList) {
  progressList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const progressId = li.dataset.progressId;
    if (!progressId) return;

    if (e.target.classList.contains("progress-delete")) {
      const { error } = await supabase
        .from("progress_logs")
        .delete()
        .eq("id", progressId);

      if (error) {
        console.error("Error deleting progress entry:", error);
        return;
      }

      await loadProgressLogs();
      return;
    }
  });
}

//
// AI COACH: chat submit
//
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

//
// AI COACH: Generate 7-Day Plan
//
if (coachGenerateWeek) {
  coachGenerateWeek.addEventListener("click", async () => {
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
  });
}

//
// LOGOUT handler
//
logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  currentUser = null;
  currentFamilyId = null;
  setGroceryFamilyState();
  setMealsFamilyState();
  setWorkoutsFamilyState();
  setProgressFamilyState();
  if (coachMessages) {
    coachMessages.innerHTML = "";
  }
  showAuth();
});

//
// Init on load
//
init();
