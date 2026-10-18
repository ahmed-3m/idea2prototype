// Frontend entry — keep this file small; the backend is the source of truth.
const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#list');
const form = document.querySelector('#add-form');
const input = document.querySelector('#add-input');

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const body = await res.json();
    statusEl.textContent = body.status === 'ok' ? 'server: ok' : `server: ${body.status}`;
  } catch {
    statusEl.textContent = 'server: unreachable';
  }
}

function render(items) {
  listEl.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function load() {
  const items = JSON.parse(localStorage.getItem('items') ?? '[]');
  render(items);
  return items;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  const items = load();
  items.push(value);
  localStorage.setItem('items', JSON.stringify(items));
  render(items);
  input.value = '';
});

refreshHealth();
load();
