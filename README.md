# Idea2Prototype

[![CI](https://github.com/ahmed-3m/idea2prototype/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmed-3m/idea2prototype/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 18.17](https://img.shields.io/badge/node-%3E%3D18.17-green.svg)](#)

**Turn ideas into tested prototypes — token-lean, for any coding agent.** Zero-dependency scaffolds, feature modules with tests baked in, one-command verification, and a repo map for surgical context. Ships as an npm CLI (`i2p`) and a [ZCode](https://z.ai) plugin; works with any agent that can run a shell (Claude Code, Cline, OpenHands, Cursor, …).

```
$ npm run check

Idea2Prototype check — PASS (3/3)
  syntax  PASS  14 files parse clean
  tests   PASS  9 tests passed (3 files)
  boot    PASS  GET /api/health -> 200 in 41ms
```

That verdict is the whole idea: an agent building a prototype should **never generate boilerplate it didn't need to, and never read logs it didn't need to**.

## Why

Watch any coding agent build "a small app" from scratch and you'll see the same token sinks:

1. **Boilerplate emission.** The model writes 15–40 files of config, server plumbing, and test harness — 10–30k output tokens for code a template already contains.
2. **Log ingestion.** Every build/test iteration dumps 5–20k tokens of raw output into context to find the one failing assertion.
3. **Context sprawl.** The agent opens file after file to learn the codebase.

Idea2Prototype moves all three to deterministic code: `new` scaffolds a running, tested project for ~0 tokens, `check` distills syntax + tests + a live boot probe into ~60 tokens, and `map` gives a LOC-and-exports overview instead of file dumps.

| Cost per prototype | Without | With |
|---|---|---|
| Scaffold (~15 files) | ~10–30k output tokens | ~0 (deterministic copy) |
| Feedback per edit | raw logs, 5–20k tokens | verdict, ~60 tokens |
| "Does it actually boot?" | agent guesses / reads logs | boot probe, 1 line |
| Learning the codebase | open everything | `map` (~15 lines) |

## Commands

| Command | What it does |
|---|---|
| `i2p new <dir> --template web\|api\|cli` | scaffold a running, tested project (zero deps) |
| `i2p add api-crud --resource todos` | JSON-file CRUD resource + roundtrip tests |
| `i2p add auth-local` | accounts: register/login/logout/me — scrypt + HMAC-signed cookies + `requireAuth` |
| `i2p add upload` | multipart file uploads + fetch-back endpoint + tests |
| `i2p check [--json]` | syntax + tests + boot, compact verdict (also `npm run check`) |
| `i2p verify [dir] [--json]` | same verdict on ANY Node project — judge mode |
| `i2p map [dir]` | repo map: paths + LOC + exports |

Templates: `web` (static frontend + health + auto-loading routes), `api` (JSON API + route manifest), `cli` (arg-parsed tool). All Node >= 18.17, built-in `node:test`, zero installs — ever.

## Quickstart

**Any agent or plain shell:**

```bash
npx idea2prototype new my-app --template web --name "My App" --idea "recipe box"
cd my-app && npm start          # http://127.0.0.1:3000
npm run check                   # the verdict above
npx idea2prototype add api-crud --resource recipes
npx idea2prototype add auth-local
npm run check                   # still PASS — now with CRUD + auth tests
```

**ZCode plugin:** add this repo's marketplace, install `idea2prototype`, then pick the skill in the composer or use `/proto-new a recipe box with search`.

**Make any agent use it:** copy [`agents/AGENTS.md`](agents/AGENTS.md) (or `agents/CLAUDE.md`) into your project — it teaches the agent the commands and the token-discipline workflow. Point your agent at this README and it has everything it needs.

## How it compares

| | Idea2Prototype | bolt.diy / dyad | OpenHands / Cline |
|---|---|---|---|
| Runs anywhere (any agent, any OS) | ✅ one Node file | browser/app | IDE/agent-specific |
| Zero dependencies | ✅ | ❌ | ❌ |
| Tests included by default | ✅ scaffold + every feature | varies | varies |
| Feedback for agents | ~60-token verdict | UI-first | logs |
| Works offline / air-gapped | ✅ | ❌ | ✅ |

## Benchmarks

`benchmarks/specs.md` is a pre-registered protocol: paired 2-arm design (same agent with vs. without the harness), blind functional judges, a symmetric verifier (`i2p verify`), and hypotheses stated up front. Results land in that file as they're measured — failures included.

## Design rules

1. **Deterministic outside the model, instructions inside.** Anything a template can own, the template owns.
2. **Zero dependencies, forever.** No install step between "scaffolded" and "verified".
3. **Verdicts, not logs.** Failure output is capped at 3 notes so context stays clean.
4. **No destructive operations.** `new` refuses non-empty directories.
5. **Portable core.** One `.mjs` engine; plugin/skill/npm wrappers are sugar.

## Contributing

New templates and features are exactly two template files + one registry entry — see [CONTRIBUTING.md](CONTRIBUTING.md). The engine suite (`node --test "tests/*.test.mjs"`) runs on ubuntu/windows across Node 18/22/24 in CI and must stay green. `AGENTS.md` documents the architecture for humans and coding agents alike.

## License

MIT — see [LICENSE](LICENSE).
