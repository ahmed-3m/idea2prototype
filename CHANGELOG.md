# Changelog

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
