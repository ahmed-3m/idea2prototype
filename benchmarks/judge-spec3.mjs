// Spec-3 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec3-paired/NOTES.md). Rubric pre-registered
// BEFORE either arm ran (see NOTES); criteria are binary and exercised
// mechanically by spawning each arm's CLI in an isolated dir.
// Post-review hardening (external diff review on the results PR): absolute
// path resolution, layout-agnostic persistence check (dir diff), search-miss
// accepts exit 0 or 1 (grep convention), tighter usage check, NODE_TEST_CONTEXT
// stripped, tmp cleanup, non-zero exit on failure. Re-run on both archived
// arms after hardening: same 5/5 verdicts.
// Usage: node judge-spec3.mjs <projectDir> <entryFile> "<own test command>"
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [rawDir, entry, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);
const cli = join(projectDir, entry);
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd });

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const noStack = (r) => !/throw|\n\s+at /m.test(r.stderr);

// c1 — first use shows real usage (must name the subcommands) without a crash
const showsUsage = (r) =>
  r.status !== null && noStack(r) && /add/.test(r.stdout + r.stderr) && /list|search/.test(r.stdout + r.stderr);
const help = run(['--help'], projectDir);
const bare = run([], projectDir);
check('c1 first use shows usage, no crash', showsUsage(help) || showsUsage(bare));

const dir = await mkdtemp(join(tmpdir(), 'judge-spec3-'));
try {
  const note = `judge rubric milk ${Date.now()}`;

  // c2 — add persists SOMETHING new on disk (layout-agnostic: dir diff)
  const before = await readdir(dir, { recursive: true });
  const add = run(['add', note], dir);
  const after = add.status === 0 ? await readdir(dir, { recursive: true }) : before;
  const created = after.filter((f) => !before.includes(f));
  check('c2 add persists a note on disk', add.status === 0 && noStack(add) && created.length >= 1);

  // c3 — list shows it in a FRESH process (each spawn is a fresh process)
  const list = run(['list'], dir);
  check('c3 list shows the note in a fresh process', list.status === 0 && list.stdout.includes(note));

  // c4 — search hits an existing term; absent term misses cleanly
  // (miss may exit 0 or 1 — grep-style conventions exit 1 on no-match)
  const hit = run(['search', 'rubric'], dir);
  const miss = run(['search', 'zzz-no-such-term'], dir);
  check('c4 search hit + clean miss',
    hit.status === 0 && hit.stdout.includes(note) && (miss.status === 0 || miss.status === 1) && !miss.stdout.includes(note));

  // c5 — the project's own tests pass via its documented command
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8', env });
  check(`c5 own test command passes (${testCmd})`, t.status === 0);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
