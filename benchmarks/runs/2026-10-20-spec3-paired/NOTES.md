# Spec 3 — paired run (Markdown notes CLI), 2026-10-20

Pre-registered rubric (written BEFORE either arm ran, archived with timestamp in `D:/tmp/i2p-spec3/RUBRIC.md`): `c1 first use shows usage without a crash · c2 add persists a note · c3 list shows it in a fresh process · c4 search hits an existing term and cleanly misses an absent one · c5 own tests pass via its documented command`. Same builder, same model, same machine; arms run sequentially (control first — order alternated from spec 2). Criteria executed mechanically by `benchmarks/judge-spec3.mjs`.

## Results

| Arm | Wall-clock (build) | Hand-written | Tests | Verifier | Judge |
|---|---|---|---|---|---|
| Control | ~16s | 4 files / 129 LOC (everything) | 2 | PASS (2/3, boot skip) | 5/5 |
| Treatment | ~47s | 3 files / 149 LOC (scaffold gifted package.json + README) | 4 | PASS (2/3, boot skip) | 5/5 |

- **Honest mixed result — the first spec where the harness did not win on speed or LOC.** Published as a result, per the protocol.
  - **Wall-clock: control ~16s vs treatment ~47s.** Tiny CLI, warmed builder: `new` scaffold + PROTOTYPE.md discipline + a double `npm run check` cost ~3× the from-scratch build. The harness's fixed overhead dominates micro-specs; the spec-1/2 speed wins should be read as applying to larger builds.
  - **Hand-written LOC: treatment 149 vs control 129 (+15%).** The cli template's verbose switch/HELP idiom plus a filled PROTOTYPE.md outweigh the gifted package.json/README/skeletons on a project this small.
  - **What the overhead bought:** 2× tests (4 vs 2, incl. usage and unknown-command edges), explicit spec discipline (goal + out-of-scope written before code), and the verify verdict loop including a re-check pass — both CLIs are otherwise functionally identical.
  - **CLI arms and the verifier:** both PASS with boot SKIP (`no server.mjs`) — the verifier treats serverless projects honestly instead of failing them; syntax + tests still ran on both.
- Hypotheses: H1 (tokens) **not measurable this run** — see deviations. H2 (wall-clock ↓) **failed this run** — control faster; fixed overhead dominates micro-specs. H3 (reliability) no discrimination — both arms PASS verifier. H4 (function) parity — 5/5 = 5/5, mechanically judged.

## Deviations from protocol (documented honestly)

1. **Builder was the orchestrator session, not fresh subagent sessions** — the Agent tool again failed dispatch ("No reasoning level selected"; same failure as spec 2, next day). One dispatch was attempted before the control build and failed immediately; in-session sequential builds preserve the within-subject pairing (same builder, same warmth) but weaken the fresh-session control.
2. **Token usage not recorded** (not attributable per arm in-session) — RQ1 untested.
3. **Functional judge knew the arms** (same session, dirs judged in place) — mitigations: rubric pre-registered before builds, criteria executed mechanically by `judge-spec3.mjs`, objective verifier arm-blind.
4. **Machine not perfectly idle**; wall-clock from unix timestamps, rounded honestly (~16s = 22:32:20→22:32:36, ~47s = 22:33:44→22:34:31 UTC).

## Reproduce

- Spec text (verbatim, both arms): "Build a working prototype: Markdown notes CLI: `add`, `list`, `search` commands, file persistence. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end."
- Treatment = spec text + idea2prototype skill available (engine at main @ `c45ca3f`, v0.7.0: `new --template cli`, hand-written commands, filled PROTOTYPE.md, `npm run check` ×2); control = spec text only, full freedom.
- Judge: `node benchmarks/judge-spec3.mjs <dir> <entry> "<testCmd>"` (control: `notes.mjs` + `npm test`; treatment: `cli.mjs` + `npm run check`) + `node skills/idea2prototype/scripts/idea2prototype.mjs verify <dir> --json`.
- Arms kept for inspection: `D:/tmp/i2p-spec3/{control,treatment/notes}` (not committed — repo bloat).
