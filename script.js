/**
 * TaskFlow — To-Do List Dashboard (Vanilla JavaScript)
 * Demonstrates full CRUD operations (Create, Read, Update, Delete)
 * connected to Supabase via server-side /api/tasks routes, with automatic
 * LocalStorage fallback when opened standalone or before secrets are set.
 */

// ==========================================================================
// 1. Constants & Application State
// ==========================================================================

const STORAGE_KEY = "taskflow_tasks_v1";
const API_BASE = "/api/tasks";

/** @type {Array<{id: string, title: string, date: string, completed: boolean, createdAt: number}>} */
let tasks = [];

/** True once the server confirms Supabase credentials are configured and active */
let useSupabaseApi = false;

/** Current active status filter: "all" | "pending" | "completed" */
let currentFilter = "all";

/** Current live search text */
let searchQuery = "";

/** ID of the task currently open in inline edit mode (or null) */
let editingTaskId = null;

/** Stores the pending delete callback while the confirmation modal is open */
let pendingDeleteAction = null;

// ==========================================================================
// 2. DOM Element References
// ==========================================================================

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const brandHomeLink = document.getElementById("brandHomeLink");

const currentViewLabel = document.getElementById("currentViewLabel");
const currentDateEl = document.getElementById("currentDate");
const focusInputBtn = document.getElementById("focusInputBtn");

const statTotalEl = document.getElementById("statTotal");
const statPendingEl = document.getElementById("statPending");
const statCompletedEl = document.getElementById("statCompleted");

const navCountAllEl = document.getElementById("navCountAll");
const navCountPendingEl = document.getElementById("navCountPending");
const navCountCompletedEl = document.getElementById("navCountCompleted");
const progressPercentEl = document.getElementById("progressPercent");
const progressTrackEl = document.getElementById("progressTrack");
const progressBarFillEl = document.getElementById("progressBarFill");
const progressCaptionEl = document.getElementById("progressCaption");

const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskDateInput = document.getElementById("taskDateInput");
const formErrorEl = document.getElementById("formError");

const taskListEl = document.getElementById("taskList");
const emptyStateEl = document.getElementById("emptyState");
const emptyStateTitleEl = document.getElementById("emptyStateTitle");
const emptyStateMessageEl = document.getElementById("emptyStateMessage");
const emptyStateActionBtn = document.getElementById("emptyStateActionBtn");

const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const clearCompletedBtn = document.getElementById("clearCompletedBtn");

const filterButtons = document.querySelectorAll("[data-filter]");

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalMessage = document.getElementById("confirmModalMessage");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

const toastContainer = document.getElementById("toastContainer");

// ==========================================================================
// 3. Helper Utilities (Date Formatting & Unique IDs)
// ==========================================================================

/**
 * Returns today's local date in YYYY-MM-DD format for the date picker.
 */
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a YYYY-MM-DD string into a clean, readable date (e.g., "Nov 24, 2026").
 * Parses year, month, and day locally to avoid timezone offset shifts.
 */
function formatDisplayDate(dateString) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return "No date";
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);

  return localDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Generates a unique task ID for offline / LocalStorage fallback mode.
 */
function generateTaskId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ==========================================================================
// 4. Data Persistence (Supabase API + LocalStorage Fallback)
// ==========================================================================

/**
 * Loads saved tasks from browser LocalStorage (used when Supabase is not configured yet).
 */
function loadTasksFromStorage() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) {
      return [];
    }

    const parsed = JSON.parse(rawData);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.completed === "boolean"
    );
  } catch (error) {
    console.error("Failed to load tasks from LocalStorage:", error);
    return [];
  }
}

/**
 * Saves the current tasks array into browser LocalStorage.
 */
function saveTasksToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.error("Failed to save tasks to LocalStorage:", error);
  }
}

/**
 * Fetches all tasks from the server-side Supabase proxy (/api/tasks).
 * Falls back to LocalStorage if the server has not been configured with Supabase secrets yet.
 */
async function loadInitialTasks() {
  try {
    const response = await fetch(API_BASE, {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const payload = await response.json();
      useSupabaseApi = true;
      tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      return;
    }

    const errorPayload = await response.json().catch(() => ({}));
    if (response.status === 503 && errorPayload.configured === false) {
      useSupabaseApi = false;
      tasks = loadTasksFromStorage();
      return;
    }

    useSupabaseApi = true;
    tasks = [];
    showToast(errorPayload.error || "Could not load tasks from Supabase.", "error");
  } catch {
    // Running standalone (e.g., Live Server without Express backend)
    useSupabaseApi = false;
    tasks = loadTasksFromStorage();
  }
}

// ==========================================================================
// 5. CRUD Operations (Create, Read, Update, Delete)
// ==========================================================================

/**
 * CREATE: Validates and adds a new task to Supabase (or LocalStorage fallback).
 */
async function createTask(titleText, dateValue) {
  const trimmedTitle = titleText.trim();

  // Prevent empty task submissions
  if (!trimmedTitle) {
    showFormError("Please enter a task name before adding.");
    showToast("Task name cannot be empty.", "error");
    taskInput.focus();
    return false;
  }

  clearFormError();
  const normalizedDate = dateValue || getTodayDateString();

  if (useSupabaseApi) {
    try {
      const response = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, date: normalizedDate }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task) {
        showToast(payload.error || "Failed to add task to Supabase.", "error");
        return false;
      }

      tasks.unshift(payload.task);
    } catch {
      showToast("Network error while adding task to Supabase.", "error");
      return false;
    }
  } else {
    const newTask = {
      id: generateTaskId(),
      title: trimmedTitle,
      date: normalizedDate,
      completed: false,
      createdAt: Date.now(),
    };
    tasks.unshift(newTask);
    saveTasksToStorage();
  }

  // If the user is viewing only "Completed", switch to "All" so the newly created task is visible
  if (currentFilter === "completed") {
    setFilter("all");
  } else {
    renderApp();
  }

  showToast("Task added successfully.", "success");
  return true;
}

/**
 * UPDATE (Status): Toggles a task between completed and pending.
 */
async function toggleTaskStatus(taskId) {
  const targetTask = tasks.find((task) => task.id === taskId);
  if (!targetTask) {
    return;
  }

  const nextCompleted = !targetTask.completed;

  if (useSupabaseApi) {
    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: nextCompleted }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task) {
        showToast(payload.error || "Failed to update task status.", "error");
        return;
      }

      targetTask.completed = payload.task.completed;
    } catch {
      showToast("Network error while updating task status.", "error");
      return;
    }
  } else {
    targetTask.completed = nextCompleted;
    saveTasksToStorage();
  }

  renderApp();

  if (targetTask.completed) {
    showToast("Task marked as completed.", "success");
  } else {
    showToast("Task marked as pending.", "info");
  }
}

/**
 * UPDATE (Edit Mode): Opens inline editing for a specific task.
 */
function startEditingTask(taskId) {
  editingTaskId = taskId;
  renderTasksList();

  const editInput = document.querySelector(".task-edit-input");
  if (editInput) {
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);
  }
}

/**
 * UPDATE (Save Edit): Validates and saves changes to an existing task immediately.
 */
async function saveEditedTask(taskId, updatedTitle, updatedDate) {
  const trimmedTitle = updatedTitle.trim();

  if (!trimmedTitle) {
    showToast("Task name cannot be empty.", "error");
    const editInput = document.querySelector(".task-edit-input");
    if (editInput) {
      editInput.focus();
    }
    return;
  }

  const targetTask = tasks.find((task) => task.id === taskId);
  if (!targetTask) {
    editingTaskId = null;
    renderTasksList();
    return;
  }

  const nextDate = updatedDate || targetTask.date;

  if (useSupabaseApi) {
    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, date: nextDate }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task) {
        showToast(payload.error || "Failed to update task in Supabase.", "error");
        return;
      }

      targetTask.title = payload.task.title;
      targetTask.date = payload.task.date;
    } catch {
      showToast("Network error while saving task changes.", "error");
      return;
    }
  } else {
    targetTask.title = trimmedTitle;
    targetTask.date = nextDate;
    saveTasksToStorage();
  }

  editingTaskId = null;
  renderApp();
  showToast("Task updated successfully.", "success");
}

/**
 * Cancels inline editing without saving changes.
 */
function cancelEditingTask() {
  editingTaskId = null;
  renderTasksList();
}

/**
 * DELETE (Request): Opens the confirmation dialog before deleting a task.
 */
function requestDeleteTask(taskId) {
  const targetTask = tasks.find((task) => task.id === taskId);
  if (!targetTask) {
    return;
  }

  openConfirmModal({
    title: "Delete task?",
    message: `Are you sure you want to permanently delete "${targetTask.title}"? This action cannot be undone.`,
    confirmLabel: "Delete Task",
    onConfirm: () => {
      deleteTaskById(taskId);
    },
  });
}

/**
 * DELETE (Execute): Removes a task by ID after user confirmation.
 */
async function deleteTaskById(taskId) {
  if (useSupabaseApi) {
    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || "Failed to delete task from Supabase.", "error");
        return;
      }
    } catch {
      showToast("Network error while deleting task.", "error");
      return;
    }
  }

  tasks = tasks.filter((task) => task.id !== taskId);

  if (editingTaskId === taskId) {
    editingTaskId = null;
  }

  if (!useSupabaseApi) {
    saveTasksToStorage();
  }

  renderApp();
  showToast("Task deleted successfully.", "success");
}

/**
 * DELETE (Bulk): Requests confirmation before clearing all completed tasks.
 */
function requestClearCompleted() {
  const completedCount = tasks.filter((task) => task.completed).length;
  if (completedCount === 0) {
    return;
  }

  const noun = completedCount === 1 ? "task" : "tasks";
  openConfirmModal({
    title: "Clear completed tasks?",
    message: `Are you sure you want to remove ${completedCount} completed ${noun}?`,
    confirmLabel: "Clear Completed",
    onConfirm: async () => {
      if (useSupabaseApi) {
        try {
          const response = await fetch(`${API_BASE}/completed`, {
            method: "DELETE",
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            showToast(payload.error || "Failed to clear completed tasks.", "error");
            return;
          }
        } catch {
          showToast("Network error while clearing completed tasks.", "error");
          return;
        }
      }

      tasks = tasks.filter((task) => !task.completed);
      editingTaskId = null;

      if (!useSupabaseApi) {
        saveTasksToStorage();
      }

      renderApp();
      showToast(`Cleared ${completedCount} completed ${noun}.`, "success");
    },
  });
}

// ==========================================================================
// 6. READ & Rendering Functions
// ==========================================================================

/**
 * Returns tasks filtered by the active status tab and live search query.
 */
function getFilteredTasks() {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return tasks.filter((task) => {
    if (currentFilter === "completed" && !task.completed) {
      return false;
    }
    if (currentFilter === "pending" && task.completed) {
      return false;
    }
    if (normalizedQuery && !task.title.toLowerCase().includes(normalizedQuery)) {
      return false;
    }
    return true;
  });
}

/**
 * Updates all dashboard counters, sidebar counts, and completion progress bar.
 */
function updateStats() {
  const totalCount = tasks.length;
  const completedCount = tasks.filter((task) => task.completed).length;
  const pendingCount = totalCount - completedCount;
  const completionPercent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  statTotalEl.textContent = String(totalCount);
  statPendingEl.textContent = String(pendingCount);
  statCompletedEl.textContent = String(completedCount);

  navCountAllEl.textContent = String(totalCount);
  navCountPendingEl.textContent = String(pendingCount);
  navCountCompletedEl.textContent = String(completedCount);

  progressPercentEl.textContent = `${completionPercent}%`;
  progressBarFillEl.style.width = `${completionPercent}%`;
  progressTrackEl.setAttribute("aria-valuenow", String(completionPercent));
  progressCaptionEl.textContent = `${completedCount} of ${totalCount} ${
    totalCount === 1 ? "task" : "tasks"
  } completed`;

  // Show "Clear Completed" only when at least one completed task exists
  clearCompletedBtn.hidden = completedCount === 0;
}

/**
 * Builds a single task list row DOM element (either view mode or inline edit mode).
 * Uses textContent for all user-provided strings to keep rendering safe from XSS.
 */
function buildTaskRowElement(task) {
  const li = document.createElement("li");
  li.className = `task-item${task.completed ? " is-completed" : ""}`;
  li.dataset.taskId = task.id;

  // Inline Edit Mode
  if (editingTaskId === task.id) {
    const editForm = document.createElement("form");
    editForm.className = "task-edit-form";

    const editInput = document.createElement("input");
    editInput.type = "text";
    editInput.className = "task-edit-input";
    editInput.value = task.title;
    editInput.maxLength = 160;
    editInput.setAttribute("aria-label", "Edit task name");

    const editDateInput = document.createElement("input");
    editDateInput.type = "date";
    editDateInput.className = "task-edit-date";
    editDateInput.value = task.date || getTodayDateString();
    editDateInput.setAttribute("aria-label", "Edit task date");

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "task-edit-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary btn-sm";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", cancelEditingTask);

    editForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveEditedTask(task.id, editInput.value, editDateInput.value);
    });

    editInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        cancelEditingTask();
      }
    });

    actionsWrap.append(saveBtn, cancelBtn);
    editForm.append(editInput, editDateInput, actionsWrap);
    li.appendChild(editForm);
    return li;
  }

  // Standard View Mode
  const mainDiv = document.createElement("div");
  mainDiv.className = "task-main";

  // Completion Toggle Button
  const checkboxBtn = document.createElement("button");
  checkboxBtn.type = "button";
  checkboxBtn.className = "task-checkbox";
  checkboxBtn.setAttribute(
    "aria-label",
    task.completed ? `Mark "${task.title}" as pending` : `Mark "${task.title}" as completed`
  );
  checkboxBtn.setAttribute("aria-pressed", String(task.completed));
  checkboxBtn.innerHTML = `
    <span class="checkbox-box" aria-hidden="true">
      <svg class="checkbox-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </span>
  `;
  checkboxBtn.addEventListener("click", () => toggleTaskStatus(task.id));

  // Task Content (Title + Clean Unboxed Metadata)
  const bodyDiv = document.createElement("div");
  bodyDiv.className = "task-body";

  const titleEl = document.createElement("p");
  titleEl.className = "task-title";
  titleEl.textContent = task.title;

  const metaEl = document.createElement("div");
  metaEl.className = "task-meta";

  const dateEl = document.createElement("span");
  dateEl.className = "task-date";
  dateEl.textContent = formatDisplayDate(task.date);

  const sepEl = document.createElement("span");
  sepEl.className = "task-meta-sep";
  sepEl.setAttribute("aria-hidden", "true");
  sepEl.textContent = "·";

  const statusEl = document.createElement("span");
  statusEl.className = `task-status-text ${task.completed ? "is-completed" : "is-pending"}`;
  statusEl.textContent = task.completed ? "Completed" : "Pending";

  metaEl.append(dateEl, sepEl, statusEl);
  bodyDiv.append(titleEl, metaEl);
  mainDiv.append(checkboxBtn, bodyDiv);

  // Action Controls (Edit + Delete)
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "task-action-btn edit-btn";
  editBtn.setAttribute("aria-label", `Edit "${task.title}"`);
  editBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
    <span>Edit</span>
  `;
  editBtn.addEventListener("click", () => startEditingTask(task.id));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "task-action-btn delete-btn";
  deleteBtn.setAttribute("aria-label", `Delete "${task.title}"`);
  deleteBtn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
    </svg>
    <span>Delete</span>
  `;
  deleteBtn.addEventListener("click", () => requestDeleteTask(task.id));

  actionsDiv.append(editBtn, deleteBtn);
  li.append(mainDiv, actionsDiv);

  return li;
}

/**
 * READ: Renders the filtered task list or displays a context-aware friendly empty state.
 */
function renderTasksList() {
  const visibleTasks = getFilteredTasks();
  taskListEl.innerHTML = "";

  if (visibleTasks.length === 0) {
    taskListEl.hidden = true;
    emptyStateEl.hidden = false;
    updateEmptyStateContent();
    return;
  }

  taskListEl.hidden = false;
  emptyStateEl.hidden = true;

  const fragment = document.createDocumentFragment();
  visibleTasks.forEach((task) => {
    fragment.appendChild(buildTaskRowElement(task));
  });
  taskListEl.appendChild(fragment);
}

/**
 * Updates the friendly empty state message depending on whether there are
 * no tasks at all or no tasks matching the current filter/search.
 */
function updateEmptyStateContent() {
  if (tasks.length === 0) {
    emptyStateTitleEl.textContent = "No tasks yet";
    emptyStateMessageEl.textContent =
      "Add your first task above to start organizing your day with TaskFlow.";
    emptyStateActionBtn.textContent = "Create Your First Task";
    emptyStateActionBtn.dataset.action = "focus-input";
    return;
  }

  if (searchQuery.trim() !== "") {
    emptyStateTitleEl.textContent = "No matching tasks";
    emptyStateMessageEl.textContent = `No tasks matched "${searchQuery.trim()}". Try another search term or clear the search.`;
    emptyStateActionBtn.textContent = "Clear Search";
    emptyStateActionBtn.dataset.action = "clear-search";
    return;
  }

  if (currentFilter === "completed") {
    emptyStateTitleEl.textContent = "No completed tasks yet";
    emptyStateMessageEl.textContent =
      "Check off a task when you finish it and it will appear here.";
    emptyStateActionBtn.textContent = "View Pending Tasks";
    emptyStateActionBtn.dataset.action = "show-pending";
    return;
  }

  emptyStateTitleEl.textContent = "All caught up";
  emptyStateMessageEl.textContent =
    "You have no pending tasks right now. Great work staying on top of your list.";
  emptyStateActionBtn.textContent = "Show All Tasks";
  emptyStateActionBtn.dataset.action = "show-all";
}

/**
 * Re-renders both dashboard statistics and the task list.
 */
function renderApp() {
  updateStats();
  renderTasksList();
}

// ==========================================================================
// 7. Filtering, Navigation & Form Feedback
// ==========================================================================

/**
 * Switches the active filter ("all", "pending", "completed") and keeps
 * both sidebar links and segmented filter tabs synchronized.
 */
function setFilter(nextFilter) {
  currentFilter = nextFilter;
  editingTaskId = null;

  const viewTitles = {
    all: "All Tasks",
    pending: "Pending Tasks",
    completed: "Completed Tasks",
  };
  currentViewLabel.textContent = viewTitles[nextFilter] || "All Tasks";

  filterButtons.forEach((btn) => {
    const isMatch = btn.dataset.filter === nextFilter;
    btn.classList.toggle("is-active", isMatch);

    if (btn.getAttribute("role") === "tab") {
      btn.setAttribute("aria-selected", String(isMatch));
    } else if (isMatch) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  closeMobileSidebar();
  renderTasksList();
}

function showFormError(message) {
  formErrorEl.textContent = message;
  taskInput.classList.add("is-invalid");
}

function clearFormError() {
  formErrorEl.textContent = "";
  taskInput.classList.remove("is-invalid");
}

// ==========================================================================
// 8. Confirmation Modal & Toast Notifications
// ==========================================================================

/**
 * Opens the custom confirmation modal before destructive actions.
 */
function openConfirmModal({ title, message, confirmLabel, onConfirm }) {
  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmDeleteBtn.textContent = confirmLabel;
  pendingDeleteAction = onConfirm;

  confirmModal.hidden = false;
  confirmDeleteBtn.focus();
}

/**
 * Closes the confirmation modal and clears any pending delete action.
 */
function closeConfirmModal() {
  confirmModal.hidden = true;
  pendingDeleteAction = null;
}

/**
 * Displays an animated notification toast at the bottom right of the screen.
 * @param {string} message - Message to display
 * @param {"success" | "error" | "info"} type - Visual style of notification
 */
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");

  const iconMarkup =
    type === "error"
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      : type === "info"
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  const iconEl = document.createElement("span");
  iconEl.className = "toast-icon";
  iconEl.innerHTML = iconMarkup;

  const textEl = document.createElement("span");
  textEl.className = "toast-message";
  textEl.textContent = message;

  toast.append(iconEl, textEl);
  toastContainer.appendChild(toast);

  // Automatically remove toast after 3.2 seconds
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => {
      toast.remove();
    }, 180);
  }, 3200);
}

// ==========================================================================
// 9. Mobile Sidebar Controls
// ==========================================================================

function openMobileSidebar() {
  sidebar.classList.add("is-open");
  sidebarOverlay.classList.add("is-visible");
  openSidebarBtn.setAttribute("aria-expanded", "true");
}

function closeMobileSidebar() {
  sidebar.classList.remove("is-open");
  sidebarOverlay.classList.remove("is-visible");
  openSidebarBtn.setAttribute("aria-expanded", "false");
}

// ==========================================================================
// 10. Event Listeners & Application Initialization
// ==========================================================================

function bindEvents() {
  // Form submission (CREATE)
  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const created = await createTask(taskInput.value, taskDateInput.value);
    if (created) {
      taskInput.value = "";
      taskDateInput.value = getTodayDateString();
      taskInput.focus();
    }
  });

  // Clear validation state as the user starts typing
  taskInput.addEventListener("input", () => {
    if (taskInput.value.trim().length > 0) {
      clearFormError();
    }
  });

  // Filter buttons (Sidebar + Segmented Control)
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetFilter = button.dataset.filter;
      if (targetFilter) {
        setFilter(targetFilter);
      }
    });
  });

  // Brand link resets to All Tasks view
  brandHomeLink.addEventListener("click", (event) => {
    event.preventDefault();
    searchQuery = "";
    searchInput.value = "";
    clearSearchBtn.hidden = true;
    setFilter("all");
  });

  // Top bar "New Task" quick-focus button
  focusInputBtn.addEventListener("click", () => {
    taskInput.scrollIntoView({ behavior: "smooth", block: "center" });
    taskInput.focus();
  });

  // Live search input
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    clearSearchBtn.hidden = searchQuery.length === 0;
    renderTasksList();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchQuery = "";
    searchInput.value = "";
    clearSearchBtn.hidden = true;
    searchInput.focus();
    renderTasksList();
  });

  // Clear Completed button
  clearCompletedBtn.addEventListener("click", requestClearCompleted);

  // Empty state contextual action button
  emptyStateActionBtn.addEventListener("click", () => {
    const action = emptyStateActionBtn.dataset.action;
    if (action === "focus-input") {
      taskInput.focus();
    } else if (action === "clear-search") {
      searchQuery = "";
      searchInput.value = "";
      clearSearchBtn.hidden = true;
      renderTasksList();
    } else if (action === "show-pending") {
      setFilter("pending");
    } else {
      setFilter("all");
    }
  });

  // Delete confirmation modal handlers
  cancelDeleteBtn.addEventListener("click", closeConfirmModal);

  confirmDeleteBtn.addEventListener("click", () => {
    const actionToRun = pendingDeleteAction;
    closeConfirmModal();
    if (typeof actionToRun === "function") {
      actionToRun();
    }
  });

  confirmModal.addEventListener("click", (event) => {
    if (event.target === confirmModal) {
      closeConfirmModal();
    }
  });

  // Mobile sidebar toggles
  openSidebarBtn.addEventListener("click", openMobileSidebar);
  closeSidebarBtn.addEventListener("click", closeMobileSidebar);
  sidebarOverlay.addEventListener("click", closeMobileSidebar);

  // Global Escape key closes modal or mobile drawer
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!confirmModal.hidden) {
        closeConfirmModal();
      } else if (sidebar.classList.contains("is-open")) {
        closeMobileSidebar();
      }
    }
  });
}

/**
 * Bootstraps TaskFlow once the DOM is ready.
 */
async function initApp() {
  // Display today's date in the top bar and default the date picker to today
  const today = new Date();
  currentDateEl.textContent = today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  currentDateEl.setAttribute("datetime", getTodayDateString());
  taskDateInput.value = getTodayDateString();

  bindEvents();
  await loadInitialTasks();
  renderApp();
}

initApp();
