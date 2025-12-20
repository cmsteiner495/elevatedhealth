// js/state.js
export let currentUser = null;
export let currentFamilyId = null;

// Shared, app-wide selected date state (YYYY-MM-DD) using local time
function toLocalDateString(date) {
  if (!(date instanceof Date)) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalDayKey(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const copy = new Date(value);
    copy.setHours(12, 0, 0, 0);
    return toLocalDateString(copy);
  }
  if (typeof value === "string") {
    const datePart = value.split("T")[0] || value;
    const [y, m, d] = datePart.split("-").map(Number);
    if ([y, m, d].every((n) => Number.isFinite(n))) {
      return toLocalDateString(new Date(y, (m || 1) - 1, d || 1));
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toLocalDayKey(parsed);
    }
  }
  return "";
}

export function getLast7DaysLocal() {
  const days = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    days.push(day);
  }
  return days;
}

export function formatWeekdayShort(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { weekday: "short" }).format(date);
}

function normalizeDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return toLocalDateString(value);
  if (typeof value === "string") {
    const parts = value.split("-").map(Number);
    if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
      const [y, m, d] = parts;
      return toLocalDateString(new Date(y, (m || 1) - 1, d || 1));
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toLocalDateString(parsed);
    }
  }
  return null;
}

const isoToday = toLocalDateString(new Date());
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
  const normalized = normalizeDateString(nextDate);
  if (!normalized) return;
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

export function addDays(dateValue, daysDelta) {
  const normalized = normalizeDateString(dateValue);
  if (!normalized) return dateValue;
  const [y, m, d] = normalized.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysDelta);
  return toLocalDateString(date);
}

export { toLocalDateString };
