// js/progress.js
import { supabase } from "./supabaseClient.js";
import {
  progressNoFamily,
  progressHasFamily,
  progressForm,
  progressDateInput,
  progressWeightInput,
  progressWaterInput,
  progressSleepInput,
  progressStepsInput,
  progressMoodInput,
  progressNotesInput,
  progressMessage,
  progressList,
} from "./dom.js";
import { currentUser, currentFamilyId } from "./state.js";
import { maybeVibrate, showToast } from "./ui.js";

export function setProgressFamilyState() {
  if (!progressNoFamily || !progressHasFamily) return;

  if (currentFamilyId) {
    progressNoFamily.style.display = "none";
    progressHasFamily.style.display = "block";
  } else {
    progressNoFamily.style.display = "block";
    progressHasFamily.style.display = "none";
    if (progressList) progressList.innerHTML = "";
    if (progressMessage) {
      progressMessage.textContent = "";
      progressMessage.style.color = "";
    }
  }
}

export async function loadProgressLogs() {
  if (!currentFamilyId || !progressList) return;

  if (progressMessage) {
    progressMessage.textContent = "";
    progressMessage.style.color = "";
  }
  progressList.innerHTML = "<li>Loading progress...</li>";

  const { data, error } = await supabase
    .from("progress_logs")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("log_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading progress logs:", error);
    progressList.innerHTML = "<li>Could not load progress.</li>";
  } else {
    renderProgressLogs(data || []);
  }
}

function renderProgressLogs(items) {
  if (!progressList) return;

  if (!items.length) {
    progressList.innerHTML = "<li>No progress entries yet. Add one above!</li>";
    return;
  }

  progressList.innerHTML = "";

  for (const p of items) {
    const li = document.createElement("li");
    li.dataset.progressId = p.id;
    li.style.display = "flex";
    li.style.flexDirection = "column";
    li.style.gap = "0.25rem";
    li.style.padding = "0.5rem 0";
    li.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.justifyContent = "space-between";
    topRow.style.alignItems = "center";
    topRow.style.gap = "0.5rem";

    const left = document.createElement("div");

    const title = document.createElement("div");
    const dateStr = p.log_date;
    title.textContent = `Progress • ${dateStr}`;
    title.style.fontWeight = "600";

    const meta = document.createElement("div");
    meta.style.fontSize = "0.8rem";
    meta.style.opacity = "0.8";

    const parts = [];
    if (p.weight_lb != null) parts.push(`${p.weight_lb} lb`);
    if (p.water_oz != null) parts.push(`${p.water_oz} oz water`);
    if (p.sleep_hours != null) parts.push(`${p.sleep_hours} hrs sleep`);
    if (p.steps != null) parts.push(`${p.steps} steps`);
    if (p.mood) parts.push(`Mood: ${p.mood}`);

    meta.textContent = parts.join(" • ") || "No metrics recorded";

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("progress-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    topRow.appendChild(left);
    topRow.appendChild(right);

    li.appendChild(topRow);

    if (p.notes) {
      const notes = document.createElement("div");
      notes.textContent = p.notes;
      notes.style.fontSize = "0.8rem";
      notes.style.opacity = "0.8";
      li.appendChild(notes);
    }

    progressList.appendChild(li);
  }
}

// ADD PROGRESS ENTRY
if (progressForm) {
  progressForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (progressMessage) {
      progressMessage.textContent = "";
      progressMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (progressMessage) {
        progressMessage.textContent = "You need a family group to log progress.";
        progressMessage.style.color = "red";
      }
      return;
    }

    const dateValue = progressDateInput.value;
    if (!dateValue) return;

    const weightRaw = progressWeightInput.value;
    const waterRaw = progressWaterInput.value;
    const sleepRaw = progressSleepInput.value;
    const stepsRaw = progressStepsInput.value;
    const mood = progressMoodInput.value.trim();
    const notes = progressNotesInput.value.trim();

    const weight = weightRaw ? Number(weightRaw) : null;
    const water = waterRaw ? Number(waterRaw) : null;
    const sleep = sleepRaw ? Number(sleepRaw) : null;
    const steps = stepsRaw ? Number(stepsRaw) : null;

    const { error } = await supabase.from("progress_logs").insert({
      family_group_id: currentFamilyId,
      user_id: currentUser.id,
      log_date: dateValue,
      weight_lb: weight,
      water_oz: water,
      sleep_hours: sleep,
      steps: steps,
      mood: mood || null,
      notes: notes || null,
    });

    if (error) {
      console.error("Error adding progress entry:", error);
      if (progressMessage) {
        progressMessage.textContent = "Error adding progress.";
        progressMessage.style.color = "red";
      }
      return;
    }

    progressForm.reset();
    await loadProgressLogs();
    showToast("Progress saved");
    maybeVibrate([10]);
  });
}

// DELETE PROGRESS ENTRY
if (progressList) {
  progressList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const progressId = li.dataset.progressId;
    if (!progressId) return;

    if (e.target.classList.contains("progress-delete")) {
      const { error } = await supabase
        .from("progress_logs")
        .delete()
        .eq("id", progressId);

      if (error) {
        console.error("Error deleting progress entry:", error);
        return;
      }

      await loadProgressLogs();
      return;
    }
  });
}
