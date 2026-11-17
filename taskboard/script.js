/* =========================================================
   Task Flow Board - Application logic (vanilla ES6+)

   Data flow:
   1. All tasks live in the `tasks` array (single source of truth).
   2. Every change goes through a function that updates the array,
      saves it to localStorage and calls renderTasks().
   3. renderTasks() rebuilds the board from the array, applying
      the current search and category filters.
   ========================================================= */

'use strict';

// ---------- Constants ----------
const STORAGE_KEY = 'taskflow.tasks';
const THEME_KEY = 'taskflow.theme';

/** Column order, used by the arrow buttons to move a task left/right. */
const STATUSES = ['todo', 'in-progress', 'completed'];

/** Human-readable labels for each status. */
const STATUS_LABELS = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'completed': 'Completed'
};

/** Used to sort cards inside a column: High first, then Medium, then Low. */
const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

// ---------- Application state ----------
let tasks = loadTasks();
let lastDeletedTask = null; // kept so the user can undo a delete
let toastTimer = null;

// ---------- DOM element references ----------
const taskForm = document.getElementById('task-form');
const taskTitle = document.getElementById('task-title');
const taskDescription = document.getElementById('task-description');
const taskCategory = document.getElementById('task-category');
const taskPriority = document.getElementById('task-priority');
const formError = document.getElementById('form-error');

const searchInput = document.getElementById('search-input');
const categoryFilter = document.getElementById('category-filter');
const clearCompletedButton = document.getElementById('clear-completed');
const themeToggle = document.getElementById('theme-toggle');
const board = document.querySelector('.board-container');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastUndoButton = document.getElementById('toast-undo');

/** The three task lists, indexed by status. */
const lists = {
  'todo': document.getElementById('list-todo'),
  'in-progress': document.getElementById('list-in-progress'),
  'completed': document.getElementById('list-completed')
};

// ---------- Initialise ----------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderTasks();

  // Form and filters
  taskForm.addEventListener('submit', handleAddTask);
  searchInput.addEventListener('input', renderTasks);
  categoryFilter.addEventListener('change', renderTasks);
  clearCompletedButton.addEventListener('click', clearCompletedTasks);

  // Remove the red border as soon as the user fixes a field
  [taskTitle, taskCategory, taskPriority].forEach(field => {
    field.addEventListener('input', () => field.classList.remove('invalid'));
  });

  // One listener for all cards (event delegation), so new cards work automatically
  board.addEventListener('click', handleBoardClick);
  board.addEventListener('change', handleBoardChange);

  // Native HTML5 drag and drop
  setupDragAndDrop();

  // Theme and toast
  themeToggle.addEventListener('change', handleThemeToggle);
  toastUndoButton.addEventListener('click', undoDelete);
});

// =========================================================
// Persistence (localStorage)
// =========================================================

/**
 * Reads the tasks from localStorage.
 * Returns an empty array if nothing is saved or the data is corrupted.
 */
function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(stored)) return [];

    // Keep only valid tasks, so bad data can never break the board
    return stored.filter(task =>
      task && typeof task.id === 'string' && typeof task.title === 'string' && STATUSES.includes(task.status)
    );
  } catch (error) {
    console.warn('Could not read saved tasks, starting with an empty board.', error);
    return [];
  }
}

/** Saves the current tasks array to localStorage. */
function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.warn('Could not save tasks to localStorage.', error);
  }
}

// =========================================================
// Task management (add / move / delete)
// =========================================================

/** Handles the "Add Task" form submission. */
function handleAddTask(event) {
  event.preventDefault();

  const title = taskTitle.value.trim();
  const description = taskDescription.value.trim();
  const category = taskCategory.value;
  const priority = taskPriority.value;

  // Validate the required fields and highlight the ones that are missing
  const missingFields = [];
  if (!title) missingFields.push(taskTitle);
  if (!category) missingFields.push(taskCategory);
  if (!priority) missingFields.push(taskPriority);

  missingFields.forEach(field => field.classList.add('invalid'));

  if (missingFields.length > 0) {
    formError.textContent = 'Please fill in the title, category and priority.';
    missingFields[0].focus();
    return;
  }

  formError.textContent = '';

  const newTask = {
    id: createId(),
    title,
    description,
    category,
    priority,
    status: 'todo',
    createdAt: new Date().toISOString()
  };

  tasks.push(newTask);
  saveTasks();
  renderTasks();

  // Reset the form and put the cursor back in the title for the next task
  taskForm.reset();
  taskTitle.focus();
}

/** Changes the status (column) of a task. */
function updateTaskStatus(id, newStatus) {
  if (!STATUSES.includes(newStatus)) return;

  tasks = tasks.map(task =>
    task.id === id ? { ...task, status: newStatus } : task
  );
  saveTasks();
  renderTasks();
}

/** Moves a task one column left (-1) or right (+1). */
function moveTask(id, direction) {
  const task = tasks.find(item => item.id === id);
  if (!task) return;

  const newIndex = STATUSES.indexOf(task.status) + direction;
  if (newIndex >= 0 && newIndex < STATUSES.length) {
    updateTaskStatus(id, STATUSES[newIndex]);
  }
}

/** Deletes a task, keeping a copy so it can be restored with "Undo". */
function deleteTask(id) {
  const index = tasks.findIndex(task => task.id === id);
  if (index === -1) return;

  lastDeletedTask = { task: tasks[index], index };
  tasks.splice(index, 1);
  saveTasks();
  renderTasks();

  showToast(`"${lastDeletedTask.task.title}" deleted.`);
}

/** Restores the last deleted task in its original position. */
function undoDelete() {
  if (!lastDeletedTask) return;

  tasks.splice(lastDeletedTask.index, 0, lastDeletedTask.task);
  lastDeletedTask = null;
  saveTasks();
  renderTasks();
  hideToast();
}

/** Removes every completed task after asking for confirmation. */
function clearCompletedTasks() {
  const completedCount = tasks.filter(task => task.status === 'completed').length;

  if (completedCount === 0) {
    showToast('There are no completed tasks to clear.', false);
    return;
  }

  const confirmed = window.confirm(`Delete ${completedCount} completed task(s)? This cannot be undone.`);
  if (!confirmed) return;

  tasks = tasks.filter(task => task.status !== 'completed');
  saveTasks();
  renderTasks();
}

// =========================================================
// Rendering
// =========================================================

/** Rebuilds the whole board from the `tasks` array and the active filters. */
function renderTasks() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const isFiltering = searchTerm !== '' || selectedCategory !== 'All';

  // Clear the three columns
  Object.values(lists).forEach(list => list.replaceChildren());

  const counts = { 'todo': 0, 'in-progress': 0, 'completed': 0 };

  // Apply the search (by title) and category filters
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm);
    const matchesCategory = selectedCategory === 'All' || task.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Sort: highest priority first, then the newest tasks first
  filteredTasks.sort((a, b) =>
    (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0) ||
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  // Add each card to its column
  filteredTasks.forEach(task => {
    counts[task.status]++;
    lists[task.status].appendChild(createTaskCard(task));
  });

  // Show a friendly message in empty columns
  STATUSES.forEach(status => {
    if (counts[status] === 0) {
      lists[status].appendChild(createEmptyState(status, isFiltering));
    }
    document.getElementById(`count-${status}`).textContent = counts[status];
  });

  updateStats();
}

/**
 * Builds the DOM element for one task card.
 * User text is inserted with textContent (never innerHTML) to prevent HTML injection.
 */
function createTaskCard(task) {
  const card = document.createElement('article');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;
  card.dataset.priority = task.priority;
  card.dataset.status = task.status;
  card.setAttribute('aria-label', `${task.title}, ${task.priority} priority, ${STATUS_LABELS[task.status]}`);

  // Title
  const title = createElement('h3', 'task-card-title', task.title);
  card.appendChild(title);

  // Optional description
  if (task.description) {
    card.appendChild(createElement('p', 'task-description', task.description));
  }

  // Meta information: category, priority and creation date
  const meta = createElement('div', 'task-meta');
  meta.appendChild(createElement('span', `badge badge-category badge-category-${task.category}`, task.category));
  meta.appendChild(createElement('span', `badge badge-priority-${task.priority}`, task.priority));
  if (task.createdAt) {
    const date = new Date(task.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    meta.appendChild(createElement('span', 'task-date', date));
  }
  card.appendChild(meta);

  // Actions: move left/right, status dropdown and delete
  const actions = createElement('div', 'task-actions');
  const moveControls = createElement('div', 'move-controls');
  const statusIndex = STATUSES.indexOf(task.status);

  const leftButton = createButton('btn-icon', '←', 'move-left', 'Move to previous column');
  leftButton.disabled = statusIndex === 0;

  const statusSelect = document.createElement('select');
  statusSelect.className = 'status-select';
  statusSelect.dataset.action = 'change-status';
  statusSelect.setAttribute('aria-label', 'Change status');
  STATUSES.forEach(status => {
    const option = new Option(STATUS_LABELS[status], status, false, status === task.status);
    statusSelect.add(option);
  });

  const rightButton = createButton('btn-icon', '→', 'move-right', 'Move to next column');
  rightButton.disabled = statusIndex === STATUSES.length - 1;

  moveControls.append(leftButton, statusSelect, rightButton);

  const deleteButton = createButton('btn-danger', 'Delete', 'delete', `Delete task ${task.title}`);

  actions.append(moveControls, deleteButton);
  card.appendChild(actions);

  return card;
}

/** Message shown inside a column with no tasks. */
function createEmptyState(status, isFiltering) {
  const message = isFiltering
    ? 'No tasks match your filters.'
    : status === 'completed'
      ? 'Nothing finished yet. Drag a task here when it is done.'
      : 'No tasks here. Drop one in or add a new task.';

  return createElement('p', 'empty-state', message);
}

/** Updates the "Active vs Completed" counter and the progress bar (all tasks, ignoring filters). */
function updateStats() {
  const total = tasks.length;
  const completed = tasks.filter(task => task.status === 'completed').length;
  const active = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-percent').textContent = `${percent}%`;
  document.getElementById('progress-bar').style.width = `${percent}%`;
}

// =========================================================
// Card events (event delegation)
// =========================================================

/** Handles clicks on the arrow and delete buttons of any card. */
function handleBoardClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const card = button.closest('.task-card');
  const id = card.dataset.id;

  switch (button.dataset.action) {
    case 'move-left':
      moveTask(id, -1);
      break;
    case 'move-right':
      moveTask(id, 1);
      break;
    case 'delete':
      deleteTask(id);
      break;
  }
}

/** Handles the status dropdown of any card. */
function handleBoardChange(event) {
  const select = event.target;
  if (select.dataset.action !== 'change-status') return;

  const id = select.closest('.task-card').dataset.id;
  updateTaskStatus(id, select.value);
}

// =========================================================
// Drag and drop (native HTML5 API)
// =========================================================

function setupDragAndDrop() {
  // Start dragging a card: store its id in the drag data
  board.addEventListener('dragstart', event => {
    const card = event.target.closest('.task-card');
    if (!card) return;

    event.dataTransfer.setData('text/plain', card.dataset.id);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });

  // Finished dragging (dropped or cancelled): clean up the visual states
  board.addEventListener('dragend', event => {
    const card = event.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    Object.values(lists).forEach(list => list.classList.remove('drag-over'));
  });

  Object.values(lists).forEach(list => {
    // Allow dropping by preventing the default behaviour
    list.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      list.classList.add('drag-over');
    });

    // Remove the highlight only when the pointer really leaves the list
    list.addEventListener('dragleave', event => {
      if (!list.contains(event.relatedTarget)) {
        list.classList.remove('drag-over');
      }
    });

    // Drop: move the task to this column's status
    list.addEventListener('drop', event => {
      event.preventDefault();
      list.classList.remove('drag-over');

      const id = event.dataTransfer.getData('text/plain');
      const task = tasks.find(item => item.id === id);
      if (task && task.status !== list.dataset.status) {
        updateTaskStatus(id, list.dataset.status);
      }
    });
  });
}

// =========================================================
// Dark mode
// =========================================================

/** Syncs the switch with the theme applied in the <head> script. */
function initTheme() {
  themeToggle.checked = document.documentElement.dataset.theme === 'dark';
}

/** Switches between light and dark and remembers the choice. */
function handleThemeToggle() {
  const theme = themeToggle.checked ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn('Could not save the theme preference.', error);
  }
}

// =========================================================
// Toast notification
// =========================================================

/**
 * Shows a small message at the bottom of the screen.
 * @param {string} message - text to display
 * @param {boolean} showUndo - whether to show the "Undo" button
 */
function showToast(message, showUndo = true) {
  toastMessage.textContent = message;
  toastUndoButton.hidden = !showUndo;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  toast.classList.remove('show');
}

// =========================================================
// Helpers
// =========================================================

/** Creates an element with a class and (safe) text content. */
function createElement(tag, className, text = '') {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** Creates a button with an action name used by event delegation. */
function createButton(className, text, action, label) {
  const button = createElement('button', className, text);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

/** Generates a unique id (uses crypto.randomUUID when available). */
function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
