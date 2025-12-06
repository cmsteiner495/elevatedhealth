// js/state.js
export let currentUser = null;
export let currentFamilyId = null;

export function setCurrentUser(user) {
  currentUser = user;
}

export function setCurrentFamilyId(familyId) {
  currentFamilyId = familyId;
}
