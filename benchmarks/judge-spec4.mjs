// Spec-4 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec4-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec4/RUBRIC.md, 2026-10-20T09:32:00Z);
// criteria are binary and exercised mechanically over HTTP: the app is started
// via its own documented start command (PORT overridden), driven through the
// API its README documents, restarted for the persistence check, and its own
// test command is spawned for c5.
// Hardening mirrors judge-spec3: absolute path resolution, expected totals
// computed relative to pre-existing state (re-run safe), NODE_TEST_CONTEXT
// stripped, non-zero exit on failure. Windows: the start command runs through
// a shell, so cleanup kills the whole process tree (taskkill /T) — a plain
// child.kill() would orphan the node server under cmd.exe.
// Execution order: c5 runs BEFORE the HTTP checks so the judge's own writes
// cannot poison the arm's test fixtures (an arm whose tests assert exact
// totals would otherwise see the judge's expenses).
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

function start() {
  return spawn(startCmd, {
    shell: true,
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
}
function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
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

// c5 — the project's own tests pass via its documented command (runs first)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env });
check(`c5 own test command passes (${testCmd})`, t.status === 0);

let child;
try {
  child = start();
  check('c1 app starts using its documented command', await waitReady());

  const added = [[10, 'food'], [5, 'food'], [7, 'travel']];
  const before = await (await fetch(summaryUrl)).json().catch(() => ({}));

  let okAdds = true;
  for (const [amount, category] of added) {
    const res = await fetch(expensesUrl, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ amount, category }),
    });
    if (res.status !== 200 && res.status !== 201) okAdds = false;
  }
  check('c2 add expense (amount+category) via the documented API', okAdds);

  const num = (v) => Number(v ?? 0);
  const summary = await (await fetch(summaryUrl)).json();
  check(
    'c3 summary totals correct for 2 categories',
    num(summary.food) === num(before.food) + 15 && num(summary.travel) === num(before.travel) + 7,
  );
} catch (err) {
  check('c1..c3 rubric flow threw', false);
  console.error(err);
} finally {
  stop(child);
  await new Promise((r) => setTimeout(r, 500));
}

// c4 — restart: expenses added before the stop must still be present
let child2;
try {
  child2 = start();
  await waitReady();
  const list = await (await fetch(expensesUrl)).json();
  const hasPair = (amount, category) =>
    list.some((x) => Number(x.amount) === amount && x.category === category);
  check('c4 expenses survive an app restart', hasPair(10, 'food') && hasPair(5, 'food') && hasPair(7, 'travel'));
} catch {
  check('c4 expenses survive an app restart', false);
} finally {
  stop(child2);
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
