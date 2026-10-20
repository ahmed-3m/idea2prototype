// Spec-5 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec5-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec5/RUBRIC.md, 2026-10-20T14:06:45Z).
// A quiz web app is UI-centric and may legitimately have no HTTP protocol for
// answers/scoring (pure client-side logic is a valid reading of the spec), so
// c2–c4 are operationalized at the SERVED-SOURCE level per the pre-registered
// rubric: the judge walks the app's own delivery surface and analyzes the
// combined source with fixed regex/count predicates — blind (never sees which
// arm produced the project), mechanical, identical for both arms. Known
// limitation, pre-registered up front: source-presence is weaker than behavior
// for UI criteria; a broken score line could pass c3.
// Collector history (both hardening rounds documented in the run NOTES):
// the pre-registered collector (root HTML + <script src> only) missed both
// natural quiz shapes (API-JSON questions; module-import questions) — both
// arms first scored 4/5; round 1 followed imports/fetch literals; round 2
// (external review, CodeRabbit + opencode) made the walk origin-based and
// per-asset-relative, bounded every fetch and the test command, and made
// cleanup unconditional. Criteria text/predicates unchanged throughout;
// both arms re-judged after every round.
// Conventions mirror judge-spec4/7: c5 (the project's own test command) runs
// FIRST so judge traffic cannot poison fixtures (NODE_TEST_CONTEXT stripped,
// 120s cap — a hung test command fails c5 instead of hanging the judge);
// exactly five rubric entries even when the flow throws mid-way (unrecorded
// criteria are recorded as failed via recorded flags, never replaced ad hoc);
// the HTTP block short-circuits when readiness fails; every fetch carries a
// 5s abort deadline; cleanup always attempts the whole-tree kill (a shell
// that exits while a backgrounded server lives must not skip it — Windows
// taskkill /T, POSIX kills the detached group, ESRCH-guarded).
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
  if (!child) return;
  // Unconditional: the shell may have exited while a backgrounded server
  // lives on in its process group. Killing an already-dead tree is a silent
  // no-op (taskkill) or ESRCH (caught) — never a judge failure.
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

// c5 — the project's own tests pass via its documented command (runs first).
// 120s cap: a test process that outlives its tests (open handles, keep-alive
// sockets) fails c5 instead of hanging the judge forever.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env, timeout: 120_000 });
if (t.status !== 0) {
  console.log(`  c5 diagnostics: exit ${t.status}${t.timedOut ? ' (timed out at 120s)' : ''}${t.error ? ` ${t.error}` : ''}`);
  const tail = (s) => String(s ?? '').split(/\r?\n/).filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n');
  if (t.stdout) console.log(tail(t.stdout));
  if (t.stderr) console.log(tail(t.stderr));
}
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
  const home = ready ? await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) }) : null;
  const homeOk = home !== null && home.status === 200 && /text\/html/i.test(home.headers.get('content-type') ?? '');
  check(C1, homeOk);
  c1Recorded = true;
  if (!homeOk) throw new Error('app did not serve HTML at / — skipping c2/c4 source checks');
  let combined = await home.text();

  // Walk the app's own delivery surface: what its code loads from its origin.
  // References are extracted FROM EACH ASSET and resolved against THAT asset's
  // URL (a './questions.mjs' inside /js/main.mjs is /js/questions.mjs), then
  // kept only if they resolve onto the judge's origin — this admits
  // root-absolute, relative, bare-relative, and same-origin protocol-relative
  // references, and excludes CDNs, bare specifiers, and cross-origin URLs.
  // Sources followed: <script src> attributes, static import specifiers, and
  // first-arg fetch('…') literals (GET — a POST-only endpoint answers 405/404
  // and is skipped). Bounded to 3 rounds / 20 assets, each fetch capped at 5s.
  const origin = new URL(base).origin;
  const assets = [{ href: `${base}/`, text: combined }];
  const visited = new Set([`${base}/`]);
  const assetRefs = (src, fromUrl) => {
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
    return out
      .map((s) => {
        try {
          return new URL(s, fromUrl);
        } catch {
          return null; // unparseable reference — skip, not crash
        }
      })
      .filter((u) => u && u.origin === origin && /^https?:$/.test(u.protocol));
  };
  for (let round = 0; round < 3; round++) {
    const urls = [
      ...new Set(assets.flatMap((a) => assetRefs(a.text, a.href)).map((u) => u.href)),
    ]
      .filter((href) => !visited.has(href))
      .slice(0, 20 - visited.size);
    if (urls.length === 0) break;
    for (const href of urls) {
      visited.add(href);
      try {
        const res = await fetch(href, { signal: AbortSignal.timeout(5_000) });
        // text/*, JSON, and JavaScript media types (RFC 9239 legacy included).
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && /^(text\/|application\/(json|javascript))/i.test(type)) {
          const text = await res.text();
          assets.push({ href, text });
          combined += `\n${text}`;
        }
      } catch {} // a broken/timing-out/unfetchable asset must not crash the judge; its absence shows up in c2
    }
  }

  // c2 — >= 5 DISTINCT question strings in the combined served source.
  const distinct = new Set(stringLiterals(combined));
  check(C2, distinct.size >= 5);
  c2Recorded = true;

  // c3 — score identifier AND a vs-total presentation (pre-registered
  // alternatives; the `.length` branch must sit in a score/template context —
  // `score … .length` nearby or inside a ${…} interpolation — per the frozen
  // rubric wording, not anywhere in the source).
  const lengthInScoreContext = /(score[\s\S]{0,40}\.length|\.length[\s\S]{0,40}score|\$\{[^}`]*\.length[^}`]*\})/i;
  check(
    C3,
    /score/i.test(combined) &&
      (/(out of|\/\s*5|total|percent)/i.test(combined) || lengthInScoreContext.test(combined)),
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
