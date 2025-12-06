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
  moreMenuInstallButton,
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

function triggerAIDigestPlaceholder() {
  openModal({
    title: "AI Coach Weekly Digest",
    body: "Your personalized digest is coming soon. We'll use your meals, workouts, and progress to craft insights.",
    primaryLabel: "Got it",
  });
}

let activeTabId = "dashboard-tab";
let displayNameValue = "";
let deferredInstallPrompt = null;
let isStandaloneMode = false;
let isAppInstalled = false;
let selectedThemeStyle = "mountain";

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

const THEME_STYLES = {
  mountain: {
    name: "Mountain Blue",
    values: {
      "--color-accent-primary": "#3aa1ff",
      "--accent": "#3aa1ff",
      "--accent-blue": "#74c0ff",
      "--color-orange": "#ff6b1a",
    },
  },
  summer: {
    name: "Summer Glow",
    values: {
      "--color-accent-primary": "#ff8b3d",
      "--accent": "#ffb347",
      "--accent-blue": "#ffd089",
      "--color-orange": "#ff7a2f",
    },
  },
  winter: {
    name: "Winter Frost",
    values: {
      "--color-accent-primary": "#7fd3ff",
      "--accent": "#a8e1ff",
      "--accent-blue": "#d7f0ff",
      "--color-orange": "#5ed0ff",
    },
  },
};

function applyThemeStyle(styleKey = selectedThemeStyle) {
  const theme = THEME_STYLES[styleKey] || THEME_STYLES.mountain;
  const root = document.documentElement;
  Object.entries(theme.values).forEach(([k, v]) => {
    root.style.setProperty(k, v);
  });
  selectedThemeStyle = styleKey;
  document
    .querySelectorAll("#theme-style-chips .chip")
    .forEach((chip) => chip.classList.toggle("active", chip.dataset.themeStyle === styleKey));
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

async function calculateWorkoutStreak() {
  try {
    const today = new Date();
    const isoToday = today.toISOString().slice(0, 10);
    const targetFamily = currentFamilyId;
    if (!targetFamily) {
      const streakEl = document.getElementById("streak-count");
      if (streakEl) streakEl.textContent = "0";
      return;
    }

    const { data, error } = await supabase
      .from("family_workouts")
      .select("workout_date")
      .eq("family_group_id", targetFamily)
      .lte("workout_date", isoToday)
      .order("workout_date", { ascending: false });

    if (error) {
      console.error("Error fetching workouts for streak", error);
      return;
    }

    const uniqueDates = Array.from(
      new Set((data || []).map((w) => w.workout_date))
    ).sort((a, b) => new Date(b) - new Date(a));

    let streak = 0;
    let cursor = new Date(isoToday);

    for (const date of uniqueDates) {
      const dateObj = new Date(date);
      if (
        dateObj.toISOString().slice(0, 10) ===
        cursor.toISOString().slice(0, 10)
      ) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else if (dateObj < cursor) {
        break;
      }
    }

    const streakEl = document.getElementById("streak-count");
    if (streakEl) streakEl.textContent = `${streak}`;
  } catch (err) {
    console.error("Streak calculation failed", err);
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

async function openLogWeightModal(defaultDate) {
  const body = document.createElement("div");
  body.className = "log-weight-body";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = defaultDate || new Date().toISOString().slice(0, 10);
  const weightInput = document.createElement("input");
  weightInput.type = "number";
  weightInput.step = "0.1";
  weightInput.placeholder = "Weight";
  body.appendChild(dateInput);
  body.appendChild(weightInput);

  openModal({
    title: "Log weight",
    body,
    primaryLabel: "Save",
    onPrimary: async () => {
      const payload = {
        family_group_id: currentFamilyId,
        date: dateInput.value,
        weight: parseFloat(weightInput.value || "0") || null,
      };

      const { error } = await supabase.from("progress_logs").insert(payload);
      if (error) {
        alert("Unable to save weight right now.");
        return;
      }
      document.dispatchEvent(new CustomEvent("progress:refresh"));
    },
  });
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

document.querySelectorAll(".more-tile[data-action]").forEach((tile) => {
  tile.addEventListener("click", () => {
    if (tile.dataset.action === "download-app") {
      showInstallHelper();
    }
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

const digestButton = document.getElementById("ai-digest-trigger");
if (digestButton) {
  digestButton.addEventListener("click", triggerAIDigestPlaceholder);
}

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
      if (target) {
        closeMoreMenu();
        const tabId = target.endsWith("-tab") ? target : `${target}`;
        const resolved = target === "settings" ? "settings-tab" : tabId;
        setTimeout(() => activateTab(resolved), 160);
        return;
      }
      if (item.dataset.action === "download-app") {
        closeMoreMenu();
        showInstallHelper();
      }
    });
  });
}

function checkStandalone() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  isAppInstalled = standalone;
  return standalone;
}

function updateInstallUI() {
  const installAvailable =
    Boolean(deferredInstallPrompt) && !isStandaloneMode && !isAppInstalled;
  const showGuidance = !isStandaloneMode && !isAppInstalled;

  if (installHelperButton) {
    const showDesktopCTA = detectPlatform() === "desktop" && showGuidance;
    installHelperButton.style.display = showDesktopCTA ? "inline-flex" : "none";
  }

  if (settingsInstallButton) {
    const installCard = settingsInstallButton.closest(".install-card");
    if (installCard) {
      installCard.style.display = showGuidance ? "" : "none";
    }
    settingsInstallButton.style.display = showGuidance ? "inline-flex" : "none";
  }

  if (moreMenuInstallButton) {
    const showMobileInstall = showGuidance && detectPlatform() !== "desktop";
    moreMenuInstallButton.style.display = showMobileInstall ? "block" : "none";
    const subtitle = moreMenuInstallButton.querySelector(".more-menu-sub");
    if (subtitle) {
      subtitle.textContent = installAvailable
        ? "Add Elevated Health to your device"
        : "Use your browser's Add to Home Screen";
    }
  }
}

async function requestInstall() {
  if (isStandaloneMode) return;

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome === "accepted") {
      isStandaloneMode = true;
    }
    updateInstallUI();
    return;
  }

  showInstallHelper();
}

function initInstallState() {
  isStandaloneMode = checkStandalone();
  updateInstallUI();

  const displayModeMedia = window.matchMedia("(display-mode: standalone)");
  if (displayModeMedia?.addEventListener) {
    displayModeMedia.addEventListener("change", (evt) => {
      isStandaloneMode = evt.matches;
      isAppInstalled = evt.matches;
      updateInstallUI();
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    isStandaloneMode = true;
    isAppInstalled = true;
    updateInstallUI();
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
      focusLogSection("progress");
      break;

    case "log-weight":
      openLogWeightModal(selectedDate);
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

[
  installHelperButton,
  settingsInstallButton,
  moreMenuInstallButton,
].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (btn === moreMenuInstallButton) {
      closeMoreMenu();
    }
    await requestInstall();
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

document.querySelectorAll("#theme-style-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const styleKey = chip.dataset.themeStyle;
    applyThemeStyle(styleKey);
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

const deleteSelectors = [
  "meal-delete",
  "workout-delete",
  "grocery-delete",
  "progress-delete",
];

document.addEventListener(
  "click",
  (e) => {
    const match = deleteSelectors.find((cls) => e.target.classList?.contains(cls));
    if (!match) return;
    const li = e.target.closest("li");
    if (li) {
      li.classList.add("fade-out");
      setTimeout(() => li.remove(), 180);
    }
  },
  true
);

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

async function instantiateAppAfterInitialization() {
  initThemeToggle();
  applyThemeStyle(selectedThemeStyle);
  initModal();
  initAIDinnerCards();
  initInstallState();
  initCoachHandlers();
  initDiary();
  await init();
  await calculateWorkoutStreak();
}

instantiateAppAfterInitialization();
