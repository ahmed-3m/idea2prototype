// Spec-5 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec5-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec5/RUBRIC.md, 2026-10-20T14:06:45Z).
// A quiz web app is UI-centric and may legitimately have no HTTP protocol for
// answers/scoring (pure client-side logic is a valid reading of the spec), so
// c2–c4 are operationalized at the SERVED-SOURCE level per the pre-registered
// rubric: the judge fetches the root HTML plus every same-origin <script src>
// asset and analyzes the combined source with fixed regex/count predicates —
// blind (never sees which arm produced the project), mechanical, identical for
// both arms. Known limitation, pre-registered up front: source-presence is
// weaker than behavior for UI criteria; a broken score line could pass c3.
// Conventions mirror judge-spec4/7: c5 (the project's own test command) runs
// FIRST so judge traffic cannot poison fixtures (NODE_TEST_CONTEXT stripped);
// exactly five rubric entries even when the flow throws mid-way (unrecorded
// criteria are recorded as failed via recorded flags, never replaced ad hoc);
// the HTTP block short-circuits when readiness fails; cleanup kills the whole
// process tree on both platforms (shell:true means child.pid is a shell —
// Windows uses taskkill /T, POSIX kills the detached group, ESRCH-guarded).
// Usage: node judge-spec5.mjs <projectDir> <port> "<startCmd>" "<testCmd>"
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C1 = 'c1 app starts using its documented command (HTML at /)';
const C2 = 'c2 five hard-coded questions in served source';
const C3 = 'c3 score-at-end logic in served source (score + vs-total presentation)';
const C4 = 'c4 restart control + quiz-state reset in served source';
let c1Recorded = false;
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
  else {
    // ESRCH if the group already exited on its own — cleanup must never
    // abort the judge before the score is computed.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
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

// Question strings per the pre-registered rubric: quoted literals ('…', "…",
// backtick — JSON string values are quoted too) of >= 10 chars containing '?'
// and at least 3 letters. Code ternaries don't produce 10+ char '?' literals.
const stringLiterals = (src) => {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const s = m[2];
    if (s.includes('?') && s.length >= 10 && (s.match(/[a-z]/gi) ?? []).length >= 3) out.push(s);
  }
  return out;
};

let child;
try {
  child = start();
  const ready = await waitReady();
  const home = ready ? await fetch(`${base}/`) : null;
  const homeOk = home !== null && home.status === 200 && /text\/html/i.test(home.headers.get('content-type') ?? '');
  check(C1, homeOk);
  c1Recorded = true;
  if (!homeOk) throw new Error('app did not serve HTML at / — skipping c2/c4 source checks');
  let combined = await home.text();

  // Collect what the app's own code loads from its origin — the pre-registered
  // "served source" collection (HTML + <script src> assets) proved too narrow
  // for both natural quiz shapes (questions served as JSON from an API route;
  // questions in a module reached by an inline `import '/x.mjs'`). Hardened per
  // the spec-4/7 precedent AFTER both arms were judged 4/5 by the strict
  // collector (both failing c2 identically — the collection bug, not missing
  // questions); criteria unchanged, re-judged identically on both arms.
  // Followed mechanically, same-origin only: <script src> attributes, static
  // import specifiers, and first-arg fetch('…') literals (GET — a POST-only
  // endpoint answers 405/404 and is skipped). Bare specifiers and CDN URLs are
  // ignored; bounded to 3 rounds / 20 assets so a self-referencing app can't
  // loop the judge.
  const visited = new Set();
  const sameOrigin = (s) => s.startsWith('/') || s.startsWith('./') || s.startsWith('../');
  const candidates = (src) => {
    const out = [];
    const patterns = [
      /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
      /\bfrom\s*['"]([^'"]+)['"]/g,
      /\bimport\s*['"]([^'"]+)['"]/g,
      /\bfetch\(\s*['"`]([^'"`]+)['"`]/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(src)) !== null) out.push(m[1]);
    }
    return out.filter(sameOrigin);
  };
  for (let round = 0; round < 3; round++) {
    const urls = candidates(combined)
      .map((s) => (s.startsWith('/') ? `${base}${s}` : new URL(s, `${base}/`).href))
      .filter((u) => !visited.has(u))
      .slice(0, 20 - visited.size);
    if (urls.length === 0) break;
    for (const u of urls) {
      visited.add(u);
      try {
        const res = await fetch(u);
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && /^(text\/|application\/json)/i.test(type)) combined += `\n${await res.text()}`;
      } catch {} // a broken/unfetchable asset must not crash the judge; its absence shows up in c2
    }
  }

  // c2 — >= 5 DISTINCT question strings in the combined served source.
  const distinct = new Set(stringLiterals(combined));
  check(C2, distinct.size >= 5);
  c2Recorded = true;

  // c3 — score identifier AND a vs-total presentation (pre-registered regexes).
  check(
    C3,
    /score/i.test(combined) && /(out of|\/\s*5|\.length|total|percent)/i.test(combined),
  );
  c3Recorded = true;

  // c4 — restart control AND reset logic (pre-registered regexes).
  check(
    C4,
    /(restart|play again|try again|retry|reset|start over|again)/i.test(combined) &&
      /(location\.reload|score\s*=\s*0|index\s*=\s*0|current\s*=\s*0|i\s*=\s*0|answers\s*=\s*\{\s*\}|answers\s*=\s*\[\s*\]|innerHTML\s*=\s*['"]{2})/i.test(combined),
  );
  c4Recorded = true;
} catch (err) {
  if (!c1Recorded) check(C1, false);
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
