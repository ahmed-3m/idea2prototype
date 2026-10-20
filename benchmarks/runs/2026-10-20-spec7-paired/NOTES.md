# Spec 7 — paired run (Bookmarks API + tag filter), 2026-10-20

Pre-registered rubric (written BEFORE either arm ran, archived with timestamp in `D:/tmp/i2p-spec7/RUBRIC.md`, 2026-10-20T09:53:04Z): `c1 API starts per its own README · c2 create bookmark (url+title+tags) · c3 update + delete roundtrip · c4 ?tag=x returns only matches AND absent tag → empty · c5 own tests pass via their documented command`. Same builder, same model (GLM-5.3), same machine; arms run sequentially — control first (order alternated from spec 4, which ran treatment first). Criteria executed mechanically by `benchmarks/judge-spec7.mjs` (judge-spec4 conventions: c5 runs first so judge writes can't poison fixtures; unique per-run tags make the only-matches assertion safe against pre-existing data).

## Results

| Arm | Wall-clock (build) | Hand-written | Tests | Verifier | Judge |
|---|---|---|---|---|---|
| Control | ~37s | 4 files / ~240 LOC (everything) | 2 | PASS (2/3, boot skip) | 5/5 |
| Treatment | ~46s | 3 files / ~86 LOC (scaffold gifted server.mjs, CRUD route + tests, package.json, README) | 6 | PASS 3/3 | 5/5 |

- **Harness's strongest result so far on its core claims.**
  - **Hand-written LOC: treatment ~86 vs control ~240 (−64%).** The generated CRUD (`add api-crud --resource bookmarks`) carried create/list/get/update/delete + persistence + roundtrip tests; the hand-written layer was just the tag-filter edit (~7 LOC), one focused test file (57), and the filled spec (~22). The tag filter itself is exactly the "small edit to a file the tool generated once" the composition model promises.
  - **Tests: 6 vs 2 (3×)** — scaffold api contract tests (3) + generated CRUD roundtrip/validation (2) + hand-written tag-filter/update/delete test (1).
  - **Wall-clock: control ~37s vs treatment ~46s.** Control won speed again (warmed in-session builder, small API) — but needed no fix cycle this time; treatment's ~46s includes the double-`check` discipline. Consistent with spec 3/4: on small builds the harness trades ~10–25s of wall-clock for structure, tests, and spec discipline.
  - **Verifier depth: treatment PASS 3/3 vs control PASS 2/3 (boot skip — server listens at import, exports no `start()`; same class as spec 4's control).**
- Hypotheses: H1 (tokens) **not measurable this run** — see deviations. H2 (wall-clock ↓) **failed this run** (3rd consecutive small-build loss; the spec-1/2 wins were larger builds). H3 (reliability) no discrimination — both PASS; control's test command worked first try this time (explicit file path). H4 (function) parity — 5/5 = 5/5, mechanically judged.

## Deviations from protocol (documented honestly)

1. **Builder was the orchestrator session, not fresh subagent sessions** — Agent tool broken 3rd consecutive day ("No reasoning level selected"). In-session sequential builds preserve the within-subject pairing but weaken the fresh-session control.
2. **Token usage not recorded** — RQ1 untested.
3. **Functional judge knew the arms** — mitigations: rubric pre-registered with timestamp before builds, criteria executed mechanically, verifier arm-blind.
4. **Machine not perfectly idle**; wall-clock from unix timestamps, rounded honestly (~37s = 09:53:28→09:54:05, ~46s = 09:54:14→09:55:00 UTC).
5. The spec-4 finding recurred on this control arm too: **`verify` never exits on foreign servers that listen at import time and export nothing** (verdict captured via output redirect + timed kill). Same engine fix queued.

## Reproduce

- Spec text (verbatim, both arms): "Build a working prototype: Bookmarks API: CRUD + tag filter (`?tag=x`). Requirements: runnable with Node.js, include automated tests, finish only when it works end to end."
- Treatment = spec text + idea2prototype skill flow (engine v0.8.0 @ `7c2db27`: `new --template api`, filled PROTOTYPE.md, `add api-crud --resource bookmarks`, tag-filter edit in routes/bookmarks.mjs + tags.test.mjs, `npm run check` ×2). Control = spec text only, full freedom.
- Judge: `node benchmarks/judge-spec7.mjs <dir> <port> "npm start" api/bookmarks "<testCmd>"` (treatment testCmd `npm run check`, control `npm test`) + `node skills/idea2prototype/scripts/idea2prototype.mjs verify <dir> --json`.
- Arms kept for inspection: `D:/tmp/i2p-spec7/{control,treatment}` (not committed — repo bloat).
