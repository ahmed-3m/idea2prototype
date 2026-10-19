# Changelog

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
