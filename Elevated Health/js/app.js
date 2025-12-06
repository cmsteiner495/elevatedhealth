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
  mobilePageTitle,
  mobileOverline,
  profileAvatar,
  tabButtons,
  tabPanels,
  coachMessages,
  mealDateInput,
  mealTypeInput,
  workoutDateInput,
  progressDateInput,
  quickAddButton,
  quickSheetBackdrop,
  quickSheetActionButtons,
  moreNavButton,
  moreMenuBackdrop,
  moreMenuItems,
  settingsEmailLabel,
  installHelperButton,
  settingsInstallButton,
} from "./dom.js";
import {
  currentUser,
  setCurrentUser,
  setCurrentFamilyId,
  setSelectedDate,
  selectedDate,
  onSelectedDateChange,
} from "./state.js";
import { setGroceryFamilyState } from "./grocery.js";
import { setMealsFamilyState } from "./meals.js";
import { setWorkoutsFamilyState } from "./workouts.js";
import { setProgressFamilyState } from "./progress.js";
import { loadFamilyState } from "./family.js";
import { initCoachHandlers } from "./coach.js";
import { initDiary } from "./logDiary.js";
import {
  initAIDinnerCards,
  initModal,
  initThemeToggle,
  openModal,
} from "./ui.js";

console.log(
  "EH app.js VERSION 5.1 (nav refresh + central log tab + desktop FAB menu)"
);

initThemeToggle();
initModal();
initAIDinnerCards();

// Show / hide auth vs app

function showAuth() {
  if (authSection) authSection.style.display = "block";
  if (appSection) appSection.style.display = "none";
}

function showApp() {
  if (authSection) authSection.style.display = "none";
  if (appSection) appSection.style.display = "block";
}

const TAB_TITLE_MAP = {
  "dashboard-tab": "Overview",
  "log-tab": "Log",
  "meals-tab": "Meals",
  "workouts-tab": "Workouts",
  "grocery-tab": "Grocery",
  "progress-tab": "Progress",
  "family-tab": "Family",
  "coach-tab": "Coach",
  "settings-tab": "Settings",
};

let activeTabId = "dashboard-tab";
let displayNameValue = "";

function getDisplayName() {
  return (
    displayNameValue ||
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.fullName ||
    currentUser?.user_metadata?.name ||
    currentUser?.email ||
    "there"
  );
}

function deriveFirstName() {
  const metaFullName =
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.fullName ||
    currentUser?.user_metadata?.name;

  const source = metaFullName || displayNameValue || currentUser?.email || "there";
  const isEmail = source.includes("@");
  const emailPart = isEmail ? source.split("@")[0] : source;
  const withoutSeparators = emailPart.split(/[._]/)[0] || emailPart;
  const firstWord = withoutSeparators.trim().split(/\s+/)[0] || "there";
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

function updateAvatar(initialsSource) {
  if (!profileAvatar) return;
  const base = initialsSource || getDisplayName();
  const initial = base?.trim().charAt(0)?.toUpperCase() || "U";
  profileAvatar.textContent = initial;
  profileAvatar.setAttribute("aria-label", `Profile for ${base}`);
}

function updateWelcomeCopy() {
  const firstName = deriveFirstName();
  if (welcomeText) {
    welcomeText.textContent = `Welcome, ${firstName}`;
  }
}

function updateMobileHeader(targetId = activeTabId) {
  if (targetId) {
    activeTabId = targetId;
  }
  if (mobilePageTitle) {
    if (targetId === "dashboard-tab") {
      const firstName = deriveFirstName();
      mobilePageTitle.textContent = `Welcome, ${firstName}`;
    } else {
      mobilePageTitle.textContent = TAB_TITLE_MAP[targetId] || "";
    }
  }
  if (mobileOverline) {
    if (targetId === "dashboard-tab") {
      mobileOverline.textContent = "Today";
      mobileOverline.style.visibility = "visible";
    } else {
      mobileOverline.textContent = "";
      mobileOverline.style.visibility = "hidden";
    }
  }
}

function updateSettingsEmail(email) {
  if (settingsEmailLabel) {
    settingsEmailLabel.textContent = email || "you@example.com";
  }
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
    displayNameValue =
      currentUser?.user_metadata?.full_name ||
      currentUser?.user_metadata?.fullName ||
      currentUser?.user_metadata?.name ||
      user.email;
    updateWelcomeCopy();
    updateAvatar(displayNameValue);
    updateMobileHeader(activeTabId);
    updateSettingsEmail(user.email);
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
      displayNameValue =
        currentUser?.user_metadata?.full_name ||
        currentUser?.user_metadata?.fullName ||
        currentUser?.user_metadata?.name ||
        user.email;
      updateWelcomeCopy();
      updateAvatar(displayNameValue);
      updateMobileHeader(activeTabId);
      updateSettingsEmail(user.email);
      return;
    }

    displayNameValue =
      newProfile.display_name ||
      currentUser?.user_metadata?.full_name ||
      currentUser?.user_metadata?.fullName ||
      currentUser?.user_metadata?.name ||
      user.email;
    updateWelcomeCopy();
    updateAvatar(displayNameValue);
    updateMobileHeader(activeTabId);
    updateSettingsEmail(user.email);
    return;
  }

  displayNameValue =
    profile.display_name ||
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.fullName ||
    currentUser?.user_metadata?.name ||
    user.email;
  updateWelcomeCopy();
  updateAvatar(displayNameValue);
  updateMobileHeader(activeTabId);
  updateSettingsEmail(profile.display_name || user.email);
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
  activeTabId = targetId;

  tabButtons.forEach((btn) => {
    const btnTab = btn.dataset.tab;
    if (!btnTab) return;
    btn.classList.toggle("active", btnTab === targetId);
  });

  tabPanels.forEach((panel) => {
    const isTarget = panel.id === targetId;
    panel.classList.toggle("is-active", isTarget);
    panel.style.display = isTarget ? "block" : "none";
  });

  if (targetId !== "settings-tab") {
    closeMoreMenu();
  }

  updateMobileHeader(targetId);
}

function syncDateInputs(dateValue) {
  if (mealDateInput) mealDateInput.value = dateValue;
  if (workoutDateInput) workoutDateInput.value = dateValue;
  if (progressDateInput) progressDateInput.value = dateValue;
}

// Helper: highlight a section on the Log tab

function focusLogSection(sectionKey) {
  activateTab("log-tab");

  const allCards = document.querySelectorAll(".diary-section");
  allCards.forEach((c) => c.classList.remove("log-card-highlight"));

  const targetKeyMap = {
    meal: "breakfast",
    workout: "exercise",
    exercise: "exercise",
    progress: "exercise",
  };
  const targetKey = targetKeyMap[sectionKey] || sectionKey;
  const target = document.querySelector(
    `.diary-section[data-section="${targetKey}"]`
  );
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

document.addEventListener("diary:add", (event) => {
  const { section, date } = event.detail || {};
  if (!section || !date) return;

  if (section === "exercise") {
    activateTab("workouts-tab");
    if (workoutDateInput) workoutDateInput.value = date;
    return;
  }

  activateTab("meals-tab");
  if (mealDateInput) mealDateInput.value = date;
  if (mealTypeInput) mealTypeInput.value = section;
});

// QUICK ACTION SHEET + DESKTOP FAB MENU

function openMoreMenu() {
  if (!moreMenuBackdrop || !moreNavButton) return;
  moreMenuBackdrop.classList.add("is-open");
  moreMenuBackdrop.setAttribute("aria-hidden", "false");
  moreNavButton.setAttribute("aria-expanded", "true");
  moreNavButton.classList.add("active");
}

function closeMoreMenu() {
  if (!moreMenuBackdrop || !moreNavButton) return;
  moreMenuBackdrop.classList.remove("is-open");
  moreMenuBackdrop.setAttribute("aria-hidden", "true");
  moreNavButton.setAttribute("aria-expanded", "false");
  moreNavButton.classList.remove("active");
}

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
  document.body.classList.add("sheet-open");
}

function closeQuickSheet() {
  if (!quickSheetBackdrop) return;
  quickSheetBackdrop.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
}

if (moreNavButton) {
  moreNavButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const isOpen = moreMenuBackdrop?.classList.contains("is-open");
    if (isOpen) {
      closeMoreMenu();
    } else {
      openMoreMenu();
    }
  });
}

if (moreMenuBackdrop) {
  moreMenuBackdrop.addEventListener("click", (e) => {
    if (e.target === moreMenuBackdrop) {
      closeMoreMenu();
    }
  });
}

if (moreMenuItems && moreMenuItems.length) {
  moreMenuItems.forEach((item) => {
    item.addEventListener("click", () => {
      const target = item.dataset.menuTarget;
      if (target === "settings") {
        closeMoreMenu();
        setTimeout(() => activateTab("settings-tab"), 160);
        return;
      }
      closeMoreMenu();
    });
  });
}

function detectPlatform() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

function showInstallHelper() {
  const platform = detectPlatform();
  const copy = {
    ios: {
      intro: "Install Elevated Health to launch it like a native app on iPhone.",
      steps: [
        "Tap the Share icon in Safari.",
        "Choose 'Add to Home Screen'.",
        "Confirm to place the Elevated Health icon on your Home Screen.",
      ],
    },
    android: {
      intro: "Install Elevated Health from Chrome for quick access.",
      steps: [
        "Open the Chrome menu (⋮).",
        "Tap 'Install app' or 'Add to Home screen'.",
        "Accept the prompt to save Elevated Health.",
      ],
    },
    desktop: {
      intro:
        "Save Elevated Health as an app from your browser for a focused window.",
      steps: [
        "Open your browser menu and choose the Install/Save as app option.",
        "Name the shortcut and confirm.",
        "Pin the new app to your dock or taskbar for easy access.",
      ],
    },
  };

  const content = document.createElement("div");
  content.className = "install-helper-body";
  const intro = document.createElement("p");
  intro.textContent = copy[platform].intro;
  const steps = document.createElement("ol");
  steps.className = "install-helper-steps";
  copy[platform].steps.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    steps.appendChild(li);
  });
  content.appendChild(intro);
  content.appendChild(steps);

  openModal({
    title: "Install Elevated Health",
    body: content,
    primaryLabel: null,
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMoreMenu();
  }
});

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

[installHelperButton, settingsInstallButton].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener("click", () => {
    showInstallHelper();
  });
});

document.querySelectorAll("[data-placeholder-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const isActive = btn.getAttribute("aria-pressed") === "true";
    const next = !isActive;
    btn.setAttribute("aria-pressed", String(next));
    const label = btn.querySelector(".switch-label");
    if (label) {
      label.textContent = next ? "On" : "Off";
    }
  });
});

onSelectedDateChange((dateValue) => {
  syncDateInputs(dateValue);
});
syncDateInputs(selectedDate);

if (mealDateInput) {
  mealDateInput.addEventListener("change", (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
  });
}

if (workoutDateInput) {
  workoutDateInput.addEventListener("change", (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
  });
}

if (progressDateInput) {
  progressDateInput.addEventListener("change", (e) => {
    if (e.target.value) setSelectedDate(e.target.value);
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
initDiary();
init();
