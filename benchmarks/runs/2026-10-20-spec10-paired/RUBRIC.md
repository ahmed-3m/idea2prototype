# Spec 10 rubric — Word counter CLI (pre-registered 2026-10-20T16:12:54Z, BEFORE either arm ran)

Spec text (verbatim, both arms): "Build a working prototype: Word counter CLI: `count <file>` → words, lines, top-5 words. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end. When finished reply with DONE and instructions to run it."

Five binary criteria. A CLI's flows are its stdout/exit codes — fully mechanical to judge without a browser or HTTP. The judge writes its OWN input file (known content, fixed expected counts), runs the arm's documented count command on it, and parses the output. Judging conventions follow judge-spec3 (the first CLI judge): the arm's own test command runs first (c5); output parsing is layout-agnostic (numbers located by label/regex, not position); a missing thing accepts exit 0-or-1 where the protocol below says so.

- **c1 — CLI runs per its documented command**: `count <file>` (via the arm's documented invocation, e.g. `node cli.mjs count <file>` or `npm start -- count <file>` or a bin script) exits 0 on a valid file and prints a usage/help line when invoked with NO arguments (exit 0 or 1 both accepted for the help case — the criterion is that no-args produces guidance, not a stack trace).
- **c2 — word count correct**: on the judge's input file (exact content fixed below), the output contains the exact total word count with a word-ish label or bare number findable by regex (`words: 23` / `23 words` / `Words: 23` / a bare `23` adjacent to the other totals).
- **c3 — line count correct**: same output contains the exact total line count, same label tolerance (`lines`/`Lines`).
- **c4 — top-5 words listed**: the output lists exactly the top 5 most frequent words for the fixed input, each findable by regex, in descending frequency order (rank 1 before rank 5 in the output text). Case handling and punctuation trimming are FIXED by the input below (no ambiguous tokens: all words lowercase, separated by whitespace, no punctuation attached).
- **c5 — own test command passes**: the project's own documented test command exits 0 (runs FIRST, `NODE_TEST_CONTEXT` stripped, 120s cap).

Judge input file (written by the judge to a temp dir, exact bytes):

```
the quick brown fox
the lazy dog
the fox and the dog
dog dog
```

Fixed expectations are COMPUTED PROGRAMMATICALLY by the judge (whitespace-split on the exact input above) so no hardcoded number can be wrong: words = sum of per-line token counts (14 for the input above: 4+3+5+2), lines = 4, and the frequency table is `the`×4, `dog`×4, `fox`×2, then four 1-count words (`quick`, `brown`, `lazy`, `and`). (Draft-history note: an earlier draft of this rubric's illustration said `the`×5 — a human miscount corrected before either arm ran or the judge was written; the operative rule was always programmatic computation.) All tokens are already lowercase and punctuation-free, so case/punct conventions cannot change the answer. Top-5 with ties: the judge requires the output's extracted top-5 to contain EVERY word whose count exceeds the rank-5 threshold count (here: `the`, `dog`, `fox`) plus exactly (5 − 3) = 2 further words from the tied 1-count set, in descending-frequency order overall (rank 1 appears before rank 5 in the output text). This keeps c4 mechanical and tie-fair.

Judge: `benchmarks/judge-spec10.mjs <projectDir> <countCmdTemplate> "<testCmd>"` where countCmdTemplate contains the literal `FILE` token the judge replaces with the input path (e.g. `node cli.mjs count FILE`). Family conventions: c5-first with diagnostics, recorded-flag integrity (exactly five entries), 120s caps on both spawns, unique per-run temp dir.
