// Idea2Prototype feature: worker-jobs — persistent background job queue.
// Jobs are persisted to data/jobs.json; failed jobs retry up to MAX_ATTEMPTS,
// then stay 'failed' with the last error. Import what you need:
//   import { enqueue, list, registerHandler } from './jobs.mjs';
// Handlers run in THIS server process — the queue drains whenever jobs are
// enqueued (no long-lived timer; an empty queue costs nothing and never keeps
// the server from closing). Handlers must settle: one that awaits forever
// stalls the whole queue until the process restarts.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_PATH = join(process.cwd(), 'data', 'jobs.json');
const MAX_ATTEMPTS = 3;

let jobs = null;
let ready = null; // memoized cold load: concurrent first callers share ONE array

function load() {
  if (!ready) {
    ready = (async () => {
      try {
        jobs = JSON.parse(await readFile(STORE_PATH, 'utf8'));
      } catch (err) {
        if (err?.code !== 'ENOENT') {
          console.error(`[jobs] could not read ${STORE_PATH} (${err?.message ?? err}) — starting empty`);
        }
        jobs = [];
      }
      return jobs;
    })();
  }
  return ready;
}

// Writes are chained, not concurrent: enqueue and the drain both persist, and
// two in-flight writeFile calls on the same store can finish out of order —
// a staler snapshot written last would resurrect finished jobs as queued.
// Each write goes to a temp file then renames into place (atomic — a crash
// mid-write can never leave a half-written store behind), and the chain
// recovers from a failed write instead of rejecting forever.
let persistChain = Promise.resolve();
function persist() {
  const write = persistChain.then(async () => {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(jobs, null, 2));
    await rename(tmp, STORE_PATH);
  });
  persistChain = write.catch(() => {}); // one failed write must not block later writes
  return write;
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
      // Race-free by construction: the while-condition, the loop exit, and
      // `draining = null` below share one synchronous continuation, so a
      // concurrent enqueue either pushes into the shared array BEFORE the
      // final condition check (this loop picks it up) or runs AFTER
      // `draining = null` (its own kick() starts a fresh drain).
      while ((await load()).some((j) => j.status === 'queued')) {
        await processNext();
      }
    } finally {
      draining = null;
    }
  })().catch((err) => {
    // A dead drain strands queued jobs until the next enqueue — never silent.
    console.error('[jobs] drain aborted:', err?.message ?? err);
  });
}
