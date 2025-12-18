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
  workoutDateInput,
  progressDateInput,
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
  "EH app.js VERSION 5.1 (nav refresh + central log tab + desktop FAB menu)"
);

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
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  if (session?.user) {
    setCurrentUser(session.user);
    await loadUserProfile(session.user);
    await loadFamilyState(session.user);
    showApp();
  } else {
    setCurrentUser(null);
    setCurrentFamilyId(null);
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
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
}

// Helper: highlight a section on the Log tab

function focusLogSection(sectionKey) {
  activateTab("log-tab");

  const allCards = document.querySelectorAll(".log-card");
  allCards.forEach((c) => c.classList.remove("log-card-highlight"));

  const target = document.getElementById(`log-section-${sectionKey}`);
  if (target) {
    target.classList.add("log-card-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
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

// "More" tab tiles → switch to underlying tab

document.querySelectorAll(".more-tile[data-tab-target]").forEach((tile) => {
  tile.addEventListener("click", () => {
    const targetId = tile.getAttribute("data-tab-target");
    if (!targetId) return;
    activateTab(targetId);
  });
});

// Log tab buttons → go straight to the right tab (for now)

document.querySelectorAll(".log-card-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-log-target");
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
      focusLogSection("meal");
      break;

    case "log-water":
    case "log-weight":
      focusLogSection("progress");
      break;

    case "log-exercise":
      focusLogSection("workout");
      break;

    case "barcode":
    case "meal-scan":
      activateTab("log-tab");
      alert("Barcode & Meal Scan are coming soon.");
      break;

    default:
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
