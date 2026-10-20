import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { rateLimit } from '../routes/ratelimit.mjs';

// NOTE: each rateLimit() call owns its buckets, so these tests are
// independent of each other and of the /api/ping demo's limiter.

test('GET /api/ping allows max then returns 429 with limit headers', async (t) => {
  const app = await start(0);
  t.after(() => app.close());

  const responses = [];
  for (let i = 0; i < 7; i++) {
    responses.push(await fetch(`http://127.0.0.1:${app.port}/api/ping`));
  }

  const statuses = responses.map((r) => r.status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);

  assert.equal(responses[0].headers.get('x-ratelimit-limit'), '5');
  assert.equal(responses[0].headers.get('x-ratelimit-remaining'), '4');
  assert.equal(responses[4].headers.get('x-ratelimit-remaining'), '0');

  const retryAfter = Number(responses[5].headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 10, `unexpected Retry-After ${retryAfter}`);
  assert.deepEqual(await responses[5].json(), { error: 'rate limit exceeded' });

  // allowed requests still serve their real body
  assert.deepEqual(await responses[0].json(), { pong: true });
});

test('rateLimit: custom keyFn isolates clients into separate buckets', async () => {
  const wrapped = rateLimit({ max: 1, windowMs: 60_000, keyFn: (ctx) => ctx.key })(
    async (ctx) => [200, { key: ctx.key }],
  );

  const first = await wrapped({ key: 'alice', req: {} });
  const second = await wrapped({ key: 'alice', req: {} });
  const other = await wrapped({ key: 'bob', req: {} });

  assert.equal(first[0], 200);
  assert.equal(second[0], 429); // same key: over the limit
  assert.equal(other[0], 200); // different key: fresh bucket
  // exact value depends on elapsed ms — assert the range, not '60'
  const retryAfter = Number(second[2]['Retry-After']);
  assert.ok(retryAfter >= 59 && retryAfter <= 60, `unexpected Retry-After ${retryAfter}`);
});

test('rateLimit: separate limiters never share a budget for the same key', async () => {
  const strict = rateLimit({ max: 2 })(async () => [200, { route: 'strict' }]);
  const generous = rateLimit({ max: 100 })(async () => [200, { route: 'generous' }]);
  const ctx = { req: { socket: { remoteAddress: '203.0.113.7' } } }; // same client on both

  for (let i = 0; i < 5; i++) assert.equal((await generous(ctx))[0], 200);
  // traffic on the generous route must not have spent the strict one's budget
  assert.equal((await strict(ctx))[0], 200);
  assert.equal((await strict(ctx))[0], 200);
  assert.equal((await strict(ctx))[0], 429);
  assert.equal((await generous(ctx))[2]['X-RateLimit-Remaining'], '94');
});
