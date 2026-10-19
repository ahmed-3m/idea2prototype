// Spec-3 functional rubric judge — the exact script used for the archived
// 2026-10-20 paired run (benchmarks/runs/2026-10-20-spec3-paired/NOTES.md).
// Rubric pre-registered BEFORE either arm ran (see NOTES); criteria are binary
// and exercised mechanically by spawning each arm's CLI in an isolated dir.
// Usage: node judge-spec3.mjs <projectDir> <entryFile> "<own test command>"
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [projectDir, entry, testCmd] = process.argv.slice(2);
const cli = join(projectDir, entry);
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd });

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

// c1 — first use shows usage without a crash (help flag or bare invocation)
const showsUsage = (r) =>
  r.status !== null && !/throw|\n\s+at /m.test(r.stderr) && /usage|command/i.test(`${r.stdout}${r.stderr}`);
const help = run(['--help'], projectDir);
const bare = run([], projectDir);
check('c1 first use shows usage, no crash', showsUsage(help) || showsUsage(bare));

const dir = await mkdtemp(join(tmpdir(), 'judge-spec3-'));
const note = `judge rubric milk ${Date.now()}`;

// c2 — add persists a markdown file
const add = run(['add', note], dir);
const files = add.status === 0
  ? (await readdir(join(dir, 'notes')).catch(() => [])).filter((f) => f.endsWith('.md'))
  : [];
check('c2 add persists a note file', add.status === 0 && files.length === 1);

// c3 — list shows it in a FRESH process (each spawn is a fresh process)
const list = run(['list'], dir);
check('c3 list shows the note in a fresh process', list.status === 0 && list.stdout.includes(note));

// c4 — search hits an existing term and cleanly misses an absent one
const hit = run(['search', 'rubric'], dir);
const miss = run(['search', 'zzz-no-such-term'], dir);
check('c4 search hit + clean miss',
  hit.status === 0 && hit.stdout.includes(note) && miss.status === 0 && !miss.stdout.includes(note));

// c5 — the project's own tests pass via its documented command
const t = spawnSync(testCmd, { shell: true, cwd: projectDir, encoding: 'utf8' });
check(`c5 own test command passes (${testCmd})`, t.status === 0);

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
