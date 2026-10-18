# Benchmark run — 2026-10-19 — Spec 1 (todo app) — TREATMENT arm

Arm: **treatment** (agent + idea2prototype v0.2.0 tooling). Single run, single rep — indicative, not a study.

## Method

Agent followed the skill workflow on spec 1: *"Todo list web app: add, complete, delete items; items survive reload."*

1. `i2p new todo-app --template web` (scaffold, 0 hand-written files)
2. `i2p add api-crud --resource todos` (CRUD + roundtrip tests, 0 hand-written files)
3. Baseline `npm run check` → PASS (3/3, 5 tests)
4. Agent-written code (the only LLM-authored artifacts): `PROTOTYPE.md` (spec fill-in) + `public/app.js` (frontend wired to /api/todos: add / toggle done / delete)
5. Final `npm run check` → **PASS (3/3), 5 tests passed, boot 200 in 46ms**
6. Live smoke: POST /api/todos then GET — item persisted to data/todos.json ✓

## Results

| Metric | Value |
|---|---|
| Wall-clock (scaffold → final PASS, incl. agent think time) | ~71 s |
| Check verdicts | baseline PASS → final PASS (no fix iterations needed) |
| Hand-written files | 2 of 8 (PROTOTYPE.md spec, public/app.js) |
| Generated files (tests, server, routes, package wiring) | 6 |
| Tests at finish | 5, all passing |

## Honest caveats

- **Single arm, single rep, same session that built the tool** — contaminated by design. The paired control arm (same spec, fresh session, no tooling) must be run separately per `benchmarks/specs.md`.
- Token counts not captured (not measurable from inside the building session). Proxy evidence of the token story: the two deterministic commands replaced the entire server/test/route layer — the only authored surface was the spec + one frontend file.
- Control-arm prompt (copy into a fresh session, no skill installed): *"Build a working prototype: todo list web app where you can add, complete and delete items, and items survive reload. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end. When finished reply with DONE and instructions to run it."*
