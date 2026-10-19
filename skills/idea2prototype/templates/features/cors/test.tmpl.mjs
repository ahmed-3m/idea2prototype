import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { cors } from '../routes/cors.mjs';

async function withApp(fn) {
  const app = await start(0);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

// Unit-level: exercise the wrapper directly with a fake ctx — no server.
test('cors(): allowlist reflects matched origins and omits unmatched', async () => {
  const wrapped = cors({ origin: ['https://a.example', 'https://b.example'] })(
    async () => [200, { ok: true }],
  );
  const matched = await wrapped({ req: { method: 'GET', headers: { origin: 'https://a.example' } } });
  assert.equal(matched[2]['access-control-allow-origin'], 'https://a.example');
  const stranger = await wrapped({ req: { method: 'GET', headers: { origin: 'https://evil.example' } } });
  assert.ok(!('access-control-allow-origin' in stranger[2]));
});

test('cors(): preflight is answered without calling the handler', async () => {
  let handlerRan = false;
  const wrapped = cors({ methods: 'GET,POST' })(async () => {
    handlerRan = true;
    return [200, {}];
  });
  const [status, payload, headers] = await wrapped({ req: { method: 'OPTIONS', headers: {} } });
  assert.equal(status, 204);
  assert.equal(payload, null);
  assert.match(headers['access-control-allow-methods'], /GET,POST/);
  assert.equal(handlerRan, false);
});

test('demo route: preflight 204 and simple GET carries CORS headers', async () => {
  await withApp(async (app) => {
    const base = `http://127.0.0.1:${app.port}`;
    const pre = await fetch(`${base}/api/cors-ping`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'GET' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    const get = await fetch(`${base}/api/cors-ping`, { headers: { origin: 'https://app.example' } });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('access-control-allow-origin'), '*');
    const body = await get.json();
    assert.equal(body.pong, true);
  });
});
