import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

function firstCookie(res) {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}

test('auth-local full session flow', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}`;
  // Unique identity per run: data/users.json persists between `check` runs,
  // so a fixed username would 409 on the second run. Keep it <= 32 chars
  // (route-side username validation).
  const username = `alice_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  try {
    const badRegister = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'x', password: 'short' }),
    });
    assert.equal(badRegister.status, 400);

    const register = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password: 'correct horse battery' }),
    });
    assert.equal(register.status, 201);

    const duplicate = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password: 'another password' }),
    });
    assert.equal(duplicate.status, 409);

    const wrongLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password: 'wrong password!' }),
    });
    assert.equal(wrongLogin.status, 401);

    const anon = await fetch(`${base}/api/auth/me`);
    assert.equal(anon.status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password: 'correct horse battery' }),
    });
    assert.equal(login.status, 200);
    const cookie = firstCookie(login);
    assert.match(cookie, /^i2p_session=/);

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).username, username);

    const tampered = await fetch(`${base}/api/auth/me`, { headers: { cookie: `${cookie}x` } });
    assert.equal(tampered.status, 401);

    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
  } finally {
    await app.close();
  }
});
