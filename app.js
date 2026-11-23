'use strict';

// No backend is required. Tasks persist in this browser's localStorage.
const STORAGE_KEY = 'taskly.tasks.v1';
const MAX_TITLE_LENGTH = 160;
const VALID_FILTERS = new Set(['all', 'active', 'completed']);

const elements = {
  form: document.querySelector('#task-form'),
  input: document.querySelector('#task-input'),
  list: document.querySelector('#task-list'),
  empty: document.querySelector('#empty-state'),
  emptyHeading: document.querySelector('#empty-heading'),
  emptyDescription: document.querySelector('#empty-description'),
  allCount: document.querySelector('#all-filter-count'),
  totalCount: document.querySelector('#total-count'),
  completedStat: document.querySelector('#completed-stat'),
  progressPercent: document.querySelector('#progress-percent'),
  progressRing: document.querySelector('#progress-ring'),
  progressNote: document.querySelector('#progress-note'),
  remainingLabel: document.querySelector('#remaining-label'),
  date: document.querySelector('#today-date'),
  clearCompleted: document.querySelector('#clear-completed'),
  filters: [...document.querySelectorAll('[data-filter]')],
  toast: document.querySelector('#toast'),
  toastMessage: document.querySelector('#toast-message'),
  undoButton: document.querySelector('#undo-button'),
  dismissToast: document.querySelector('#dismiss-toast'),
};

/** Only accept known fields and values from saved data. */
function readTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    const seenIds = new Set();
    return stored.filter((task) => {
      if (!task || typeof task.id !== 'string' || !task.id || seenIds.has(task.id) ||
          typeof task.title !== 'string' || !task.title.trim() ||
          typeof task.completed !== 'boolean') return false;
      seenIds.add(task.id);
      return true;
    }).map((task) => ({
      id: task.id,
      title: task.title.trim().slice(0, MAX_TITLE_LENGTH),
      completed: task.completed,
    }));
  } catch {
    return [];
  }
}

let tasks = readTasks();
let currentFilter = 'all';
let lastRemoval = null;
let toastTimer = null;

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch {
    // Private browsing or blocked storage: continue in-memory and warn the user.
    showToast('Браузер не разрешил сохранить изменения', false);
    return false;
  }
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const ICON_CHECK = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m5 12 4.2 4.2L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TRASH = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 4h4m-8 3 1 13h10l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function makeTaskRow(task) {
  const item = document.createElement('li');
  item.className = `task-item${task.completed ? ' completed' : ''}`;
  item.dataset.id = task.id;

  const checkbox = document.createElement('button');
  checkbox.type = 'button';
  checkbox.className = 'task-check';
  checkbox.dataset.action = 'toggle';
  checkbox.setAttribute('aria-label', `${task.completed ? 'Вернуть в активные' : 'Отметить выполненной'}: ${task.title}`);
  checkbox.setAttribute('aria-pressed', String(task.completed));
  checkbox.innerHTML = ICON_CHECK;

  const content = document.createElement('div');
  content.className = 'task-content';
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title; // Never interpolate user text into HTML.
  content.append(title);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-delete';
  del.dataset.action = 'delete';
  del.setAttribute('aria-label', `Удалить задачу: ${task.title}`);
  del.title = 'Удалить задачу';
  del.innerHTML = ICON_TRASH;

  item.append(checkbox, content, del);
  return item;
}

function pluralize(number, one, few, many) {
  const n = Math.abs(number) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function render() {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const active = total - completed;
  const percent = total ? Math.round(completed / total * 100) : 0;

  elements.totalCount.textContent = total;
  elements.allCount.textContent = total;
  elements.completedStat.textContent = `${completed} из ${total}`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressRing.style.setProperty('--progress', `${percent}%`);
  elements.progressRing.setAttribute('aria-label', `Выполнено ${percent} процентов`);
  elements.progressNote.textContent = !total ? 'Начните с первой задачи' : !active ? 'Отличная работа!' : 'Продолжайте в своём темпе';
  elements.remainingLabel.textContent = `${active} ${pluralize(active, 'задача', 'задачи', 'задач')} ${pluralize(active, 'осталась', 'осталось', 'осталось')}`;
  elements.clearCompleted.hidden = completed === 0;

  elements.filters.forEach((button) => {
    const selected = button.dataset.filter === currentFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  const visibleTasks = tasks.filter((task) => {
    if (currentFilter === 'active') return !task.completed;
    if (currentFilter === 'completed') return task.completed;
    return true;
  });
  elements.list.replaceChildren(...visibleTasks.map(makeTaskRow));
  elements.empty.hidden = visibleTasks.length !== 0;
  if (!visibleTasks.length) {
    const messages = {
      all: ['Начните с малого', 'Добавьте первую задачу, и она появится здесь.'],
      active: ['Всё под контролем', 'Незавершённых задач пока нет.'],
      completed: ['Первые победы впереди', 'Выполненные задачи появятся здесь.'],
    };
    [elements.emptyHeading.textContent, elements.emptyDescription.textContent] = messages[currentFilter];
  }
}

function showToast(message, canUndo) {
  clearTimeout(toastTimer);
  elements.toastMessage.textContent = message;
  elements.undoButton.hidden = !canUndo;
  elements.toast.hidden = false;
  toastTimer = setTimeout(hideToast, 5500);
}
function hideToast() {
  clearTimeout(toastTimer);
  elements.toast.hidden = true;
  lastRemoval = null;
}
function addTask(rawTitle) {
  const title = rawTitle.trim();
  if (!title) return;
  tasks.unshift({ id: createId(), title: title.slice(0, MAX_TITLE_LENGTH), completed: false });
  if (currentFilter === 'completed') currentFilter = 'all';
  saveTasks();
  render();
  elements.input.value = '';
  elements.input.focus();
}

function removeTask(id) {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return;
  lastRemoval = { task: tasks[index], index };
  tasks.splice(index, 1);
  const saved = saveTasks();
  render();
  showToast(saved ? 'Задача удалена' : 'Удалено, но браузер не сохранил изменения', true);
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  addTask(elements.input.value);
});
elements.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('li[data-id]')?.dataset.id;
  if (!id) return;
  if (button.dataset.action === 'delete') return removeTask(id);
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
});
elements.filters.forEach((button) => button.addEventListener('click', () => {
  if (!VALID_FILTERS.has(button.dataset.filter)) return;
  currentFilter = button.dataset.filter;
  render();
}));
elements.clearCompleted.addEventListener('click', () => {
  tasks = tasks.filter((task) => !task.completed);
  hideToast();
  saveTasks();
  render();
});
elements.undoButton.addEventListener('click', () => {
  if (!lastRemoval) return;
  const { task, index } = lastRemoval;
  hideToast();
  if (!tasks.some((item) => item.id === task.id)) {
    tasks.splice(Math.min(index, tasks.length), 0, task);
    saveTasks();
    render();
  }
});
elements.dismissToast.addEventListener('click', hideToast);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    tasks = readTasks();
    render();
  }
});
elements.date.textContent = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
}).format(new Date());
render();
