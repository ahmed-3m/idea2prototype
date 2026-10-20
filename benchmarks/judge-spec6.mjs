// Spec-6 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec6-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (D:/tmp/i2p-spec6/RUBRIC.md, 2026-10-20T14:28:11Z).
// A pomodoro is UI/timer-centric and may legitimately be fully client-side,
// so c2–c4 are operationalized at the SERVED-SOURCE level per the
// pre-registered rubric, with LINE-granular predicates (tokens must co-occur
// on one line, as real duration/control declarations do) — stronger than
// whole-source contains. The collector is the hardened spec-5 shape: root
// HTML + same-origin <script src> assets + static import specifiers +
// first-arg fetch('…') literals (GET-only, same-origin, bounded rounds).
// Pre-registered limitation: source-presence cannot prove a ticking timer;
// it applies identically to both arms.
// Conventions mirror judge-spec4/5/7: c5 (the project's own test command)
// runs FIRST (NODE_TEST_CONTEXT stripped); exactly five rubric entries via
// recorded flags; readiness short-circuit; whole-tree kill (Windows taskkill
// /T, POSIX detached group, ESRCH-guarded).
// Usage: node judge-spec6.mjs <projectDir> <port> "<startCmd>" "<testCmd>"
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [rawDir, portArg, startCmd, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const port = Number(portArg);
const base = `http://127.0.0.1:${port}`;

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C1 = 'c1 app starts using its documented command (HTML at /)';
const C2 = 'c2 25-minute work + 5-minute break durations declared (line-level)';
const C3 = 'c3 start and pause controls present';
const C4 = 'c4 reset control + cycle counter present';
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
  // lives on in its process group; killing a dead tree is a silent no-op.
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
  // Diagnostics on failure — the verdict is still binary, but the output tail
  // makes transient failures (port races etc.) distinguishable from real ones.
  console.log('  c5 diagnostics: exit', t.status, t.error ? String(t.error) : '');
  const tail = (s) => String(s ?? '').split(/\r?\n/).filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n');
  if (t.stdout) console.log(tail(t.stdout));
  if (t.stderr) console.log(tail(t.stderr));
}
check(`c5 own test command passes (${testCmd})`, t.status === 0);

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

  // Same hardened collector family as judge-spec5: what the app's own code
  // loads from its origin. Same-origin only, bounded rounds/assets.
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

  // c2 — durations, LINE-granular per the pre-registered rubric: a line with
  // `25 * 60` or a bare 1500, or a line pairing the token 25 with a
  // duration-ish word; same for 5 / 300 on the break side.
  const lines = combined.split(/\r?\n/);
  const workLine = lines.some((ln) => /25\s*\*\s*60|\b1500\b/.test(ln) || (/\b25\b/.test(ln) && /(min|minute|work|focus|dur|pomodoro)/i.test(ln)));
  const breakLine = lines.some((ln) => /5\s*\*\s*60|\b300\b/.test(ln) || (/\b5\b/.test(ln) && /(min|minute|break|rest|short|pause)/i.test(ln)));
  check(C2, workLine && breakLine);
  c2Recorded = true;

  check(C3, /\b(start|play)\b/i.test(combined) && /\bpause\b/i.test(combined));
  c3Recorded = true;

  check(C4, /\b(reset|restart)\b/i.test(combined) && /\b(cycle|session|round|pomodoro)s?\b/i.test(combined));
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
