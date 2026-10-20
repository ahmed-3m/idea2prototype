# Spec 4 — paired run (Expense tracker web app), 2026-10-20

Pre-registered rubric (written BEFORE either arm ran, archived with timestamp in `D:/tmp/i2p-spec4/RUBRIC.md`, 2026-10-20T09:32:00Z): `c1 app starts per its own README · c2 add expense (amount+category) via the documented interface · c3 summary totals correct for ≥2 categories (judge adds food=10, food=5, travel=7 → expects food=15, travel=7) · c4 expenses survive an app restart · c5 own tests pass via their documented command`. Same builder, same model (GLM-5.3), same machine; arms run sequentially — treatment first (order alternated from spec 3, which ran control first). Criteria executed mechanically by `benchmarks/judge-spec4.mjs` (HTTP-driven, restart-aware, expected totals computed relative to pre-existing state so re-runs are safe).

## Results

| Arm | Wall-clock (build) | Hand-written | Tests | Verifier | Judge |
|---|---|---|---|---|---|
| Control | ~76s (incl. ~24s test-runner fix) | 6 files / ~260 LOC (everything) | 2 | PASS (2/3, boot skip) | 5/5 |
| Treatment | ~89s (incl. double-check discipline) | 5 files / ~149 LOC (scaffold gifted server.mjs, package.json, README, health+CRUD tests) | 6 | PASS 3/3 | 5/5 |

- **Mixed result, harness wins where it claims to.**
  - **Hand-written LOC: treatment ~149 vs control ~260 (−43%).** The scaffold gifted the server (174 LOC), package.json, README, the health test, and the full CRUD route + tests (`add api-crud --resource expenses`); the hand-written layer was the summary route (~17 LOC), one test file (42), the frontend rewrite (60), the spec (~20), and a small html edit.
  - **Tests: 6 vs 2 (3×).** Treatment: scaffold health test + generated CRUD roundtrip/validation + hand-written summary-restart test. Control: 2 hand-written.
  - **Wall-clock: control ~76s vs treatment ~89s.** Control was faster again on a small app with a warmed in-session builder — but ~24s of its 76s was fixing its own `npm test` runner compat (`node --test tests/` → MODULE_NOT_FOUND on Node 24/Windows; the spec-2 failure class recurring). Treatment's 89s includes the skill-mandated double `check`.
  - **Verifier depth: treatment PASS 3/3 vs control PASS 2/3 (boot skip — its server.mjs starts listening at import time and exports no `start()`, so the boot probe cannot drive it).** Both honest verdicts; the harness's export convention simply gives the fuller probe.
- Hypotheses: H1 (tokens) **not measurable this run** — see deviations. H2 (wall-clock ↓) **failed this run** — control faster (fixed overhead + warmed builder dominates a small app; consistent with spec 3). H3 (reliability) partial — both PASS, but control needed a test-runner fix mid-build and boots shallower. H4 (function) parity — 5/5 = 5/5, mechanically judged.

## Findings (fed back to the tool)

1. **`verify` never exits on foreign projects whose server.mjs listens at import time and exports nothing.** The boot probe imports the module, records the honest skip, but the imported listener (port 3000) keeps the verifier process alive forever — the verdict prints, the process hangs (reproduced: stray PID on :3000; verdict captured via file redirect). An engine fix is queued for this loop.

## Deviations from protocol (documented honestly)

1. **Builder was the orchestrator session, not fresh subagent sessions** — Agent tool broken 3rd consecutive day ("No reasoning level selected"). In-session sequential builds preserve the within-subject pairing but weaken the fresh-session control. One dispatch attempt was NOT repeated this time (established pattern; specs 1–3 precedent).
2. **Token usage not recorded** — RQ1 untested.
3. **Functional judge knew the arms** — mitigations: rubric pre-registered with timestamp before builds, criteria executed mechanically, verifier arm-blind.
4. **Judge script needed one mechanical hardening re-run** — first invocation passed URL paths as `/api/...` CLI args, which Git Bash's MSYS layer rewrote to Windows paths (`C:/Program Files/Git/api/...`). The judge now takes route paths without the leading slash (normalizing either form). Rubric criteria unchanged; both arms re-judged from scratch after the fix (5/5 both).
5. **Machine not perfectly idle**; wall-clock from unix timestamps, rounded honestly (~89s = 09:39:01→09:40:30, ~76s = 09:40:46→09:42:02 UTC).

## Reproduce

- Spec text (verbatim, both arms): "Build a working prototype: Expense tracker web app: add expense with amount+category, summary by category. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end."
- Treatment = spec text + idea2prototype skill flow (engine v0.8.0 @ `7c2db27`: `new --template web`, filled PROTOTYPE.md, `add api-crud --resource expenses`, hand-written summary route + summary test + frontend, `npm run check` ×2). Control = spec text only, full freedom (npm allowed; chose zero-dep again).
- Judge: `node benchmarks/judge-spec4.mjs <dir> <port> "npm start" api/expenses api/expenses/summary "<testCmd>"` (treatment testCmd `npm run check`, control `npm test`) + `node skills/idea2prototype/scripts/idea2prototype.mjs verify <dir> --json` (control verdict via output redirect — see Findings #1).
- Arms kept for inspection: `D:/tmp/i2p-spec4/{control,treatment}` (not committed — repo bloat).
