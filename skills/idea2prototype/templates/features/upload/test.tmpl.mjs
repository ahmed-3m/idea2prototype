import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

test('upload roundtrip: multipart POST then fetch back', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const form = new FormData();
    form.append('label', 'my note');
    form.append('file', new Blob(['hello upload'], { type: 'text/plain' }), 'note.txt');

    const uploaded = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);
    const info = await uploaded.json();
    assert.match(info.url, /^\/api\/uploads\//);
    assert.equal(info.filename, 'note.txt');
    assert.equal(info.size, 12);

    const fetched = await fetch(`${base}${info.url}`);
    assert.equal(fetched.status, 200);
    assert.match(fetched.headers.get('content-type'), /text\/plain/);
    assert.equal(await fetched.text(), 'hello upload');
  } finally {
    await app.close();
  }
});

test('upload rejects non-multipart and unknown ids', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const notMultipart = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    assert.equal(notMultipart.status, 400);

    const missing = await fetch(`${base}/api/uploads/does-not-exist.txt`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${base}/api/uploads/..%2Fserver.mjs`);
    assert.ok(traversal.status === 400 || traversal.status === 404);
  } finally {
    await app.close();
  }
});
