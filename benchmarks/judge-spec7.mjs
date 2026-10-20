// Spec-7 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec7-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec7/RUBRIC.md, 2026-10-20T09:53:04Z);
// criteria are binary and exercised mechanically over HTTP. Conventions mirror
// judge-spec4 incl. its external-review hardening: exactly five rubric entries
// even when the flow throws mid-way (unrecorded criteria are recorded as
// failed, never replaced by an ad-hoc entry), the HTTP block short-circuits
// when readiness fails, judge-chosen tags are unique per run so the
// only-matches assertion is safe against pre-existing data, and cleanup kills
// the whole process tree on both platforms (shell:true means child.pid is a
// shell — a bare kill() orphans the server on POSIX; Windows uses taskkill
// /T, POSIX kills the detached group). The arm's own test command runs FIRST
// (c5) so judge writes cannot poison its fixtures.
// Usage: node judge-spec7.mjs <projectDir> <port> "<startCmd>" <bookmarksPath> "<testCmd>"
// Route paths are given WITHOUT the leading slash — Git Bash's MSYS layer
// rewrites leading-slash args into Windows paths; the judge normalizes back.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, bookmarksPath, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;
const routePath = (p) => '/' + String(p).replace(/^\/+/, '');
const listUrl = (tag) => `${base}${routePath(bookmarksPath)}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
const itemUrl = (id) => `${base}${routePath(bookmarksPath)}/${id}`;
const JSON_HEADERS = { 'content-type': 'application/json' };

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C2 = 'c2 create bookmark (url+title+tags)';
const C3 = 'c3 update + delete roundtrip';
const C4 = 'c4 tag filter: only matches + absent tag is empty';
let c2Recorded = false;
let c3Recorded = false;
let c4Recorded = false;

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

// c5 — the project's own tests pass via its documented command (runs first)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env });
check(`c5 own test command passes (${testCmd})`, t.status === 0);

const stamp = `rubric-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAG_A = `${stamp}-a`;
const TAG_B = `${stamp}-b`;

let child;
try {
  child = start();
  const ready = await waitReady();
  check('c1 API starts using its documented command', ready);
  if (!ready) throw new Error('app did not become ready — skipping c2/c4 HTTP flow');

  const mk = (url, title, tags) =>
    fetch(listUrl(), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ url, title, tags }),
    });

  const a = await mk('https://judge-a.dev', 'Judge A', [TAG_A]);
  const b = await mk('https://judge-b.dev', 'Judge B', [TAG_B]);
  const aBody = a.status === 201 || a.status === 200 ? await a.json() : null;
  check(C2, (a.status === 201 || a.status === 200) && (b.status === 201 || b.status === 200) && !!aBody?.id);
  c2Recorded = true;

  const put = await fetch(itemUrl(aBody.id), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: 'Judge A renamed' }),
  });
  const putBody = put.status === 200 ? await put.json() : null;
  const del = await fetch(itemUrl(aBody.id), { method: 'DELETE' });
  const gone = await fetch(itemUrl(aBody.id));
  check(
    C3,
    put.status === 200 && putBody?.title === 'Judge A renamed' &&
      (del.status === 200 || del.status === 204) && gone.status === 404,
  );
  c3Recorded = true;

  const only = asList(await (await fetch(listUrl(TAG_B))).json().catch(() => null));
  const none = asList(await (await fetch(listUrl(`${stamp}-never`))).json().catch(() => null));
  check(
    C4,
    only.some((x) => x.url === 'https://judge-b.dev' && (x.tags ?? []).includes(TAG_B)) &&
      !only.some((x) => x.url === 'https://judge-a.dev') &&
      none.length === 0,
  );
  c4Recorded = true;
} catch (err) {
  if (!c2Recorded) check(C2, false);
  if (!c3Recorded) check(C3, false);
  if (!c4Recorded) check(C4, false);
  console.error(err);
} finally {
  stop(child);
  await new Promise((r) => setTimeout(r, 500));
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
