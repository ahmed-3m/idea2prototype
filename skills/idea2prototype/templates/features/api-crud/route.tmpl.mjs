// Idea2Prototype feature: api-crud — resource "{{resource}}"
// Contract: handlers return [status, payload]; the server sends payload as JSON.
// Persistence: JSON file at data/{{resource}}.json (created on first write).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_PATH = join(process.cwd(), 'data', '{{resource}}.json');
let cache = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(STORE_PATH, 'utf8'));
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  await mkdir(join(process.cwd(), 'data'), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(cache, null, 2));
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
        const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...body };
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
        list[index] = { ...list[index], ...body, id: list[index].id };
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
