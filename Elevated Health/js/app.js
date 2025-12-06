// js/app.js
import { supabase } from "./supabaseClient.js";
import {
  authSection,
  appSection,
  signupForm,
  signupEmail,
  signupPassword,
  signupDisplayName,
  signupMessage,
  loginForm,
  loginEmail,
  loginPassword,
  loginMessage,
  logoutButton,
  welcomeText,
  tabButtons,
  tabPanels,
  coachMessages,
  mealDateInput,
  mealTypeInput,
  workoutDateInput,
  progressDateInput,
  progressWaterInput,
  progressNotesInput,
  quickAddButton,
  quickSheetBackdrop,
  quickSheetActionButtons,
} from "./dom.js";
import {
  currentUser,
  setCurrentUser,
  setCurrentFamilyId,
} from "./state.js";
import { setGroceryFamilyState } from "./grocery.js";
import { setMealsFamilyState } from "./meals.js";
import { setWorkoutsFamilyState } from "./workouts.js";
import { setProgressFamilyState } from "./progress.js";
import { loadFamilyState } from "./family.js";
import { initCoachHandlers } from "./coach.js";

console.log(
  "EH app.js VERSION 5.2 (Diary log layout + date navigation)"
);

// Diary state
let diarySelectedDate = new Date();

const diaryDateDisplay = document.getElementById("diary-date-display");
const diaryPrevButton = document.getElementById("diary-prev-day");
const diaryNextButton = document.getElementById("diary-next-day");
const diaryTodayButton = document.getElementById("diary-today");
const diaryAddButtons = document.querySelectorAll(".diary-add");

const diaryLists = {
  breakfast: document.getElementById("diary-breakfast-list"),
  lunch: document.getElementById("diary-lunch-list"),
  dinner: document.getElementById("diary-dinner-list"),
  snacks: document.getElementById("diary-snacks-list"),
  exercise: document.getElementById("diary-exercise-list"),
  water: document.getElementById("diary-water-list"),
  notes: document.getElementById("diary-notes-list"),
};

function formatDateForInput(dateObj) {
  return dateObj.toISOString().split("T")[0];
}

function formatDiaryLabel(dateObj) {
  return dateObj.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function updateDiaryDateUI() {
  if (diaryDateDisplay) {
    diaryDateDisplay.textContent = formatDiaryLabel(diarySelectedDate);
  }
}

function setDiaryListsMessage(message) {
  Object.values(diaryLists).forEach((listEl) => {
    if (!listEl) return;
    listEl.innerHTML = `<li class="diary-empty">${message}</li>`;
  });
}

function renderDiaryList(listEl, items, builder, emptyText) {
  if (!listEl) return;
  if (!items || !items.length) {
    listEl.innerHTML = `<li class="diary-empty">${emptyText}</li>`;
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "diary-entry";
    builder(li, item);
    listEl.appendChild(li);
  });
}

async function loadDiaryEntries() {
  if (!diaryLists.breakfast) return;

  const isoDate = formatDateForInput(diarySelectedDate);

  if (!currentUser) {
    setDiaryListsMessage("Log in to see your diary.");
    return;
  }

  if (!currentFamilyId) {
    setDiaryListsMessage("Create a family group to start logging.");
    return;
  }

  setDiaryListsMessage("Loading…");

  const [{ data: meals, error: mealsError }, { data: workouts, error: workoutsError }, { data: progress, error: progressError },] =
    await Promise.all([
      supabase
        .from("family_meals")
        .select("*")
        .eq("family_group_id", currentFamilyId)
        .eq("meal_date", isoDate)
        .order("created_at", { ascending: true }),
      supabase
        .from("family_workouts")
        .select("*")
        .eq("family_group_id", currentFamilyId)
        .eq("workout_date", isoDate)
        .order("created_at", { ascending: true }),
      supabase
        .from("progress_logs")
        .select("*")
        .eq("family_group_id", currentFamilyId)
        .eq("log_date", isoDate)
        .order("created_at", { ascending: true }),
    ]);

  if (mealsError || workoutsError || progressError) {
    console.error("Error loading diary:", mealsError || workoutsError || progressError);
  }

  const safeMeals = meals || [];
  const safeWorkouts = workouts || [];
  const safeProgress = progress || [];

  const mealTypes = [
    ["breakfast", "breakfast"],
    ["lunch", "lunch"],
    ["dinner", "dinner"],
    ["snacks", "snack"],
  ];

  mealTypes.forEach(([sectionKey, mealType]) => {
    const listEl = diaryLists[sectionKey];
    const entries = safeMeals.filter(
      (m) => (m.meal_type || "").toLowerCase() === mealType,
    );
    renderDiaryList(
      listEl,
      entries,
      (li, meal) => {
        const title = document.createElement("div");
        title.className = "diary-entry-title";
        title.textContent = meal.title;

        const meta = document.createElement("div");
        meta.className = "diary-entry-meta";
        meta.textContent = meal.notes || "No notes";

        li.appendChild(title);
        li.appendChild(meta);
      },
      `No ${sectionKey} logged yet.`,
    );
  });

  renderDiaryList(
    diaryLists.exercise,
    safeWorkouts,
    (li, workout) => {
      const title = document.createElement("div");
      title.className = "diary-entry-title";
      title.textContent = workout.title || "Workout";

      const meta = document.createElement("div");
      meta.className = "diary-entry-meta";
      const parts = [];
      if (workout.workout_type) {
        const label =
          workout.workout_type.charAt(0).toUpperCase() +
          workout.workout_type.slice(1);
        parts.push(label);
      }
      if (workout.duration_min) {
        parts.push(`${workout.duration_min} min`);
      }
      meta.textContent = parts.join(" • ") || "Scheduled";

      li.appendChild(title);
      li.appendChild(meta);
    },
    "No exercise logged yet.",
  );

  const waterEntries = safeProgress.filter((p) => p.water_oz != null);
  renderDiaryList(
    diaryLists.water,
    waterEntries,
    (li, entry) => {
      const title = document.createElement("div");
      title.className = "diary-entry-title";
      title.textContent = `${entry.water_oz} oz`;

      const meta = document.createElement("div");
      meta.className = "diary-entry-meta";
      const parts = [];
      if (entry.weight_lb != null) parts.push(`${entry.weight_lb} lb`);
      if (entry.steps != null) parts.push(`${entry.steps} steps`);
      meta.textContent = parts.join(" • ") || "Logged in progress";

      li.appendChild(title);
      li.appendChild(meta);
    },
    "No water logged yet.",
  );

  const noteEntries = safeProgress.filter((p) => p.notes);
  renderDiaryList(
    diaryLists.notes,
    noteEntries,
    (li, entry) => {
      const title = document.createElement("div");
      title.className = "diary-entry-title";
      title.textContent = "Note";

      const meta = document.createElement("div");
      meta.className = "diary-entry-meta";
      meta.textContent = entry.notes;

      li.appendChild(title);
      li.appendChild(meta);
    },
    "No notes yet.",
  );
}

function syncFormsToDiaryDate() {
  const isoDate = formatDateForInput(diarySelectedDate);
  if (mealDateInput) mealDateInput.value = isoDate;
  if (workoutDateInput) workoutDateInput.value = isoDate;
  if (progressDateInput) progressDateInput.value = isoDate;
}

function setDiaryDate(nextDate) {
  diarySelectedDate = nextDate;
  updateDiaryDateUI();
  syncFormsToDiaryDate();
  loadDiaryEntries();
}

function handleDiaryAdd(sectionKey) {
  const isoDate = formatDateForInput(diarySelectedDate);

  switch (sectionKey) {
    case "breakfast":
    case "lunch":
    case "dinner":
    case "snacks": {
      activateTab("meals-tab");
      if (mealDateInput) mealDateInput.value = isoDate;
      if (mealTypeInput) mealTypeInput.value = sectionKey === "snacks" ? "snack" : sectionKey;
      break;
    }

    case "exercise": {
      activateTab("workouts-tab");
      if (workoutDateInput) workoutDateInput.value = isoDate;
      break;
    }

    case "water": {
      activateTab("progress-tab");
      if (progressDateInput) progressDateInput.value = isoDate;
      if (progressWaterInput) progressWaterInput.focus();
      break;
    }

    case "notes": {
      activateTab("progress-tab");
      if (progressDateInput) progressDateInput.value = isoDate;
      if (progressNotesInput) progressNotesInput.focus();
      break;
    }

    default:
      break;
  }
}

// Show / hide auth vs app

function showAuth() {
  if (authSection) authSection.style.display = "block";
  if (appSection) appSection.style.display = "none";
}

function showApp() {
  if (authSection) authSection.style.display = "none";
  if (appSection) appSection.style.display = "block";
}

// Load profile

async function loadUserProfile(user) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile:", error);
    if (welcomeText) {
      welcomeText.textContent = `Welcome, ${user.email}`;
    }
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
      if (welcomeText) {
        welcomeText.textContent = `Welcome, ${user.email}`;
      }
      return;
    }

    if (welcomeText) {
      welcomeText.textContent = `Welcome, ${
        newProfile.display_name || user.email
      }`;
    }
    return;
  }

  if (welcomeText) {
    welcomeText.textContent = `Welcome, ${profile.display_name || user.email}`;
  }
}

// Init

async function init() {
  updateDiaryDateUI();
  syncFormsToDiaryDate();

  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (session?.user) {
    setCurrentUser(session.user);
    await loadUserProfile(session.user);
    await loadFamilyState(session.user);
    setDiaryDate(new Date());
    showApp();
  } else {
    setCurrentUser(null);
    setCurrentFamilyId(null);
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    setDiaryListsMessage("Log in to see your diary.");
    showAuth();
  }
}

// Shared tab helper

function activateTab(targetId) {
  if (!targetId || !tabButtons || !tabPanels) return;

  tabButtons.forEach((btn) => {
    const btnTab = btn.dataset.tab;
    if (!btnTab) return;
    btn.classList.toggle("active", btnTab === targetId);
  });

  tabPanels.forEach((panel) => {
    panel.style.display = panel.id === targetId ? "block" : "none";
  });
  if (targetId === "log-tab") {
    updateDiaryDateUI();
    syncFormsToDiaryDate();
    loadDiaryEntries();
  }
}

// SIGN UP

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (signupMessage) {
      signupMessage.textContent = "";
      signupMessage.style.color = "";
    }

    const email = signupEmail.value.trim();
    const password = signupPassword.value;
    const displayName = signupDisplayName.value.trim();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error(error);
      if (signupMessage) {
        signupMessage.textContent = error.message;
        signupMessage.style.color = "red";
      }
      return;
    }

    if (signupMessage) {
      signupMessage.textContent =
        "Account created! If email confirmation is required, check your inbox, then log in.";
      signupMessage.style.color = "limegreen";
    }
    signupForm.reset();
  });
}

// LOGIN

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loginMessage) {
      loginMessage.textContent = "";
      loginMessage.style.color = "";
    }

    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(error);
      if (loginMessage) {
        loginMessage.textContent = error.message;
        loginMessage.style.color = "red";
      }
      return;
    }

    const user = data.user;
    if (user) {
      setCurrentUser(user);
      await loadUserProfile(user);
      await loadFamilyState(user);
      showApp();
      loginForm.reset();
      if (loginMessage) loginMessage.textContent = "";
    }
  });
}

// TAB SWITCHING (desktop + mobile nav buttons)

if (tabButtons && tabPanels) {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;
      if (!targetId) return;
      activateTab(targetId);
    });
  });
}

function shiftDiaryDate(days) {
  const next = new Date(diarySelectedDate);
  next.setDate(next.getDate() + days);
  setDiaryDate(next);
}

if (diaryPrevButton) {
  diaryPrevButton.addEventListener("click", () => shiftDiaryDate(-1));
}

if (diaryNextButton) {
  diaryNextButton.addEventListener("click", () => shiftDiaryDate(1));
}

if (diaryTodayButton) {
  diaryTodayButton.addEventListener("click", () => setDiaryDate(new Date()));
}

if (diaryAddButtons && diaryAddButtons.length) {
  diaryAddButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset.diaryAdd;
      if (!section) return;
      handleDiaryAdd(section);
    });
  });
}

// "More" tab tiles → switch to underlying tab

document.querySelectorAll(".more-tile[data-tab-target]").forEach((tile) => {
  tile.addEventListener("click", () => {
    const targetId = tile.getAttribute("data-tab-target");
    if (!targetId) return;
    activateTab(targetId);
  });
});

// QUICK ACTION SHEET + DESKTOP FAB MENU

// Desktop floating FAB + vertical menu
const desktopQuickFab = document.getElementById("desktop-quick-fab");
const desktopFabMenu = document.getElementById("desktop-fab-menu");
const desktopFabMenuButtons = desktopFabMenu
  ? desktopFabMenu.querySelectorAll(".desktop-fab-menu-item")
  : [];

// Mobile bottom-sheet helpers
function openQuickSheet() {
  if (!quickSheetBackdrop) return;
  quickSheetBackdrop.classList.add("is-open");
}

function closeQuickSheet() {
  if (!quickSheetBackdrop) return;
  quickSheetBackdrop.classList.remove("is-open");
}

// Desktop FAB open/close helper
function setDesktopFabMenuOpen(isOpen) {
  if (!desktopQuickFab || !desktopFabMenu) return;
  desktopQuickFab.classList.toggle("is-open", isOpen);
  desktopFabMenu.classList.toggle("is-open", isOpen);
}

function handleQuickAction(action) {
  switch (action) {
    case "log-meal":
      handleDiaryAdd("dinner");
      break;

    case "log-water":
      handleDiaryAdd("water");
      break;

    case "log-weight":
      activateTab("progress-tab");
      if (progressDateInput)
        progressDateInput.value = formatDateForInput(diarySelectedDate);
      break;

    case "log-exercise":
      handleDiaryAdd("exercise");
      break;

    case "barcode":
    case "meal-scan":
      activateTab("log-tab");
      alert("Barcode & Meal Scan are coming soon.");
      break;

    default:
      activateTab("log-tab");
      break;
  }

  closeQuickSheet();
}

// Mobile FAB (bottom nav + button)
if (quickAddButton) {
  quickAddButton.addEventListener("click", () => {
    openQuickSheet();
  });
}

// Desktop floating FAB toggles vertical menu
if (desktopQuickFab) {
  desktopQuickFab.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !desktopQuickFab.classList.contains("is-open");
    setDesktopFabMenuOpen(isOpen);
  });
}

// Desktop FAB menu buttons
if (desktopFabMenuButtons && desktopFabMenuButtons.length) {
  desktopFabMenuButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action) {
        handleQuickAction(action);
      }
      setDesktopFabMenuOpen(false);
    });
  });
}

// Close desktop FAB menu when clicking outside
document.addEventListener("click", (e) => {
  if (!desktopQuickFab || !desktopFabMenu) return;
  if (!desktopQuickFab.classList.contains("is-open")) return;

  const target = e.target;
  if (
    target === desktopQuickFab ||
    desktopQuickFab.contains(target) ||
    desktopFabMenu.contains(target)
  ) {
    return;
  }
  setDesktopFabMenuOpen(false);
});

// Tap outside mobile sheet to close
if (quickSheetBackdrop) {
  quickSheetBackdrop.addEventListener("click", (e) => {
    if (e.target === quickSheetBackdrop) {
      closeQuickSheet();
    }
  });
}

// Sheet buttons (mobile)
if (quickSheetActionButtons && quickSheetActionButtons.length) {
  quickSheetActionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      handleQuickAction(action);
    });
  });
}

// LOGOUT

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setCurrentFamilyId(null);
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    if (coachMessages) {
      coachMessages.innerHTML = "";
    }
    showAuth();
  });
}

// Init coach + app

initCoachHandlers();
init();
