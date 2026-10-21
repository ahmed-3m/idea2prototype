// Idea2Prototype feature: api-crud — resource "{{resource}}"
// Contract: handlers return [status, payload]; the server sends payload as JSON.
// Persistence: JSON file at data/{{resource}}.json (created on first write).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_PATH = join(process.cwd(), 'data', '{{resource}}.json');
let ready = null; // memoized cold load: concurrent first callers share ONE array

function load() {
  if (!ready) {
    ready = (async () => {
      let cache = null;
      let raw = null;
      try {
        raw = await readFile(STORE_PATH, 'utf8');
      } catch (err) {
        if (err?.code !== 'ENOENT') console.error(`[{{resource}}] could not read data store (${err?.code ?? err}) — starting empty`);
      }
      if (raw !== null) {
        try {
          cache = JSON.parse(raw);
        } catch {
          cache = null;
        }
      }
      if (raw === null || cache === null || !Array.isArray(cache)) {
        // A store that exists but is corrupt (unparseable, or not a list) must
        // never be silently wiped — the next persist() would overwrite data
        // that may still be recoverable. Quarantine it, say so loudly, start
        // empty. If even the quarantine rename fails, do NOT pretend it is
        // safe: the original file WILL be overwritten by the next persist.
        if (raw !== null) {
          const quarantine = `${STORE_PATH}.corrupt-${Date.now().toString(36)}`;
          try {
            await rename(STORE_PATH, quarantine);
            console.error(`[{{resource}}] data store is not a valid JSON list — quarantined as ${quarantine}; starting empty`);
          } catch (err) {
            console.error(`[{{resource}}] data store is corrupt AND could not be quarantined (${err?.code ?? err}) — the next write will overwrite it`);
          }
        }
        cache = [];
      }
      return cache;
    })();
  }
  return ready;
}

// Windows refuses to rename over a file another handle has open (a reader in
// another process, the search indexer, antivirus) with a transient EPERM/
// EACCES/EBUSY — measured at 2 in 3 renames under a concurrent reader. Retry
// briefly instead of failing the write.
async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(err?.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

// Writes are chained, not concurrent: two in-flight writeFile calls on the
// same file interleave, and a burst of POSTs left a store with trailing
// garbage — quarantined on the next start, every row gone. Each write goes to
// a temp file then renames into place (atomic — a crash mid-write never leaves
// a half-written store), and one failed write does not block later ones.
let persistChain = Promise.resolve();
function persist() {
  const write = persistChain.then(async () => {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(await load(), null, 2));
    await renameWithRetry(tmp, STORE_PATH);
  });
  persistChain = write.catch(() => {});
  return write;
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [400, { error: 'JSON object body required' }];
  }
  return null;
}

export default [
  {
    path: '/api/{{resource}}',
    methods: {
      GET: async () => [200, await load()],
      POST: async ({ body }) => {
        const bad = requireObject(body);
        if (bad) return bad;
        // body first: the server owns id + createdAt — a client-sent id would
        // otherwise duplicate (or shadow) an existing item
        const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
        (await load()).push(item);
        await persist();
        return [201, item];
      },
    },
  },
  {
    path: '/api/{{resource}}/:id',
    methods: {
      GET: async ({ params }) => {
        const item = (await load()).find((x) => x.id === params.id);
        return item ? [200, item] : [404, { error: 'not found' }];
      },
      PUT: async ({ params, body }) => {
        const bad = requireObject(body);
        if (bad) return bad;
        const list = await load();
        const index = list.findIndex((x) => x.id === params.id);
        if (index === -1) return [404, { error: 'not found' }];
        list[index] = { ...list[index], ...body, id: list[index].id, createdAt: list[index].createdAt };
        await persist();
        return [200, list[index]];
      },
      DELETE: async ({ params }) => {
        const list = await load();
        const index = list.findIndex((x) => x.id === params.id);
        if (index === -1) return [404, { error: 'not found' }];
        list.splice(index, 1);
        await persist();
        return [204, null];
      },
    },
  },
];
