import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

test('serves the app shell', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<title>/);
  } finally {
    await app.close();
  }
});

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
