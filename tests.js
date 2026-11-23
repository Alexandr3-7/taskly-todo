/* No dependencies: node tests.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = { setProperty(key, value) { this[key] = value; } };
    this.classSet = new Set();
    this.classList = { toggle: (name, on) => on ? this.classSet.add(name) : this.classSet.delete(name) };
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.attrs = {};
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  focus() { this.focused = true; }
  closest(selector) {
    let current = this;
    while (current) {
      if (selector === 'button[data-action]' && current.tag === 'button' && current.dataset.action) return current;
      if (selector === 'li[data-id]' && current.tag === 'li' && current.dataset.id) return current;
      current = current.parent;
    }
    return null;
  }
}
const saved = new Map();
let storageBlocked = false;
let idSequence = 0;
const storage = {
  getItem(k) { return saved.has(k) ? saved.get(k) : null; },
  setItem(k, v) { if (storageBlocked) throw Error("Storage blocked"); saved.set(k, v); },
};
function startApp() {
  const ids = [
    'task-form', 'task-input', 'task-list', 'empty-state', 'empty-heading', 'empty-description',
    'all-filter-count', 'total-count', 'completed-stat', 'progress-percent', 'progress-ring',
    'progress-note', 'remaining-label', 'today-date', 'clear-completed', 'toast', 'toast-message',
    'undo-button', 'dismiss-toast'
  ];
  const dom = Object.fromEntries(ids.map((name) => [name, new Element()]));
  const filters = ['all', 'active', 'completed'].map((name) => {
    const el = new Element('button'); el.dataset.filter = name; return el;
  });
  const document = {
    querySelector(selector) { return dom[selector.slice(1)]; },
    querySelectorAll(selector) { assert.equal(selector, '[data-filter]'); return filters; },
    createElement(tag) { return new Element(tag); },
  };
  const window = new Element('window');
  let counter = 0;
  const timers = new Map();
  const sandbox = {
    document, window, localStorage: storage, Intl, Date, Math,
    globalThis: { crypto: { randomUUID: () => `test-${++idSequence}` } },
    setTimeout(fn) { const key = ++counter; timers.set(key, fn); return key; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/app.js', 'utf8'), sandbox);
  return { dom, filters, window };
}

function test() {
  let { dom, filters } = startApp();
  assert.equal(dom['total-count'].textContent, 0);
  assert.equal(dom['empty-state'].hidden, false);
  dom['task-input'].value = '  Подготовить тестовое  ';
  dom['task-form'].fire('submit', { preventDefault() {} });
  assert.equal(dom['task-list'].children[0].children[1].children[0].textContent, 'Подготовить тестовое');
  assert.equal(dom['task-input'].value, '');
  assert.equal(dom['total-count'].textContent, 1);

  dom['task-input'].value = '<img src=x onerror=alert(1)>';
  dom['task-form'].fire('submit', { preventDefault() {} });
  const row = dom['task-list'].children[0];
  assert.equal(row.children[1].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(row.children[1].children[0].innerHTML, undefined);
  assert.equal(dom['total-count'].textContent, 2);

  ({ dom, filters } = startApp());
  assert.equal(dom['total-count'].textContent, 2, 'localStorage persistence');
  dom['task-list'].fire('click', { target: dom['task-list'].children[0].children[0] });
  assert.equal(dom['completed-stat'].textContent, '1 из 2');
  assert.equal(dom['progress-percent'].textContent, '50%');
  filters[1].fire('click');
  assert.equal(dom['task-list'].children.length, 1, 'active filter');
  filters[2].fire('click');
  assert.equal(dom['task-list'].children.length, 1, 'completed filter');

  filters[0].fire('click');
  dom['task-list'].fire('click', { target: dom['task-list'].children[0].children[2] });
  assert.equal(dom['task-list'].children.length, 1, 'delete');
  dom['undo-button'].fire('click');
  assert.equal(dom['task-list'].children.length, 2, 'undo');
  dom['clear-completed'].fire('click');
  assert.equal(dom['task-list'].children.length, 1, 'clear completed');
  assert.equal(dom['completed-stat'].textContent, '0 из 1');
  ({ dom } = startApp());
  assert.equal(dom['total-count'].textContent, 1, 'persistence after clear');
  ({ dom, filters } = startApp());
  filters[2].fire('click');
  dom['task-input'].value = 'Добавить в режиме выполненных';
  dom['task-form'].fire('submit', { preventDefault() {} });
  assert.equal(filters[0].getAttribute('aria-pressed'), 'true');
  assert.equal(dom['task-list'].children.length, 2);
  storageBlocked = true;
  dom['task-list'].fire('click', { target: dom['task-list'].children[0].children[2] });
  assert.match(dom['toast-message'].textContent, /не сохранил/);
  dom['undo-button'].fire('click');
  assert.equal(dom['task-list'].children.length, 2);
  assert.match(dom['toast-message'].textContent, /не разрешил сохранить/);
  storageBlocked = false;
  saved.set('taskly.tasks.v1', '{malformed');
  ({ dom } = startApp());
  assert.equal(dom['total-count'].textContent, 0);
  console.log('PASS: create, trim, escaping, persistence, completion, progress, filters, delete, undo, clear, add from completed, blocked storage, damaged data');
}
test();
