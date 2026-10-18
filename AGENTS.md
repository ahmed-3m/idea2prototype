# AGENTS.md — developing idea2prototype itself

Guidance for coding agents working on THIS repository.

## Layout

- `skills/idea2prototype/scripts/idea2prototype.mjs` — the entire engine (single zero-dependency file). Commands: `new`, `add`, `check`, `verify`, `map`, `list`.
- `skills/idea2prototype/templates/<name>/` — scaffold templates; placeholders `{{name}}`, `{{slug}}`, `{{idea}}`, `__IDEA2PROTOTYPE_BIN__` are replaced by `new`.
- `skills/idea2prototype/templates/features/<feature>/` — feature modules: `route.tmpl.mjs` + `test.tmpl.mjs`, registered in the `FEATURES` map in the engine.
- `skills/idea2prototype/SKILL.md` — the agent-facing workflow skill (ZCode).
- `commands/` — ZCode slash commands. `tests/engine.test.mjs` — the e2e suite. `bin/i2p.mjs` — npm shim.

## Hard rules

1. **Zero dependencies, forever.** Node >= 18.17 built-ins only. No npm installs anywhere.
2. **Every template must pass check on a clean scaffold** — the engine suite enforces this; run it before claiming done: `node --test tests/engine.test.mjs`.
3. **No destructive operations.** `new` refuses non-empty dirs; nothing deletes user files.
4. Templates are exemplars: agents read them to learn the route contract. Keep them clean and commented.
5. Route contract: `routes/*.mjs` default-export route objects `{ path, methods }`; handlers get `ctx = { url, params, req, res, body, rawBody }` and return `[status, payload, headers?]`; Buffer payloads send raw.

## Windows pitfalls we already fixed (do not regress)

- Normalize `\r\n` before parsing TAP from spawned `node --test`.
- Strip `NODE_TEST_CONTEXT` from the env when spawning `node --test` from inside a test runner.
- Use `process.execPath`, never `"node"`. Pass explicit test file paths to `node --test` — glob arguments need Node >= 21.

## Conventions

Commit style: `Loop <X>: <what and why>`. Version bumps: plugin.json + package.json + the `VERSION` const + `D:/side_hustle/opensources_gh/marketplace.json` stay in sync.
