// Idea2Prototype feature: worker-jobs — persistent background job queue.
// Jobs are persisted to data/jobs.json; failed jobs retry up to MAX_ATTEMPTS,
// then stay 'failed' with the last error. Import what you need:
//   import { enqueue, list, registerHandler } from './jobs.mjs';
// Handlers run in THIS server process — the queue drains whenever jobs are
// enqueued (no long-lived timer; an empty queue costs nothing and never keeps
// the server from closing).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_PATH = join(process.cwd(), 'data', 'jobs.json');
const MAX_ATTEMPTS = 3;

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

// Built-in demo handlers — register your own with registerHandler().
const HANDLERS = {
  echo: async ({ payload }) => ({ echoed: payload }),
  fail: async () => {
    throw new Error('intentional failure (fail job)');
  },
};

export function registerHandler(type, handler) {
  HANDLERS[type] = handler;
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
  // One serialized background drain at a time: concurrent enqueues can never
  // run two loops that would pick up the same queued job. The loop exits on
  // an empty queue, so nothing keeps the event loop alive at rest.
  kick();
  return job;
}

export async function list(filter = {}) {
  const all = await load();
  return filter.status ? all.filter((j) => j.status === filter.status) : all;
}

async function processNext() {
  const job = (await load()).find((j) => j.status === 'queued');
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
    if (job.attempts >= MAX_ATTEMPTS) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
    } // else stays 'queued' — the same drain retries it immediately
  }
  await persist();
  return true;
}

let draining = null;
function kick() {
  if (draining) return;
  draining = (async () => {
    try {
      // processNext returning false means "no queued job" — re-check once more
      // inside the same tick (an enqueue can push between the check and the
      // loop's synchronous exit; the queued-recheck below closes that window).
      while ((await load()).some((j) => j.status === 'queued')) {
        await processNext();
      }
    } finally {
      draining = null;
    }
  })().catch(() => {});
}
