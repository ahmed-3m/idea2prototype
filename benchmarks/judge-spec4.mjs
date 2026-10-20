// Spec-4 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec4-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec4/RUBRIC.md, 2026-10-20T09:32:00Z);
// criteria are binary and exercised mechanically over HTTP: the app is started
// via its own documented start command (PORT overridden), driven through the
// API its README documents, restarted for the persistence check, and its own
// test command is spawned for c5.
// Hardening mirrors judge-spec3 plus the external review of this very script:
// exactly five rubric entries even when the flow throws mid-way (unrecorded
// criteria are recorded as failed, never replaced by an ad-hoc entry), the
// HTTP block short-circuits when readiness fails, c4 compares per-pair counts
// against the pre-run list (re-run safe against leftover seed data), summary
// values must be finite, and cleanup kills the whole process tree on both
// platforms (shell:true means child.pid is a shell — a bare kill() orphans the
// server on POSIX; Windows uses taskkill /T, POSIX kills the detached group).
// Execution order: c5 runs BEFORE the HTTP checks so the judge's own writes
// cannot poison the arm's test fixtures.
// Usage: node judge-spec4.mjs <projectDir> <port> "<startCmd>" <expensesPath> <summaryPath> "<testCmd>"
// Route paths are given WITHOUT the leading slash (e.g. api/expenses) — Git
// Bash's MSYS layer rewrites leading-slash args into Windows paths; the judge
// normalizes either form back onto a URL path.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, expensesPath, summaryPath, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;
const routePath = (p) => '/' + String(p).replace(/^\/+/, '');
const expensesUrl = `${base}${routePath(expensesPath)}`;
const summaryUrl = `${base}${routePath(summaryPath)}`;
const JSON_HEADERS = { 'content-type': 'application/json' };

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C2 = 'c2 add expense (amount+category) via the documented API';
const C3 = 'c3 summary totals correct for 2 categories';
const C4 = 'c4 expenses survive an app restart';
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
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else process.kill(-child.pid, 'SIGKILL');
}
async function waitReady(deadlineMs = 15_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(base);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}
const asList = (v) => (Array.isArray(v) ? v : []);
const countPair = (items, amount, category) =>
  asList(items).filter((x) => Number(x.amount) === amount && x.category === category).length;

// c5 — the project's own tests pass via its documented command (runs first)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env });
check(`c5 own test command passes (${testCmd})`, t.status === 0);

const added = [[10, 'food'], [5, 'food'], [7, 'travel']];
let beforeExpenses = [];
let child;
try {
  child = start();
  const ready = await waitReady();
  check('c1 app starts using its documented command', ready);
  if (!ready) throw new Error('app did not become ready — skipping c2/c3 HTTP flow');

  // Absent/non-finite categories read as 0: a fresh store must satisfy
  // `after === before + added`, and an Infinity summary value must not
  // compare equal to itself + 15.
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // The rubric accepts either summary shape: {category: total} or [{category, total}].
  const totalOf = (summary, category) => {
    if (!summary || typeof summary !== 'object') return NaN;
    if (Array.isArray(summary)) {
      const row = summary.find((x) => x && x.category === category);
      return num(row?.total ?? row?.amount ?? row?.sum);
    }
    return num(summary[category]);
  };
  const before = await (await fetch(summaryUrl)).json().catch(() => ({}));
  beforeExpenses = asList(await (await fetch(expensesUrl)).json().catch(() => []));

  let okAdds = true;
  for (const [amount, category] of added) {
    const res = await fetch(expensesUrl, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ amount, category }),
    });
    if (res.status !== 200 && res.status !== 201) okAdds = false;
  }
  check(C2, okAdds);
  c2Recorded = true;

  const summary = await (await fetch(summaryUrl)).json();
  check(
    C3,
    totalOf(summary, 'food') === totalOf(before, 'food') + 15 &&
      totalOf(summary, 'travel') === totalOf(before, 'travel') + 7,
  );
  c3Recorded = true;
} catch (err) {
  if (!c2Recorded) check(C2, false);
  if (!c3Recorded) check(C3, false);
  console.error(err);
} finally {
  stop(child);
  await new Promise((r) => setTimeout(r, 500));
}

// c4 — restart: the judge's own additions must still be present (per-pair
// count vs the pre-run list, so leftover seed data from earlier runs can't
// satisfy the criterion on its own)
let child2;
try {
  child2 = start();
  if (!(await waitReady())) throw new Error('c4 restart: app did not become ready');
  const list = await (await fetch(expensesUrl)).json();
  check(C4, added.every(([amount, category]) => countPair(list, amount, category) > countPair(beforeExpenses, amount, category)));
} catch (error) {
  check(C4, false);
  console.error(error);
} finally {
  stop(child2);
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
