// Spec-9 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec9-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec9/RUBRIC.md, 2026-10-20T16:00:59Z).
// Habits + day-cells are naturally server-backed (task template demands
// Node-runnable + automated tests; the spec-1 precedent judges persistence
// across an app restart), so c2–c4 are BEHAVIORAL over HTTP through the arm's
// documented habits endpoint: create a uniquely-stamped habit, locate its
// 7-slot day structure, toggle slot 3 via the whole-habit PUT, then restart
// the app and require habit + toggle to survive ("persisted" = server-side).
// Envelope tolerance (spec-7 convention, and the spec-8 review's ask): lists
// may be bare arrays or wrapped in habits/data/items. Day-structure discovery
// (spec-9 rubric wording): an array of length 7 anywhere in the habit object,
// OR an object property with exactly 7 day-ish keys (d1..d7, day1..7,
// mon..sun, monday..sunday).
// Conventions mirror the round-2 hardened family: c5 first (NODE_TEST_CONTEXT
// stripped, 120s cap, output-tail diagnostics); exactly five entries via
// recorded flags; readiness short-circuit; per-cycle unconditional tree
// cleanup; 5s/2s fetch caps; unique per-run stamps.
// Usage: node judge-spec9.mjs <projectDir> <port> "<startCmd>" <habitsPath> "<testCmd>"
// Route path WITHOUT the leading slash — MSYS rewrites leading-slash args;
// the judge normalizes back.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, habitsPathArg, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;
const routePath = (p) => '/' + String(p).replace(/^\/+/, '');
const listUrl = `${base}${routePath(habitsPathArg)}`;
const itemUrl = (id) => `${base}${routePath(habitsPathArg)}/${encodeURIComponent(id)}`;
const JSON_HEADERS = { 'content-type': 'application/json' };

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C1 = 'c1 app starts using its documented command (HTML at /)';
const C2 = 'c2 create habit and retrieve it';
const C3 = 'c3 7-day grid found and a cell toggle round-trips';
const C4 = 'c4 habit + toggled cell persist across an app restart';
let c1Recorded = false;
let c2Recorded = false;
let c3Recorded = false;

function start() {
  return spawn(startCmd, {
    shell: true,
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    detached: process.platform !== 'win32', // POSIX: own process group, killable as a group
  });
}
function stop(child) {
  if (!child) return;
  // Unconditional: the shell may have exited while a backgrounded server
  // lives on in its process group; killing a dead tree is a silent no-op.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
}
async function waitReady(deadlineMs = 15_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(base, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

// c5 — the project's own tests pass via its documented command (runs first)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env, timeout: 120_000 });
if (t.status !== 0) {
  console.log(`  c5 diagnostics: exit ${t.status}${t.timedOut ? ' (timed out at 120s)' : ''}${t.error ? ` ${t.error}` : ''}`);
  const tail = (s) => String(s ?? '').split(/\r?\n/).filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n');
  if (t.stdout) console.log(tail(t.stdout));
  if (t.stderr) console.log(tail(t.stderr));
}
check(`c5 own test command passes (${testCmd})`, t.status === 0);

// Lists may be bare arrays or wrapped in a common envelope key; everything
// else reads as [] so shape problems fail the criterion instead of crashing.
const asList = (v) =>
  Array.isArray(v) ? v :
    Array.isArray(v?.habits) ? v.habits :
    Array.isArray(v?.data) ? v.data :
    Array.isArray(v?.items) ? v.items : [];

const DAY_KEY = /^(d[1-7]|day ?[1-7]|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
// Locate the habit's 7-slot day structure per the pre-registered rubric.
function findDaysSlots(habit) {
  for (const [key, value] of Object.entries(habit ?? {})) {
    if (Array.isArray(value) && value.length === 7) return { kind: 'array', key };
  }
  for (const [key, value] of Object.entries(habit ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 7 && keys.every((k) => DAY_KEY.test(k))) return { kind: 'object', key, keys };
    }
  }
  return null;
}

const stamp = `habit-judge-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let expectedCell; // the value the judge set in c3; c4 requires it after restart
let child;
try {
  child = start();
  const ready = await waitReady();
  const home = ready ? await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) }) : null;
  const homeOk = home !== null && home.status === 200 && /text\/html/i.test(home.headers.get('content-type') ?? '');
  check(C1, homeOk);
  c1Recorded = true;
  if (!homeOk) throw new Error('app did not serve HTML at / — skipping c2/c3/c4 HTTP flow');

  const create = await fetch(listUrl, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: stamp }),
    signal: AbortSignal.timeout(5_000),
  });
  const created = create.status === 200 || create.status === 201 ? await create.json().catch(() => null) : null;
  const listed = asList(await (await fetch(listUrl, { signal: AbortSignal.timeout(5_000) })).json().catch(() => null));
  const mine = listed.find((h) => JSON.stringify(h).includes(stamp));
  check(C2, (create.status === 200 || create.status === 201) && created?.id != null && mine != null);
  c2Recorded = true;

  const id = mine?.id ?? created?.id;
  const slots = mine ? findDaysSlots(mine) : null;
  if (!id || !slots) {
    check(C3, false);
    c3Recorded = true;
  } else {
    // Toggle slot 3 in the shape the GET returned, send the whole habit back.
    const updated = JSON.parse(JSON.stringify(mine));
    if (slots.kind === 'array') updated[slots.key][3] = !updated[slots.key][3];
    else updated[slots.key][slots.keys[3]] = !updated[slots.key][slots.keys[3]];
    const put = await fetch(itemUrl(id), {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(updated),
      signal: AbortSignal.timeout(5_000),
    });
    const after = asList(await (await fetch(listUrl, { signal: AbortSignal.timeout(5_000) })).json().catch(() => null))
      .find((h) => h.id === id);
    const before = mine;
    const cellAfter = after ? (slots.kind === 'array' ? after[slots.key]?.[3] : after[slots.key]?.[slots.keys[3]]) : undefined;
    const cellBefore = slots.kind === 'array' ? before[slots.key][3] : before[slots.key][slots.keys[3]];
    expectedCell = !cellBefore;
    check(C3, (put.status === 200 || put.status === 204) && after != null && cellAfter === !cellBefore);
    c3Recorded = true;
  }
} catch (err) {
  if (!c1Recorded) check(C1, false);
  if (!c2Recorded) check(C2, false);
  if (!c3Recorded) check(C3, false);
  console.error(err);
} finally {
  stop(child);
  await new Promise((r) => setTimeout(r, 800));
}

// c4 — restart: the habit and its toggled cell must still be there.
let child2;
try {
  child2 = start();
  if (!(await waitReady())) throw new Error('c4 restart: app did not become ready');
  const after = asList(await (await fetch(listUrl, { signal: AbortSignal.timeout(5_000) })).json().catch(() => null));
  const mine = after.find((h) => JSON.stringify(h).includes(stamp));
  const slots = mine ? findDaysSlots(mine) : null;
  const cell = mine && slots ? (slots.kind === 'array' ? mine[slots.key][3] : mine[slots.key][slots.keys[3]]) : undefined;
  check(C4, mine != null && slots != null && cell === expectedCell);
} catch (error) {
  check(C4, false);
  console.error(error);
} finally {
  stop(child2);
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
