// Idea2Prototype worker template — zero-dependency persistent job queue (Node >= 18)
// Jobs are persisted to data/jobs.json; failed jobs retry up to maxAttempts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const STORE_PATH = join(process.cwd(), 'data', 'jobs.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let jobs = null;

async function load() {
  if (jobs) return jobs;
  try {
    jobs = JSON.parse(await readFile(STORE_PATH, 'utf8'));
  } catch {
    jobs = [];
  }
  return jobs;
}

async function persist() {
  await mkdir(join(process.cwd(), 'data'), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(jobs, null, 2));
}

const HANDLERS = {
  echo: async ({ payload }) => ({ echoed: payload }),
  delay: async ({ payload }) => {
    const ms = Number(payload?.ms ?? 10);
    await sleep(ms);
    return { waited: ms };
  },
  fail: async () => {
    throw new Error('intentional failure (fail job)');
  },
};

export function registerHandler(type, handler) {
  HANDLERS[type] = handler;
}

export async function reset() {
  jobs = [];
  await persist();
}

export async function enqueue(type, payload = {}) {
  const job = {
    id: randomUUID(),
    type,
    payload,
    status: 'queued',
    attempts: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  (await load()).push(job);
  await persist();
  return job;
}

export async function list(filter = {}) {
  const all = await load();
  return filter.status ? all.filter((j) => j.status === filter.status) : all;
}

async function processNext(maxAttempts) {
  const queue = await load();
  const job = queue.find((j) => j.status === 'queued');
  if (!job) return false;
  job.attempts += 1;
  const handler = HANDLERS[job.type];
  try {
    if (!handler) throw new Error(`no handler registered for "${job.type}"`);
    job.result = await handler({ payload: job.payload });
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    job.error = String(err?.message ?? err);
    if (job.attempts >= maxAttempts) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
    } else {
      job.status = 'queued'; // retry on a later tick
    }
  }
  await persist();
  return true;
}

// Process the queue until it drains (or stop() is called). Returns { stop, done }.
export async function start(options = {}) {
  const { interval = 25, maxAttempts = 3 } = options;
  let stopped = false;
  const done = (async () => {
    while (!stopped) {
      const processed = await processNext(maxAttempts);
      if (!processed && !(await load()).some((j) => j.status === 'queued')) break;
      if (!processed) await sleep(interval);
    }
  })();
  return {
    stop() {
      stopped = true;
    },
    done,
  };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  await reset();
  await enqueue('echo', { hello: 'worker' });
  await enqueue('delay', { ms: 20 });
  const run = await start();
  await run.done;
  const final = await list();
  console.log(`processed ${final.length} jobs:`);
  for (const job of final) console.log(`  ${job.type} -> ${job.status} (attempts: ${job.attempts})`);
}
