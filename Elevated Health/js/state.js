// js/state.js
export let currentUser = null;
export let currentFamilyId = null;

// Shared, app-wide selected date state (YYYY-MM-DD)
const today = new Date();
const isoToday = today.toISOString().slice(0, 10);
export let selectedDate = isoToday;

const dateListeners = new Set();

export function setCurrentUser(user) {
  currentUser = user;
}

export function setCurrentFamilyId(familyId) {
  currentFamilyId = familyId;
}

export function setSelectedDate(nextDate, options = {}) {
  if (!nextDate) return;
  const normalized = nextDate.slice(0, 10);
  const force = options.force === true;
  if (!force && normalized === selectedDate) return;
  selectedDate = normalized;
  dateListeners.forEach((cb) => cb(selectedDate));
}

export function onSelectedDateChange(cb) {
  if (typeof cb !== "function") return;
  dateListeners.add(cb);
}

export function getTodayDate() {
  return isoToday;
}
