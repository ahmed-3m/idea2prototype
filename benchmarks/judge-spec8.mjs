// Spec-8 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec8-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec8/RUBRIC.md, 2026-10-20T15:08:07Z).
// Unlike specs 5/6 (UI-internal), an echo chat's core flows ARE an HTTP
// protocol, so c2–c4 are BEHAVIORAL over HTTP through the endpoints each
// arm's own README documents (paths passed per arm — the judge-spec4/7
// precedent for layout-agnostic API probing): c2 POSTs a unique judge
// message and requires the exact string back plus a timestamp value, c3
// requires the history endpoint to contain it, c4 restarts the app via its
// documented command and requires the message GONE (the spec's own words:
// "history in memory"). Message field tolerance: the judge sends { text }
// and accepts the string anywhere in the JSON response body.
// Conventions mirror the round-2 hardened family: c5 (the project's own
// test command) runs FIRST (NODE_TEST_CONTEXT stripped, 120s cap, output-tail
// diagnostics); exactly five rubric entries via recorded flags; readiness
// short-circuit; every fetch capped (2s probe / 5s content); unconditional
// whole-tree cleanup per server cycle (Windows taskkill /T, POSIX detached
// group, ESRCH-guarded); unique per-run stamps make re-runs safe.
// Usage: node judge-spec8.mjs <projectDir> <port> "<startCmd>" <sendPath> <historyPath> "<testCmd>"
// Route paths are given WITHOUT the leading slash — Git Bash's MSYS layer
// rewrites leading-slash args into Windows paths; the judge normalizes back.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, sendPathArg, historyPathArg, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;
const routePath = (p) => '/' + String(p).replace(/^\/+/, '');
const sendUrl = `${base}${routePath(sendPathArg)}`;
const historyUrl = `${base}${routePath(historyPathArg)}`;
const JSON_HEADERS = { 'content-type': 'application/json' };

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C1 = 'c1 app starts using its documented command (HTML at /)';
const C2 = 'c2 server echoes the message with a timestamp';
const C3 = 'c3 history contains the judge message';
const C4 = 'c4 history is in memory (cleared by a restart)';
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
  // Diagnostics on failure — the verdict is still binary, but the output tail
  // makes transient failures (port races etc.) distinguishable from real ones.
  console.log(`  c5 diagnostics: exit ${t.status}${t.timedOut ? ' (timed out at 120s)' : ''}${t.error ? ` ${t.error}` : ''}`);
  const tail = (s) => String(s ?? '').split(/\r?\n/).filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n');
  if (t.stdout) console.log(tail(t.stdout));
  if (t.stderr) console.log(tail(t.stderr));
}
check(`c5 own test command passes (${testCmd})`, t.status === 0);

// A timestamp value per the rubric: an ISO-8601 string, or an epoch number
// (> 1e9 covers seconds and milliseconds), distinct from the message itself.
const hasTimestamp = (body, stamp) => {
  const s = JSON.stringify(body) ?? '';
  if (/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return true;
  const nums = s.match(/-?\d+(\.\d+)?e?\d*/g) ?? [];
  return nums.some((n) => Number(n) > 1e9 && !stamp.includes(n));
};

const stamp = `echo-judge-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let child;
try {
  child = start();
  const ready = await waitReady();
  const home = ready ? await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) }) : null;
  const homeOk = home !== null && home.status === 200 && /text\/html/i.test(home.headers.get('content-type') ?? '');
  check(C1, homeOk);
  c1Recorded = true;
  if (!homeOk) throw new Error('app did not serve HTML at / — skipping c2/c3/c4 HTTP flow');

  const send = await fetch(sendUrl, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text: stamp }),
    signal: AbortSignal.timeout(5_000),
  });
  const sendBody = send.status === 200 || send.status === 201 ? await send.json().catch(() => null) : null;
  check(
    C2,
    (send.status === 200 || send.status === 201) &&
      JSON.stringify(sendBody).includes(stamp) &&
      hasTimestamp(sendBody, stamp),
  );
  c2Recorded = true;

  // NOTE (external review): the frozen rubric also requires a list-shaped
  // body here (bare array or envelope: messages/data/items/history); this
  // judge checks 200 + stamp-presence only — outcome-neutral for the archived
  // arms (both serve {messages:[…]}); the envelope check ships in judge-spec9.
  const hist = await fetch(historyUrl, { signal: AbortSignal.timeout(5_000) });
  const histText = hist.status === 200 ? await hist.text() : '';
  check(C3, hist.status === 200 && histText.includes(stamp));
  c3Recorded = true;
} catch (err) {
  if (!c1Recorded) check(C1, false);
  if (!c2Recorded) check(C2, false);
  if (!c3Recorded) check(C3, false);
  console.error(err);
} finally {
  stop(child);
  await new Promise((r) => setTimeout(r, 800));
}

// c4 — restart: the spec says history lives in memory, so a fresh process
// must NOT serve the judge's message anymore.
let child2;
try {
  child2 = start();
  if (!(await waitReady())) throw new Error('c4 restart: app did not become ready');
  const hist = await fetch(historyUrl, { signal: AbortSignal.timeout(5_000) });
  const text = hist.status === 200 ? await hist.text() : '';
  check(C4, hist.status === 200 && !text.includes(stamp));
} catch (error) {
  check(C4, false);
  console.error(error);
} finally {
  stop(child2);
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
