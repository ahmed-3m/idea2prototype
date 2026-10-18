# Idea2Prototype

**Token-lean prototype forge for coding agents.** Zero-dependency scaffolds, one-command verified checks, and the workflow skill that ties them together. Ships as a [ZCode](https://z.ai) plugin, but the engine is a single Node script any agent (Claude Code, Cline, OpenHands, Cursor, a shell) can drive.

```
$ npm run check

Idea2Prototype check — PASS (3/3)
  syntax  PASS  14 files parse clean
  tests   PASS  9 tests passed (3 files)
  boot    PASS  GET /api/health -> 200 in 41ms
```

That verdict is the whole idea: an agent building a prototype should **never generate boilerplate it didn't need to, and never read logs it didn't need to**.

## Why

Watch any coding agent build "a small app" from scratch and you'll see the same two token sinks:

1. **Boilerplate emission.** The model happily writes 15–40 files of config, server plumbing, and test harness — 10–30k output tokens for code a template already contains.
2. **Log ingestion.** Every build/test iteration dumps 5–20k tokens of raw output into context, and the model reads it all to find the one failing assertion.

Idea2Prototype moves both to deterministic code: `new` scaffolds a running, tested project for ~0 tokens, and `check` distills syntax + tests + a live boot probe into ~60 tokens. The bundled skill teaches the agent when to use each and how to keep the loop tight.

| Cost per prototype iteration | Without Idea2Prototype | With Idea2Prototype |
|---|---|---|
| Scaffold (~15 files) | ~10–30k output tokens | ~0 (deterministic copy) |
| Feedback per edit | raw logs, 5–20k tokens | verdict, ~60 tokens |
| "Does it actually boot?" | agent guesses / reads more logs | boot probe, 1 line |

## What's inside

- **Templates** (`web`, `api`, `cli`) — zero runtime dependencies, Node >= 18.17 only:
  - `web`: static frontend + health endpoint + auto-loading `routes/` + tests (built-in `node:test`)
  - `api`: JSON API with a route-manifest index + tests
  - `cli`: arg-parsed command with `--help`/`version` + spawn-based tests
- **Features**: `add api-crud --resource todos` generates a JSON-file CRUD resource (GET/POST list, GET/PUT/DELETE by id) **with its own roundtrip tests**, auto-wired into the server's route loader.
- **`check`**: `node --check` on every runnable file → `node --test` → boots the server on an ephemeral port and probes `/api/health`. Compact verdict, non-zero exit on failure, `--json` for tooling.
- **`verify [dir]`**: the same verdict on ANY Node project, no scaffold marker required — a symmetric judge for benchmarking agents with vs. without this harness (`benchmarks/specs.md`).
- **Skill + commands**: the `idea2prototype` skill and `/proto-new`, `/proto-check` commands encode the workflow (spec → scaffold → implement → check → done) and the token-discipline rules.

## Quickstart

**As a ZCode plugin** (skills + commands wired in):

1. Add this repo's root as a plugin marketplace in ZCode, install `idea2prototype`.
2. Then either pick the skill in the composer, or: `/proto-new a recipe box with search` — you get a scaffolded, spec'd, verified prototype.

**With any other agent** (or plain shell, Node >= 18.17):

```bash
node skills/idea2prototype/scripts/idea2prototype.mjs new my-app --template web --name "My App" --idea "recipe box"
cd my-app && npm start        # http://127.0.0.1:3000
npm run check                 # the verdict above
node ../skills/idea2prototype/scripts/idea2prototype.mjs add api-crud --resource recipes
npm run check                 # still PASS, now with CRUD tests
```

Point your agent at this README and it has everything it needs — that's the point.

## Design rules

1. **Deterministic outside the model, instructions inside.** Anything a template can own, the template owns. The LLM spends tokens only on the actual product logic.
2. **Zero dependencies, forever.** Templates run on bare Node. No install step between "scaffolded" and "verified".
3. **Verdicts, not logs.** `check` is the only feedback loop; it caps failure output at 3 notes so context stays clean even when things break.
4. **No destructive operations.** `new` refuses non-empty directories; nothing deletes user files.
5. **Portable core.** The engine is one `.mjs` file; plugin/skill wrappers are sugar.

## Benchmarks

`benchmarks/specs.md` contains 10 fixed prototype specs and the measurement protocol (input/output tokens, wall-clock, tests passing — with vs. without the harness). Results are welcome as PRs; the table in that file is the source of truth.

## Roadmap

- More templates (`worker`, `discord-bot`, `chrome-extension`)
- More features (`add auth-local`, `add file-upload`, `add realtime-ws`)
- `proto map` — aider-style repo map for surgical context loading
- `bench` — one-command with/without harness comparison from session transcripts

## Contributing

PRs for new templates/features are welcome: a template is a directory under `skills/idea2prototype/templates/`, a feature is a pair of `.tmpl.mjs` files plus a small registration in `scripts/idea2prototype.mjs`. Every template must pass `check` on a clean scaffold — that's the bar.

## License

MIT — see [LICENSE](LICENSE).
