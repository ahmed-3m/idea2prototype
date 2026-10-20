# Spec 9 — paired run (Habit tracker web app), 2026-10-20

Pre-registered rubric (written BEFORE either arm ran, archived with timestamp in `D:/tmp/i2p-spec9/RUBRIC.md`, 2026-10-20T16:00:59Z; copy in this directory): `c1 app starts per its own documented command (HTML at /) · c2 create habit and retrieve it · c3 7-day grid found and a cell toggle round-trips · c4 habit + toggled cell persist across an app restart · c5 own tests pass via their documented command`. Behavioral over HTTP (habits + day-cells are naturally server-backed; "persisted" pre-registered as SERVER-side, surviving a restart — a pure-localStorage arm would fail c4 and also cannot meet the automated-tests requirement without a browser). Same builder, same model (GLM-5.3), same machine; arms run sequentially — **control first** (alternation chain: spec 5 treatment-first, 6 control-first, 8 treatment-first, 9 control-first). Criteria executed mechanically by `benchmarks/judge-spec9.mjs` (round-2 hardened family + the spec-8 review's envelope-tolerance ask, implemented here).

## Results

| Arm | Wall-clock (build) | Hand-written | Tests | Verifier | Judge |
|---|---|---|---|---|---|
| Control | ~1m55s (16:01:41→16:03:36Z), 0 fix cycles | 6 files / 298 LOC (everything) | 3 | PASS (2/3, boot skip) | 5/5 |
| Treatment | ~3m04s (16:03:44→16:06:48Z), 1 fix cycle | full-set 269 LOC as committed (incl. the `add api-crud`-generated route 80 + its adapted roundtrip test 56); hand-written layer ≈ 139 (route edits ~8, new grid test 48, frontend rewrites 68, filled spec 15) | 6 | PASS 3/3 | 5/5 |

- **Behavioral parity with persistence verified over HTTP: 5/5 = 5/5.** Both arms create uniquely-stamped habits, expose a discoverable 7-slot day grid, round-trip a slot-3 toggle through the whole-habit PUT, and keep habit + toggle across a full app restart. The judge auto-discovered each arm's grid shape (array-of-7 on both arms) and used the arm's own GET shape to build the PUT — the envelope check from the spec-8 review's ask is in.
- **LOC: treatment 269 vs 298 full-set (−10%); the hand-written layer is ≈ 139 (−53%).** The honest headline for a persistence spec: `add api-crud --resource habits` generated the store + full CRUD + roundtrip/validation tests (the spec-7 pattern — the harness's home turf), and the hand-written layer was route edits (fresh 7-day grid on create, days-length validation), one focused grid test, and the frontend grid UI. Both numbers published; the full-set convention remains the default since the spec-6 correction.
- **Tests: 6 vs 3 (2×).** Treatment = 3 scaffold contract tests + 2 adapted CRUD tests (generic `title` bodies → the habit `name` contract) + 1 new grid-semantics test. Control = 3 hand-written (store persistence incl. cache-reset round-trip, toggleDay, API round-trip).
- **Treatment's fix cycle:** the generated CRUD roundtrip test POSTed a generic `{title}` body; after the name-required edit it failed `check` — adapted to the habit contract (generated tests are yours to edit after generation; this is the composition cost of tightening a generated contract).
- **Wall-clock: control ~1m55s vs treatment ~3m04s — control faster** (warmed builder, zero fix cycles; treatment paid the add + adaptation). In-session timings, deviation 1 applies.
- **Verifier depth: treatment PASS 3/3 vs control PASS 2/3 (boot skip — listens at import, exports `{ server }`; 6th consecutive control arm in this class).**
- Hypotheses: H1 (tokens) **not measurable** — deviation 2. H2 (wall-clock ↓) **failed** (4th of the last 5 assessable runs; the spec-5 win remains the exception, driven by control harness failures that didn't recur). H3 (reliability) mixed — both harnesses green first try here; treatment's only red was the expected contract adaptation. H4 (function) **parity** — 5/5 = 5/5, mechanically judged incl. restart persistence.

## Deviations from protocol (documented honestly)

1. **Builder was the orchestrator session, not fresh subagent sessions** — Agent tool broken 4+ consecutive days; in-session sequential builds preserve the within-subject pairing but weaken the fresh-session control.
2. **Token usage not recorded** — RQ1 untested.
3. **Functional judge knew the arms** — mitigations: rubric pre-registered with timestamp before builds, criteria executed mechanically (behavioral HTTP probes, unique stamps, shape discovery from the arm's own GET), verifier arm-blind.
4. **Machine not perfectly idle**; wall-clock from unix timestamps (16:01:41→16:03:36, 16:03:44→16:06:48 UTC).
5. **Persistent stores reset before judging** (the spec-4 lesson): both arms' `data/habits.json` were removed to build-time state before the judge ran (earlier test/probe habits had accumulated); each judge run then re-poisons the store with its own uniquely-stamped habit — harmless to all criteria (presence-based, unique stamps).
6. Judge carries the round-2 family hardening + envelope tolerance from the start (spec-8 review ask); both arms judged once each with the archived copy, 5/5 = 5/5. c4's expected cell value is carried from c3 rather than assumed `true` (re-run safe on pre-toggled stores).
7. Both arms probed live end-to-end before judging: create → PUT day 3 → restart → habit present, `days[3]` retained, grid length 7.

## Reproduce

- Spec text (verbatim, both arms): "Build a working prototype: Habit tracker web app: 7-day grid per habit, toggle cells, persisted. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end. When finished reply with DONE and instructions to run it."
- Treatment = spec text + idea2prototype skill flow (engine v0.9.1 @ `1191761`-era main, scaffolded at v0.9.1: `new --template web`, `add api-crud --resource habits` (spec genuinely calls for persistence), filled PROTOTYPE.md, route edits (name required + fresh 7-day grid + days validation), adapted generated test + new grid test + frontend grid UI, `npm run check` ×2 PASS 3/3, live restart-persistence probe). Control = spec text only, full freedom: store module (file persistence, atomic tmp+rename writes) + http server (whole-item PUT + toggle endpoint) + inline-script grid UI; `npm test` 3/3 first try.
- Judge: `node benchmarks/judge-spec9.mjs <dir> <port> "npm start" api/habits "<testCmd>"` (treatment testCmd `npm run check`, control `npm test`) + `node skills/idea2prototype/scripts/idea2prototype.mjs verify <dir> --json`.
- Arms kept for inspection: `D:/tmp/i2p-spec9/{control,treatment}` (not committed — repo bloat).
