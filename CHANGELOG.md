# Changelog

## 0.1.0

Initial release.

- Templates: `web`, `api`, `cli` — zero-dependency, Node >= 18.17, built-in `node:test` suites.
- `idea2prototype new <dir>` scaffolding with spec stub (`PROTOTYPE.md`) and `npm run check` wiring.
- `idea2prototype add api-crud --resource <name>`: JSON-file CRUD resource with roundtrip tests.
- `idea2prototype check`: syntax + tests + live boot probe, compact verdict, `--json` mode, non-zero exit on failure.
- ZCode plugin packaging: `idea2prototype` skill + `/proto-new`, `/proto-check` commands.
- Benchmark protocol and 10 fixed prototype specs (`benchmarks/specs.md`).
