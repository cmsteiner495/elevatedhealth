// js/grocery.js
import { supabase } from "./supabaseClient.js";
import {
  groceryNoFamily,
  groceryHasFamily,
  groceryForm,
  groceryName,
  groceryQuantity,
  groceryCategory,
  groceryMessage,
  groceryList,
} from "./dom.js";
import { currentUser, currentFamilyId } from "./state.js";
import { guardMutation } from "./debug/mutationGuard.js";

let groceryItems = [];

export function getGroceryItems() {
  return Array.isArray(groceryItems) ? [...groceryItems] : [];
}

function announceGroceryChange() {
  window.dispatchEvent(
    new CustomEvent("eh:data-changed", { detail: { source: "grocery" } })
  );
  window.dispatchEvent(
    new CustomEvent("eh:dataChanged", { detail: { source: "grocery" } })
  );
}

export function setGroceryFamilyState() {
  if (!groceryNoFamily || !groceryHasFamily) return;

  if (currentFamilyId) {
    groceryNoFamily.style.display = "none";
    groceryHasFamily.style.display = "block";
  } else {
    groceryNoFamily.style.display = "block";
    groceryHasFamily.style.display = "none";
    groceryItems = [];
    if (groceryList) groceryList.innerHTML = "";
    if (groceryMessage) {
      groceryMessage.textContent = "";
      groceryMessage.style.color = "";
    }
  }
}

export async function loadGroceryItems() {
  if (!currentFamilyId || !groceryList) return;

  if (groceryMessage) {
    groceryMessage.textContent = "";
    groceryMessage.style.color = "";
  }
  groceryList.innerHTML = "<li>Loading items...</li>";

  const { data, error } = await supabase
    .from("grocery_list_items")
    .select("*")
    .eq("family_group_id", currentFamilyId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading grocery items:", error);
    groceryList.innerHTML = "<li>Could not load grocery items.</li>";
    return;
  }

  groceryItems = data || [];
  renderGroceryList();
  announceGroceryChange();
}

function renderGroceryList(items = groceryItems) {
  if (!groceryList) return;

  if (!items.length) {
    groceryList.innerHTML = "<li>No items yet. Add something above!</li>";
    return;
  }

  groceryList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.dataset.itemId = item.id;
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.gap = "0.5rem";
    li.style.padding = "0.25rem 0";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.5rem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.checked || false;
    checkbox.classList.add("grocery-checkbox");

    const text = document.createElement("span");
    text.textContent = item.name + (item.quantity ? ` (${item.quantity})` : "");
    if (item.checked) {
      text.style.textDecoration = "line-through";
      text.style.opacity = "0.6";
    }

    left.appendChild(checkbox);
    left.appendChild(text);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "0.5rem";

    if (item.category) {
      const cat = document.createElement("span");
      cat.textContent = item.category;
      cat.style.fontSize = "0.75rem";
      cat.style.opacity = "0.8";
      right.appendChild(cat);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.type = "button";
    delBtn.classList.add("grocery-delete");
    delBtn.style.paddingInline = "0.6rem";

    right.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(right);
    groceryList.appendChild(li);
  }
}

// ADD GROCERY ITEM
if (groceryForm) {
  groceryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (groceryMessage) {
      groceryMessage.textContent = "";
      groceryMessage.style.color = "";
    }

    if (!currentUser || !currentFamilyId) {
      if (groceryMessage) {
        groceryMessage.textContent = "You need a family group to add items.";
        groceryMessage.style.color = "red";
      }
      return;
    }

    const name = groceryName.value.trim();
    const quantity = groceryQuantity.value.trim();
    const category = groceryCategory.value.trim();

    if (!name) return;

    const { error } = await supabase.from("grocery_list_items").insert({
      family_group_id: currentFamilyId,
      added_by: currentUser.id,
      name,
      quantity: quantity || null,
      category: category || null,
    });

    if (error) {
      console.error("Error adding grocery item:", error);
      if (groceryMessage) {
        groceryMessage.textContent = "Error adding item.";
        groceryMessage.style.color = "red";
      }
      return;
    }

    groceryForm.reset();
    await loadGroceryItems();
  });
}

// TOGGLE CHECK + DELETE
if (groceryList) {
  groceryList.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    if (!li) return;

    const itemId = li.dataset.itemId;
    if (!itemId) return;

    // Toggle checked
    if (e.target.classList.contains("grocery-checkbox")) {
      const checked = e.target.checked;
      const existing = groceryItems.find((item) => item.id === itemId);
      if (existing) {
        groceryItems = groceryItems.map((item) =>
          item.id === itemId ? { ...item, checked } : item
        );
        renderGroceryList();
      }

      if (!currentFamilyId) {
        guardMutation({
          table: "grocery_list_items",
          operation: "update",
          filters: { id: itemId },
        });
        console.warn("[GROCERY] Missing family id for update");
        groceryItems = groceryItems.map((item) =>
          item.id === itemId ? { ...item, checked: !checked } : item
        );
        renderGroceryList();
        return;
      }

      guardMutation({
        table: "grocery_list_items",
        operation: "update",
        filters: { id: itemId, family_group_id: currentFamilyId },
      });
      const { error } = await supabase
        .from("grocery_list_items")
        .update({ checked, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .eq("family_group_id", currentFamilyId);

      if (error) {
        console.error("Error updating grocery item:", error);
        groceryItems = groceryItems.map((item) =>
          item.id === itemId ? { ...item, checked: !checked } : item
        );
        renderGroceryList();
        return;
      }
      announceGroceryChange();
      return;
    }

    // Delete
    if (e.target.classList.contains("grocery-delete")) {
      li.classList.add("list-removing");
      if (!currentFamilyId) {
        guardMutation({
          table: "grocery_list_items",
          operation: "delete",
          filters: { id: itemId },
        });
        console.warn("[GROCERY] Missing family id for delete");
        li.classList.remove("list-removing");
        return;
      }
      guardMutation({
        table: "grocery_list_items",
        operation: "delete",
        filters: { id: itemId, family_group_id: currentFamilyId },
      });
      const { error } = await supabase
        .from("grocery_list_items")
        .delete()
        .eq("id", itemId)
        .eq("family_group_id", currentFamilyId);

      if (error) {
        console.error("Error deleting grocery item:", error);
        li.classList.remove("list-removing");
        return;
      }

      groceryItems = groceryItems.filter((item) => item.id !== itemId);
      setTimeout(() => renderGroceryList(), 160);
      announceGroceryChange();
      return;
    }
  });
}
