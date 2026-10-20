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

// Stored XSS guard: an uploaded page must never render as active content on
// the app's own origin — it comes back as an inert download instead.
test('uploaded html/svg is served as an attachment, never as active content', async () => {
  const app = await start(0);
  const base = `http://127.0.0.1:${app.port}`;
  try {
    for (const [name, type] of [['evil.html', 'text/html'], ['evil.svg', 'image/svg+xml']]) {
      const form = new FormData();
      form.append('file', new Blob(['<script>alert(1)</script>'], { type }), name);
      const info = await (await fetch(`${base}/api/uploads`, { method: 'POST', body: form })).json();
      const fetched = await fetch(`${base}${info.url}`);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.headers.get('content-type'), 'application/octet-stream');
      assert.match(fetched.headers.get('content-disposition') ?? '', /^attachment; filename="[\w.-]+"$/);
      assert.equal(fetched.headers.get('x-content-type-options'), 'nosniff');
      assert.match(fetched.headers.get('content-security-policy') ?? '', /sandbox/);
      await fetched.arrayBuffer();
    }
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
