# Benchmark run — 2026-10-18 — Spec 1 (todo app) — PAIRED (control + treatment)

First paired data point for spec 1. Single rep per arm — indicative, not a study.
Judged with the **v0.5.1** verifier (see deviations: the control run forced a
verifier fairness fix mid-experiment).

## Arms

- **Control** — same agent/model, no idea2prototype tooling, pre-registered
  control prompt verbatim. Hand-written from scratch: `server.mjs` (node:http,
  JSON-file persistence, static serving), `public/index.html`, `public/app.js`,
  `tests/todos.test.mjs` (2 tests), `package.json`.
- **Treatment** — re-materialized per the archived method
  (`runs/2026-10-19-spec1-treatment/NOTES.md`): `i2p new --template web` +
  `i2p add api-crud --resource todos`, then the agent authors exactly two
  files: `PROTOTYPE.md` (spec fill-in) and `public/app.js` (UI wiring).

## Results (single rep)

| Metric | Control | Treatment |
|---|---|---|
| Wall-clock (start → green, incl. authoring) | 341 s | 104 s (re-run; original archived run: 71 s) |
| Hand-written files | 5 | 2 |
| Authored LOC (proxy for output tokens) | ~270 | ~80 (−70%) |
| Tests at finish | 2 | 5 (CRUD roundtrip + server + health) |
| Verifier verdict (`i2p verify`, v0.5.1) | PASS 3/3 | PASS 3/3 |
| Functional rubric (spec 1, 5 criteria) | 5/5 | 5/5 |
| Dependencies installed | 0 | 0 |

Functional rubric per `benchmarks/specs.md`: starts via documented command;
add; complete; delete; persistence after restart. Both arms passed all five
(judge script exercised each criterion over HTTP against each project).

## Hypotheses (pre-registered in specs.md) — status after this pair

- **H1 output tokens ↓ ≥ 40%**: not directly measurable in-session; authored
  surface fell from ~270 to ~80 LOC (−70%), consistent with H1 but proxy only.
- **H2 wall-clock ↓ 10–30%**: 341 s → 104 s (−70%) — beyond the hypothesis
  range, but single rep with noisy in-session timing; treat as direction only.
- **H3 pass rate ↑ ≥ 20 points**: no difference observed (both PASS 3/3).
- **H4 functional ≥ control**: met exactly (5/5 = 5/5).

## Deviations from the pre-registered protocol (all documented, none hidden)

1. **Control was built in the same session by the tool's author.** The
   protocol demands a fresh session; the subagent spawn was unavailable
   (host error `reasoning-level-missing`). Mitigation: no i2p usage, no
   template access; the control is a natural zero-dep design (node:http +
   JSON file + node:test). Contamination risk remains — the author knows the
   treatment's shape.
2. **Verifier was patched mid-experiment (v0.5.1).** The control initially
   FAILED boot under v0.5.0 because `verify` required `/api/health` — a route
   only this tool's templates ship (judge bias in the treatment's favor).
   Boot now falls back to `GET /` for foreign projects; both arms re-judged
   green under v0.5.1. Regression-tested in the engine suite.
3. **Treatment artifacts were re-materialized** — the original scratch
   directory had been cleaned up; only NOTES.md was archived. The scaffold
   half is deterministic; the two authored files were rewritten per the
   archived method. Re-run time 104 s vs the original 71 s.
4. **The functional judge was the builder**, not a separate blind session;
   the rubric is binary and exercised mechanically (HTTP calls), which limits
   discretion but does not eliminate bias.
5. **Token counts were not captured** in either arm (not measurable from
   inside the building session in this harness).

## Reproduce

Control prompt (verbatim, from the treatment NOTES): *"Build a working
prototype: todo list web app where you can add, complete and delete items,
and items survive reload. Requirements: runnable with Node.js, include
automated tests, finish only when it works end to end. When finished reply
with DONE and instructions to run it."*

Judge: `i2p verify <dir>` on both arms (v0.5.1+), plus the spec-1 rubric
exercised over HTTP (add/complete/delete/restart-persist) — the exact judge
script is committed at [`benchmarks/judge-spec1.mjs`](../../judge-spec1.mjs)
(`node benchmarks/judge-spec1.mjs <projectDir> <port>`).
