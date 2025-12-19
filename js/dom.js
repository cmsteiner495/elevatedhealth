// js/dom.js

// Sections
export const authSection = document.getElementById("auth-section");
export const appSection = document.getElementById("app-section");

// Auth
export const signupForm = document.getElementById("signup-form");
export const signupEmail = document.getElementById("signup-email");
export const signupPassword = document.getElementById("signup-password");
export const signupDisplayName = document.getElementById(
  "signup-display-name"
);
export const signupMessage = document.getElementById("signup-message");

export const loginForm = document.getElementById("login-form");
export const loginEmail = document.getElementById("login-email");
export const loginPassword = document.getElementById("login-password");
export const loginMessage = document.getElementById("login-message");

export const logoutButton = document.getElementById("logout-button");
export const welcomeText = document.getElementById("welcome-text");
export const mobilePageTitle = document.getElementById("mobile-page-title");
export const mobileOverline = document.getElementById("mobile-overline");
export const profileAvatar = document.getElementById("profile-avatar");
export const themeToggleButton = document.getElementById("theme-toggle");
export const themeLabel = document.getElementById("theme-label");
export const themeStyleChips = document.querySelectorAll("[data-theme-style]");
export const settingsEmailLabel = document.getElementById("settings-email");
export const installHelperButton = document.getElementById(
  "install-helper-button"
);
export const settingsInstallButton = document.getElementById(
  "settings-install-button"
);

// Tabs
export const tabButtons = document.querySelectorAll(".tab-button");
export const tabPanels = document.querySelectorAll(".tab-panel");
export const dashboardAiShortcut = document.getElementById("dashboard-ai-shortcut");

// Log / diary
export const diaryPrevDayBtn = document.getElementById("diary-prev-day");
export const diaryNextDayBtn = document.getElementById("diary-next-day");
export const diaryTodayBtn = document.getElementById("diary-today-btn");
export const diaryCalendarBtn = document.getElementById("diary-calendar-btn");
export const diaryDatePicker = document.getElementById("diary-date-picker");
export const diaryDateMeta = document.getElementById("diary-date-meta");
export const diaryDateLabel = document.getElementById("diary-date-label");
export const diaryDateSub = document.getElementById("diary-date-sub");
export const diaryAddButtons = document.querySelectorAll("[data-diary-add]");
export const diaryBreakfastList = document.getElementById(
  "diary-breakfast-list"
);
export const diaryLunchList = document.getElementById("diary-lunch-list");
export const diaryDinnerList = document.getElementById("diary-dinner-list");
export const diarySnacksList = document.getElementById("diary-snacks-list");
export const diaryExerciseList = document.getElementById("diary-exercise-list");
export const diaryCaloriesGoal = document.getElementById("diary-calories-goal");
export const diaryCaloriesFood = document.getElementById("diary-calories-food");
export const diaryCaloriesExercise = document.getElementById(
  "diary-calories-exercise"
);
export const diaryCaloriesRemaining = document.getElementById(
  "diary-calories-remaining"
);
export const dashboardCaloriesFill = document.getElementById(
  "dashboard-calories-fill"
);
export const insightMacrosCard = document.getElementById("insight-macros-card");
export const insightCaloriesCard = document.getElementById(
  "insight-calories-card"
);
export const insightWorkoutsCard = document.getElementById(
  "insight-workouts-card"
);
export const macrosChartCanvas = document.getElementById("macros-chart");
export const caloriesChartCanvas = document.getElementById("calories-chart");
export const workoutsChartCanvas = document.getElementById("workouts-chart");
export const macrosEmptyState = document.getElementById("macros-empty");
export const caloriesEmptyState = document.getElementById("calories-empty");
export const workoutsEmptyState = document.getElementById("workouts-empty");
export const streakCount = document.getElementById("streak-count");

// Family
export const familyStatus = document.getElementById("family-status");

// Grocery
export const groceryNoFamily = document.getElementById("grocery-no-family");
export const groceryHasFamily = document.getElementById("grocery-has-family");
export const groceryForm = document.getElementById("grocery-form");
export const groceryName = document.getElementById("grocery-name");
export const groceryQuantity = document.getElementById("grocery-quantity");
export const groceryCategory = document.getElementById("grocery-category");
export const groceryMessage = document.getElementById("grocery-message");
export const groceryList = document.getElementById("grocery-list");

// Meals
export const mealsNoFamily = document.getElementById("meals-no-family");
export const mealsHasFamily = document.getElementById("meals-has-family");
export const mealsForm = document.getElementById("meals-form");
export const mealDateInput = document.getElementById("meal-date");
export const mealTypeInput = document.getElementById("meal-type");
export const mealTitleInput = document.getElementById("meal-title");
export const mealNotesInput = document.getElementById("meal-notes");
export const mealsMessage = document.getElementById("meals-message");
export const mealsList = document.getElementById("meals-list");
export const aiDinnerGrid = document.getElementById("ai-dinner-grid");

// Workouts
export const workoutsNoFamily = document.getElementById("workouts-no-family");
export const workoutsHasFamily = document.getElementById("workouts-has-family");
export const workoutsForm = document.getElementById("workouts-form");
export const workoutDateInput = document.getElementById("workout-date");
export const workoutTitleInput = document.getElementById("workout-title");
export const workoutTypeInput = document.getElementById("workout-type");
export const workoutDifficultyInput =
  document.getElementById("workout-difficulty");
export const workoutDurationInput =
  document.getElementById("workout-duration");
export const workoutNotesInput = document.getElementById("workout-notes");
export const workoutsMessage = document.getElementById("workouts-message");
export const workoutsList = document.getElementById("workouts-list");

// Progress
export const progressNoFamily = document.getElementById("progress-no-family");
export const progressHasFamily =
  document.getElementById("progress-has-family");
export const progressForm = document.getElementById("progress-form");
export const progressDateInput = document.getElementById("progress-date");
export const progressWeightInput =
  document.getElementById("progress-weight");
export const progressWaterInput =
  document.getElementById("progress-water");
export const progressSleepInput =
  document.getElementById("progress-sleep");
export const progressStepsInput =
  document.getElementById("progress-steps");
export const progressMoodInput = document.getElementById("progress-mood");
export const progressNotesInput =
  document.getElementById("progress-notes");
export const progressMessage = document.getElementById("progress-message");
export const progressList = document.getElementById("progress-list");

// Ella
export const coachMessages = document.getElementById("coach-messages");
export const coachForm = document.getElementById("coach-form");
export const coachInput = document.getElementById("coach-input");
export const coachGenerateWeek =
  document.getElementById("coach-generate-week");
export const coachStatus = document.getElementById("coach-message");
export const coachTypingPill = document.getElementById("coach-typing-pill");

// Bottom nav + quick sheet
export const quickAddButton = document.getElementById("quick-add-button");
export const quickSheetBackdrop =
  document.getElementById("quick-sheet-backdrop");
export const quickSheetActionButtons =
  document.querySelectorAll(".quick-sheet-item");
export const moreNavButton = document.getElementById("more-nav-button");
export const moreMenuBackdrop = document.getElementById("more-menu-backdrop");
export const moreMenu = document.getElementById("more-menu");
export const moreMenuItems = document.querySelectorAll("[data-menu-target]");
export const moreMenuInstallButton = document.getElementById(
  "more-menu-install"
);

// Modal
export const modalBackdrop = document.getElementById("eh-modal");
export const modalTitle = document.getElementById("eh-modal-title");
export const modalBody = document.getElementById("eh-modal-body");
export const modalPrimaryButton = document.querySelector(
  "[data-modal-primary]"
);
export const modalCloseButtons = document.querySelectorAll("[data-modal-close]");

// Toasts
export const toastContainer = document.getElementById("toast-container");
