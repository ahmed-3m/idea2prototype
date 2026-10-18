# Contributing to idea2prototype

PRs welcome — especially new templates and features. The bar is simple: **the engine suite stays green and every template passes `check` on a clean scaffold.**

## Adding a feature (`add <name>`)

1. Create `skills/idea2prototype/templates/features/<name>/route.tmpl.mjs` (+ `test.tmpl.mjs`).
   - Route contract: default-export `{ path, methods }`; handlers receive `ctx = { url, params, req, res, body, rawBody }` and return `[status, payload, headers?]`. Buffer payloads are sent raw with your content-type.
   - Tests must cover the happy path plus one validation/failure case, and use `try/finally` around `app.close()` (a leaked server hangs the runner).
2. Register it in the `FEATURES` map in `skills/idea2prototype/scripts/idea2prototype.mjs` (files mapping + summary lines).
3. Add an engine test in `tests/engine.test.mjs`: scaffold → `add <name>` → `check` must PASS.

## Adding a template (`new --template <name>`)

1. Create `skills/idea2prototype/templates/<name>/` — must include `tests/*.test.mjs` (node:test), `package.json` (with the `__IDEA2PROTOTYPE_BIN__` check script), `.idea2prototype.json` marker, `PROTOTYPE.md`, `README.md`.
2. Zero runtime dependencies. Node >= 18.17 built-ins only.
3. Add an engine test: scaffold → `check` PASS.

## Before opening a PR

```bash
node --test "tests/*.test.mjs"   # full e2e suite, all green
node --check skills/idea2prototype/scripts/idea2prototype.mjs
```

CI runs the same suite on ubuntu/windows across Node 18/22/24. See `AGENTS.md` for architecture context — it's written for coding agents and humans alike.
