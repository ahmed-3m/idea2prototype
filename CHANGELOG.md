# Changelog

## 1.1.0

- Added: `list --json` — machine-readable introspection of the live template and feature set: one JSON document on stdout (`{ ok, version, templates, features }`), templates sorted from the live `TEMPLATES_DIR` scan, features in the human output's order. The human `list` output is unchanged, and unknown flags still die with the allowed list (`--json` now allowed). Consumers: `brainstorm2idea` v0.5.0 `handoff` uses this for live template discovery with a pinned fallback, so this release is fully backwards-compatible and non-urgent for existing users. Tests: JSON shape + parity with the human list + strictness preserved.

## 1.0.2

First-trial friction fixes (2026-10-21 external review) and every confirmed finding of the 2026-10-21 adversarial stress suite (new: `tests/stress.test.mjs`, `npm run test:stress`, its own CI job + a weekly fresh-seed run) — the stress fixes first:

- Fix: the web and api servers answer malformed request targets (`//%5c..%5c`, `/%E0%A4%A`, a bare `%` in a route param) with 400 — `new URL`/`decodeURIComponent` used to throw outside any handler and kill the whole server with an unhandled rejection.
- Fix: the web and api servers reject JSON bodies nested more than 100 levels deep with 400 (a linear scan of the raw text before parsing, so a hostile body allocates nothing) — `JSON.parse` accepts depth `JSON.stringify` cannot write back, so one anonymous 20k-deep POST stored by `api-crud` made every later GET/POST of that resource answer 500 "Maximum call stack size exceeded" until a restart.
- Fix: `api-crud` and `auth-local` store writes are chained and atomic (tmp + rename, as `worker-jobs` already did) — concurrent requests interleaved bare `writeFile`s, losing rows or leaving a truncated store. All three stores retry the rename on Windows' transient EPERM/EACCES/EBUSY (another process reading the file), which used to surface as a 500.
- Fix: the `rate-limit` and `cors` wrappers pass non-array handler results through instead of destructuring them ("is not iterable").
- Fix: `new` substitutes `--name`/`--idea` literally — `$'`, `$&`, `$$` were expanded as replacement patterns and corrupted the manifest after every file was written; U+2028/U+2029 are rejected up front (they end a `//` comment and broke the library template's own syntax check).
- Fix: concurrent engine runs on one project serialize on a per-project lock (stale-pid and max-age takeover serialized so two waiters cannot both take over and only ever deleting the same lock file it judged stale, a lock released mid-check retried instead of mistaken for an ancient one, an existing but unreadable lock waited on under the deadline instead of spun on, Windows delete-pending contention retried, `add` refusing to run if the lock cannot be created at all while `check`/`verify` warn and still judge, a readable wait notice, a clear timeout message) — parallel `add`s dropped features from the manifest, parallel `check`s failed each other through the shared data store.
- Fix: a hand-edited `.idea2prototype.json` with a UTF-8 BOM parses; a missing `features` list is recreated and a non-list one dies with a readable message instead of a TypeError.
- Fix: `check`/`verify` give a passing suite that logs more than 16 MiB a verdict (it used to read as "? failed"; the cap is now 256 MiB with an explicit "output exceeded" fail beyond it); a test file whose name starts with `-` runs instead of being parsed as a runner flag; the syntax step skips dot-directories (`.next/`, `.cache/`).
- Fix: `map` skips unreadable entries (a dangling symlink, an EACCES file, an unreadable root reported as `.`) and counts them instead of crashing.
- Tests: a focused engine-suite regression per finding above; each fails on the pre-fix code.

First-trial friction fixes (2026-10-21 external review):

- Fix: the `web`/`api` server templates hunt past a busy port — with no explicit `PORT`, a taken 3000 falls forward to 3001, 3002, … (Vite-style, silent: the boot URL line names the port it landed on) instead of crashing with an unhandled `EADDRINUSE` stack. An explicit `PORT` never hunts: it fails with a one-line readable error. `start(0)` (dynamic OS port, what `check` boots with) is untouched.
- Fix: `check` accepts an optional directory — `i2p check my-app` from the parent works instead of dying with "check takes no arguments"; `check` with no argument still checks the cwd. Mirrors the existing `verify [dir]`/`map [dir]` convention, including the `no such directory` guard.
- Packaging: a root `plugin.json` (name/displayName/version/description/suggestedPrompts) so agent registries that scan the repository root (Google Antigravity, Gemini CLI) discover the plugin natively; pinned to the engine version by the consistency suite alongside the other manifests.
- Packaging: `commands/` ships in the npm tarball (`files[]`) — global installs used to lose the `/proto-new` and `/proto-check` slash commands.
- Also carried from a parallel working session: marketplace/manifest fields for Antigravity (`version`, `displayName`, `category`, `skills`, `commands` pointers), an `idea2prototype` bin alias, npx fallbacks in SKILL.md/`proto-new` when `<skill-base>` is unsubstituted, and a `sep`-boundary fix for static path traversal to sibling `public-*` directories in the web template (+ regression test).
- Also from the parallel session: a Socratic-alignment step 0 in the workflow (2–3 scope questions before scaffolding when the idea is ambiguous, answers written straight into `PROTOTYPE.md`), the root `plugin.json` converged to the package description + review prompts, and port-hunting test hardening (retries-exhausted path; `npm start` on a busy explicit PORT exits 1 with the one-line message and no stack internals).
- Tests: engine + consistency suite 73 → 79.
- Fix: the tests line of a check verdict says `1 file` when a single test file ran.
- Docs: `docs/how-to-use.md` — the complete user walkthrough (every install path, the first-prototype flow, a live-captured worked session, command reference, troubleshooting), relayed from the how-to-use workflow with every captured line re-verified against the current engine; linked from the README quickstart and shipped in the npm tarball.

## 1.0.1

Fixes for the critical + high findings of the 2026-10-20 repo review:

- Security: `add api-crud` refuses resource names another feature owns (`users`, `auth`, `jobs`, `uploads`, `events`, `sse`, `ping`, `ratelimit`, `cors`, `cors-ping`, `health`). `--resource users` used to share `data/users.json` with `auth-local` — anonymous `GET /api/users` served every salt + hash, and an anonymous POST could plant a login-capable account.
- Security: `upload` serves only passive types inline (text, csv, json, raster images); everything else — including html, svg, js — comes back as `application/octet-stream` + `content-disposition: attachment`, and every response carries `x-content-type-options: nosniff` + a sandboxing CSP. Uploaded HTML used to render on the app's own origin (stored XSS).
- Fix: `verify`/`check` boot the server even when no tests exist — a `start()` that throws used to verify PASS on syntax alone. Boot still skips after a syntax failure (structured `cause` on the tests step, no string coupling).
- Fix: `verify` accepts a foreign `start()` that returns a bare `http.Server` (port via `address()`, callback-style close) and never lets a throwing/hanging `close()` replace the verdict — it crashed with `app.close(...).catch is not a function` before printing anything.
- Fix: boot runs with the project as cwd (as the tests step already did), so `verify <dir>` from elsewhere boots the same app as `verify` from inside — scaffolds used to boot with no routes and no `public/`, foreign servers failed on cwd-relative reads.
- Fix: `api-crud` POST ignores client-sent `id`/`createdAt` (two POSTs with the same `id` created duplicates, the second unreachable); PUT keeps `createdAt` too. SKILL.md/README composition snippets follow the same body-first pattern.
- Tests: regression test per finding above (engine suite + the generated template tests that every scaffold runs). The review's seventh finding — `rateLimit()` sharing one bucket map — was fixed independently on main and shipped in 1.0.0.
- Fix: the upload route's path guard checks the separator boundary (`uploads` + `/`) — a sibling directory sharing the prefix (`uploads-x/`) used to pass the traversal check (flagged in review; served inert either way).

## 1.0.0

First stable release. The scaffold contract — route objects, check/verify verdicts, `add`-module shapes — is frozen as-is; 1.x commits to additive changes only.

- Stress: every finding of the 2026-10-20 stress test (#49–#60) triaged and resolved. Data stores that fail to parse are quarantined (`data/<name>.json.corrupt-<ts>`, original bytes preserved) instead of silently wiped; single-writer and stateless-token semantics documented in the README; `ci.yml` runs with minimal permissions; README status line pinned by CI.
- Fix: `verify` (judge mode) discovers tests by node:test's own conventions (`*.test.{js,mjs,cjs}`, `test-*.js`, `*-test.js`/`*_test.js`, `test.js`, and everything under a `test/` dir, at any depth) — no more false PASS when failing tests live outside `tests/*.test.mjs` — and never reads or executes anything under `uploads/`, `data/`, `dist/`, `coverage/`, or `node_modules/`. The verdict header names its mode, boot-skip names the real cause, and an empty directory fails.
- Fix: `new` validates everything before writing a single file — reserved Windows device names (CON, NUL, COM1–9, …) and a 200-char cap apply to the final directory name AND every path component that will be created; quotes/backslashes/control characters in `--name`/`--idea` die instead of poisoning the JSON manifest mid-scaffold.
- Fix: the CLI never silently ignores input it doesn't understand — unknown flags, empty or flag-like flag values, and extra positional arguments die with the allowed list on every command; nested `new sub/proj` (missing parents created) works while an unusable parent dies with a readable message; a hung test run reports a `tests timed out` verdict on every supported Node (22's file-level runner timeout and 24's spawn-budget timeout both covered).
- Fix: `rateLimit({...})` instances own their buckets — independently configured wrappers no longer drain one shared budget (#54).
- Fix: the server templates answer oversize bodies with 413 before destroying the socket (up to 2× the limit drained so the 413 can be delivered; beyond that destroyed to bound the cost), turn contract-violating handler returns into clean 500s, clamp non-standard statuses, and send `null` for `[status]`-only returns. Both web and api templates are covered by live e2e tests.
- Fix: the package identity is scoped everywhere in-repo — `package.json` is `@ahmed-3m/idea2prototype` (what the release pipeline actually publishes); `publish.yml` no longer rewrites the name at publish time; tarball/global installs and the engine's registry-pin detection agree (pinned by a consistency test).
- CI: SHA-pinned actions upgraded to current majors (checkout v7.0.1, setup-node v7.1.0) plus weekly Dependabot bump-PRs so the pins stop rotting; nothing auto-merges.
- Benchmark: the 10-spec paired benchmark set is complete (this release archives specs 5–6 and 8–10: quiz, pomodoro, echo chat, habit tracker, word-counter CLI; spec 7 landed in 0.9.0). Across n=10: hand-written LOC −10%…−64% on 7 of 8 build-type specs (spec 6 at parity) and generated tests 2–3× the control's (parity on spec 6), full-depth verify vs. the control's recurring boot-skip; wall-clock split honestly, with the from-scratch arm faster on several small builds. All rubrics pre-registered; all judges mechanical.
- Tests: engine + consistency suite 46 → 69.

## 0.9.1

- Fix: scaffolds made through a published install (`npx`, `npm i -g`) now pin registry coordinates in the check script (`npx -y @ahmed-3m/idea2prototype@<scaffold-version> check`) instead of an absolute path into the volatile npx cache — `npm run check` survives `npm cache clean` and runs on a second machine. Checkouts (repo clone, plugin cache) still pin the stable local engine path; the exact-version guarantee is unchanged either way. Template placeholder renamed `__IDEA2PROTOTYPE_BIN__` → `__IDEA2PROTOTYPE_CMD__` to match the broader contract.
- CI: release publishes now fail loudly when `NPM_TOKEN` is missing instead of skipping with a warning — npmjs is the documented primary channel, and a mirror-only release with a green run would silently invert the README's install claims. Manual `workflow_dispatch` without the secret keeps the visible skip.

## 0.9.0

- Feature: `add worker-jobs` — the worker template's persistent job queue as a feature module for web/api projects: `enqueue`/`list`/`registerHandler`, `data/jobs.json` persistence, 3 attempts with a terminal `failed` state, disposable demo routes `POST/GET /api/jobs`. `enqueue` auto-kicks a background drain; concurrent enqueues share one serialized drain, so double-processing is designed out, and the drain exits on an empty queue (no long-lived timer; server `close()` unaffected). Closes the previously documented "web app + background jobs" cross-template gap. Review-hardened: memoized cold load (concurrent first enqueues share one array), chained atomic store writes (write-to-tmp + rename; a failed write can't poison later ones or leave a half-written store), honest drain diagnostics, handler contract documented.
- Fix: `verify` no longer hangs forever on foreign servers that listen at import time and export no `start()` (found by benchmark specs 4 + 7 control arms) — the verdict prints and the process exits explicitly, after stdout flushes, on every boot path where no app handle came back to close. An unconditional exit was rejected with evidence: it races libuv's handle wind-down after `app.close()` and aborts on Windows.
- Fix: `check` runs test files one at a time in sorted order (`--test-concurrency=1`) — concurrent test files each hold an in-memory cache over the same JSON data store and lost updates nondeterministically (found by benchmark spec 4: generated CRUD rows leaked in 2 of 3 runs). The spawn budget scales with the file count (90 s floor, 30 s/file, 5-min ceiling). Nodes without both runner flags keep the bare-runner fallback — identical to prior behavior there.
- Fix: engine `help` and header comment list the feature set correctly again (cors, sse, worker-jobs had drifted out); the worker template shares the hardened load/persist logic.
- Benchmark: specs 4 (expense tracker web) and 7 (bookmarks API + tag filter) paired runs archived — spec 4: treatment wrote ~43% fewer hand-written LOC with 3× tests and a full-depth verify (control faster on wall-clock again); spec 7: the strongest core-claim result — ~64% fewer hand-written LOC, the tag filter itself a ~7 LOC edit, 3× tests (third consecutive small-build speed loss recorded honestly). Both arms judged 5/5 by mechanical, review-hardened judges (`judge-spec4.mjs`, `judge-spec7.mjs`; rubrics pre-registered with timestamps).
- Tests: engine + consistency suite 41 → 45 (verify-exit regression, serialized-file-execution ordering, worker-jobs web/api variants).

## 0.8.0

- Feature: `add sse` — Server-Sent Events (`GET /api/events`: `text/event-stream`, immediate `connected` event, 1 s heartbeats, cleanup tied to the response stream) and the streaming route contract it introduces: handlers may write chunks directly to `ctx.res` and return nothing — the server leaves the stream open (`headersSent` guard); a handler that throws after sending headers kills the socket instead of crashing the process, and a handler that neither writes nor returns still fails as a clean 500.
- Benchmark: spec 3 (Markdown notes CLI) paired run archived — both arms verify PASS (serverless projects boot-skip honestly) and judge 5/5 via the new mechanical `judge-spec3.mjs`; the first honest harness loss on speed and hand-written LOC (~16 s vs ~47 s, 129 vs 149 LOC on a micro-CLI — fixed overhead dominates), published as a result per the pre-registered protocol.
- CI: releases now also publish to npmjs.org — NPM_TOKEN-gated with a visible skip until the secret exists (`--access public`, unconditional tag/version guard, GitHub Packages job on release events only).

## 0.7.0

Fixes for all five findings of the 2026-10-19 complex-task stress test (#16–#20):

- Fix (#16): `auth-local`'s generated test registers a unique user per run — the fixed username `alice` 409'd on the second `npm run check` because `data/users.json` persists across runs; the re-check loop is now pinned by an engine test that checks the same project twice.
- Fix (#17): the syntax step now covers `public/*.js`. Each frontend file is parsed via stdin as both ESM and classic script — only code broken in both modes fails, so sloppy-mode classic scripts pass and browser ESM works on every supported Node (no version split). Detail line names its coverage: `3 files parse clean (2 server + 1 frontend)`. Large-file parse errors handled with a 16 MiB buffer (review-hardened).
- Fix (#18): the boot probe also asks `GET /` after the health contract — a 5xx root fails boot, so a server whose every real route 500s no longer verifies PASS 3/3; 4xx roots (API-only projects) stay in the ok-range; symmetric for scaffolded and foreign projects; `judge-spec1.mjs` untouched (frozen).
- Docs (#19): "Composing features" section in SKILL.md + README with the worked auth×crud example (`requireAuth` route wrap with author stamp + session-bootstrap test pattern), executed end-to-end and pinned by an engine test that follows the documented steps literally; rule 2 reworded — "never hand-write what `add` can generate; hand-edits are yours to keep"; multi-feature stacking pinned by test (auth + api-crud×2 + rate-limit → PASS).
- Minor (#20): single-process persistence note in SECURITY.md; `rate-limit`/`cors` add summaries state the demo route is disposable (pinned by test); optional `## Modules` section in all 5 PROTOTYPE.md stubs; cross-template boundary documented — features compose within a template, templates do not compose with each other.
- Tests: engine+consistency suite 29 → 38 — re-check loop, broken/classic/large frontend files, 500-root and API-only boot probes, feature stacking, documented composition, demo-route warnings.

## 0.6.0

- Feature: `add cors` — Cross-Origin Resource Sharing wrapper (`cors({ origin, methods, headers, maxAge, credentials })`) in the rateLimit() pattern: OPTIONS preflights answered 204 + CORS headers without invoking the handler, `access-control-*` headers merged into every response, origin allowlists with matched-origin reflection; `GET/OPTIONS /api/cors-ping` demo + tests.
- Benchmark: spec 2 (URL shortener) paired run archived — both arms verify PASS 3/3 and rubric 5/5; treatment wrote 23% fewer hand-written LOC with 2× tests and zero test-runner compat failures (control's from-scratch `npm test` broke on Node 24/Windows); results table in `benchmarks/specs.md` now carries specs 1–2.

## 0.5.2

- Fix: `check`/`verify` lingered ~15s after the verdict — `withTimeout`'s timer was never cleared (web check 15.7s → 0.69s wall-clock; full engine suite minutes → ~11s).
- Fix: the booted server is closed even when a probe fails — a dropped connection used to leave a leaked listener that hung `check` indefinitely.
- Fix: `uploads/` is excluded from the syntax step (matching `map`) — user uploads can no longer fail `check`; an ESM `.js` upload was a CommonJS SyntaxError under `node --check` on Node 18.
- Test: automated version-consistency guard in CI — engine/package/plugin/template-marker versions, the CHANGELOG section, and the npm files manifest are asserted in one place; version drift is now a failing check, not a manual 8-field checklist.
- Tests: regression coverage for redirect probes, the tests-failed boot skip, `add` template applicability, uploads isolation, prompt check return, and `--json` output shapes.
- Docs: quickstart works from a clean clone today (npm `npx` form preserved under "once published"); `agents/` ships in the npm tarball; `agents/CLAUDE.md` title fixed; `help()` documents `version`.
- Repo: `main` is branch-protected — all 6 CI legs required before merge, force-pushes disabled, admins included.

## 0.5.1

- Verifier fairness fix (found by the first control-arm benchmark run): `verify`'s boot probe required `/api/health` — a route only this tool's own templates ship. Boot now falls back to `GET /` when health returns 404 and accepts any 2xx/redirect, so foreign projects that never heard of our health route are judged on whether they start and serve, not on our template's DNA.

## 0.5.0

- Feature: `add rate-limit` — per-key fixed-window limiter (`rateLimit({ max, windowMs, keyFn })` handler wrapper) with 429 + `Retry-After` + `X-RateLimit-*` headers, lazy bucket cleanup (no timers), and a live `GET /api/ping` demo route.
- `agents/AGENTS.md` + `agents/CLAUDE.md` snippets now list all five templates and all four features (they had drifted to `web|api|cli`).

## 0.4.0

- Template: `library` — importable zero-dep module (`createStore` observable state container, `memoAsync` with in-flight dedupe) plus tests; for library/util prototypes instead of apps.
- `check` boot step becomes an import smoke test for `library` scaffolds (loads `index.mjs`, verifies the public API exports) — 3/3 PASS, no server needed.
- `check` now reports scaffold/engine version drift as a non-fatal note line; `check --json` includes `scaffoldVersion`.
- Community files: issue templates (bug/feature), PR template, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- Docs: help text and SKILL.md now list all five templates (`web`, `api`, `cli`, `worker`, `library`).

## 0.3.0

- Template: `worker` — persistent job queue (JSON-file store, retry with maxAttempts, custom handlers via `registerHandler`) with restart-persistence tests.
- First archived benchmark run (treatment arm, spec 1): `benchmarks/runs/2026-10-19-spec1-treatment/` — 71s scaffold→PASS, 2 of 8 files hand-written.

## 0.2.0

- Features: `add auth-local` (scrypt + HMAC-signed cookie sessions, `requireAuth` helper), `add upload` (zero-dep multipart parser, 5MB cap, traversal guards).
- `map [dir]`: compact repo map (paths + LOC + exports) for surgical context loading.
- npm packaging: `npx idea2prototype` / `i2p` bin; publish-ready `package.json`.
- Engine self-test suite (12 e2e tests) + GitHub Actions CI (ubuntu/windows × Node 18/22/24).
- Route contract: handlers may return `[status, payload, headers]` (Set-Cookie) and Buffer payloads (raw bodies); servers expose `ctx.rawBody` for multipart.
- Agent integration snippets (`agents/AGENTS.md`, `agents/CLAUDE.md`), repo `AGENTS.md`, `CONTRIBUTING.md`.
- Windows robustness: CRLF normalization in TAP parsing; `NODE_TEST_CONTEXT` stripped for spawned test runs.

## 0.1.1

- `verify [dir] [--json]`: the check verdict on ANY Node project (no marker required) — symmetric judge mode for benchmarking with/without the harness.
- Rigorous pre-registered benchmark protocol: paired 2-arm design, blind functional judge rubrics, stop rules, hypotheses (benchmarks/specs.md).

## 0.1.0

Initial release.

- Templates: `web`, `api`, `cli` — zero-dependency, Node >= 18.17, built-in `node:test` suites.
- `idea2prototype new <dir>` scaffolding with spec stub (`PROTOTYPE.md`) and `npm run check` wiring.
- `idea2prototype add api-crud --resource <name>`: JSON-file CRUD resource with roundtrip tests.
- `idea2prototype check`: syntax + tests + live boot probe, compact verdict, `--json` mode, non-zero exit on failure.
- ZCode plugin packaging: `idea2prototype` skill + `/proto-new`, `/proto-check` commands.
- Benchmark protocol and 10 fixed prototype specs (`benchmarks/specs.md`).
