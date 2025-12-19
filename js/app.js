// js/app.js
import { supabase } from "./supabaseClient.js";
import { getMeals, getWorkouts } from "./dataAdapter.js";
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
  dashboardAiShortcut,
  tabButtons,
  tabPanels,
  coachMessages,
  mealDateInput,
  mealTypeInput,
  mealTitleInput,
  mealsForm,
  mealsList,
  workoutDateInput,
  workoutTitleInput,
  workoutsForm,
  progressDateInput,
  progressForm,
  progressWaterInput,
  progressWeightInput,
  aiDinnerGrid,
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
  themeToggleButton,
  themeLabel,
  diaryPrevDayBtn,
  diaryNextDayBtn,
  diaryTodayBtn,
  diaryCalendarBtn,
  diaryDatePicker,
  diaryAddButtons,
  insightMacrosCard,
  insightCaloriesCard,
  insightWorkoutsCard,
  macrosChartCanvas,
  caloriesChartCanvas,
  workoutsChartCanvas,
  macrosEmptyState,
  caloriesEmptyState,
  workoutsEmptyState,
  streakCount,
} from "./dom.js";
import {
  currentUser,
  currentFamilyId,
  setCurrentUser,
  setCurrentFamilyId,
  setSelectedDate,
  selectedDate,
  getTodayDate,
  onSelectedDateChange,
  addDays,
  toLocalDateString,
} from "./state.js";
import { setGroceryFamilyState } from "./grocery.js";
import { loadMeals, logMealToDiary, setMealsFamilyState } from "./meals.js";
import {
  cacheWorkoutsLocally,
  getStoredWorkouts,
  setWorkoutsFamilyState,
} from "./workouts.js";
import { setProgressFamilyState } from "./progress.js";
import { loadFamilyState } from "./family.js";
import { initCoachHandlers, runWeeklyPlanGeneration } from "./coach.js";
import { initDiary, refreshDiaryForSelectedDate } from "./logDiary.js";
import {
  initAIDinnerCards,
  initModal,
  initThemeStyles,
  openModal,
  showToast,
  maybeVibrate,
} from "./ui.js";

console.log(
  "EH app.js VERSION 5.1 (nav refresh + central log tab + desktop FAB menu)"
);

// Global UI/install state
let activeTabId;
let displayNameValue;
let displayNavMenu;
let deferredInstallPrompt;
let isStandaloneMode;
let isAppInstalled;
let selectedThemeStyle;
let activeThemeMode = "dark";
let diaryRealtimeChannel;
let mealsGuidedMode = false;
let isCalendarOpen = false;
let isQuickSheetOpen = false;
let macrosChart;
let caloriesChart;
let workoutsChart;
let macrosLegendEl;
let insightsRenderLock = false;
let insightsRenderQueued = false;
let insightsResizeTimer;
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

if (typeof window !== "undefined") {
  if (!("__EH_MACROS_RENDERING__" in window)) {
    window.__EH_MACROS_RENDERING__ = false;
  }
  if (!("__EH_MACROS_RAF_ID__" in window)) {
    window.__EH_MACROS_RAF_ID__ = null;
  }
  if (!("__EH_MACROS_TIMER_ID__" in window)) {
    window.__EH_MACROS_TIMER_ID__ = null;
  }
}

const DASHBOARD_CHARTS_INIT_FLAG = "__EH_DASHBOARD_CHARTS_INIT__";

const THEME_STORAGE_KEY = "eh-theme";
// Default macro targets; adjust here to tune ring goals.
const MACRO_GOALS = {
  protein: 150,
  carbs: 200,
  fat: 70,
};
const MACRO_ORDER = ["protein", "carbs", "fat"];
const THEME_TOKEN_MAP = {
  dark: {
    "--bg-app": "#031c2c",
    "--surface-primary": "#06263d",
    "--surface-secondary": "#0a324d",
    "--surface-elevated": "#0d3a57",
    "--surface-soft": "#0b304a",
    "--text-primary": "#f4f7fb",
    "--text-muted": "rgba(244, 247, 251, 0.7)",
    "--text-soft": "rgba(244, 247, 251, 0.86)",
    "--border-subtle": "rgba(0, 154, 154, 0.35)",
    "--accent": "#00a3a3",
    "--accent-soft": "rgba(0, 163, 163, 0.22)",
    "--accent-strong": "#ff6b1a",
    "--nav-surface": "rgba(4, 6, 11, 0.96)",
    "--nav-surface-border": "rgba(255, 255, 255, 0.08)",
    "--nav-icon-color": "rgba(244, 247, 251, 0.78)",
  },
  light: {
    "--bg-app": "#eef3f6",
    "--surface-primary": "#ffffff",
    "--surface-secondary": "#f5f7fa",
    "--surface-elevated": "#ffffff",
    "--surface-soft": "#f1f4f8",
    "--text-primary": "#031c2c",
    "--text-muted": "rgba(3, 28, 44, 0.65)",
    "--text-soft": "rgba(3, 28, 44, 0.82)",
    "--border-subtle": "rgba(3, 28, 44, 0.12)",
    "--accent": "#009a9a",
    "--accent-soft": "rgba(0, 154, 154, 0.12)",
    "--accent-strong": "#ff6b1a",
    "--nav-surface": "#f8fbfd",
    "--nav-surface-border": "rgba(3, 28, 44, 0.08)",
    "--nav-icon-color": "rgba(3, 28, 44, 0.7)",
  },
};

const TAB_TITLE_MAP = {
  "dashboard-tab": "Overview",
  "log-tab": "Log",
  "meals-tab": "Meals",
  "workouts-tab": "Workouts",
  "grocery-tab": "Grocery",
  "progress-tab": "Progress",
  "family-tab": "Family",
  "coach-tab": "Ella",
  "settings-tab": "Settings",
  "more-tab": "More",
};

function getInsightPalette() {
  const styles = getComputedStyle(document.documentElement);
  const read = (token, fallback) =>
    styles.getPropertyValue(token)?.trim() || fallback;

  return {
    accent: read("--accent", "#00a3a3"),
    accentStrong: read("--accent-strong", "#ff6b1a"),
    accentBlue: read("--accent-blue", "#4aa5ff"),
    textMuted: read("--text-muted", "#7aa0b8"),
    grid: read("--border-subtle", "rgba(0, 154, 154, 0.35)"),
  };
}

function applyAlpha(color, alpha) {
  if (!color) return `rgba(0,0,0,${alpha})`;
  if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const normalized = hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
    const int = parseInt(normalized, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(",").map((p) => Number(p.trim())) || [];
    const [r, g, b] = parts;
    if ([r, g, b].every((v) => Number.isFinite(v))) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  return color;
}

function mergeEntries(primary = [], secondary = [], keyBuilder) {
  const map = new Map();
  const buildKey = keyBuilder || ((item) => item?.id);
  const add = (item, priority = false) => {
    if (!item) return;
    const key = buildKey(item) || `k-${map.size}`;
    const existing = map.get(key) || {};
    map.set(key, priority ? { ...existing, ...item } : { ...item, ...existing });
  };

  primary.forEach((item) => add(item, false));
  secondary.forEach((item) => add(item, true));

  return Array.from(map.values());
}

function buildDateWindow() {
  const today = getTodayDate();
  const dates = [];
  for (let i = 6; i >= 0; i -= 1) {
    dates.push(addDays(today, -i));
  }
  return dates;
}

function parseMetricNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toggleInsightState(emptyEl, canvasEl, hasData) {
  if (emptyEl) emptyEl.style.display = hasData ? "none" : "block";
  if (canvasEl) {
    canvasEl.style.display = "block";
    canvasEl.classList.toggle("insight-canvas-empty", !hasData);
  }
}

function resetChartInstance(chartInstance, canvasEl) {
  if (chartInstance) {
    chartInstance.destroy();
  }
  if (canvasEl) {
    const ctx = canvasEl.getContext("2d");
    if (ctx && canvasEl.width && canvasEl.height) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
  }
}

function cancelMacrosAsyncLoops() {
  if (typeof window === "undefined") return;
  if (window.__EH_MACROS_RAF_ID__) {
    cancelAnimationFrame(window.__EH_MACROS_RAF_ID__);
    window.__EH_MACROS_RAF_ID__ = null;
  }
  if (window.__EH_MACROS_TIMER_ID__) {
    clearTimeout(window.__EH_MACROS_TIMER_ID__);
    window.__EH_MACROS_TIMER_ID__ = null;
  }
}

function getMacrosHost() {
  return (
    insightMacrosCard?.querySelector(".insight-body") ||
    macrosChartCanvas?.parentElement ||
    null
  );
}

function prepareMacrosHost(host) {
  if (!host) return;
  host.innerHTML = "";
  macrosLegendEl = null;
  if (macrosEmptyState) host.appendChild(macrosEmptyState);
  if (macrosChartCanvas) host.appendChild(macrosChartCanvas);
}

function safeRenderMacros(reason = "manual", macros) {
  const host = getMacrosHost();
  if (!macrosChartCanvas || !host) return;
  if (window.__EH_MACROS_RENDERING__) return;

  window.__EH_MACROS_RENDERING__ = true;
  try {
    cancelMacrosAsyncLoops();
    prepareMacrosHost(host);
    resetChartInstance(macrosChart, macrosChartCanvas);
    macrosChart = null;
    console.log("[macros] render", reason, "children:", host.childElementCount);
    renderMacrosInsight(macros);
  } finally {
    window.__EH_MACROS_RENDERING__ = false;
  }
}

function scheduleMacrosRender(reason = "manual", macros) {
  if (typeof window === "undefined") {
    safeRenderMacros(reason, macros);
    return;
  }
  cancelMacrosAsyncLoops();
  const delay = reason === "resize" ? 120 : 0;
  window.__EH_MACROS_TIMER_ID__ = window.setTimeout(() => {
    window.__EH_MACROS_TIMER_ID__ = null;
    safeRenderMacros(reason, macros);
  }, delay);
}

function formatShortLabel(dateValue) {
  if (!dateValue) return "";
  const normalized = toLocalDateString(dateValue);
  const parts = normalized.split("-").map(Number);
  const [y, m, d] = parts;
  const date = new Date(y || 0, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat("en", { weekday: "short" }).format(date);
}

function normalizeLogDate(dateValue) {
  return toLocalDateString(dateValue);
}

function computeWorkoutStreakFromList(workouts = []) {
  const workoutDates = new Set();
  workouts.forEach((workout) => {
    const date = normalizeLogDate(workout.workout_date || workout.date);
    if (date) workoutDates.add(date);
  });

  let streak = 0;
  let cursor = getTodayDate();
  while (workoutDates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function calculateWorkoutStreak() {
  if (streakCount) streakCount.textContent = "0";
  if (!currentFamilyId) return 0;

  try {
    let workouts = getStoredWorkouts(currentFamilyId);
    if (!workouts.length) {
      const { data, error } = await supabase
        .from("family_workouts")
        .select("id, workout_date")
        .eq("family_group_id", currentFamilyId)
        .order("workout_date", { ascending: false });

      if (!error && data) {
        workouts = data;
        cacheWorkoutsLocally(currentFamilyId, data);
      } else if (error) {
        console.error("Error loading workouts for streak", error);
      }
    }

    const streakValue = computeWorkoutStreakFromList(workouts);
    if (streakCount) streakCount.textContent = String(streakValue);
    return streakValue;
  } catch (err) {
    console.error("Could not calculate workout streak", err);
    if (streakCount) streakCount.textContent = "0";
    return 0;
  }
}

async function getDashboardMetrics() {
  const labels = buildDateWindow();
  const today = getTodayDate();
  const startDate = labels[0];
  const endDate = labels[labels.length - 1];

  const filterByFamily = (items = []) =>
    currentFamilyId
      ? items.filter(
          (item) =>
            !item.family_group_id || item.family_group_id === currentFamilyId
        )
      : items;

  const localMeals = filterByFamily(getMeals());
  const localWorkouts = filterByFamily(getWorkouts());

  let remoteMeals = [];
  let remoteWorkouts = [];

  if (currentFamilyId) {
    try {
      const [mealsResult, workoutsResult] = await Promise.all([
        supabase
          .from("family_meals")
          .select("*")
          .eq("family_group_id", currentFamilyId)
          .gte("meal_date", startDate)
          .lte("meal_date", endDate),
        supabase
          .from("family_workouts")
          .select("*")
          .eq("family_group_id", currentFamilyId)
          .gte("workout_date", startDate)
          .lte("workout_date", endDate),
      ]);

      if (!mealsResult.error && mealsResult.data) {
        remoteMeals = mealsResult.data;
      } else if (mealsResult.error) {
        console.error("Error loading meals for insights", mealsResult.error);
      }

      if (!workoutsResult.error && workoutsResult.data) {
        remoteWorkouts = workoutsResult.data;
      } else if (workoutsResult.error) {
        console.error("Error loading workouts for insights", workoutsResult.error);
      }
    } catch (err) {
      console.error("Error building dashboard metrics", err);
    }
  }

  const meals = mergeEntries(
    filterByFamily(localMeals),
    filterByFamily(remoteMeals),
    (meal) =>
      meal.id ||
      `${normalizeLogDate(meal.meal_date || meal.date)}:${
        meal.title || ""
      }:${meal.meal_type || meal.mealType || ""}`
  );

  const workouts = mergeEntries(
    filterByFamily(localWorkouts),
    filterByFamily(remoteWorkouts),
    (workout) =>
      workout.id ||
      `${normalizeLogDate(workout.workout_date || workout.date)}:${
        workout.title || ""
      }:${workout.workout_type || workout.type || ""}`
  );

  const macrosToday = { protein: 0, carbs: 0, fat: 0 };
  const caloriesByDate = Object.fromEntries(labels.map((date) => [date, 0]));
  const workoutsByDate = Object.fromEntries(labels.map((date) => [date, 0]));

  meals.forEach((meal) => {
    const date = normalizeLogDate(meal.meal_date || meal.date);
    if (!date) return;

    if (caloriesByDate[date] !== undefined) {
      const calories = parseMetricNumber(
        meal.calories ?? meal.nutrition?.calories
      );
      caloriesByDate[date] += calories;
    }

    if (date === today) {
      macrosToday.protein += parseMetricNumber(
        meal.protein ?? meal.nutrition?.protein
      );
      macrosToday.carbs += parseMetricNumber(
        meal.carbs ?? meal.nutrition?.carbs
      );
      macrosToday.fat += parseMetricNumber(meal.fat ?? meal.nutrition?.fat);
    }
  });

  workouts.forEach((workout) => {
    const date = normalizeLogDate(workout.workout_date || workout.date);
    if (!date) return;
    if (workoutsByDate[date] !== undefined) {
      workoutsByDate[date] += 1;
    }
  });

  return {
    labels,
    macrosToday,
    calories7Days: labels.map((date) => caloriesByDate[date] || 0),
    workouts7Days: labels.map((date) => workoutsByDate[date] || 0),
  };
}

function renderMacrosInsight(macros) {
  if (!macrosChartCanvas || typeof Chart === "undefined") return;
  const totals = macros || { protein: 0, carbs: 0, fat: 0 };
  const numericTotals = MACRO_ORDER.reduce((acc, key) => {
    acc[key] = parseMetricNumber(totals[key]);
    return acc;
  }, {});
  const hasData = MACRO_ORDER.some((key) => numericTotals[key] > 0);

  toggleInsightState(macrosEmptyState, macrosChartCanvas, hasData);

  const palette = getInsightPalette();
  const macroColors = {
    protein: palette.accentStrong,
    carbs: "#00c2c2",
    fat: "#5c8dff",
  };
  const trackColor = applyAlpha(palette.grid, hasData ? 0.6 : 0.4);
  const datasets = MACRO_ORDER.map((key, idx) => {
    const goal = parseMetricNumber(MACRO_GOALS[key]) || 1;
    const value = Math.max(0, numericTotals[key]);
    const remaining = Math.max(goal - value, 0);
    const baseColor = macroColors[key] || palette.accent;
    const progressColor = hasData ? baseColor : applyAlpha(baseColor, 0.35);

    return {
      label: `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
      data: [value, Math.max(remaining, goal * 0.08)],
      backgroundColor: [progressColor, trackColor],
      borderWidth: 0,
      hoverOffset: 4,
      spacing: 4,
      weight: 1,
    };
  });

  const chartData = {
    labels: MACRO_ORDER.map(
      (key) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`
    ),
    datasets,
  };

  const options = {
    cutout: "38%",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const key = MACRO_ORDER[ctx.datasetIndex];
            const value = numericTotals[key] || 0;
            const goal = parseMetricNumber(MACRO_GOALS[key]) || 1;
            const pct = Math.round((value / goal) * 100);
            return `${ctx.dataset.label}: ${value.toFixed(1)}g (${pct}% of ${goal}g)`;
          },
        },
      },
    },
    animation: {
      duration: 240,
    },
  };

  resetChartInstance(macrosChart, macrosChartCanvas);
  macrosChart = new Chart(macrosChartCanvas, {
    type: "doughnut",
    data: chartData,
    options,
  });

  renderMacrosLegend(macroColors, numericTotals);
}

function ensureMacrosLegend() {
  if (macrosLegendEl) return macrosLegendEl;
  const container = insightMacrosCard?.querySelector(".insight-body");
  if (!container) return null;
  macrosLegendEl = document.createElement("div");
  macrosLegendEl.className = "macros-legend";
  container.appendChild(macrosLegendEl);
  return macrosLegendEl;
}

function renderMacrosLegend(colors, totals) {
  const legend = ensureMacrosLegend();
  if (!legend) return;
  legend.innerHTML = "";

  MACRO_ORDER.forEach((key) => {
    const item = document.createElement("div");
    item.className = "macros-legend-item";

    const dot = document.createElement("span");
    dot.className = "macros-legend-dot";
    dot.style.backgroundColor = colors[key] || "var(--accent)";

    const label = document.createElement("span");
    const value = parseMetricNumber(totals[key]);
    const valueLabel = Number.isFinite(value) && value > 0 ? ` · ${value}g` : "";
    label.textContent = `${
      key.charAt(0).toUpperCase() + key.slice(1)
    }${valueLabel}`;

    item.appendChild(dot);
    item.appendChild(label);
    legend.appendChild(item);
  });
}

function renderCaloriesInsight(labels, calories) {
  if (!caloriesChartCanvas || typeof Chart === "undefined") return;
  const data = Array.isArray(calories) ? calories : [];
  const dataset = labels.map((_, idx) => parseMetricNumber(data[idx]));
  const hasData = dataset.some((v) => v > 0);
  const tooltipValues = dataset;

  const visibleData = hasData ? dataset : labels.map(() => 0);

  toggleInsightState(caloriesEmptyState, caloriesChartCanvas, hasData);

  const palette = getInsightPalette();
  const labelSet = labels.map((label) => formatShortLabel(label));

  const chartData = {
    labels: labelSet,
    datasets: [
      {
        label: "Calories",
        data: visibleData,
        borderColor: hasData ? palette.accent : applyAlpha(palette.grid, 0.7),
        backgroundColor: hasData
          ? "rgba(0, 163, 163, 0.14)"
          : applyAlpha(palette.grid, 0.14),
        tension: 0.35,
        pointRadius: hasData ? 3 : 2,
        pointHoverRadius: hasData ? 4 : 2,
        fill: true,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    responsive: true,
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: palette.textMuted },
      },
      y: {
        beginAtZero: true,
        suggestedMax: hasData ? undefined : 1,
        grid: { color: "rgba(255,255,255,0.06)" },
        ticks: { color: palette.textMuted },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${tooltipValues[ctx.dataIndex] || 0} kcal`,
        },
      },
    },
    animation: {
      duration: 220,
    },
  };

  resetChartInstance(caloriesChart, caloriesChartCanvas);
  caloriesChart = new Chart(caloriesChartCanvas, {
    type: "line",
    data: chartData,
    options,
  });
}

function renderWorkoutsInsight(labels, workouts) {
  if (!workoutsChartCanvas || typeof Chart === "undefined") return;
  const data = Array.isArray(workouts) ? workouts : [];
  const dataset = labels.map((_, idx) => parseMetricNumber(data[idx]));
  const hasData = dataset.some((v) => v > 0);
  const tooltipValues = dataset;

  const visibleData = hasData ? dataset : labels.map(() => 0);

  toggleInsightState(workoutsEmptyState, workoutsChartCanvas, hasData);

  const palette = getInsightPalette();
  const labelSet = labels.map((label) => formatShortLabel(label));

  const chartData = {
    labels: labelSet,
    datasets: [
      {
        label: "Sessions",
        data: visibleData,
        backgroundColor: hasData
          ? palette.accentStrong
          : applyAlpha(palette.grid, 0.65),
        borderRadius: 10,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    responsive: true,
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: palette.textMuted },
      },
      y: {
        beginAtZero: true,
        suggestedMax: hasData ? undefined : 1,
        grid: { color: "rgba(255,255,255,0.06)" },
        ticks: { color: palette.textMuted, precision: 0 },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${tooltipValues[ctx.dataIndex] || 0} sessions`,
        },
      },
    },
    animation: {
      duration: 200,
    },
  };

  resetChartInstance(workoutsChart, workoutsChartCanvas);
  workoutsChart = new Chart(workoutsChartCanvas, {
    type: "bar",
    data: chartData,
    options,
  });
}

async function renderInsights(reason = "manual") {
  if (!insightMacrosCard) return;
  const metrics = await getDashboardMetrics();
  const labels = metrics.labels || buildDateWindow();

  if (reason === "resize") {
    scheduleMacrosRender(reason, metrics.macrosToday);
  } else {
    safeRenderMacros(reason, metrics.macrosToday);
  }
  renderCaloriesInsight(labels, metrics.calories7Days);
  renderWorkoutsInsight(labels, metrics.workouts7Days);
}

async function runSafeInsightsRender(reason = "manual") {
  if (!window[DASHBOARD_CHARTS_INIT_FLAG]) return;
  if (insightsRenderLock) {
    insightsRenderQueued = true;
    return;
  }
  insightsRenderLock = true;
  try {
    await renderInsights(reason);
  } finally {
    insightsRenderLock = false;
    if (insightsRenderQueued) {
      insightsRenderQueued = false;
      runSafeInsightsRender("queued");
    }
  }
}

function scheduleInsightsRender(reason = "manual", options = {}) {
  if (!window[DASHBOARD_CHARTS_INIT_FLAG]) return;
  if (options.debounceMs) {
    clearTimeout(insightsResizeTimer);
    insightsResizeTimer = setTimeout(
      () => runSafeInsightsRender(reason),
      options.debounceMs
    );
    return;
  }
  runSafeInsightsRender(reason);
}

const refreshDashboardInsights = (reason = "refresh") =>
  runSafeInsightsRender(reason);

function initDashboardInsights() {
  if (window[DASHBOARD_CHARTS_INIT_FLAG]) return;
  window[DASHBOARD_CHARTS_INIT_FLAG] = true;

  bindInsightCards();

  const handleDataChanged = (event) => {
    scheduleInsightsRender("data-change");
    const source = event?.detail?.source || event?.detail?.entity;
    if (
      !source ||
      source === "workouts" ||
      source === "workout" ||
      source === "all"
    ) {
      calculateWorkoutStreak();
    }
  };

  document.addEventListener("family:changed", () => {
    scheduleInsightsRender("family-changed");
    calculateWorkoutStreak();
  });

  document.addEventListener("diary:refresh", () => {
    scheduleInsightsRender("diary-refresh");
  });

  window.addEventListener("eh:data-changed", handleDataChanged);
  window.addEventListener("eh:dataChanged", handleDataChanged);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleInsightsRender("visibility");
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    scheduleInsightsRender("dom-ready");
  });
  window.addEventListener("resize", () =>
    scheduleInsightsRender("resize", { debounceMs: 120 })
  );

  scheduleInsightsRender("init");
}

function createInitialState() {
  return {
    activeTabId: "dashboard-tab",
    displayNameValue: "",
    displayNavMenu: false,
    deferredInstallPrompt: null,
    isStandaloneMode: false,
    isAppInstalled: false,
    selectedThemeStyle: "mountain",
  };
}

function applyThemeTokens(themeKey) {
  const root = document.documentElement;
  const tokenMap = THEME_TOKEN_MAP[themeKey] || THEME_TOKEN_MAP.dark;
  Object.entries(tokenMap).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

function initInitialState() {
  const next = createInitialState();
  activeTabId = next.activeTabId;
  displayNameValue = next.displayNameValue;
  displayNavMenu = next.displayNavMenu;
  deferredInstallPrompt = next.deferredInstallPrompt;
  isStandaloneMode = next.isStandaloneMode;
  isAppInstalled = next.isAppInstalled;
  selectedThemeStyle = next.selectedThemeStyle;
}

function applyThemeMode(theme) {
  const root = document.documentElement;
  activeThemeMode = theme === "light" ? "light" : "dark";
  if (activeThemeMode === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  applyThemeTokens(activeThemeMode);
  if (themeToggleButton)
    themeToggleButton.setAttribute("aria-pressed", activeThemeMode === "light");
  if (themeLabel)
    themeLabel.textContent = activeThemeMode === "light" ? "Light" : "Dark";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, activeThemeMode);
  } catch (err) {
    console.warn("Could not persist theme", err);
  }
}

function initThemeMode() {
  const stored = (() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (err) {
      return null;
    }
  })();
  applyThemeMode(stored || "dark");

  if (!themeToggleButton) return;
  themeToggleButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const next = activeThemeMode === "dark" ? "light" : "dark";
    applyThemeMode(next);
  });
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

function triggerAIDigestPlaceholder() {
  openModal({
    title: "Ella Weekly Digest",
    body: "Your personalized digest is coming soon. We'll use your meals, workouts, and progress to craft insights.",
    primaryLabel: "Got it",
  });
}

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
    await refreshDashboardInsights();
    setupDiaryRealtime();
    showApp();
  } else {
    setCurrentUser(null);
    setCurrentFamilyId(null);
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    teardownDiaryRealtime();
    await refreshDashboardInsights();
    showAuth();
  }
}

// Shared tab helper

function activateTab(targetId) {
  if (!targetId || !tabButtons || !tabPanels) return;
  activeTabId = targetId;

  if (targetId !== "meals-tab" && mealsGuidedMode) {
    mealsGuidedMode = false;
    document.body.classList.remove("meals-guided");
    if (mealsForm) {
      delete mealsForm.dataset.targetDate;
      delete mealsForm.dataset.targetMealType;
    }
  }

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

  if (isCoarsePointer) {
    maybeVibrate([6]);
  }

  if (targetId === "log-tab") {
    refreshDiaryForSelectedDate();
  }
}

function syncDateInputs(dateValue) {
  if (mealDateInput) mealDateInput.value = dateValue;
  if (workoutDateInput) workoutDateInput.value = dateValue;
  if (progressDateInput) progressDateInput.value = dateValue;
}

function teardownDiaryRealtime() {
  if (!diaryRealtimeChannel) return;
  supabase.removeChannel(diaryRealtimeChannel);
  diaryRealtimeChannel = null;
}

function setupDiaryRealtime() {
  teardownDiaryRealtime();
  if (!currentFamilyId) return;

  const handleChange = () => {
    refreshDiaryForSelectedDate();
    refreshDashboardInsights();
  };

  diaryRealtimeChannel = supabase
    .channel("diary-log-sync")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "family_meals",
        filter: `family_group_id=eq.${currentFamilyId}`,
      },
      handleChange
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "family_workouts",
        filter: `family_group_id=eq.${currentFamilyId}`,
      },
      handleChange
    )
    .subscribe();
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

function scrollAndFocus(target, focusEl) {
  if (target) {
    try {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      /* non-fatal */
    }
  }
  if (focusEl) {
    setTimeout(() => focusEl.focus({ preventScroll: true }), 60);
  }
}

function bindInsightCards() {
  const attachHandler = (card, handler) => {
    if (!card) return;
    card.addEventListener("click", handler);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  };

  attachHandler(insightMacrosCard, () => {
    const today = getTodayDate();
    setSelectedDate(today, { force: true });
    activateTab("meals-tab");
    if (mealDateInput) mealDateInput.value = today;
    const anchor = mealsForm?.closest(".card") || mealsForm;
    scrollAndFocus(anchor, mealTitleInput);
  });

  attachHandler(insightCaloriesCard, () => {
    const today = getTodayDate();
    setSelectedDate(today, { force: true });
    activateTab("log-tab");
    focusLogSection("meal");
  });

  attachHandler(insightWorkoutsCard, () => {
    const today = getTodayDate();
    setSelectedDate(today, { force: true });
    activateTab("workouts-tab");
    if (workoutDateInput) workoutDateInput.value = today;
    const anchor = workoutsForm?.closest(".card") || workoutsForm;
    scrollAndFocus(anchor, workoutTitleInput);
  });
}

function openMealsQuickEntry() {
  const targetDate = selectedDate || getTodayDate();
  activateTab("meals-tab");
  if (mealDateInput) mealDateInput.value = targetDate;
  if (mealTypeInput) mealTypeInput.value = "dinner";
  setTimeout(() => {
    const addMealAnchor = mealsForm?.closest(".card") || mealsForm;
    if (addMealAnchor) {
      scrollAndFocus(addMealAnchor, mealTitleInput);
    }
  }, 80);
}

function openWorkoutQuickEntry() {
  const targetDate = selectedDate || getTodayDate();
  activateTab("workouts-tab");
  if (workoutDateInput) workoutDateInput.value = targetDate;
  setTimeout(() => {
    const workoutAnchor = workoutsForm?.closest(".card") || workoutsForm;
    if (workoutAnchor) {
      scrollAndFocus(workoutAnchor, workoutTitleInput);
    }
  }, 80);
}

function openProgressQuickEntry(target) {
  const targetDate = selectedDate || getTodayDate();
  activateTab("progress-tab");
  if (progressDateInput) progressDateInput.value = targetDate;
  const focusTarget =
    target === "water" ? progressWaterInput : progressWeightInput;
  setTimeout(() => {
    const progressAnchor = focusTarget?.closest("div") || progressForm;
    if (progressAnchor) {
      scrollAndFocus(progressAnchor, focusTarget);
    }
  }, 80);
}

function openMealFlow(section, date) {
  activateTab("meals-tab");
  mealsGuidedMode = true;
  document.body.classList.add("meals-guided");
  if (mealDateInput) mealDateInput.value = date;
  if (mealTypeInput) mealTypeInput.value = section;
  if (mealsForm) {
    mealsForm.dataset.targetDate = date;
    mealsForm.dataset.targetMealType = section;
    mealsForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (mealTitleInput) {
    setTimeout(() => mealTitleInput.focus({ preventScroll: true }), 120);
  }
}

function offsetDiaryDate(baseDate, delta) {
  return addDays(baseDate, delta);
}

function bindDiaryDateNav() {
  if (diaryPrevDayBtn && !diaryPrevDayBtn.dataset.bound) {
    diaryPrevDayBtn.dataset.bound = "true";
    diaryPrevDayBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelectedDate(offsetDiaryDate(selectedDate, -1), { force: true });
      },
      { capture: true }
    );
  }

  if (diaryNextDayBtn && !diaryNextDayBtn.dataset.bound) {
    diaryNextDayBtn.dataset.bound = "true";
    diaryNextDayBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelectedDate(offsetDiaryDate(selectedDate, 1), { force: true });
      },
      { capture: true }
    );
  }

  if (diaryTodayBtn && !diaryTodayBtn.dataset.bound) {
    diaryTodayBtn.dataset.bound = "true";
    diaryTodayBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelectedDate(getTodayDate(), { force: true });
      },
      { capture: true }
    );
  }

  if (diaryCalendarBtn && diaryDatePicker && !diaryCalendarBtn.dataset.bound) {
    diaryCalendarBtn.dataset.bound = "true";
    diaryCalendarBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        diaryDatePicker.value = selectedDate;
        if (isCalendarOpen) {
          diaryDatePicker.blur();
          isCalendarOpen = false;
          return;
        }
        if (typeof diaryDatePicker.showPicker === "function") {
          diaryDatePicker.showPicker();
        } else {
          diaryDatePicker.focus();
          diaryDatePicker.click();
        }
        isCalendarOpen = true;
      },
      { capture: true }
    );
  }

  if (diaryDatePicker && !diaryDatePicker.dataset.bound) {
    diaryDatePicker.dataset.bound = "true";
    diaryDatePicker.addEventListener("change", (e) => {
      const next = e.target.value;
      if (next) setSelectedDate(next, { force: true });
      isCalendarOpen = false;
    });
    diaryDatePicker.addEventListener("blur", () => {
      isCalendarOpen = false;
    });
  }
}

function bindDiaryAddButtons() {
  if (!diaryAddButtons?.length) return;
  diaryAddButtons.forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const section = btn.dataset.diaryAdd;
        if (!section) return;
        openMealFlow(section, selectedDate);
      },
      { capture: true }
    );
  });
}

async function logUpcomingMealToToday(entryEl) {
  if (!entryEl || !currentFamilyId || !currentUser) {
    showToast("Join a family to log meals.");
    return;
  }

  const title = entryEl.dataset.mealTitle || "";
  if (!title.trim()) return;
  const notes = entryEl.dataset.mealNotes || null;
  const mealType = entryEl.dataset.mealType || "dinner";
  const targetDate = selectedDate || getTodayDate();

  await logMealToDiary(
    {
      title,
      meal_type: mealType,
      notes,
    },
    { date: targetDate }
  );
}

function bindMealsLogButtons() {
  if (!mealsList) return;
  mealsList.addEventListener(
    "click",
    async (e) => {
      const btn = e.target.closest(".meal-log-btn");
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const li = btn.closest("li");
      await logUpcomingMealToToday(li);
    },
    { capture: true }
  );
}

function bindMealsListRemoveButtons() {
  if (!mealsList) return;
  mealsList.addEventListener(
    "click",
    async (e) => {
      const deleteBtn = e.target.closest(".meal-delete");
      const logBtn = e.target.closest(".meal-log-btn");
      if (!deleteBtn && !logBtn) return;
      const li = e.target.closest("li");
      if (!li) return;

      if (logBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        logBtn.disabled = true;
        await logUpcomingMealToToday(li);
        logBtn.disabled = false;
        return;
      }

      if (!li.dataset.mealId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      li.classList.add("list-removing");
      const removeAfter = () => {
        setTimeout(async () => {
          const { error } = await supabase
            .from("family_meals")
            .delete()
            .eq("id", li.dataset.mealId);

          if (error) {
            console.error("Error deleting meal", error);
            li.classList.remove("list-removing");
            return;
          }

          await loadMeals();
          document.dispatchEvent(
            new CustomEvent("diary:refresh", { detail: { entity: "meal" } })
          );
        }, 180);
      };

      const transitionTarget =
        li.matches(".list-removing") && li.getAnimations
          ? li.getAnimations()
          : [];
      if (transitionTarget.length) {
        Promise.all(transitionTarget.map((a) => a.finished)).then(removeAfter);
      } else {
        removeAfter();
      }
    },
    { capture: true }
  );
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
      await refreshDashboardInsights();
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
      if (isQuickSheetOpen) {
        closeQuickSheet();
        setTimeout(() => activateTab(targetId), 230);
      } else {
        activateTab(targetId);
      }
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

window.EH_DEBUG = {
  getMeals,
  getWorkouts,
  renderInsights,
};

if (dashboardAiShortcut) {
  dashboardAiShortcut.addEventListener("click", async () => {
    const originalLabel = dashboardAiShortcut.textContent;
    dashboardAiShortcut.disabled = true;
    dashboardAiShortcut.textContent = "Refreshing…";
    try {
      await runWeeklyPlanGeneration();
      document.dispatchEvent(
        new CustomEvent("diary:refresh", { detail: { entity: "plan" } })
      );
    } catch (err) {
      console.error("Weekly plan refresh failed", err);
      showToast("Could not refresh the 7-day plan");
    } finally {
      dashboardAiShortcut.disabled = false;
      dashboardAiShortcut.textContent = originalLabel;
    }
  });
}

document.addEventListener("diary:add", (event) => {
  const { section, date } = event.detail || {};
  if (!section || !date) return;

  if (section === "exercise") {
    activateTab("workouts-tab");
    if (workoutDateInput) workoutDateInput.value = date;
    return;
  }

  openMealFlow(section, date);
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
const quickSheet = quickSheetBackdrop
  ? quickSheetBackdrop.querySelector(".quick-sheet")
  : null;
const keyboardAwareSelectors = [
  "input",
  "textarea",
  "#coach-input",
  "#meal-title",
  "#meal-notes",
  "#workout-title",
  "#workout-notes",
  "#progress-weight",
  "#progress-water",
  "#progress-notes",
  "#login-email",
  "#login-password",
  "#signup-email",
  "#signup-password",
  "#signup-display-name",
];

// Mobile bottom-sheet helpers
function syncViewportOffset() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.body.style.setProperty("--keyboard-offset", `${offset}px`);
  document.body.classList.toggle("keyboard-visible", offset > 0);
}

function ensureInputVisible(target) {
  if (!target) return;
  syncViewportOffset();
  setTimeout(() => {
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      // non-fatal: some elements may not support scrollIntoView in older browsers
    }
  }, 120);
}

function syncQuickButtonState(isOpen) {
  if (!quickAddButton) return;
  quickAddButton.classList.toggle("is-open", isOpen);
  const label = quickAddButton.querySelector("span");
  if (label) {
    label.textContent = isOpen ? "×" : "＋";
  }
  quickAddButton.setAttribute("aria-pressed", String(isOpen));
}

function openQuickSheet() {
  if (!quickSheetBackdrop) return;
  quickSheetBackdrop.classList.remove("is-closing");
  quickSheetBackdrop.classList.add("is-open");
  document.body.classList.add("sheet-open");
  if (isCoarsePointer) maybeVibrate([8, 12]);
  isQuickSheetOpen = true;
  syncQuickButtonState(true);
  syncViewportOffset();
}

function closeQuickSheet() {
  if (!quickSheetBackdrop) return;
  quickSheetBackdrop.classList.add("is-closing");
  quickSheetBackdrop.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
  isQuickSheetOpen = false;
  syncQuickButtonState(false);
  setTimeout(() => quickSheetBackdrop.classList.remove("is-closing"), 220);
}

if (moreNavButton) {
  moreNavButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isQuickSheetOpen) {
      closeQuickSheet();
    }
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
      closeMoreMenu();
      if (!target) return;
      const resolved = target === "settings" ? "settings-tab" : target;
      const delay = resolved === "settings-tab" ? 160 : 0;
      if (delay) {
        setTimeout(() => activateTab(resolved), delay);
      } else {
        activateTab(resolved);
      }
    });
  });
}

function checkStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function updateInstallUI() {
  const installAvailable = Boolean(deferredInstallPrompt) && !isStandaloneMode;
  const showGuidance = !isStandaloneMode;

  if (installHelperButton) {
    installHelperButton.style.display = installAvailable ? "inline-flex" : "none";
  }

  if (settingsInstallButton) {
    const installCard = settingsInstallButton.closest(".install-card");
    if (installCard) {
      installCard.style.display = showGuidance ? "" : "none";
    }
    settingsInstallButton.style.display = showGuidance ? "inline-flex" : "none";
  }

  if (moreMenuInstallButton) {
    moreMenuInstallButton.style.display = showGuidance ? "block" : "none";
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

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    isStandaloneMode = true;
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
  closeQuickSheet();
  setDesktopFabMenuOpen(false);
  if (isCoarsePointer) maybeVibrate([10]);
  switch (action) {
    case "log-meal":
      openMealsQuickEntry();
      break;

    case "log-ella-meal":
      activateTab("meals-tab");
      setTimeout(() => {
        const grid = aiDinnerGrid || document.getElementById("ai-dinner-grid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
          const firstCard = grid.querySelector(".ai-dinner-card");
          if (firstCard) {
            firstCard.focus({ preventScroll: true });
          }
        }
      }, 80);
      showToast("Opening Ella’s picks");
      break;

    case "log-water":
      openProgressQuickEntry("water");
      break;

    case "log-weight":
      openProgressQuickEntry("weight");
      break;

    case "log-exercise":
      openWorkoutQuickEntry();
      break;

    case "barcode":
    case "meal-scan":
      activateTab("log-tab");
      showToast("Coming soon: quick scans");
      break;

    default:
      break;
  }
}

// Mobile FAB (bottom nav + button)
if (quickAddButton) {
  quickAddButton.addEventListener("click", () => {
    if (isQuickSheetOpen) {
      closeQuickSheet();
    } else {
      openQuickSheet();
    }
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

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportOffset);
  window.visualViewport.addEventListener("scroll", syncViewportOffset);
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

document.addEventListener("focusin", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!keyboardAwareSelectors.some((selector) => target.matches(selector))) {
    return;
  }
  ensureInputVisible(target);
});

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

syncViewportOffset();

onSelectedDateChange((dateValue) => {
  syncDateInputs(dateValue);
});
syncDateInputs(selectedDate);

document.addEventListener("family:changed", () => {
  setupDiaryRealtime();
  if (activeTabId === "log-tab") {
    refreshDiaryForSelectedDate();
  }
});

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
    if (streakCount) {
      streakCount.textContent = "0";
    }
    teardownDiaryRealtime();
    await refreshDashboardInsights();
    if (coachMessages) {
      coachMessages.innerHTML = "";
    }
    showAuth();
  });
}

// Init coach + app

async function instantiateAppAfterInitialization() {
  initInitialState();
  initThemeMode();
  initThemeStyles();
  initDashboardInsights();
  initModal();
  initAIDinnerCards();
  bindDiaryDateNav();
  bindDiaryAddButtons();
  bindMealsLogButtons();
  bindMealsListRemoveButtons();
  initInstallState();
  initCoachHandlers();
  initDiary();
  await init();
  await calculateWorkoutStreak();
}

instantiateAppAfterInitialization();
