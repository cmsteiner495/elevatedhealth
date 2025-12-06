import {
  aiDinnerGrid,
  modalBackdrop,
  modalBody,
  modalCloseButtons,
  modalPrimaryButton,
  modalTitle,
  themeLabel,
  themeToggleButton,
  toastContainer,
} from "./dom.js";

const THEME_KEY = "eh-theme";
let activeTheme = "dark";
let modalKeyHandler = null;
let previousFocus = null;
let dinnerLogHandler = null;

export function maybeVibrate(pattern = [12]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function")
    return;
  try {
    navigator.vibrate(pattern);
  } catch (err) {
    console.warn("Vibration not supported", err);
  }
}

export function showToast(message = "") {
  if (!toastContainer || !message) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

export function setDinnerLogHandler(cb) {
  dinnerLogHandler = cb;
}

const dinnerIdeas = [
  {
    id: "one-pan-chicken",
    title: "One-Pan Chicken & Vegetables",
    description:
      "Herb-roasted chicken thighs with carrots, potatoes, and green beans in a single pan.",
    ingredients: [
      "4 bone-in chicken thighs",
      "2 cups baby potatoes, halved",
      "2 cups green beans",
      "2 carrots, sliced",
      "2 tbsp olive oil + garlic herb seasoning",
    ],
    nutrition: {
      calories: 520,
      protein: "38g",
      carbs: "42g",
      fat: "18g",
    },
    instructions:
      "Toss veggies with oil and seasoning. Add chicken on top and roast at 400°F for 35-40 minutes until crispy.",
    recipeUrl: "https://example.com/one-pan-chicken",
  },
  {
    id: "lemon-salmon",
    title: "Lemon-Dill Salmon Bowls",
    description: "Seared salmon over quinoa with cucumber, tomatoes, and yogurt-dill drizzle.",
    ingredients: [
      "4 salmon filets",
      "2 cups cooked quinoa",
      "1 cup cherry tomatoes",
      "1 cup sliced cucumber",
      "Yogurt + lemon + dill sauce",
    ],
    nutrition: {
      calories: 610,
      protein: "42g",
      carbs: "48g",
      fat: "24g",
    },
    instructions:
      "Sear salmon 3-4 minutes per side. Layer bowls with quinoa, veggies, and spoon sauce over top.",
    recipeUrl: "https://example.com/lemon-salmon",
  },
  {
    id: "veggie-pasta",
    title: "Creamy Veggie Pasta",
    description:
      "Whole-grain pasta tossed with spinach, roasted peppers, and a light cashew cream sauce.",
    ingredients: [
      "12 oz whole-grain pasta",
      "2 cups spinach",
      "1 cup roasted peppers",
      "1/2 cup cashew cream or light cream",
      "Parmesan, salt, pepper",
    ],
    nutrition: {
      calories: 520,
      protein: "21g",
      carbs: "68g",
      fat: "16g",
    },
    instructions:
      "Cook pasta to al dente. Toss with sautéed veggies and cream sauce; finish with parmesan and pepper.",
  },
];

function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    // noop for environments without storage
  }
}

export function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  activeTheme = nextTheme;
  const root = document.documentElement;
  if (nextTheme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  persistTheme(nextTheme);
  if (themeLabel) {
    themeLabel.textContent = nextTheme === "light" ? "Light" : "Dark";
  }
  if (themeToggleButton) {
    themeToggleButton.setAttribute("aria-pressed", nextTheme === "light");
  }
}

export function initThemeToggle() {
  const stored = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  })();

  setTheme(stored || "dark");

  if (!themeToggleButton) return;
  themeToggleButton.addEventListener("click", () => {
    const next = activeTheme === "dark" ? "light" : "dark";
    setTheme(next);
    showToast("Settings saved");
    maybeVibrate([10]);
  });
}

function getFocusableElements(container) {
  return container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
}

function handleFocusTrap(e) {
  if (!modalBackdrop?.classList.contains("is-open")) return;
  if (e.key === "Escape") {
    closeModal();
    return;
  }
  if (e.key !== "Tab") return;

  const focusable = getFocusableElements(modalBackdrop);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function initModal() {
  if (!modalBackdrop) return;
  modalCloseButtons.forEach((btn) =>
    btn.addEventListener("click", () => closeModal())
  );
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });
}

export function openModal({ title, body, primaryLabel, onPrimary }) {
  if (!modalBackdrop || !modalTitle || !modalBody) return;

  modalTitle.textContent = title || "Details";
  modalBody.innerHTML = "";
  if (body) {
    modalBody.append(body);
  }

  if (modalPrimaryButton) {
    if (primaryLabel) {
      modalPrimaryButton.textContent = primaryLabel;
      modalPrimaryButton.style.display = "inline-flex";
      modalPrimaryButton.onclick = async () => {
        if (typeof onPrimary === "function") {
          await onPrimary();
        }
        closeModal();
      };
    } else {
      modalPrimaryButton.style.display = "none";
    }
  }

  previousFocus = document.activeElement;
  modalBackdrop.classList.add("is-open");
  modalBackdrop.setAttribute("aria-hidden", "false");

  modalKeyHandler = (e) => handleFocusTrap(e);
  document.addEventListener("keydown", modalKeyHandler);

  const focusable = getFocusableElements(modalBackdrop);
  const firstTarget = focusable[0] || modalBackdrop;
  firstTarget.focus();
}

export function closeModal() {
  if (!modalBackdrop) return;
  modalBackdrop.classList.remove("is-open");
  modalBackdrop.setAttribute("aria-hidden", "true");
  if (modalKeyHandler) {
    document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = null;
  }
  if (previousFocus && typeof previousFocus.focus === "function") {
    previousFocus.focus();
  }
}

function createNutritionRow(label, value) {
  const pill = document.createElement("span");
  pill.className = "ai-dinner-pill";
  pill.textContent = `${label}: ${value}`;
  return pill;
}

function buildDinnerModalContent(meal) {
  const wrapper = document.createElement("div");
  wrapper.className = "modal-meal-details";

  if (meal.description) {
    const desc = document.createElement("p");
    desc.className = "modal-note";
    desc.textContent = meal.description;
    wrapper.appendChild(desc);
  }

  if (meal.ingredients?.length) {
    const ingTitle = document.createElement("h4");
    ingTitle.className = "modal-section-title";
    ingTitle.textContent = "Ingredients";
    wrapper.appendChild(ingTitle);

    const list = document.createElement("ul");
    list.className = "modal-list";
    meal.ingredients.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    wrapper.appendChild(list);
  }

  const nutrition = meal.nutrition;
  const hasNutrition = nutrition && Object.keys(nutrition).length;
  const nutritionBlock = document.createElement("div");
  nutritionBlock.className = "ai-dinner-meta";
  nutritionBlock.setAttribute("aria-label", "Nutrition summary");

  if (hasNutrition) {
    if (nutrition.calories) {
      nutritionBlock.appendChild(
        createNutritionRow("Calories", `${nutrition.calories}`)
      );
    }
    if (nutrition.protein) {
      nutritionBlock.appendChild(createNutritionRow("Protein", nutrition.protein));
    }
    if (nutrition.carbs) {
      nutritionBlock.appendChild(createNutritionRow("Carbs", nutrition.carbs));
    }
    if (nutrition.fat) {
      nutritionBlock.appendChild(createNutritionRow("Fat", nutrition.fat));
    }
  } else {
    const note = document.createElement("div");
    note.className = "modal-note";
    note.textContent = "Nutrition info coming soon.";
    nutritionBlock.appendChild(note);
  }

  wrapper.appendChild(nutritionBlock);

  if (meal.instructions || meal.recipeUrl) {
    const howTo = document.createElement("div");
    howTo.className = "modal-note";
    howTo.textContent =
      meal.instructions || "View full recipe for detailed instructions.";
    wrapper.appendChild(howTo);
  }

  if (meal.recipeUrl) {
    const link = document.createElement("a");
    link.href = meal.recipeUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "ai-dinner-pill";
    link.textContent = "View full recipe";
    wrapper.appendChild(link);
  }

  return wrapper;
}

function openDinnerModal(meal) {
  const body = buildDinnerModalContent(meal);
  openModal({
    title: meal.title,
    body,
    primaryLabel: "Log this meal",
    onPrimary: async () => {
      if (typeof dinnerLogHandler === "function") {
        await dinnerLogHandler(meal);
      }
      if (meal.recipeUrl) {
        window.open(meal.recipeUrl, "_blank");
      }
    },
  });
}

export function initAIDinnerCards() {
  if (!aiDinnerGrid) return;
  aiDinnerGrid.innerHTML = "";

  dinnerIdeas.forEach((meal) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ai-dinner-card";

    const title = document.createElement("h4");
    title.textContent = meal.title;
    card.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "modal-note";
    desc.textContent = meal.description;
    card.appendChild(desc);

    const meta = document.createElement("div");
    meta.className = "ai-dinner-meta";
    meta.innerHTML =
      `<span class="ai-dinner-pill">Dinner</span><span class="ai-dinner-pill">Prep: quick</span>`;
    card.appendChild(meta);

    card.addEventListener("click", () => openDinnerModal(meal));
    aiDinnerGrid.appendChild(card);
  });
}

// Apply stored theme immediately
const storedTheme = (() => {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (e) {
    return null;
  }
})();
setTheme(storedTheme || "dark");
