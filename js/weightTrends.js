// js/weightTrends.js
import {
  dashboardWeightChart,
  dashboardWeightEmpty,
  progressWeightChart,
  progressWeightEmpty,
} from "./dom.js";
import { subscribe } from "./ehStore.js";
import { toLocalDayKey } from "./state.js";

let dashboardChart = null;
let progressChart = null;
let unsubscribe = null;

const DAYS_WINDOW = 30;

function getCssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name);
  return val?.trim() || fallback;
}

function normalizeWeightEntries(entries = []) {
  const byDate = new Map();
  entries.forEach((entry) => {
    const dayKey = toLocalDayKey(
      entry.dayKey ||
        entry.log_date ||
        entry.logDate ||
        entry.date ||
        entry.created_at
    );
    const rawWeight =
      entry.weight_lb ?? entry.weight ?? entry.weightLb ?? entry.body_weight;
    if (!dayKey || rawWeight === null || rawWeight === undefined) return;
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight)) return;
    const createdAt = entry.created_at || entry.inserted_at || "";
    const existing = byDate.get(dayKey);
    if (!existing || createdAt > existing.created_at) {
      byDate.set(dayKey, {
        dateKey: dayKey,
        weight,
        created_at: createdAt,
      });
    }
  });

  const cutoff = new Date();
  cutoff.setHours(12, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (DAYS_WINDOW - 1));

  return Array.from(byDate.values())
    .filter((item) => {
      const parsed = new Date(`${item.dateKey}T12:00:00`);
      return Number.isFinite(parsed.getTime()) ? parsed >= cutoff : false;
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function formatDateLabel(dateKey) {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return dateKey;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function resetChart(chart) {
  if (chart && typeof chart.destroy === "function") {
    chart.destroy();
  }
  return null;
}

function renderWeightChart(canvas, emptyState, chartInstance, entries) {
  if (!canvas || typeof Chart === "undefined") return null;

  const normalized = normalizeWeightEntries(entries);
  const hasData = normalized.length > 0;

  if (emptyState) {
    emptyState.style.display = hasData ? "none" : "flex";
  }
  canvas.style.display = hasData ? "block" : "none";

  if (!hasData) {
    return resetChart(chartInstance);
  }

  if (chartInstance) {
    chartInstance = resetChart(chartInstance);
  }

  const labels = normalized.map((item) => formatDateLabel(item.dateKey));
  const data = normalized.map((item) => item.weight);
  const accent = getCssVar("--accent", "#00a3a3");
  const border = getCssVar("--border-subtle", "rgba(255,255,255,0.12)");
  const textMuted = getCssVar("--text-muted", "rgba(255,255,255,0.7)");

  const nextChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Weight (lb)",
          data,
          borderColor: accent,
          backgroundColor: accent,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            color: border,
            display: true,
          },
          ticks: {
            color: textMuted,
            autoSkip: true,
            maxTicksLimit: 6,
          },
        },
        y: {
          beginAtZero: false,
          grid: {
            color: border,
          },
          ticks: {
            color: textMuted,
            callback: (value) => `${value} lb`,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `Weight: ${ctx.parsed.y} lb`,
          },
        },
      },
    },
  });

  return nextChart;
}

function renderAll(entries) {
  progressChart = renderWeightChart(
    progressWeightChart,
    progressWeightEmpty,
    progressChart,
    entries
  );
  dashboardChart = renderWeightChart(
    dashboardWeightChart,
    dashboardWeightEmpty,
    dashboardChart,
    entries
  );
}

export function initWeightTrends() {
  if (unsubscribe || (!progressWeightChart && !dashboardWeightChart)) return;
  unsubscribe = subscribe((snapshot) => {
    renderAll(snapshot.progressLogs || []);
  });
}
