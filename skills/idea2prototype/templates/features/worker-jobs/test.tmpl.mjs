import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { start } from '../server.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

// Wait until a job reaches one of the terminal statuses (done/failed).
async function settle(base, id, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const jobs = await (await fetch(base)).json();
    const match = jobs.find((x) => x.id === id);
    if (match && match.status !== 'queued') return match;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job did not settle within the deadline');
}

test('echo job runs in the background and persists', async () => {
  const app = await start(0);
  try {
    const base = `http://127.0.0.1:${app.port}/api/jobs`;
    const createdRes = await fetch(base, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'echo', payload: { hello: 'jobs' } }),
    });
    assert.equal(createdRes.status, 202);
    const created = await createdRes.json();
    assert.ok(created.id);

    const settled = await settle(base, created.id);
    assert.equal(settled.status, 'done');
    assert.deepEqual(settled.result, { echoed: { hello: 'jobs' } });
    assert.equal(settled.attempts, 1);

    // the store file exists — jobs survive a server restart
    assert.ok(existsSync('data/jobs.json'));
  } finally {
    await app.close();
  }
});

test('failing job retries up to maxAttempts, then stays failed', async () => {
  const app = await start(0);
  try {
    const base = `http://127.0.0.1:${app.port}/api/jobs`;
    const created = await (
      await fetch(base, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'fail' }),
      })
    ).json();

    const settled = await settle(base, created.id);
    assert.equal(settled.status, 'failed');
    assert.equal(settled.attempts, 3);
    assert.match(settled.error, /intentional failure/);
  } finally {
    await app.close();
  }
});

test('unknown job type fails with a clear error (no handler)', async () => {
  const app = await start(0);
  try {
    const base = `http://127.0.0.1:${app.port}/api/jobs`;
    const created = await (
      await fetch(base, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type: 'does-not-exist' }),
      })
    ).json();

    const settled = await settle(base, created.id);
    assert.equal(settled.status, 'failed');
    assert.match(settled.error, /no handler registered for "does-not-exist"/);
  } finally {
    await app.close();
  }
});

test('invalid bodies are rejected with 400', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/jobs`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(['nope']),
    });
    assert.equal(res.status, 400);
    const noType = await fetch(`http://127.0.0.1:${app.port}/api/jobs`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload: {} }),
    });
    assert.equal(noType.status, 400);
  } finally {
    await app.close();
  }
});
