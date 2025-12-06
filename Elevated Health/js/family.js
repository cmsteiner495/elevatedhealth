// js/family.js
import { supabase } from "./supabaseClient.js";
import { familyStatus } from "./dom.js";
import {
  setCurrentFamilyId,
  currentFamilyId,
} from "./state.js";
import { setGroceryFamilyState, loadGroceryItems } from "./grocery.js";
import { setMealsFamilyState, loadMeals } from "./meals.js";
import { setWorkoutsFamilyState, loadWorkouts } from "./workouts.js";
import { setProgressFamilyState, loadProgressLogs } from "./progress.js";
import { loadCoachHistory } from "./coach.js";

export async function loadFamilyState(user) {
  if (!familyStatus) return;

  familyStatus.innerHTML = "Loading family info...";
  setCurrentFamilyId(null);
  setGroceryFamilyState();
  setMealsFamilyState();
  setWorkoutsFamilyState();
  setProgressFamilyState();

  const { data: memberships, error } = await supabase
    .from("family_members")
    .select("id, role, family_group_id, family_groups(name)")
    .eq("user_id", user.id);

  if (error) {
    console.error("Error loading family memberships:", error);
    familyStatus.innerHTML = "<p>Could not load family info.</p>";
    await loadCoachHistory();
    return;
  }

  if (!memberships || memberships.length === 0) {
    familyStatus.innerHTML = `
      <div class="card">
        <h3>No family group yet</h3>
        <p>Create a family group so you can share meal plans, workouts, and grocery lists.</p>
        <button id="create-family-btn">Create Family Group</button>
      </div>
    `;

    const createBtn = document.getElementById("create-family-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => handleCreateFamily(user));
    }

    setCurrentFamilyId(null);
    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();
    await loadCoachHistory();
  } else {
    const m = memberships[0];
    const familyName = m.family_groups?.name || "Your Family Group";
    const role = m.role;

    setCurrentFamilyId(m.family_group_id);

    familyStatus.innerHTML = `
      <div class="card">
        <h3>${familyName}</h3>
        <p>Role: <strong>${role}</strong></p>
        <p>You’re connected! Future UI will show members, invites, etc.</p>
      </div>
    `;

    setGroceryFamilyState();
    setMealsFamilyState();
    setWorkoutsFamilyState();
    setProgressFamilyState();

    await loadGroceryItems();
    await loadMeals();
    await loadWorkouts();
    await loadProgressLogs();
    await loadCoachHistory();
  }
}

async function handleCreateFamily(user) {
  const name = window.prompt(
    "Enter a name for your family group:",
    "Steiner Family Health"
  );

  if (!name || !name.trim()) {
    return;
  }

  const { data: family, error: familyError } = await supabase
    .from("family_groups")
    .insert({
      name: name.trim(),
      created_by: user.id,
    })
    .select()
    .single();

  if (familyError) {
    console.error("Error creating family group:", familyError);
    alert("There was an error creating the family group.");
    return;
  }

  const { error: memberError } = await supabase.from("family_members").insert({
    family_group_id: family.id,
    user_id: user.id,
    role: "admin",
  });

  if (memberError) {
    console.error("Error creating family membership:", memberError);
    alert(
      "Family was created, but we could not link your account. Please contact support (you)."
    );
    return;
  }

  setCurrentFamilyId(family.id);
  await loadFamilyState(user);
  alert("Family group created successfully!");
}
