import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';

// An SSE response never ends, so the test reads the FIRST event and cancels.
// app.close() calls closeAllConnections() — the open stream cannot hang the
// suite; and if the route leaked its heartbeat timer, this file would hang
// into the runner timeout instead of passing silently.
test('GET /api/events streams: SSE headers + a readable first event', async () => {
  const app = await start(0);
  const root = `http://127.0.0.1:${app.port}`;
  const ac = new AbortController();
  let reader;
  try {
    const res = await fetch(`${root}/api/events`, { signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.match(res.headers.get('cache-control') ?? '', /no-cache/);

    reader = res.body.getReader();
    // Chunk boundaries do not line up with event boundaries — accumulate
    // until the first complete frame (delimited by a blank line) arrives.
    let text = '';
    while (!text.includes('\n\n')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    assert.match(text, /event: connected/);
    assert.match(text, /data: \{/);
  } finally {
    await reader?.cancel().catch(() => {}); // release the stream lock cleanly
    ac.abort();
    await app.close();
  }
});
