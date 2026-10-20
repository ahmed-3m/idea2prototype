// Spec-10 functional rubric judge — used for the archived 2026-10-20 paired
// run (benchmarks/runs/2026-10-20-spec10-paired/NOTES.md). Rubric
// pre-registered BEFORE either arm ran (D:/tmp/i2p-spec10/RUBRIC.md,
// 2026-10-20T16:12:54Z). A CLI's flows are its stdout/exit codes — fully
// mechanical. EXPECTATIONS ARE COMPUTED PROGRAMMATICALLY from the judge's
// own fixed input (whitespace-split), never hardcoded — the pre-registration
// notes a corrected human miscount (an early draft's illustration said
// the×5; the true count is the×4 — exactly why the operative rule is
// programmatic). c1 checks the arm's documented count invocation on a valid
// file AND its no-file behavior (guidance, exit 0-or-1, no stack trace);
// c2/c3 locate totals label-tolerantly; c4 extracts (word, count) pairs in
// output order, filters the words:/lines: label lines, and verifies the
// top-5 composition: every word above the rank-5 threshold count (the, dog,
// fox for this input) plus exactly the right number of tied words, rank 1
// before rank 5. c5 runs the arm's own test command FIRST (judge-spec3 CLI
// conventions: NODE_TEST_CONTEXT stripped, 120s cap + output-tail
// diagnostics; recorded-flag integrity keeps exactly five entries).
// Usage: node judge-spec10.mjs <projectDir> "<countCmdTemplate with FILE>" "<testCmd>"
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

const [rawDir, countCmdTemplate, testCmd] = process.argv.slice(2);
const projectDir = resolve(rawDir);

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const C1 = 'c1 CLI runs per its documented command (valid file exits 0; no-file gives guidance)';
const C2 = 'c2 word count correct';
const C3 = 'c3 line count correct';
const C4 = 'c4 top-5 words listed, descending frequency, tie-fair';

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

// Fixed judge input (exact bytes) + programmatic expectations.
const INPUT = 'the quick brown fox\nthe lazy dog\nthe fox and the dog\ndog dog\n';
const tokens = INPUT.toLowerCase().split(/\s+/).filter(Boolean);
const EXPECT_WORDS = tokens.length;
const EXPECT_LINES = INPUT === '' ? 0 : INPUT.endsWith('\n') ? INPUT.slice(0, -1).split('\n').length : INPUT.split('\n').length;
const freq = new Map();
for (const w of tokens) freq.set(w, (freq.get(w) ?? 0) + 1);
const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]);
const threshold = ranked[4][1]; // count at rank 5
const mandatory = ranked.filter(([, c]) => c > threshold).map(([w, c]) => `${w}:${c}`);
const tiePool = new Set(ranked.filter(([, c]) => c === threshold).map(([w]) => w));
const tieNeeded = 5 - mandatory.length;

const dir = await mkdtemp(join(tmpdir(), `judge-spec10-`));
const file = join(dir, 'input.txt');
await writeFile(file, INPUT, 'utf8');

const withFile = countCmdTemplate.replace('FILE', file);
const noFile = countCmdTemplate.replace(/\s*FILE\s*$/, '');
const runCli = (cmd) => spawnSync(cmd, { shell: true, cwd: projectDir, encoding: 'utf8', timeout: 60_000 });

try {
  const ok = runCli(withFile);
  const no = runCli(noFile);
  // Guidance must come from actual usage text; a stack trace can contain the
  // word "file" (paths) but never a usage/help banner. A crash is any Node
  // stack frame — an indented "at ..." line — which also catches async frames
  // ("at async main (...)") the old Error:…at-word( regex missed.
  const combined = (no.stdout ?? '') + (no.stderr ?? '');
  const guidance = /^.*(usage|help)/im.test(combined) || /requires a file/i.test(combined);
  const noCrash = !/^\s+at\s+\S/m.test(combined) && !/uncaught exception/i.test(combined);
  check(C1, ok.status === 0 && (no.status === 0 || no.status === 1) && guidance && noCrash);
  const out = ok.stdout ?? '';
  check(C2, new RegExp(`(?:words?[^0-9\\n]{0,5})${EXPECT_WORDS}\\b|(?:^|[^0-9])${EXPECT_WORDS}[^0-9\\n]{0,5}words?`, 'im').test(out));
  check(C3, new RegExp(`(?:lines?[^0-9\\n]{0,5})${EXPECT_LINES}\\b|(?:^|[^0-9])${EXPECT_LINES}[^0-9\\n]{0,5}lines?`, 'im').test(out));

  // c4 — (word, count) pairs in output order; label lines filtered.
  const LABELS = new Set(['words', 'word', 'lines', 'line']);
  const pairs = [];
  for (const m of out.matchAll(/^[ \t]*([a-z]+)[ \t]*[:.\-]?[ \t]+(\d+)[ \t]*$/gim)) {
    if (!LABELS.has(m[1].toLowerCase())) pairs.push([m[1].toLowerCase(), Number(m[2])]);
  }
  const top5 = pairs.slice(0, 5);
  const gotMandatory = mandatory.every((mc) => {
    const [w, c] = mc.split(':');
    return top5.some(([gw, gc]) => gw === w && gc === Number(c));
  });
  const tieWords = top5.filter(([, c]) => c === threshold).map(([w]) => w);
  const ordered = top5.every(([, c], i) => i === 0 || c <= top5[i - 1][1]);
  check(
    C4,
    top5.length === 5 &&
      gotMandatory &&
      tieWords.length >= tieNeeded &&
      tieWords.every((w) => tiePool.has(w)) &&
      ordered,
  );
} catch (err) {
  check('judge flow threw', false);
  console.error(err);
}

const score = results.filter(([, ok]) => ok).length;
console.log(`SCORE ${score}/${results.length}`);
if (score < results.length) process.exitCode = 1;
