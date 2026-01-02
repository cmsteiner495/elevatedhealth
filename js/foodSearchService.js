const DEFAULT_LIMIT = 12;

function getFunctionsBaseUrl() {
  const envUrl = window?.EH_ENV?.SUPABASE_FUNCTIONS_URL || window?.EH_ENV?.SUPABASE_URL;
  if (!envUrl) return null;
  const trimmed = envUrl.replace(/\/$/, "");
  return trimmed.includes("/functions/v1") ? trimmed : `${trimmed}/functions/v1`;
}

const functionsBaseUrl = getFunctionsBaseUrl();

function clampLimit(value = DEFAULT_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  if (numeric < 1) return 1;
  if (numeric > 25) return 25;
  return numeric;
}

export async function searchFoods(query, { mode = "common", limit = DEFAULT_LIMIT } = {}) {
  const baseUrl = functionsBaseUrl;
  if (!baseUrl) {
    throw new Error("Missing SUPABASE_FUNCTIONS_URL. Add it to window.EH_ENV.");
  }

  const trimmedQuery = (query || "").trim();
  if (!trimmedQuery) return { results: [], q: "", mode };

  const safeLimit = clampLimit(limit);
  const url = `${baseUrl}/food-search?q=${encodeURIComponent(trimmedQuery)}&mode=${mode}&limit=${safeLimit}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok || payload?.ok === false) {
    const message = payload?.message || `Food search failed (${resp.status})`;
    throw new Error(message);
  }

  return {
    results: Array.isArray(payload?.results) ? payload.results : [],
    q: payload?.q || trimmedQuery,
    mode: payload?.mode || mode,
  };
}
