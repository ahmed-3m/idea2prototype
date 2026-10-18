import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

test('health endpoint reports ok', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  } finally {
    await app.close();
  }
});

test('index lists available routes', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.routes));
    assert.ok(body.routes.includes('/api/health'));
  } finally {
    await app.close();
  }
});

test('unknown paths return 404 JSON', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'not found');
  } finally {
    await app.close();
  }
});
