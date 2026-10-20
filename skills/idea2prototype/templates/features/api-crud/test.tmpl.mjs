import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

const JSON_HEADERS = { 'content-type': 'application/json' };

test('{{resource}} CRUD roundtrip', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}/api/{{resource}}`;
  try {
    const createdRes = await fetch(base, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: 'first item' }),
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json();
    assert.ok(created.id, 'created item has an id');

    const list = await (await fetch(base)).json();
    assert.ok(list.some((x) => x.id === created.id), 'created item appears in list');

    const fetched = await (await fetch(`${base}/${created.id}`)).json();
    assert.equal(fetched.title, 'first item');

    const updated = await (
      await fetch(`${base}/${created.id}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'updated item' }),
      })
    ).json();
    assert.equal(updated.title, 'updated item');

    const deleted = await fetch(`${base}/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal((await fetch(`${base}/${created.id}`)).status, 404);
  } finally {
    await app.close();
  }
});

test('{{resource}} ignores client-sent id and createdAt', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}/api/{{resource}}`;
  try {
    const spoof = { id: 'client-chosen', createdAt: '1999-01-01T00:00:00.000Z', title: 'spoof' };
    const a = await (await fetch(base, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(spoof) })).json();
    const b = await (await fetch(base, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(spoof) })).json();
    assert.notEqual(a.id, 'client-chosen');
    assert.notEqual(a.id, b.id, 'two creates must never share an id');
    assert.notEqual(a.createdAt, spoof.createdAt);

    const put = await (await fetch(`${base}/${a.id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(spoof) })).json();
    assert.equal(put.id, a.id);
    assert.equal(put.createdAt, a.createdAt);

    for (const item of [a, b]) await fetch(`${base}/${item.id}`, { method: 'DELETE' });
  } finally {
    await app.close();
  }
});

test('{{resource}} rejects non-object bodies', async () => {
  const app = await start(0);
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/{{resource}}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(['nope']),
    });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
