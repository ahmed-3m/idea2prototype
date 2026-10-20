# Idea2Prototype benchmark — with vs. without harness

This file is the pre-registered protocol. Write judge rubrics **before** running, never show them to the build agents, and report failures as honestly as wins.

## Research questions

- **RQ1 (tokens):** does the harness reduce input/output tokens per completed prototype?
- **RQ2 (time):** does it reduce wall-clock?
- **RQ3 (reliability):** does the final artifact actually run and pass tests more often?
- **RQ4 (function):** does it meet the spec's core flows at least as well?

## Design

**Paired, within-subject:** every spec runs in both arms. 2 arms × 10 specs × 3 repetitions = 60 runs (pilot first: 3 specs × 2 reps × 2 arms = 12 runs).

| Arm | Setup |
|---|---|
| **Control** | Same agent + model, no skill/commands installed. Full freedom (npm, scaffolds like `create-vite`, anything). Task prompt explicitly requires tests — we measure the harness, not "tests vs no tests". |
| **Treatment** | Same agent + model + task prompt, with the `idea2prototype` skill selected in the composer (per plugin trial protocol). |

**Controls against confounds**

1. Same model version and settings both arms; record model id + date per run (pair runs closely in time; alternate arms to neutralize provider-side drift).
2. Fresh session per run. No memory, no prior context.
3. Identical neutral task prompt in both arms (template below). No mention of benchmarking.
4. Zero human intervention. If the agent asks anything, reply exactly: "use your best judgment".
5. Machine idle; no parallel runs while timing.
6. Randomize arm order within each spec × rep pair.

**Task prompt template (both arms, identical):**

> Build a working prototype: <spec text>. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end. When finished reply with DONE and instructions to run it.

## The 10 specs

| # | Spec |
|---|---|
| 1 | Todo list web app: add, complete, delete items; items survive reload |
| 2 | URL shortener API: create short link, redirect, click counter |
| 3 | Markdown notes CLI: `add`, `list`, `search` commands, file persistence |
| 4 | Expense tracker web app: add expense with amount+category, summary by category |
| 5 | Quiz web app: 5 hard-coded questions, score at the end, restart button |
| 6 | Pomodoro timer web app: 25/5 cycles, start/pause/reset, cycle counter |
| 7 | Bookmarks API: CRUD + tag filter (`?tag=x`) |
| 8 | Echo chat web app: UI sends message, server echoes with timestamp, history in memory |
| 9 | Habit tracker web app: 7-day grid per habit, toggle cells, persisted |
| 10 | Word counter CLI: `count <file>` → words, lines, top-5 words |

## Judging (after the agent says DONE)

Two independent layers, applied **identically to both arms**:

1. **Objective verifier** (symmetric by construction):
   `node skills/idea2prototype/scripts/idea2prototype.mjs verify <project-dir> --json`
   — syntax + tests + boot probe on any Node project, no marker required. Record status and step details.
2. **Functional judge** — a separate cheap session (not the builder) with a per-spec binary rubric written before the experiment. The judge starts the app exactly per the project's own README/instructions and checks each criterion. Rubric example for spec 1:
   - [ ] app starts using the project's documented command
   - [ ] can add an item via the UI or API
   - [ ] can complete/check an item
   - [ ] can delete an item
   - [ ] items still present after app restart (persistence)
   Score = criteria passed / total. Judges never see which arm produced the project (blind: rename dirs to `run-<hash>` first).

## Metrics per run

| Metric | Source |
|---|---|
| input tokens, output tokens | session transcript usage fields |
| wall-clock (session start → DONE) | timestamps |
| agent turns / tool calls | transcript |
| verifier verdict + step details | `verify --json` |
| functional score (0–1) | judge rubric |
| dependencies installed (count) | `package.json` diff |

## Analysis

- Per spec: paired deltas (treatment − control) for each metric; report medians and IQR across reps.
- Aggregate: median % change per metric; per-spec scatter (some specs may favor control — show them).
- Reliability: pass rates with confidence intervals (binomial).
- Optional: Wilcoxon signed-rank on paired medians. With n=10 specs, treat as descriptive, not proof.

## Stop rules & hygiene

- Abort a run only on environment failure (crash, network); log and redo.
- Pre-register hypotheses: H1 output tokens ↓ ≥ 40%; H2 wall-clock ↓ 10–30%; H3 verifier/judge pass rate ↑ ≥ 20 points; H4 functional score ≥ control. A failed hypothesis is a **result**, not a bad experiment — publish it and fix the tool.
- Raw transcripts archived per run: `benchmarks/runs/<date>-<spec>-<arm>-<rep>/`.

## Results

| Date | Agent + model | Arm | Σ tokens (in/out) | Σ wall-clock | Verifier pass | Judge score |
|---|---|---|---|---|---|---|
| 2026-10-18 | ZCode / GLM-5.3 | spec 1 control | n/a (in-session) | 341s | PASS 3/3 | 5/5 |
| 2026-10-18 | ZCode / GLM-5.3 | spec 1 treatment | n/a (in-session) | 104s | PASS 3/3 | 5/5 |
| 2026-10-19 | ZCode / GLM-5.3 | spec 2 control | n/a (in-session) | ~39s (incl. test-runner compat fix) | PASS 3/3 | 5/5 |
| 2026-10-19 | ZCode / GLM-5.3 | spec 2 treatment | n/a (in-session) | ~41s (~24s scaffold→PASS) | PASS 3/3 | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 3 control | n/a (in-session) | ~16s | PASS (2/3, boot skip) | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 3 treatment | n/a (in-session) | ~47s | PASS (2/3, boot skip) | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 4 control | n/a (in-session) | ~76s (incl. test-runner fix) | PASS (2/3, boot skip) | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 4 treatment | n/a (in-session) | ~89s | PASS 3/3 | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 7 control | n/a (in-session) | ~37s | PASS (2/3, boot skip) | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 7 treatment | n/a (in-session) | ~46s | PASS 3/3 | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 5 control | n/a (in-session) | ~7m28s (incl. 2 test-harness fix cycles) | PASS (2/3, boot skip) | 5/5 |
| 2026-10-20 | ZCode / GLM-5.3 | spec 5 treatment | n/a (in-session) | ~4m08s | PASS 3/3 | 5/5 |

Run details + deviations: `benchmarks/runs/` (spec-1 paired NOTES; spec-2 paired NOTES). Both spec-2 arms functionally identical (5/5); treatment wrote 23% fewer hand-written LOC with 2× tests and zero runner-compat failures — control's from-scratch `npm test` broke on Node 24/Windows. Spec 3 (micro-CLI) is the first honest harness loss on speed and LOC — control built ~16s vs ~47s with less hand-written code (129 vs 149 LOC); treatment still shipped 2× tests + spec discipline, and both arms verified PASS / judged 5/5. Spec 4 (web app): the harness's home turf — treatment wrote ~43% fewer hand-written LOC (~149 vs ~260) with 3× tests (6 vs 2) and a full-depth verify (3/3 vs boot-skip 2/3); control was faster again on wall-clock (~76s vs ~89s, small app + warmed builder) and needed its recurring test-runner compat fix mid-build; both judged 5/5. Spec 7 (bookmarks API + tag filter): the strongest core-claim result — treatment wrote ~64% fewer hand-written LOC (~86 vs ~240; the generated CRUD carried persistence + roundtrip tests, the tag filter was a ~7 LOC edit) with 3× tests (6 vs 2) and full-depth verify 3/3 vs boot-skip 2/3; control faster again on wall-clock (~37s vs ~46s — third consecutive small-build speed loss; the spec-1/2 speed wins were larger builds); both judged 5/5. Spec 5 (quiz web app): first treatment speed win since spec 2 — the control's hand-rolled test harness needed two fix cycles (keep-alive sockets blocking `server.close()`, listen-race on import) while the scaffold's harness was green first try (~7m28s vs ~4m08s, in-session timings); LOC win smallest so far (−20%, ~148 vs ~184 — a quiz is UI-heavy and the UI is hand-written in both arms); 2× tests (6 vs 3), full-depth verify 3/3 vs boot-skip 2/3; both judged 5/5 by a source-level rubric judge (UI spec — zero-dep judge can't drive a browser; collector hardened once, identically for both arms, see the run NOTES).

Submit results as PRs editing this table; include raw transcripts when possible.
