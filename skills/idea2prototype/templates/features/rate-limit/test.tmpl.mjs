import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { rateLimit } from '../routes/ratelimit.mjs';

// NOTE: each rateLimit({...}) instance owns its own buckets (the map lives
// inside the factory) — that independence is pinned by the third test.

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

test('rateLimit: independently configured wrappers never share budget', async () => {
  // exhaust a tight limiter, then prove a loose limiter's FIRST request
  // still sees a full budget (module-level buckets used to leak the count
  // across wrappers — cross-route lockout)
  const tight = rateLimit({ max: 1, windowMs: 60_000, keyFn: (ctx) => ctx.key })(
    async () => [200, { which: 'tight' }],
  );
  const loose = rateLimit({ max: 50, windowMs: 60_000, keyFn: (ctx) => ctx.key })(
    async () => [200, { which: 'loose' }],
  );

  await tight({ key: 'carol', req: {} }); // tight budget spent
  assert.equal((await tight({ key: 'carol', req: {} }))[0], 429);

  const [status, , headers] = await loose({ key: 'carol', req: {} }); // same client, other route
  assert.equal(status, 200); // NOT locked out by the tight wrapper
  assert.equal(headers['X-RateLimit-Limit'], '50');
  assert.equal(headers['X-RateLimit-Remaining'], '49'); // full budget, not 48
});
