# Spec 2 — paired run (URL shortener API), 2026-10-19

Pre-registered rubric (written BEFORE either arm ran): `c1 starts per own docs · c2 create short link · c3 302 redirect · c4 click counter increments · c5 survives restart`. Same builder, same model, same machine, arms run sequentially (treatment first — order alternated from spec 1).

## Results

| Arm | Wall-clock (build) | Hand-written | Tests | Verifier | Judge |
|---|---|---|---|---|---|
| Control | ~39s honest (20s to verify-PASS + ~19s compat-fix cycle) | 4 files / 229 LOC | 3 | PASS 3/3 | 5/5 |
| Treatment | ~41s total (~24s scaffold→PASS) | 3 files / 176 LOC | 6 | PASS 3/3 | 5/5 |

- **Control hit a real failure mode**: its `npm test` (`node --test tests/`) broke with MODULE_NOT_FOUND on Node 24/Windows — the directory-argument form the harness deliberately avoids by passing explicit files (encoded in AGENTS.md compat lessons). The builder burned a debug cycle fixing the script; that time is included above.
- Treatment's `npm run check` worked first try and its scaffold shipped spec discipline (`PROTOTYPE.md`) + doubled test coverage (6 vs 3, incl. restart persistence both arms).
- Both projects: zero dependencies, JSON-file persistence, identical functional surface (create/redirect/counter/stats), both survive restart with counters intact (live-verified via HTTP on both arms after kill+restart).
- Hypotheses: H1 (tokens) **not measurable this run** — see deviations. H2 (wall-clock) neutral — small API, warmed builder; the harness's win here is surface area + reliability of the feedback loop, not speed. H3 both arms passed verifier/judge (no discrimination on an easy spec). H4 functional parity (5/5 = 5/5).

## Deviations from protocol (documented honestly)

1. **Builder was the orchestrator session, not fresh subagent sessions** — the Agent tool failed its 8th consecutive attempt this account ("No reasoning level selected"); falling back to sequential in-session builds keeps the within-subject pairing (same builder, same context warmth) but weakens the fresh-session control.
2. **Token usage not recorded** (no subagent accounting; in-session token counts are not attributable per arm) — RQ1 untested this run.
3. **Functional judge knew the arms** (same session, dirs judged in place — NOT renamed) — mitigations: rubric pre-registered before builds and criteria checked mechanically over live HTTP on both arms; arm-blindness holds only for the objective verifier (`i2p verify`, the primary reliability metric).
4. Machine not perfectly idle (orchestrator live) — wall-clock figures are bounds reconstructed from unix timestamps and file mtimes, rounded honestly.

## Reproduce

- Spec text (verbatim, both arms): "Build a working prototype: URL shortener API: create short link, redirect, click counter. Requirements: runnable with Node.js, include automated tests, finish only when it works end to end."
- Treatment = spec text + idea2prototype skill available (engine at `skills/idea2prototype/scripts/idea2prototype.mjs` on main @ `624ac34`, v0.5.2); control = spec text only, full freedom.
- Arms kept for inspection: `D:/tmp/i2p-spec2/{control,treatment/shortener}` (not committed — repo bloat).
- Judge: `node skills/idea2prototype/scripts/idea2prototype.mjs verify <dir>` + rubric checks over live HTTP.
