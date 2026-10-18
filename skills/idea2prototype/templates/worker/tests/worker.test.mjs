import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, reset, start, list } from '../worker.mjs';

const freshImport = () => import(`${new URL('../worker.mjs', import.meta.url).href}?t=${Date.now()}`);

test('jobs process to done with results', async () => {
  await reset();
  await enqueue('echo', { hello: 'worker' });
  await enqueue('delay', { ms: 15 });
  const run = await start();
  await run.done;

  const done = await list({ status: 'done' });
  assert.equal(done.length, 2);
  const echo = done.find((j) => j.type === 'echo');
  assert.deepEqual(echo.result, { echoed: { hello: 'worker' } });
});

test('failing jobs retry up to maxAttempts then fail', async () => {
  await reset();
  await enqueue('fail');
  const run = await start({ maxAttempts: 3 });
  await run.done;

  const [failed] = await list({ status: 'failed' });
  assert.ok(failed, 'job ends as failed');
  assert.equal(failed.attempts, 3);
  assert.match(failed.error, /intentional failure/);
  assert.ok(failed.finishedAt);
});

test('queue persists across restarts', async () => {
  await reset();
  await enqueue('echo', { persist: true });

  // Fresh module instance = simulated restart: reads data/jobs.json from disk.
  const restarted = await freshImport();
  const queued = await restarted.list({ status: 'queued' });
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].payload, { persist: true });
});
